// Socket connection
var socket = io("http://10.71.172.147:5000");

// State management
let selectedZone = null;
let isDrawing = false;
let startPoint = null;
let zones = {};

// Zone colors with transparency
const zoneColors = {
    zone1: 'rgba(255, 0, 0, 0.3)',    // Red
    zone2: 'rgba(0, 255, 0, 0.3)',    // Green
    zone3: 'rgba(0, 0, 255, 0.3)',    // Blue
    zone4: 'rgba(165, 200, 0, 0.3)'   // Orange
    //zone5: 'rgba(225, 200, 0. 0.3)' 
};

// Initialize canvas and video elements
//const videoFeed = document.getElementById("video-feed");
const videoFeed = document.getElementById("snapshot-image");
const canvasOverlay = document.getElementById("zone-overlay");
const ctx = canvasOverlay.getContext("2d");

// Setup canvas dimensions
function setupCanvas() {
    canvasOverlay.width = 1920;//videoFeed.offsetWidth;
    canvasOverlay.height = 1080;//videoFeed.offsetHeight;
}

// Initialize on load
videoFeed.onload = function() {
    setupCanvas();
    drawAllZones();
};

// Handle window resize
window.addEventListener('resize', () => {
    setupCanvas();
    drawAllZones();
});

// Zone button event listeners
document.querySelectorAll('.zone-buttons button').forEach(button => {
    button.addEventListener('click', (e) => {
        // Reset any active buttons
        document.querySelectorAll('.zone-buttons button').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Set active state
        button.classList.add('active');
        selectedZone = button.getAttribute('data-zone');
        isDrawing = true;
        
        // Show helper message
        showToast('Click and drag to draw the zone');
    });
});

document.getElementById('snapshot-btn').addEventListener('click', takeSnapshot);

document.getElementById('reset-zone1').addEventListener('click', () => resetZoneCounts('zone1'));
document.getElementById('reset-zone2').addEventListener('click', () => resetZoneCounts('zone2'));
document.getElementById('reset-zone3').addEventListener('click', () => resetZoneCounts('zone3'));
document.getElementById('reset-zone4').addEventListener('click', () => resetZoneCounts('zone4'));

// Function to reset zone counts
function resetZoneCounts(zone) {
    // Emit event to server to reset counts for specific zone
    socket.emit("reset_zone_counts", { zone: zone });
    showToast(`Reset counts for ${zone}`);
}

// Canvas drawing event listeners
canvasOverlay.addEventListener('mousedown', startDrawing);
canvasOverlay.addEventListener('mousemove', drawZone);
canvasOverlay.addEventListener('mouseup', finishDrawing);
canvasOverlay.addEventListener('mouseleave', cancelDrawing);

// Touch event listeners for mobile support
canvasOverlay.addEventListener('touchstart', handleTouchStart);
canvasOverlay.addEventListener('touchmove', handleTouchMove);
canvasOverlay.addEventListener('touchend', handleTouchEnd);


function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    canvasOverlay.dispatchEvent(mouseEvent);
}

function handleTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY
    });
    canvasOverlay.dispatchEvent(mouseEvent);
}

function handleTouchEnd(e) {
    e.preventDefault();
    const mouseEvent = new MouseEvent('mouseup', {});
    canvasOverlay.dispatchEvent(mouseEvent);
}

function startDrawing(e) {
    if (!selectedZone || !isDrawing) return;
    
    const rect = canvasOverlay.getBoundingClientRect();
    startPoint = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
}

function drawZone(e) {
    if (!startPoint) return;
    
    const rect = canvasOverlay.getBoundingClientRect();
    const currentPoint = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    
    // Clear canvas and redraw all zones
    ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
    drawAllZones();
    
    // Draw current selection
    ctx.fillStyle = zoneColors[selectedZone];
    ctx.strokeStyle = zoneColors[selectedZone].replace('0.3', '1');
    ctx.lineWidth = 2;
    
    const width = currentPoint.x - startPoint.x;
    const height = currentPoint.y - startPoint.y;
    
    ctx.fillRect(startPoint.x, startPoint.y, width, height);
    ctx.strokeRect(startPoint.x, startPoint.y, width, height);
}

function finishDrawing(e) {
    if (!startPoint || !selectedZone) return;
    
    const rect = canvasOverlay.getBoundingClientRect();
    const endPoint = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
    };
    
    // Calculate normalized coordinates
    const scaleX = 1920 / canvasOverlay.width;  // Assuming original video width is 1920
    const scaleY = 1080 / canvasOverlay.height; // Assuming original video height is 1080
    
    const zoneData = {
        zone: selectedZone,
        top_left: [
            Math.round(Math.min(startPoint.x, endPoint.x) * scaleX),
            Math.round(Math.min(startPoint.y, endPoint.y) * scaleY)
        ],
        bottom_right: [
            Math.round(Math.max(startPoint.x, endPoint.x) * scaleX),
            Math.round(Math.max(startPoint.y, endPoint.y) * scaleY)
        ]
    };
    
    // Send zone data to server
    socket.emit("set_zone", zoneData);
    
    // Reset drawing state
    startPoint = null;
    selectedZone = null;
    isDrawing = false;
    
    // Reset button states
    document.querySelectorAll('.zone-buttons button').forEach(btn => {
        btn.classList.remove('active');
    });
    
    showToast('Zone updated successfully');
}

function cancelDrawing() {
    if (startPoint) {
        startPoint = null;
        ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
        drawAllZones();
    }
}

function drawAllZones() {
    ctx.clearRect(0, 0, canvasOverlay.width, canvasOverlay.height);
    
    Object.entries(zones).forEach(([zone, data]) => {
        const scaleX = canvasOverlay.width / 1920;
        const scaleY = canvasOverlay.height / 1080;
        
        const x1 = data.top_left[0] * scaleX;
        const y1 = data.top_left[1] * scaleY;
        const x2 = data.bottom_right[0] * scaleX;
        const y2 = data.bottom_right[1] * scaleY;
        
        ctx.fillStyle = zoneColors[zone];
        ctx.strokeStyle = zoneColors[zone].replace('0.3', '1');
        ctx.lineWidth = 2;
        
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        
        // Add zone label
        ctx.fillStyle = 'white';
        ctx.font = '14px Arial';
        ctx.fillText(zone.toUpperCase(), x1 + 5, y1 + 20);
    });
}

function takeSnapshot(){
    fetch('/get_snapshot')
        .then(response =>{
            if (!response.ok){
                throw new Error('Network response was not ok');
            }
            return response.blob();
         })
         .then(blob =>{
             const imageUrl = URL.createObjectURL(blob);
             const snapshotImage = document.getElementById('snapshot-image');
             snapshotImage.src = imageUrl;
             document.getElementById('snapshot-model').classList.remove('hidden');
         })
         .catch(errot =>{
             console.error('Error taking snapshot:', error);
         });
}                        


// Socket event handlers
socket.on("zone_updated", function(data) {
    zones = data.zones;
    drawAllZones();
    showToast('Zones synchronized with server');
});

socket.on("count_reset", function(data) {
    const zone = data.zone;
    document.getElementById(`${zone}_in`).innerText = 0;
    document.getElementById(`${zone}_out`).innerText = 0;
    document.getElementById(`${zone}_inside_ids`).innerHTML = '';
    
    const zoneBox = document.getElementById(`${zone}_box`);
    zoneBox.classList.remove('occupied');
    
    showToast(`Counts for ${zone} have been reset`);
    
});

    
socket.on("update_counts", function(data) {
    Object.entries(data.zones).forEach(([zone, zoneData]) => {
        // Update counts
        document.getElementById(`${zone}_in`).innerText = zoneData.in_count;
        document.getElementById(`${zone}_out`).innerText = zoneData.out_count;
        
        // Update inside IDs list
        const idsList = document.getElementById(`${zone}_inside_ids`);
        idsList.innerHTML = '';
        zoneData.inside_ids.forEach(id => {
            const li = document.createElement('li');
            li.textContent = `Person ${id}`;
            idsList.appendChild(li);
        });
        
        // Update zone box styling based on occupancy
        const zoneBox = document.getElementById(`${zone}-box`);
        if (zoneData.inside_ids.length > 0) {
            zoneBox.classList.add('occupied');
        } else {
            zoneBox.classList.remove('occupied');
        }
    });
    
    updateHistory(data.zones);
});

function updateHistory(zones) {
    const tbody = document.getElementById("history_table").getElementsByTagName("tbody")[0];
    tbody.innerHTML = '';
    
    // Combine all history entries
    const allHistory = [];
    Object.entries(zones).forEach(([zone, data]) => {
        data.history.forEach(entry => {
            allHistory.push({...entry, zone});
        });
    });
    
    // Sort by time (most recent first)
    allHistory.sort((a, b) => new Date(b.time) - new Date(a.time));
    
    // Display only the last 50 entries
    allHistory.slice(0, 100).forEach(entry => {
        const row = tbody.insertRow();
        row.insertCell().textContent = entry.zone;
        row.insertCell().textContent = entry.id;
        row.insertCell().textContent = entry.action;
        row.insertCell().textContent = entry.time;
        
        // Add styling based on action
        row.classList.add(entry.action.toLowerCase());
    });
}

// Toast notification system
function showToast(message) {
    // Remove existing toast if present
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    // Create new toast
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 100);
    
    // Remove toast after delay
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}




// Add CSS styles
const style = document.createElement('style');
style.textContent = `
    .toast {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%) translateY(100px);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 4px;
        z-index: 1000;
        transition: transform 0.3s ease;
    }
    
    .toast.show {
        transform: translateX(-50%) translateY(0);
    }
    
    .occupied {
        box-shadow: 0 0 15px rgba(255, 255, 255, 0.3);
        transform: translateY(-5px);
    }
    
    .entered {
        background-color: rgba(0, 255, 0, 0.1);
    }
    
    .exited {
        background-color: rgba(255, 0, 0, 0.1);
    }

    .hidden {
        display: none;
    }
    
    #snapshot-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.7);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    }

    .modal-content {
        background-color: white;
        padding: 20px;
        border-radius: 5px;
        position: relative;
        max-width: 90%;
        max-height: 90%;
    }

    .close-button {
        position: absolute;
        right: 10px;
        top: 5px;
        font-size: 24px;
        cursor: pointer;
        color: #333;
    }

    .close-button:hover {
        color: #000;
    }

    #snapshot-image {
        max-width: 100%;
        height: auto;
    }

    .snapshot-button {
        padding: 8px 16px;
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    }

    .snapshot-button:hover {
        background-color: #45a049;
    }
    
    .reset-button {
        padding: 6px 12px;
        background-color: #f44336;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        margin: 8px 0;
        transition: background-color 0.3s;
    }
    
    .reset-button:hover {
        background-color: #d32f2f;
    }       
`;

document.head.appendChild(style);
