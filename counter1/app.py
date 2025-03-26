import gi
import datetime
import json
import threading
import os
import cv2
import numpy as np
import hailo
import eventlet
import signal
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib
from flask import Flask, Response, render_template, jsonify, request
from flask_socketio import SocketIO

from hailo_apps_infra.hailo_rpi_common import (
    get_default_parser,
    get_caps_from_pad,
    get_numpy_from_buffer,
    app_callback_class,
)
from hailo_apps_infra.detection_pipeline import GStreamerMultiSourceDetectionApp

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

MODEL_PATHS = {
    "yolov6n": "/home/raspberry5/hailo-rpi5-examples/resources/yolov6n.hef",
}

# Global frame buffer for all camera sources
frame_buffers = {}
HISTORY_FILE = "multisource.json"

class MultiSourceZoneVisitorCounter(app_callback_class):
    def __init__(self):
        super().__init__()
        self.frame_height = 1080
        self.frame_width = 1920
        self.data = self.load_data()
        self.inside_zones = {}
        self.active_camera = "camera1"  # Default active camera
        
        # Initialize inside_zones tracking for each camera and zone
        for camera_id in self.data:
            self.inside_zones[camera_id] = {}
            for zone in self.data[camera_id]["zones"]:
                self.inside_zones[camera_id][zone] = set()

    def load_data(self):
        """ Load camera zones and counts from file (if exists), else initialize. """
        try:
            with open(HISTORY_FILE, "r") as file:
                return json.load(file)
        except FileNotFoundError:
            # Default configuration with multiple cameras
            return {
                "camera1": {
                    "zones": {
                        "zone1": {"top_left": [640, 360], "bottom_right": [1280, 700], "in_count": 0, "out_count": 0, "inside_ids": [], "history": []}
                    }
                },
                "camera2": {
                    "zones": {
                        "zone1": {"top_left": [500, 200], "bottom_right": [900, 600], "in_count": 0, "out_count": 0, "inside_ids": [], "history": []}                 }
                }
            }

    def save_data(self):
        """ Save all camera zones and their data persistently. """
        with open(HISTORY_FILE, "w") as file:
            json.dump(self.data, file, indent=4)

    def is_inside_zone(self, x, y, top_left, bottom_right):
        """ Check if a point (x, y) is inside the defined zone. """
        return top_left[0] <= x <= bottom_right[0] and top_left[1] <= y <= bottom_right[1]

    def update_counts(self, camera_id, detected_people):
        """ Update visitor count for each zone in a specific camera and emit data to UI """
        if camera_id not in self.data:
            # Initialize data for new cameras
            self.data[camera_id] = {"zones": {
                "zone1": {"top_left": [640, 360], "bottom_right": [1280, 700], "in_count": 0, "out_count": 0, "inside_ids": [], "history": []}
            }}
            self.inside_zones[camera_id] = {}
        
        # Ensure inside_zones tracking is initialized for this camera
        if camera_id not in self.inside_zones:
            self.inside_zones[camera_id] = {}

        for zone, zone_data in self.data[camera_id]["zones"].items():
            # Initialize zone tracking if needed
            if zone not in self.inside_zones[camera_id]:
                self.inside_zones[camera_id][zone] = set()
            
            top_left = zone_data["top_left"]
            bottom_right = zone_data["bottom_right"]

            inside_zone_ids = {p_id for p_id, x, y in detected_people if self.is_inside_zone(x, y, top_left, bottom_right)}
            entered = inside_zone_ids - self.inside_zones[camera_id][zone]
            exited = self.inside_zones[camera_id][zone] - inside_zone_ids

            self.data[camera_id]["zones"][zone]["in_count"] += len(entered)
            self.data[camera_id]["zones"][zone]["out_count"] += len(exited)
            self.inside_zones[camera_id][zone] = inside_zone_ids

            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            for p_id in entered:
                self.data[camera_id]["zones"][zone]["history"].append({"id": p_id, "action": "Entered", "time": timestamp})
            for p_id in exited:
                self.data[camera_id]["zones"][zone]["history"].append({"id": p_id, "action": "Exited", "time": timestamp})

            self.data[camera_id]["zones"][zone]["inside_ids"] = list(inside_zone_ids)
            
        self.save_data()  
        socketio.emit("update_counts", {"data": self.data, "active_camera": self.active_camera})
        
    def reset_zone_counts(self, camera_id, zone):
        """ Reset counts for a specific zone in a specific camera """
        if camera_id not in self.data or zone not in self.data[camera_id]["zones"]:
            return False
            
        self.data[camera_id]["zones"][zone]["in_count"] = 0
        self.data[camera_id]["zones"][zone]["out_count"] = 0
        self.data[camera_id]["zones"][zone]["inside_ids"] = []
        if camera_id in self.inside_zones and zone in self.inside_zones[camera_id]:
            self.inside_zones[camera_id][zone] = set()
            
        self.save_data()
        socketio.emit("count_reset", {"data": self.data, "camera": camera_id, "zone": zone})
        return True

    def set_active_camera(self, camera_id):
        """ Set the active camera for UI display """
        if camera_id in self.data:
            self.active_camera = camera_id
            socketio.emit("camera_changed", {"active_camera": self.active_camera, "data": self.data})
            return True
        return False
        
    '''def delete_zone(self, camera_id, zone):
        """Delete a zone from a specific camera"""
        if camera_id not in self.data or zone not in self.data[camera_id]["zones"]:
            return False
            
        # Remove zone data
        del self.data[camera_id]["zones"][zone]
        
        # Remove from inside_zones tracking
        if camera_id in self.inside_zones and zone in self.inside_zones[camera_id]:
            del self.inside_zones[camera_id][zone]
            
        self.save_data()
        socketio.emit("zone_deleted", {"data": self.data, "camera": camera_id, "zone": zone})
        return True'''
        

# Initialize user data
user_data = MultiSourceZoneVisitorCounter()

@socketio.on("set_zone")
def handle_set_zone(data):
    """ Handle zone updates from the UI """
    camera_id = data["camera_id"]
    zone = data["zone"]
    top_left = data["top_left"]
    bottom_right = data["bottom_right"]
    
    if camera_id not in user_data.data:
        user_data.data[camera_id] = {"zones": {}}
        user_data.inside_zones[camera_id] = {}
        
    if zone not in user_data.data[camera_id]["zones"]:
        user_data.data[camera_id]["zones"][zone] = {
            "top_left": top_left,
            "bottom_right": bottom_right,
            "in_count": 0,
            "out_count": 0,
            "inside_ids": [],
            "history": []
        }
        user_data.inside_zones[camera_id][zone] = set()
    else:
        user_data.data[camera_id]["zones"][zone]["top_left"] = top_left
        user_data.data[camera_id]["zones"][zone]["bottom_right"] = bottom_right
        
    user_data.save_data()
    socketio.emit("zone_updated", {"data": user_data.data, "camera": camera_id, "zone": zone})
    
@socketio.on("reset_zone_counts")
def handle_reset_zone_counts(data):
    """ Handle zone count reset from UI """
    camera_id = data["camera_id"]
    zone = data["zone"]
    success = user_data.reset_zone_counts(camera_id, zone)
    if not success:
        socketio.emit("error", {"message": f"Zone {zone} in camera {camera_id} not found"})

@socketio.on("set_active_camera")
def handle_set_active_camera(data):
    """ Handle camera switch from UI """
    camera_id = data["camera_id"]
    success = user_data.set_active_camera(camera_id)
    if not success:
        socketio.emit("error", {"message": f"Camera {camera_id} not found"})

def visitor_counter_callback(pad, info, user_data):
    """
    Process video frames, detect people, and update zone counts
    This function is called for each frame from each camera source
    """
    buffer = info.get_buffer()
    if buffer is None:
        print("Error: No buffer available")
        return Gst.PadProbeReturn.OK

    try:
        format, width, height = get_caps_from_pad(pad)
        if format is None or width is None or height is None:
            print("Error: Could not get format/dimensions from pad")
            return Gst.PadProbeReturn.OK

        # Get frame as numpy array
        np_frame = get_numpy_from_buffer(buffer, format, width, height)
        frame = cv2.cvtColor(np_frame, cv2.COLOR_RGB2BGR)

        # Determine which camera source this frame is from
        element = pad.get_parent_element()
        element_name = element.get_name()
        
        # Extract source index from element name
        source_index = 0  # Default to camera1
        if "identity_callback_" in element_name:
            try:
                source_index = int(element_name.split("identity_callback_")[-1])
            except ValueError:
                print(f"Couldn't parse source from {element_name}, defaulting to camera1")
                source_index = 0
        
        camera_id = f"camera{source_index + 1}"
        #print(f"Processing frame from {camera_id}")

        # Get people detections
        detected_people = set()
        roi = hailo.get_roi_from_buffer(buffer)
        if roi is None:
            print(f"Error: Could not get ROI from buffer for {camera_id}")
            return Gst.PadProbeReturn.OK
        
        for d in hailo.get_roi_from_buffer(buffer).get_objects_typed(hailo.HAILO_DETECTION):
            if d.get_label() == "person":
                x1, y1, x2, y2 = d.get_bbox().xmin() * width, d.get_bbox().ymin() * height, d.get_bbox().xmax() * width, d.get_bbox().ymax() * height
                center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
                person_id = d.get_objects_typed(hailo.HAILO_UNIQUE_ID)[0].get_id() if d.get_objects_typed(hailo.HAILO_UNIQUE_ID) else -1
                detected_people.add((person_id, center_x, center_y))

        # Draw zones on frame
        if camera_id in user_data.data:
            for zone, data in user_data.data[camera_id]["zones"].items():
                top_left = tuple(map(int, data["top_left"]))
                bottom_right = tuple(map(int, data["bottom_right"]))
                cv2.rectangle(frame, top_left, bottom_right, (0, 0, 255), 2)
                cv2.putText(frame, f"{zone} (In: {data['in_count']}, Out: {data['out_count']})", 
                           (top_left[0], top_left[1] - 10), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)

        # Update global frame buffer
        global frame_buffers
        frame_buffers[camera_id] = frame

        # Update counts for this camera
        user_data.update_counts(camera_id, detected_people)
        
    except Exception as e:
        print(f"Error in callback: {e}")

    return Gst.PadProbeReturn.OK

@socketio.on("delete_zone")
def handle_delete_zone(data):
    """Handle zone deletion from UI"""
    camera_id = data["camera_id"]
    zone = data["zone"]
    success = user_data.delete_zone(camera_id, zone)
    if not success:
        socketio.emit("error", {"message": f"Zone {zone} in camera {camera_id} not found"})
        
        
@app.route("/")
def index():
    return render_template("index3.html")

@app.route("/video_feed")
def video_feed():
    camera_id = request.args.get("camera_id", user_data.active_camera)
    return Response(generate_frames(camera_id), mimetype="multipart/x-mixed-replace; boundary=frame")

def generate_frames(camera_id):
    """Generate video stream frames for the specified camera"""
    global frame_buffers
    while True:
        if camera_id in frame_buffers and frame_buffers[camera_id] is not None:
            _, buffer = cv2.imencode(".jpg", frame_buffers[camera_id])
            frame = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        else:
            # If camera feed not available, yield a blank frame
            blank_frame = np.zeros((480, 640, 3), np.uint8)
            cv2.putText(blank_frame, f"Camera {camera_id} not available", (50, 240), 
                       cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            _, buffer = cv2.imencode(".jpg", blank_frame)
            frame = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

@app.route("/get_snapshot")
def get_snapshot():
    """Get a snapshot from the specified camera"""
    global frame_buffers
    camera_id = request.args.get("camera_id", user_data.active_camera)
    
    if camera_id in frame_buffers and frame_buffers[camera_id] is not None:
        _, buffer = cv2.imencode('.jpg', frame_buffers[camera_id])
        return Response(
            buffer.tobytes(),
            mimetype='image/jpeg'
        )
    return ('No frame available for this camera', 404)

@app.route("/get_cameras")
def get_cameras():
    """Return list of available cameras"""
    return jsonify({"cameras": list(user_data.data.keys()), "active_camera": user_data.active_camera})

@app.route("/get_zones")
def get_zones():
    """Return zones for all cameras"""
    return jsonify({"data": user_data.data})

if __name__ == "__main__":
    parser = get_default_parser()
    parser.add_argument("--sources", nargs="+", default=[
        "rtsp://admin:admin123@10.71.172.253:554/cam/realmonitor?channel=1&subtype=1",
        "/dev/video0"
        #"/home/pi/hailo-rpi5-examples/venv_hailo_rpi5_examples/lib/python3.11/site-packages/resources/example.mp4"
    ], help="Video sources (RTSP URLs, device paths, or video files)")
    args = parser.parse_args()
    
    video_sources = args.sources
    print(f"Using video sources: {video_sources}")
    
    # Initialize the GStreamer application with multiple sources
    app_instance = GStreamerMultiSourceDetectionApp(visitor_counter_callback, user_data, video_sources)
    app_instance.create_pipeline()
    
    # Add probes manually to all identity elements
    for i in range(len(video_sources)):
        identity_name = f"identity_callback{'' if i == 0 else '_'+str(i)}"
        identity_element = app_instance.pipeline.get_by_name(identity_name)
        if identity_element:
            src_pad = identity_element.get_static_pad("src")
            if src_pad:
                print(f"Adding probe to {identity_name}")
                src_pad.add_probe(Gst.PadProbeType.BUFFER, visitor_counter_callback, user_data)
            else:
                print(f"Could not get src pad from {identity_name}")
        else:
            print(f"Could not find element {identity_name}")
    
    # Start the pipeline in a separate thread
    threading.Thread(target=app_instance.run, daemon=True).start()
    
    # Run the Flask web server
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
