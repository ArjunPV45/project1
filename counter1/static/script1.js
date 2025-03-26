document.addEventListener('DOMContentLoaded', function() {
    // Connect to Socket.IO server
    const socket = io();
    
    // UI Elements
    const cameraFeed = document.getElementById('cameraFeed');
    const drawingCanvas = document.getElementById('drawingCanvas');
    const zoneSelector = document.getElementById('zoneSelector');
    const historyZoneSelector = document.getElementById('historyZoneSelector');
    const drawZoneBtn = document.getElementById('drawZoneBtn');
    const resetZoneBtn = document.getElementById('resetZoneBtn');
    const snapshotBtn = document.getElementById('snapshotBtn');
    const cameraSelector = document.querySelector('.camera-selector');
    const zonesData = document.getElementById('zonesData');
    const historyData = document.getElementById('historyData');
    const newZoneInput = document.getElementById('newZoneInput');
    const newZoneName = document.getElementById('newZoneName');
    const createZoneBtn = document.getElementById('createZoneBtn');
    
    // Bootstrap modal
    const snapshotModal = new bootstrap.Modal(document.getElementById('snapshotModal'));
    const snapshotImage = document.getElementById('snapshotImage');
    const downloadSnapshot = document.getElementById('downloadSnapshot');
    
    // Canvas context
    const ctx = drawingCanvas.getContext('2d');
    
    // Application state
    let isDrawing = false;
    let startX = 0;
    let startY = 0;
    let activeCamera = 'camera1';
    let drawMode = false;
    let currentlySelectedZone = 'zone1';
    let zones = {};
    let allData = {};
    
    // Initialize feed and canvas dimensions
    function initCanvas() {
        drawingCanvas.width = cameraFeed.offsetWidth;
        drawingCanvas.height = cameraFeed.offsetHeight;
    }
    
    // Set camera feed source
    function setCamera(camera) {
        activeCamera = camera;
        cameraFeed.src = `/video_feed?camera_id=${camera}&t=${new Date().getTime()}`;
        
        // Update active button
        document.querySelectorAll('.camera-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        const activeBtn = document.querySelector(`.camera-btn[data-camera="${camera}"]`);
        if (activeBtn) activeBtn.classList.add('active');
        
        // Update zone dropdown options
        updateZoneSelector();
        
        // Update counters display
        updateCounters();
        
        // Notify server of camera change
        socket.emit('set_active_camera', { camera_id: camera });
    }
    
    // Update zone selector dropdown with zones from active camera
    function updateZoneSelector() {
        // Clear existing options except the 'new' option
        while (zoneSelector.options.length > 1) {
            zoneSelector.remove(0);
        }
        
        // Add zones from active camera
        if (allData[activeCamera] && allData[activeCamera].zones) {
            const zones = allData[activeCamera].zones;
            const zoneNames = Object.keys(zones);
            
            zoneNames.forEach(zoneName => {
                const option = document.createElement('option');
                option.value = zoneName;
                option.textContent = zoneName;
                zoneSelector.prepend(option);
            });
            
            // Select first zone by default
            if (zoneNames.length > 0) {
                zoneSelector.value = zoneNames[0];
                currentlySelectedZone = zoneNames[0];
            }
        }
        
        // Update history zone selector
        updateHistoryZoneSelector();
    }
    
    // Update history zone selector
    function updateHistoryZoneSelector() {
        // Clear existing options
        historyZoneSelector.innerHTML = '<option value="">Select a zone to view history</option>';
        
        // Add zones from active camera
        if (allData[activeCamera] && allData[activeCamera].zones) {
            const zones = allData[activeCamera].zones;
            Object.keys(zones).forEach(zoneName => {
                const option = document.createElement('option');
                option.value = zoneName;
                option.textContent = zoneName;
                historyZoneSelector.appendChild(option);
            });
        }
    }
    
    // Draw zones on canvas
    function drawZones() {
        // Clear canvas
        ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        
        // If camera doesn't exist in data yet, return
        if (!allData[activeCamera] || !allData[activeCamera].zones) return;
        
        const zones = allData[activeCamera].zones;
        
        // Calculate scale factors
        const scaleX = drawingCanvas.width / cameraFeed.naturalWidth || 1;
        const scaleY = drawingCanvas.height / cameraFeed.naturalHeight || 1;
        
        // Draw each zone
        Object.entries(zones).forEach(([zoneName, zoneData]) => {
            const topLeft = zoneData.top_left;
            const bottomRight = zoneData.bottom_right;
            
            // Apply scaling
            const scaledX1 = topLeft[0] * scaleX;
            const scaledY1 = topLeft[1] * scaleY;
            const scaledX2 = bottomRight[0] * scaleX;
            const scaledY2 = bottomRight[1] * scaleY;
            
            // Draw rectangle
            ctx.beginPath();
            ctx.rect(scaledX1, scaledY1, scaledX2 - scaledX1, scaledY2 - scaledY1);
            ctx.strokeStyle = zoneName === currentlySelectedZone ? 'red' : 'blue';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Draw label
            ctx.font = '14px Arial';
            ctx.fillStyle = 'white';
            ctx.fillRect(scaledX1, scaledY1 - 20, ctx.measureText(zoneName).width + 10, 20);
            ctx.fillStyle = 'black';
            ctx.fillText(zoneName, scaledX1 + 5, scaledY1 - 5);
        });
    }
    
    // Update counters display
    function updateCounters() {
        // Clear existing content
        zonesData.innerHTML = '';
        
        // If camera doesn't exist in data yet, show message
        if (!allData[activeCamera] || !allData[activeCamera].zones) {
            zonesData.innerHTML = '<div class="alert alert-info">No data available for this camera.</div>';
            return;
        }
        
        const zones = allData[activeCamera].zones;
        
        // Create a card for each zone
        Object.entries(zones).forEach(([zoneName, zoneData]) => {
            const zoneDiv = document.createElement('div');
            zoneDiv.className = 'zone-container mb-3';
            zoneDiv.innerHTML = `
                <h5>${zoneName}</h5>
                <div class="row">
                    <div class="col-6">
                        <div class="counter-display text-success">In: ${zoneData.in_count}</div>
                    </div>
                    <div class="col-6">
                        <div class="counter-display text-danger">Out: ${zoneData.out_count}</div>
                    </div>
                </div>
                <div class="counter-display text-primary">
                    Currently Inside: ${zoneData.inside_ids ? zoneData.inside_ids.length : 0}
                </div>
            `;
            zonesData.appendChild(zoneDiv);
        });
    }
    
    // Update history display
    function updateHistory(zoneName) {
        // Clear existing content
        historyData.innerHTML = '';
        
        // If zone not selected or doesn't exist, show message
        if (!zoneName || !allData[activeCamera] || !allData[activeCamera].zones || !allData[activeCamera].zones[zoneName]) {
            historyData.innerHTML = '<div class="alert alert-info">Select a zone to view history.</div>';
            return;
        }
        
        const history = allData[activeCamera].zones[zoneName].history;
        
        // If no history, show message
        if (!history || history.length === 0) {
            historyData.innerHTML = '<div class="alert alert-info">No history available for this zone.</div>';
            return;
        }
        
        // Create table for history
        const table = document.createElement('table');
        table.className = 'table table-striped table-sm';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Action</th>
                    <th>Time</th>
                </tr>
            </thead>
            <tbody>
                ${history.map(entry => `
                    <tr>
                        <td>${entry.id}</td>
                        <td>${entry.action}</td>
                        <td>${entry.time}</td>
                    </tr>
                `).join('')}
            </tbody>
        `;
        historyData.appendChild(table);
    }
    
    // Take a snapshot
    function takeSnapshot() {
        const url = `/get_snapshot?camera_id=${activeCamera}&t=${new Date().getTime()}`;
        snapshotImage.src = url;
        downloadSnapshot.href = url;
        downloadSnapshot.download = `snapshot_${activeCamera}_${new Date().toISOString().replace(/:/g, '-')}.jpg`;
        snapshotModal.show();
    }
    
    // Show toast notification
    function showToast(message, type = 'info') {
        const toastContainer = document.querySelector('.toast-container');
        const toast = document.createElement('div');
        toast.className = `toast align-items-center text-white bg-${type} border-0`;
        toast.setAttribute('role', 'alert');
        toast.setAttribute('aria-live', 'assertive');
        toast.setAttribute('aria-atomic', 'true');
        
        toast.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">
                    ${message}
                </div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
        
        toastContainer.appendChild(toast);
        const bsToast = new bootstrap.Toast(toast, { autohide: true, delay: 3000 });
        bsToast.show();
        
        // Remove toast from DOM after it's hidden
        toast.addEventListener('hidden.bs.toast', function() {
            toast.remove();
        });
    }
    
    // Handle camera feed load event
    cameraFeed.addEventListener('load', function() {
        initCanvas();
        drawZones();
    });
    
    // Handle window resize event
    window.addEventListener('resize', function() {
        initCanvas();
        drawZones();
    });
    
    // Handle zone selector change
     $('#zoneSelector').change(function () {
        if ($(this).val() === "new") {
            $('#newZoneInput').show();
        } else {
            $('#newZoneInput').hide();
        }
    });
    
    // Handle history zone selector change
    historyZoneSelector.addEventListener('change', function() {
        updateHistory(this.value);
    });
    
    // Handle draw zone button click
    drawZoneBtn.addEventListener('click', function() {
        drawMode = !drawMode;
        
        if (drawMode) {
            this.textContent = 'Cancel Drawing';
            this.classList.replace('btn-primary', 'btn-warning');
            drawingCanvas.style.pointerEvents = 'auto';
            showToast('Click and drag on the camera feed to create a zone', 'primary');
        } else {
            this.textContent = 'Draw Zone';
            this.classList.replace('btn-warning', 'btn-primary');
            drawingCanvas.style.pointerEvents = 'none';
        }
    });
    
    // Handle reset zone button click
    resetZoneBtn.addEventListener('click', function() {
        const zone = zoneSelector.value;
        if (zone && zone !== 'new') {
            if (confirm(`Are you sure you want to reset counts for ${zone}?`)) {
                socket.emit('reset_zone_counts', { camera_id: activeCamera, zone: zone });
            }
        } else {
            showToast('Please select a zone to reset', 'warning');
        }
    });
    
    // Handle create zone button click
    $('#createZoneBtn').click(function () {
        let newZone = $('#newZoneName').val().trim();
        if (newZone) {
            $('#zoneSelector').append(`<option value='${newZone}'>${newZone}</option>`).val(newZone);
            $('#newZoneInput').hide();
            socket.emit("set_zone", {
                camera_id: activeCamera,
                zone: newZone,
                top_left: [100, 100],
                bottom_right: [400, 400]
            });
        }
    });

    
    // Handle snapshot button click
    snapshotBtn.addEventListener('click', takeSnapshot);
    
    // Handle drawing events
    drawingCanvas.addEventListener('mousedown', function(e) {
        if (!drawMode) return;
        
        isDrawing = true;
        
        // Get position relative to canvas
        const rect = drawingCanvas.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;
        
        // Clear previous drawing
        ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        drawZones();
    });
    
    drawingCanvas.addEventListener('mousemove', function(e) {
        if (!isDrawing || !drawMode) return;
        
        // Get position relative to canvas
        const rect = drawingCanvas.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;
        
        // Clear previous drawing
        ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
        
        // Redraw existing zones
        drawZones();
        
        // Draw new rectangle
        ctx.beginPath();
        ctx.rect(startX, startY, currentX - startX, currentY - startY);
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;
        ctx.stroke();
    });
    
    drawingCanvas.addEventListener('mouseup', function(e) {
        if (!isDrawing || !drawMode) return;
        
        isDrawing = false;
        drawMode = false;
        drawZoneBtn.textContent = 'Draw Zone';
        drawZoneBtn.classList.replace('btn-warning', 'btn-primary');
        drawingCanvas.style.pointerEvents = 'none';
        
        // Get position relative to canvas
        const rect = drawingCanvas.getBoundingClientRect();
        const endX = e.clientX - rect.left;
        const endY = e.clientY - rect.top;
        
        // Calculate scale factors
        const scaleX = cameraFeed.naturalWidth / drawingCanvas.width || 1;
        const scaleY = cameraFeed.naturalHeight / drawingCanvas.height || 1;
        
        // Convert to original coordinates
        const originalStartX = Math.round(startX * scaleX);
        const originalStartY = Math.round(startY * scaleY);
        const originalEndX = Math.round(endX * scaleX);
        const originalEndY = Math.round(endY * scaleY);
        
        // Ensure positive width and height
        const topLeft = [
            Math.min(originalStartX, originalEndX),
            Math.min(originalStartY, originalEndY)
        ];
        const bottomRight = [
            Math.max(originalStartX, originalEndX),
            Math.max(originalStartY, originalEndY)
        ];
        
        // If zone is too small, show error and return
        if (bottomRight[0] - topLeft[0] < 20 || bottomRight[1] - topLeft[1] < 20) {
            showToast('Zone is too small, please draw a larger area', 'danger');
            drawZones();
            return;
        }
        
        // Send zone to server
        socket.emit('set_zone', {
            camera_id: activeCamera,
            zone: currentlySelectedZone,
            top_left: topLeft,
            bottom_right: bottomRight
        });
        
        showToast(`Zone ${currentlySelectedZone} updated`, 'success');
    });
    
    // Initialize by fetching camera list
    fetch('/get_cameras')
        .then(response => response.json())
        .then(data => {
            const cameras = data.cameras;
            activeCamera = data.active_camera;
            
            // Create camera buttons
            cameras.forEach(camera => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `camera-btn btn btn-sm ${camera === activeCamera ? 'btn-light active' : 'btn-outline-light'}`;
                button.dataset.camera = camera;
                button.textContent = camera;
                button.addEventListener('click', () => setCamera(camera));
                cameraSelector.appendChild(button);
            });
            
            // Set initial camera feed
            setCamera(activeCamera);
        })
        .catch(error => {
            console.error('Error fetching camera list:', error);
            showToast('Failed to load camera list', 'danger');
        });
    
    // Fetch initial zone data
    fetch('/get_zones')
        .then(response => response.json())
        .then(data => {
            allData = data.data;
            updateZoneSelector();
            updateCounters();
        })
        .catch(error => {
            console.error('Error fetching zone data:', error);
            showToast('Failed to load zone data', 'danger');
        });
    
    // Socket.IO events
    socket.on('connect', () => {
        console.log('Connected to server');
        showToast('Connected to server', 'success');
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        showToast('Disconnected from server', 'danger');
    });
    
    socket.on("update_counts", function (data) {
        let cameraData = data.data[activeCamera];
        $('#zonesData').empty();
        for (let zone in cameraData.zones) {
            let z = cameraData.zones[zone];
            $("#zonesData").append(
                `<p><strong>${zone}</strong>: In - ${z.in_count}, Out - ${z.out_count}, Inside IDs: ${z.inside_ids.join(', ')}</p>`
            );
        }
    });
    
    socket.on('zone_updated', (data) => {
        allData = data.data;
        drawZones();
        updateZoneSelector();
        updateCounters();
    });
    
    socket.on('count_reset', (data) => {
        allData = data.data;
        updateCounters();
        showToast(`Counts reset for ${data.zone} in ${data.camera}`, 'info');
        
        // Update history if the reset zone is currently displayed
        if (historyZoneSelector.value === data.zone) {
            updateHistory(data.zone);
        }
    });
    
    socket.on("camera_changed", function (data) {
        updateCameraFeed(data.active_camera);
    });
    
    socket.on('error', (data) => {
        showToast(data.message, 'danger');
    });
    
    // Initialize canvas
    initCanvas();
});
