const socket = io();
let activeCamera = "camera1";
let selectedZone = "zone1";
let currentSnapshotImage = null;
let isDrawing = false;
let startX, startY, endX, endY;

// ========== PIPELINE START & CAMERA SWITCH (from script3.js) ==========
document.addEventListener("DOMContentLoaded", function () {
    const form = document.getElementById("start-pipeline-form");
    const textarea = document.getElementById("source-urls");
    const cameraButtonsDiv = document.getElementById("camera-buttons");
    const videoFeed = document.getElementById("video-feed");

    form.addEventListener("submit", async function (e) {
        e.preventDefault();

        const sources = textarea.value
            .split("\n")
            .map(url => url.trim())
            .filter(url => url.length > 0);

        if (sources.length === 0) {
            alert("Please enter at least one video source.");
            return;
        }

        try {
            const res = await fetch("/start_pipeline", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sources })
            });

            const result = await res.json();
            if (result.success) {
                cameraButtonsDiv.innerHTML = "";
                sources.forEach((src, index) => {
                    const camId = `camera${index + 1}`;
                    const btn = document.createElement("button");
                    btn.textContent = `Camera ${index + 1}`;
                    btn.addEventListener("click", () => {
                        activeCamera = camId;
                        videoFeed.src = `/video_feed?camera_id=${camId}`;
                        socket.emit("set_active_camera", { camera_id: camId });
                        highlightActiveCamera(btn);
                        loadZonesForCamera(camId);
                    });
                    cameraButtonsDiv.appendChild(btn);
                });

                activeCamera = "camera1";
                videoFeed.src = `/video_feed?camera_id=camera1`;
                socket.emit("set_active_camera", { camera_id: "camera1" });
                loadZonesForCamera("camera1");
            }
        } catch (err) {
            console.error("Failed to start pipeline:", err);
        }
    });

    function highlightActiveCamera(activeBtn) {
        document.querySelectorAll("#camera-buttons button").forEach(btn => {
            btn.classList.remove("active");
        });
        activeBtn.classList.add("active");
    }
});

// ========== SNAPSHOT + ZONE DRAWING (from script2.js) ==========
document.getElementById("snapshot-btn").addEventListener("click", () => {
    fetch(`/get_snapshot?camera_id=${activeCamera}`)
        .then(res => res.blob())
        .then(blob => {
            const imgURL = URL.createObjectURL(blob);
            currentSnapshotImage = imgURL;
            document.getElementById("snapshot-image").src = imgURL;
            document.getElementById("snapshot-modal").classList.remove("hidden");
        });
});

document.getElementById("close-snapshot").addEventListener("click", () => {
    document.getElementById("snapshot-modal").classList.add("hidden");
});

document.querySelectorAll(".zone-buttons button").forEach(btn => {
    btn.addEventListener("click", () => {
        selectedZone = btn.getAttribute("data-zone");
    });
});

const canvas = document.getElementById("snapshot-overlay");
const img = document.getElementById("snapshot-image");
const ctx = canvas.getContext("2d");

img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
};

canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    isDrawing = true;
});

canvas.addEventListener("mouseup", (e) => {
    if (!isDrawing) return;
    const rect = canvas.getBoundingClientRect();
    endX = e.clientX - rect.left;
    endY = e.clientY - rect.top;
    isDrawing = false;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "red";
    ctx.lineWidth = 2;
    ctx.strokeRect(startX, startY, endX - startX, endY - startY);

    const topLeft = [Math.min(startX, endX), Math.min(startY, endY)];
    const bottomRight = [Math.max(startX, endX), Math.max(startY, endY)];

    socket.emit("set_zone", {
        camera_id: activeCamera,
        zone: selectedZone,
        top_left: topLeft,
        bottom_right: bottomRight
    });
});

// ========== RESET ZONE COUNTS ==========
document.querySelectorAll(".reset-button").forEach(button => {
    button.addEventListener("click", () => {
        const zone = button.id.replace("reset-", "");
        socket.emit("reset_zone_counts", { camera_id: activeCamera, zone: zone });
    });
});

// ========== ZONE COUNT UPDATES ==========
socket.on("update_counts", ({ data, active_camera }) => {
    const camData = data[activeCamera];
    if (!camData || !camData.zones) return;

    for (const [zone, info] of Object.entries(camData.zones)) {
        document.getElementById(`${zone}_in`).textContent = info.in_count;
        document.getElementById(`${zone}_out`).textContent = info.out_count;
        const ul = document.getElementById(`${zone}_inside_ids`);
        ul.innerHTML = "";
        info.inside_ids.forEach(id => {
            const li = document.createElement("li");
            li.textContent = id;
            ul.appendChild(li);
        });

        const historyTable = document.querySelector("#history_table tbody");
        historyTable.innerHTML = "";
        info.history.forEach(entry => {
            const row = document.createElement("tr");
            row.className = entry.action.toLowerCase();
            row.innerHTML = `
                <td>${zone}</td>
                <td>${entry.id}</td>
                <td>${entry.action}</td>
                <td>${entry.time}</td>
            `;
            historyTable.appendChild(row);
        });
    }
});

socket.on("count_reset", ({ data, camera, zone }) => {
    if (camera === activeCamera) {
        document.getElementById(`${zone}_in`).textContent = "0";
        document.getElementById(`${zone}_out`).textContent = "0";
        document.getElementById(`${zone}_inside_ids`).innerHTML = "";
    }
});

socket.on("zone_updated", ({ data, camera, zone }) => {
    if (camera === activeCamera) {
        console.log(`Zone ${zone} updated`);
    }
});

socket.on("camera_changed", ({ active_camera }) => {
    activeCamera = active_camera;
});

// Optional: Load initial zone data
function loadZonesForCamera(camera_id) {
    fetch("/get_zones")
        .then(res => res.json())
        .then(json => {
            const camZones = json.data[camera_id];
            if (!camZones || !camZones.zones) return;
            // Trigger UI update manually if needed
            socket.emit("set_active_camera", { camera_id });
        });
}
