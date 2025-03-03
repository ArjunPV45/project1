import gi
import datetime
import json
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib
import os
import numpy as np
import hailo
import threading
import cv2
import eventlet
import signal
from flask import Flask, Response, render_template, jsonify, request
from flask_socketio import SocketIO

from hailo_apps_infra.hailo_rpi_common import (
    get_default_parser, 
    get_caps_from_pad,
    get_numpy_from_buffer,
    app_callback_class,
)
from hailo_apps_infra.detection_pipeline import GStreamerDetectionApp

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

MODEL_PATHS = {
    "yolov6n": "/home/raspberry5/hailo-rpi5-examples/resources/yolov6n.hef",
}

frame_buffer = None  
HISTORY_FILE = "multi_zone_data.json"

class MultiZoneVisitorCounter(app_callback_class):
    def __init__(self):
        super().__init__()
        self.frame_height = 1080
        self.frame_width = 1920  
        self.zones = self.load_zones()
        self.inside_zones = {zone: set() for zone in self.zones}

        
        for zone in self.zones:
            self.zones[zone]["in_count"] = 0
            self.zones[zone]["out_count"] = 0

    def load_zones(self):
        """ Load zones from file (if exists), else initialize. """
        try:
            with open(HISTORY_FILE, "r") as file:
                return json.load(file)["zones"]
        except FileNotFoundError:
            return {
                "zone1": {"top_left": [640, 360], "bottom_right": [1280, 700], "in_count": 0, "out_count": 0, "inside_ids": [], "history": []},
                "zone2": {"top_left": [100, 100], "bottom_right": [500, 500], "in_count": 0, "out_count": 0, "inside_ids": [], "history": []},
                "zone3": {"top_left": [500, 200], "bottom_right": [900, 600], "in_count": 0, "out_count": 0, "inside_ids": [], "history": []},
                "zone4": {"top_left": [1200, 400], "bottom_right": [1300, 700], "in_count": 0, "out_count": 0, "inside_ids": [], "history": []}
                
            }

    def save_zones(self):
        """ Save zones and their data persistently. """
        with open(HISTORY_FILE, "w") as file:
            json.dump({"zones": self.zones}, file, indent=4)

    def is_inside_zone(self, x, y, top_left, bottom_right):
        """ Check if a point (x, y) is inside the defined zone. """
        return top_left[0] <= x <= bottom_right[0] and top_left[1] <= y <= bottom_right[1]

    def update_counts(self, detected_people):
        """ Update visitor count for each zone and emit data to UI """
        for zone, zone_data in self.zones.items():
            top_left = zone_data["top_left"]
            bottom_right = zone_data["bottom_right"]

            inside_zone_ids = {p_id for p_id, x, y in detected_people if self.is_inside_zone(x, y, top_left, bottom_right)}
            entered = inside_zone_ids - self.inside_zones[zone]
            exited = self.inside_zones[zone] - inside_zone_ids

            self.zones[zone]["in_count"] += len(entered)
            self.zones[zone]["out_count"] += len(exited)
            self.inside_zones[zone] = inside_zone_ids

            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            for p_id in entered:
                self.zones[zone]["history"].append({"id": p_id, "action": "Entered", "time": timestamp})
            for p_id in exited:
                self.zones[zone]["history"].append({"id": p_id, "action": "Exited", "time": timestamp})

            self.zones[zone]["inside_ids"] = list(inside_zone_ids)
            
        self.save_zones()  
        socketio.emit("update_counts", {"zones": self.zones})
        
    def reset_zone_counts(self, zone):
        if zone not in self.zones:
             return False
        self.zones[zone]["in_count"] = 0
        self.zones[zone]["out_count"] = 0
        self.zones[zone]["inside_ids"] = []
        self.inside_zones[zone] = set()
            
        self.save_zones()
        socketio.emit("count_reset", {"zones":self.zones})
        return True       

user_data = MultiZoneVisitorCounter()

@socketio.on("set_zone")
def handle_set_zone(data):
    """ Handle zone updates from the UI """
    zone = data["zone"]
    top_left = data["top_left"]
    bottom_right = data["bottom_right"]
    
    if zone not in user_data.zones:
        user_data.zones[zone] ={
            "top_left":top_left,
            "bottom_right":bottom_right,
            "in_count":0,
            "out_count":0,
            "inside_ids": set()
        }
    else:
        user_data.zones[zone]["top_left"] = top_left
        user_data.zones[zone]["bottom_right"] = bottom_right
        
    user_data.save_zones()
    socketio.emit("zone_updated", {"zones": user_data.zones})
    
@socketio.on("reset_zone_counts")
def handle_reset_zone_counts(data):
    zone = data["zone"]
    success = user_data.reset_zone_counts(zone)
    if not success:
        socket.emit("error" , {"message": f"Zone {zone} not found"})     

def visitor_counter_callback(pad, info, user_data):
    global frame_buffer

    buffer = info.get_buffer()
    if buffer is None:
        return Gst.PadProbeReturn.OK

    format, width, height = get_caps_from_pad(pad)
    if format is None or width is None or height is None:
        return Gst.PadProbeReturn.OK

    np_frame = get_numpy_from_buffer(buffer, format, width, height)
    frame = cv2.cvtColor(np_frame, cv2.COLOR_RGB2BGR)

    detected_people = set()
    for d in hailo.get_roi_from_buffer(buffer).get_objects_typed(hailo.HAILO_DETECTION):
        if d.get_label() == "person":
            x1, y1, x2, y2 = d.get_bbox().xmin() * width, d.get_bbox().ymin() * height, d.get_bbox().xmax() * width, d.get_bbox().ymax() * height
            center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
            person_id = d.get_objects_typed(hailo.HAILO_UNIQUE_ID)[0].get_id() if d.get_objects_typed(hailo.HAILO_UNIQUE_ID) else -1
            detected_people.add((person_id, center_x, center_y))

    user_data.update_counts(detected_people)

    
    for zone, data in user_data.zones.items():
        top_left = tuple(map(int, data["top_left"]))
        bottom_right = tuple(map(int, data["bottom_right"]))
        cv2.rectangle(frame, top_left, bottom_right, (0, 255, 0), 2)
        cv2.putText(frame, zone, (top_left[0], top_left[1] - 10), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

    frame_buffer = frame
    return Gst.PadProbeReturn.OK

@app.route("/")
def index():
    return render_template("index1.html")

@app.route("/video_feed")
def video_feed():
    return Response(generate_frames(), mimetype="multipart/x-mixed-replace; boundary=frame")

def generate_frames():
    global frame_buffer
    while True:
        if frame_buffer is not None:
            _, buffer = cv2.imencode(".jpg", frame_buffer)
            frame = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
                   
                   
@app.route("/get_snapshot")
def get_snapshot():
    global frame_buffer
    if frame_buffer is not None:
        # Convert the frame to JPEG format
        _, buffer = cv2.imencode('.jpg', frame_buffer)
        # Create response with the JPEG data
        return Response(
            buffer.tobytes(),
            mimetype='image/jpeg'
        )
    return ('No frame available', 404)
    
    
if __name__ == "__main__":
    parser = get_default_parser()
    args = parser.parse_args()

    app_instance = GStreamerDetectionApp(visitor_counter_callback, user_data)

    threading.Thread(target=app_instance.run, daemon=True).start()
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
