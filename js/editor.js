
let currentSession = { steps: [] };
let currentStepIndex = -1;
let currentMode = 'view'; // view, blur, crop, arrow, rect
let isDragging = false;
let startX = 0, startY = 0;
let tempImage = null; // Holds the Image object for the current step
let selectedStepsForMerge = new Set();

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const data = await chrome.storage.local.get('activeSession');
        if (data.activeSession && data.activeSession.steps) {
            currentSession = data.activeSession;
            // Ensure ID and version exist
            if (!currentSession.id) currentSession.id = Date.now().toString();
            if (!currentSession.version) currentSession.version = "1.0";
            if (!currentSession.title) currentSession.title = "Dokumentation";

            document.getElementById('documentTitleInput').value = currentSession.title;
            document.getElementById('sessionVersionInput').value = currentSession.version;
            document.getElementById('sessionTagsInput').value = (currentSession.tags || []).join(', ');

            const exportTitle = document.getElementById('exportTitleInput');
            if (exportTitle) exportTitle.value = currentSession.title;

            renderSidebar();
            if (currentSession.steps.length > 0) {
                selectStep(0);
            }
        }
        setupEventListeners();
        const lockData = await chrome.storage.local.get('featuresUnlocked');
        updateLockStatus(!!lockData.featuresUnlocked);

        // Check for updates asynchronously
        checkForUpdates();

        // Listen for updates from background (new steps)
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.activeSession) {
                // IMPORTANT: If we are currently editing a textblock, DO NOT update the session from remote 
                // to prevent cursor jumps and loss of data during local input.
                const activeElement = document.activeElement;
                if (activeElement && activeElement.id === 'richEditor') {
                    console.log("Skipping session sync while editing textblock");
                    return;
                }

                const newSession = changes.activeSession.newValue;
                if (newSession && newSession.steps) {
                    const oldStepCount = currentSession.steps.length;
                    currentSession = newSession;
                    renderSidebar();

                    // If a new step was added, automatically select it if we were at the end or nothing was selected
                    if (newSession.steps.length > oldStepCount) {
                        if (currentStepIndex === -1 || currentStepIndex === oldStepCount - 1) {
                            selectStep(newSession.steps.length - 1);
                        }
                    }
                }
            }
            if (area === 'local' && changes.featuresUnlocked !== undefined) {
                updateLockStatus(!!changes.featuresUnlocked.newValue);
            }
        });
    } catch (e) {
        console.error("Error loading session:", e);
    }
});

function setupEventListeners() {
    // Buttons
    document.getElementById('btnRemoveStep').addEventListener('click', deleteCurrentStep);

    // Export UI
    const exportModal = document.getElementById('exportModal');
    document.getElementById('btnExport').addEventListener('click', () => exportModal.style.display = 'flex');
    document.getElementById('btnCancelExport').addEventListener('click', () => exportModal.style.display = 'none'); // Close button

    // Chapters
    document.getElementById('btnAddChapter').addEventListener('click', addChapterStep);

    // Export Options
    document.getElementById('exportPDF').addEventListener('click', () => exportSession('html'));
    document.getElementById('exportTour').addEventListener('click', () => exportSession('tour'));
    document.getElementById('exportLive').addEventListener('click', startOverlayGuide);
    document.getElementById('exportYouTrack').addEventListener('click', () => {
        copyYouTrackMarkdown();
        document.getElementById('exportModal').style.display = 'none';
    });
    document.getElementById('downloadTour').addEventListener('click', (e) => {
        e.stopPropagation();
        exportSession('standalone');
    });

    // New Features
    document.getElementById('btnAddTextBlock').addEventListener('click', addTextBlockStep);
    document.getElementById('btnMerge').addEventListener('click', mergeSelectedSteps);

    // Metadata Inputs
    document.getElementById('stepTitleInput').addEventListener('input', (e) => updateStepMeta('title', e.target.value));
    document.getElementById('stepDescInput').addEventListener('input', (e) => updateStepMeta('description', e.target.value));
    document.getElementById('stepSessionInput').addEventListener('input', (e) => updateStepMeta('session', e.target.value));
    document.getElementById('stepFieldInput').addEventListener('input', (e) => updateStepMeta('field', e.target.value));
    document.getElementById('stepValueInput').addEventListener('input', (e) => updateStepMeta('value', e.target.value));
    document.getElementById('stepDelayInput').addEventListener('input', (e) => updateStepMeta('rpaDelay', parseFloat(e.target.value) || 0));

    // Tools
    setupToolButton('btnSelect', 'view');
    setupToolButton('btnBlur', 'blur');
    setupToolButton('btnCrop', 'crop');
    setupToolButton('btnArrow', 'arrow');
    setupToolButton('btnRect', 'rect');
    document.getElementById('btnResetMarker').addEventListener('click', resetCurrentMarkers);
    document.getElementById('btnUndo').addEventListener('click', undoAction);
    document.getElementById('btnRedo').addEventListener('click', redoAction);

    // [Point 10] RPA Playback
    document.getElementById('btnPlayStep').addEventListener('click', playStepOnSite);
    document.getElementById('btnPlayAll').addEventListener('click', playAllSteps);


    // Canvas Interaction
    const container = document.getElementById('canvasWrapper');

    // Using delegation on container or direct canvas events?
    // Canvas is recreated, so we need to add listeners to container or re-add to canvas.
    // Let's use delegation but target the canvas.
    container.addEventListener('mousedown', handleMouseDown);
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseup', handleMouseUp);

    // Backup & Restore
    document.getElementById('btnBackup').addEventListener('click', backupSession);
    document.getElementById('btnRestore').addEventListener('click', () => document.getElementById('restoreFile').click());
    document.getElementById('restoreFile').addEventListener('change', restoreSession);

    // Auto-Save Backup Manager listeners
    const backupModal = document.getElementById('backupModal');
    if (backupModal) {
        document.getElementById('btnAutoBackups').addEventListener('click', () => {
            backupModal.style.display = 'flex';
            renderBackupList();
        });
        document.getElementById('btnCancelBackupModal').addEventListener('click', () => {
            backupModal.style.display = 'none';
        });
        document.getElementById('btnCloseBackupModal').addEventListener('click', () => {
            backupModal.style.display = 'none';
        });
        document.getElementById('btnClearAllBackups').addEventListener('click', clearAllBackups);
    }

    // Import Image
    document.getElementById('btnAddStep').addEventListener('click', () => {
        if (confirm('MÃ¶chtest du eine Bilddatei importieren? \n(Alternativ kannst du Bilder auch einfach mit Strg+V einfÃ¼gen)')) {
            document.getElementById('importImage').click();
        }
    });
    document.getElementById('importImage').addEventListener('change', handleImageImport);

    // Paste Global
    window.addEventListener('paste', handlePaste);

    // Quick Copy
    document.getElementById('btnQuickCopy').addEventListener('click', quickCopyImage);


    // Keydown Events (Keyboard Workflow)
    window.addEventListener('keydown', handleKeyDown);

    document.getElementById('btnLibrary').addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('ui/library.html') });
    });

    document.getElementById('btnSaveLibrary').addEventListener('click', () => {
        saveToLibrary();
    });



    document.getElementById('documentTitleInput').addEventListener('input', (e) => {
        currentSession.title = e.target.value;
        // Also sync to export modal input if it exists
        const exportTitle = document.getElementById('exportTitleInput');
        if (exportTitle) exportTitle.value = e.target.value;
        saveSession();
    });

    document.getElementById('sessionVersionInput').addEventListener('input', (e) => {
        currentSession.version = e.target.value;
        saveSession();
    });

    document.getElementById('sessionTagsInput').addEventListener('input', (e) => {
        const val = e.target.value;
        currentSession.tags = val.split(',').map(t => t.trim().startsWith('#') ? t.trim() : '#' + t.trim()).filter(t => t.length > 1);
        saveSession();
    });
}

function handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        if (currentStepIndex > 0) selectStep(currentStepIndex - 1);
        e.preventDefault();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        if (currentStepIndex < currentSession.steps.length - 1) selectStep(currentStepIndex + 1);
        e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedMarkerIndices.length > 0) {
            pushUndoState('marker_change', 'Marker gelÃ¶scht');
            const step = currentSession.steps[currentStepIndex];
            // Sort indices descending to splice safely
            selectedMarkerIndices.sort((a, b) => b - a).forEach(idx => {
                step.markers.splice(idx, 1);
            });
            selectedMarkerIndices = [];
            pushHistory('Aktion: Marker gelÃ¶scht');
            saveSession();
            renderCanvas();
        } else {
            deleteCurrentStep();
        }
        e.preventDefault();
    }
}

function setupToolButton(id, mode) {
    const btn = document.getElementById(id);
    btn.addEventListener('click', () => {
        // Toggle off if already active
        if (currentMode === mode) {
            currentMode = 'view';
            updateToolUI();
            return;
        }

        currentMode = mode;
        updateToolUI();
    });
}

function updateToolUI() {
    ['btnSelect', 'btnBlur', 'btnCrop', 'btnArrow', 'btnRect'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        const mode = id === 'btnSelect' ? 'view' : id.replace('btn', '').toLowerCase();
        const isActive = currentMode === mode;

        btn.style.background = isActive ? '#eef2ff' : 'white';
        btn.style.borderColor = isActive ? '#4f46e5' : '#d1d5db';
        btn.style.color = isActive ? '#4f46e5' : '#111827';
    });

    const canvas = document.querySelector('canvas');
    if (canvas) {
        canvas.style.cursor = currentMode === 'view' ? 'default' : 'crosshair';
    }
}

let selectedMarkerIndices = []; // Switched to array for multi-selection
let isDraggingMarker = false;
let dragStartX = 0;
let dragStartY = 0;
let dragInitialMarkers = []; // Store initial states for all selected markers

function updateLockStatus(unlocked) {
    const btnLibrary = document.getElementById('btnLibrary');
    const btnSaveLibrary = document.getElementById('btnSaveLibrary');

    // RPA Automation Elements
    const btnPlayStep = document.getElementById('btnPlayStep');
    const btnPlayAll = document.getElementById('btnPlayAll');
    const stepValueInput = document.getElementById('stepValueInput');
    const stepDelayInput = document.getElementById('stepDelayInput');
    const rpaLabel = document.querySelector('#selectorContainer label');

    // Live Overlay Export Option Card
    const exportLive = document.getElementById('exportLive');

    if (unlocked) {
        if (btnLibrary) {
            btnLibrary.disabled = false;
            btnLibrary.style.opacity = '1';
            btnLibrary.title = 'Bibliothek öffnen';
        }
        if (btnSaveLibrary) {
            btnSaveLibrary.disabled = false;
            btnSaveLibrary.style.opacity = '1';
            btnSaveLibrary.title = 'In Bibliothek speichern';
        }
        if (btnPlayStep) {
            btnPlayStep.disabled = false;
            btnPlayStep.style.opacity = '1';
            btnPlayStep.title = 'Diesen Schritt testen';
        }
        if (btnPlayAll) {
            btnPlayAll.disabled = false;
            btnPlayAll.style.opacity = '1';
            btnPlayAll.title = 'Alle Schritte nacheinander abspielen';
        }
        if (stepValueInput) {
            stepValueInput.disabled = false;
            stepValueInput.title = 'Text der automatisch getippt werden soll...';
        }
        if (stepDelayInput) {
            stepDelayInput.disabled = false;
            stepDelayInput.title = 'Pause (Sek)';
        }
        if (rpaLabel) {
            rpaLabel.innerHTML = 'RPA Automatisierung 🔓';
        }
        if (exportLive) {
            exportLive.style.opacity = '1';
            exportLive.style.pointerEvents = 'auto';
            exportLive.title = 'Live Overlay';
            const smallElement = exportLive.querySelector('small');
            if (smallElement) smallElement.textContent = 'Direkt auf Website';
        }
    } else {
        if (btnLibrary) {
            btnLibrary.disabled = true;
            btnLibrary.style.opacity = '0.4';
            btnLibrary.title = 'Bibliothek gesperrt (Freischalten über Hauptmenü)';
        }
        if (btnSaveLibrary) {
            btnSaveLibrary.disabled = true;
            btnSaveLibrary.style.opacity = '0.4';
            btnSaveLibrary.title = 'In Bibliothek speichern gesperrt (Freischalten über Hauptmenü)';
        }
        if (btnPlayStep) {
            btnPlayStep.disabled = true;
            btnPlayStep.style.opacity = '0.4';
            btnPlayStep.title = 'RPA Automatisierung gesperrt (Freischalten über Hauptmenü)';
        }
        if (btnPlayAll) {
            btnPlayAll.disabled = true;
            btnPlayAll.style.opacity = '0.4';
            btnPlayAll.title = 'RPA Automatisierung gesperrt (Freischalten über Hauptmenü)';
        }
        if (stepValueInput) {
            stepValueInput.disabled = true;
            stepValueInput.title = 'Gesperrt - Freischalten über Hauptmenü';
        }
        if (stepDelayInput) {
            stepDelayInput.disabled = true;
            stepDelayInput.title = 'Gesperrt - Freischalten über Hauptmenü';
        }
        if (rpaLabel) {
            rpaLabel.innerHTML = 'RPA Automatisierung 🔒 <span style="font-size:10px; font-weight:normal; color:var(--text-muted);">(Gesperrt - Freischalten über Hauptmenü)</span>';
        }
        if (exportLive) {
            exportLive.style.opacity = '0.4';
            exportLive.style.pointerEvents = 'none';
            exportLive.title = 'Live Overlay gesperrt (Freischalten über Hauptmenü)';
            const smallElement = exportLive.querySelector('small');
            if (smallElement) smallElement.textContent = 'Gesperrt 🔒';
        }
    }
}

// Canvas Event Handlers
function getCanvasCoords(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

function handleMouseDown(e) {
    if (currentStepIndex === -1) return;
    const canvas = document.querySelector('canvas');
    if (!canvas || (e.target !== canvas && !canvas.contains(e.target))) return;

    const coords = getCanvasCoords(e, canvas);
    const step = currentSession.steps[currentStepIndex];
    if (!step.markers) step.markers = [];
    const dpr = step.meta?.devicePixelRatio || 1;

    if (currentMode === 'view') {
        const pxX = coords.x;
        const pxY = coords.y;

        // Hit detection for markers (backwards to select topmost)
        let clickedIndex = -1;
        for (let i = step.markers.length - 1; i >= 0; i--) {
            const m = step.markers[i];
            if (m.type === 'rect' || m.type === 'blur') {
                const rx = m.x * dpr;
                const ry = m.y * dpr;
                const rw = m.width * dpr;
                const rh = m.height * dpr;
                if (pxX >= rx && pxX <= rx + rw && pxY >= ry && pxY <= ry + rh) {
                    clickedIndex = i;
                    break;
                }
            } else if (m.type === 'arrow') {
                const x1 = m.x1 * dpr, y1 = m.y1 * dpr, x2 = m.x2 * dpr, y2 = m.y2 * dpr;
                const dist1 = Math.sqrt((pxX - x1) ** 2 + (pxY - y1) ** 2);
                const dist2 = Math.sqrt((pxX - x2) ** 2 + (pxY - y2) ** 2);
                if (dist1 < 20 || dist2 < 20) {
                    clickedIndex = i;
                    break;
                }
            }
        }

        if (clickedIndex !== -1) {
            if (e.ctrlKey || e.metaKey) {
                // Toggle selection
                const idx = selectedMarkerIndices.indexOf(clickedIndex);
                if (idx === -1) selectedMarkerIndices.push(clickedIndex);
                else selectedMarkerIndices.splice(idx, 1);
            } else {
                // Single selection (if clicked index is not already part of multi-selection)
                if (!selectedMarkerIndices.includes(clickedIndex)) {
                    selectedMarkerIndices = [clickedIndex];
                }
            }

            isDraggingMarker = true;
            dragStartX = coords.x;
            dragStartY = coords.y;

            // Save state BEFORE dragging begins to allow undoing the move
            pushUndoState('marker_change', 'Marker verschoben');

            // Store initial states for all currently selected markers
            dragInitialMarkers = selectedMarkerIndices.map(idx => ({
                index: idx,
                marker: JSON.parse(JSON.stringify(step.markers[idx]))
            }));
            renderCanvas();
        } else {
            selectedMarkerIndices = [];
            renderCanvas();
        }
        return;
    }

    isDragging = true;
    startX = coords.x;
    startY = coords.y;
}

function handleMouseMove(e) {
    if (currentStepIndex === -1) return;
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const coords = getCanvasCoords(e, canvas);

    if (isDraggingMarker && selectedMarkerIndices.length > 0) {
        const step = currentSession.steps[currentStepIndex];
        const dpr = step.meta?.devicePixelRatio || 1;
        const dx = (coords.x - dragStartX) / dpr;
        const dy = (coords.y - dragStartY) / dpr;

        dragInitialMarkers.forEach(({ index, marker: initial }) => {
            const m = step.markers[index];
            if (m.type === 'rect' || m.type === 'blur') {
                m.x = initial.x + dx;
                m.y = initial.y + dy;
            } else if (m.type === 'arrow') {
                m.x1 = initial.x1 + dx;
                m.y1 = initial.y1 + dy;
                m.x2 = initial.x2 + dx;
                m.y2 = initial.y2 + dy;
            }
        });
        renderCanvas();
        return;
    }

    if (!isDragging) return;
    const ctx = canvas.getContext('2d');

    // Redraw original image to clear previous frames
    redrawCanvas(ctx);

    // Draw preview
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 2;

    if (currentMode === 'crop') {
        ctx.strokeRect(startX, startY, coords.x - startX, coords.y - startY);
        ctx.fillStyle = 'rgba(79, 70, 229, 0.1)';
        ctx.fillRect(startX, startY, coords.x - startX, coords.y - startY);
    } else if (currentMode === 'arrow') {
        drawArrow(ctx, startX, startY, coords.x, coords.y);
    } else if (currentMode === 'blur' || currentMode === 'rect') {
        // Preview area
        ctx.strokeRect(startX, startY, coords.x - startX, coords.y - startY);
        if (currentMode === 'rect') {
            ctx.fillStyle = 'rgba(188, 0, 3, 0.1)';
            ctx.fillRect(startX, startY, coords.x - startX, coords.y - startY);
        }
    }
}

function handleMouseUp(e) {
    if (isDraggingMarker) {
        isDraggingMarker = false;
        saveSession();
        return;
    }

    if (!isDragging || currentStepIndex === -1) return;
    isDragging = false;

    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const coords = getCanvasCoords(e, canvas);
    const ctx = canvas.getContext('2d');
    const step = currentSession.steps[currentStepIndex];
    if (!step.markers) step.markers = [];
    const dpr = step.meta?.devicePixelRatio || 1;

    if (currentMode === 'crop') {
        const w = coords.x - startX;
        const h = coords.y - startY;
        if (Math.abs(w) > 10 && Math.abs(h) > 10) {
            if (confirm('Auf diesen Bereich zuschneiden?')) {
                pushHistory('Werkzeug: Zuschneiden (Crop)');
                // Apply Crop
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = Math.abs(w);
                tempCanvas.height = Math.abs(h);
                const tCtx = tempCanvas.getContext('2d');
                tCtx.drawImage(canvas,
                    Math.min(startX, coords.x), Math.min(startY, coords.y), Math.abs(w), Math.abs(h),
                    0, 0, Math.abs(w), Math.abs(h)
                );
                saveStepImage(tempCanvas.toDataURL());
            } else {
                redrawCanvas(ctx); // Reset
            }
        }
    } else if (currentMode === 'arrow') {
        pushUndoState('marker_change', 'Pfeil hinzugefÃ¼gt');
        step.markers.push({
            type: 'arrow',
            x1: startX / dpr,
            y1: startY / dpr,
            x2: coords.x / dpr,
            y2: coords.y / dpr
        });
        pushHistory('Werkzeug: Pfeil hinzugefÃ¼gt');
        saveSession();
        renderCanvas();
    } else if (currentMode === 'rect') {
        const w = coords.x - startX;
        const h = coords.y - startY;
        if (Math.abs(w) > 5 && Math.abs(h) > 5) {
            pushUndoState('marker_change', 'Viereck hinzugefÃ¼gt');
            step.markers.push({
                type: 'rect',
                x: Math.min(startX, coords.x) / dpr,
                y: Math.min(startY, coords.y) / dpr,
                width: Math.abs(w) / dpr,
                height: Math.abs(h) / dpr
            });
            pushHistory('Werkzeug: Bereich markiert (Viereck)');
            saveSession();
            renderCanvas();
        }
    } else if (currentMode === 'blur') {
        const w = coords.x - startX;
        const h = coords.y - startY;

        let blurX, blurY, blurW, blurH;

        if (Math.abs(w) < 5 && Math.abs(h) < 5) {
            const size = 60;
            blurW = size;
            blurH = size;
            blurX = (startX - size / 2) / dpr;
            blurY = (startY - size / 2) / dpr;
            blurW /= dpr;
            blurH /= dpr;
        } else {
            blurX = Math.min(startX, coords.x) / dpr;
            blurY = Math.min(startY, coords.y) / dpr;
            blurW = Math.abs(w) / dpr;
            blurH = Math.abs(h) / dpr;
        }

        pushUndoState('marker_change', 'Verpixelung hinzugefÃ¼gt');
        step.markers.push({
            type: 'blur',
            x: blurX,
            y: blurY,
            width: blurW,
            height: blurH
        });
        pushHistory('Werkzeug: Verpixelt (Blur)');
        saveSession();
        renderCanvas();
    }
}

function drawArrow(ctx, fromX, fromY, toX, toY) {
    const headlen = 15;
    const angle = Math.atan2(toY - fromY, toX - fromX);

    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    ctx.fill();
}

function redrawCanvas(ctx) {
    if (tempImage) {
        ctx.drawImage(tempImage, 0, 0);

        const step = currentSession.steps[currentStepIndex];
        const dpr = step.meta?.devicePixelRatio || 1;

        if (step.markers) {
            step.markers.forEach((m, i) => drawMarker(ctx, m, i + 1, dpr, selectedMarkerIndices.includes(i)));
        }

        // Compatibility for old rect/coords if they exist but no markers array
        if ((!step.markers || step.markers.length === 0) && step.rect) {
            drawMarker(ctx, { type: 'rect', ...step.rect }, null, dpr, false);
        }
    }
}

function pushUndoState(type, actionName) {
    if (currentStepIndex === -1) return;
    const step = currentSession.steps[currentStepIndex];

    if (!currentSession.undoStack) currentSession.undoStack = [];
    currentSession.redoStack = [];

    currentSession.undoStack.push({
        type: type, // 'edit' (image) or 'marker_change'
        stepId: step.id,
        prevDataUrl: step.dataUrl,
        prevMarkers: JSON.parse(JSON.stringify(step.markers || []))
    });

    if (currentSession.undoStack.length > 30) currentSession.undoStack.shift();
}

function saveStepImage(newDataUrl) {
    const step = currentSession.steps[currentStepIndex];

    pushUndoState('edit', 'Bild geÃ¤ndert');

    step.dataUrl = newDataUrl;
    // Reload image object
    const img = new Image();
    img.onload = () => {
        tempImage = img;
        renderCanvas(); // Refresh view
    };
    img.src = newDataUrl;
    saveSession();
}

function undoAction() {
    if (!currentSession.undoStack || currentSession.undoStack.length === 0) {
        console.log("No more undo steps.");
        return;
    }

    const action = currentSession.undoStack.pop();

    // Push to redo stack
    if (!currentSession.redoStack) currentSession.redoStack = [];

    // Prepare redo action (store current state)
    let redoActionObj;
    if (action.type === 'edit' || action.type === 'marker_change') {
        const step = currentSession.steps.find(s => s.id === action.stepId);
        redoActionObj = {
            type: action.type,
            stepId: action.stepId,
            prevDataUrl: step.dataUrl,
            prevMarkers: JSON.parse(JSON.stringify(step.markers || []))
        };

        step.dataUrl = action.prevDataUrl;
        step.markers = action.prevMarkers;

        const stepIdx = currentSession.steps.indexOf(step);
        if (stepIdx === currentStepIndex) {
            const img = new Image();
            img.onload = () => {
                tempImage = img;
                renderCanvas();
            };
            img.src = action.prevDataUrl;
        }
    } else if (action.type === 'delete') {
        redoActionObj = {
            type: 'delete',
            index: action.index,
            step: action.step
        };
        currentSession.steps.splice(action.index, 0, action.step);
        renderSidebar();
        selectStep(action.index);
    } else if (action.type === 'reorder') {
        redoActionObj = {
            type: 'reorder',
            prevSteps: [...currentSession.steps]
        };
        currentSession.steps = action.prevSteps;
        renderSidebar();
        if (currentStepIndex >= currentSession.steps.length) {
            currentStepIndex = currentSession.steps.length - 1;
        }
        if (currentStepIndex !== -1) selectStep(currentStepIndex);
    } else if (action.type === 'merge') {
        redoActionObj = {
            type: 'merge',
            prevSteps: JSON.parse(JSON.stringify(currentSession.steps))
        };
        currentSession.steps = action.prevSteps;
        renderSidebar();
        if (currentStepIndex >= currentSession.steps.length) {
            currentStepIndex = currentSession.steps.length - 1;
        }
        if (currentStepIndex !== -1) selectStep(currentStepIndex);
    }

    currentSession.redoStack.push(redoActionObj);
    if (currentSession.redoStack.length > 30) currentSession.redoStack.shift();

    saveSession();
    renderSidebar();
    pushHistory('Aktion: RÃ¼ckgÃ¤ngig (Undo)');
}

function redoAction() {
    if (!currentSession.redoStack || currentSession.redoStack.length === 0) {
        console.log("No more redo steps.");
        return;
    }

    const action = currentSession.redoStack.pop();

    // Push back to undo stack
    if (!currentSession.undoStack) currentSession.undoStack = [];

    let undoActionObj;

    if (action.type === 'edit' || action.type === 'marker_change') {
        const step = currentSession.steps.find(s => s.id === action.stepId);
        undoActionObj = {
            type: action.type,
            stepId: action.stepId,
            prevDataUrl: step.dataUrl,
            prevMarkers: JSON.parse(JSON.stringify(step.markers || []))
        };
        step.dataUrl = action.prevDataUrl;
        step.markers = action.prevMarkers;

        if (currentSession.steps.indexOf(step) === currentStepIndex) {
            const img = new Image();
            img.onload = () => {
                tempImage = img;
                renderCanvas();
            };
            img.src = action.prevDataUrl;
        }
    } else if (action.type === 'delete') {
        undoActionObj = {
            type: 'delete',
            index: action.index,
            step: currentSession.steps[action.index]
        };
        currentSession.steps.splice(action.index, 1);
        renderSidebar();
        if (currentSession.steps.length > 0) selectStep(Math.max(0, action.index - 1));
    } else if (action.type === 'reorder') {
        undoActionObj = {
            type: 'reorder',
            prevSteps: [...currentSession.steps]
        };
        currentSession.steps = action.prevSteps;
        renderSidebar();
        if (currentStepIndex !== -1) selectStep(currentStepIndex);
    } else if (action.type === 'merge') {
        undoActionObj = {
            type: 'merge',
            prevSteps: JSON.parse(JSON.stringify(currentSession.steps))
        };
        currentSession.steps = action.prevSteps;
        renderSidebar();
        if (currentStepIndex !== -1) selectStep(currentStepIndex);
    }

    currentSession.undoStack.push(undoActionObj);
    saveSession();
    renderSidebar();
    pushHistory('Aktion: Wiederholen (Redo)');
}



let draggedItemIndex = null;

function handleDragStart(e) {
    draggedItemIndex = parseInt(this.dataset.index);
    this.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    if (e.preventDefault) e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) e.stopPropagation();

    const targetIndex = parseInt(this.dataset.index);
    if (draggedItemIndex !== targetIndex) {
        // Save current state to undo stack
        if (!currentSession.undoStack) currentSession.undoStack = [];
        currentSession.undoStack.push({
            type: 'reorder',
            prevSteps: [...currentSession.steps]
        });
        if (currentSession.undoStack.length > 30) currentSession.undoStack.shift();

        // Clear redo stack
        currentSession.redoStack = [];

        // Reorder array
        const removed = currentSession.steps.splice(draggedItemIndex, 1)[0];
        currentSession.steps.splice(targetIndex, 0, removed);

        // Update currentStepIndex if it was affected
        if (currentStepIndex === draggedItemIndex) {
            currentStepIndex = targetIndex;
        } else if (draggedItemIndex < currentStepIndex && targetIndex >= currentStepIndex) {
            currentStepIndex--;
        } else if (draggedItemIndex > currentStepIndex && targetIndex <= currentStepIndex) {
            currentStepIndex++;
        }

        saveSession();
        renderSidebar();
        selectStep(currentStepIndex);
        pushHistory('Aktion: Schritte neu anordnen');
    }
    return false;
}

function handleDragEnd() {
    this.style.opacity = '1';
    const items = document.querySelectorAll('.step-item');
    items.forEach(item => item.classList.remove('over'));
}

function selectStep(index) {
    if (index < 0 || index >= currentSession.steps.length) return;

    currentStepIndex = index;
    const step = currentSession.steps[index];

    // Migration: Move old rect/marker data to unified markers array
    if (step.rect && (!step.markers || step.markers.length === 0)) {
        step.markers = [{ type: 'rect', ...step.rect }];
        delete step.rect;
        saveSession();
    }

    // UI Update
    const items = document.querySelectorAll('.step-item');
    items.forEach((item, i) => {
        if (i === index) item.classList.add('active');
        else item.classList.remove('active');
    });

    document.getElementById('stepTitleInput').value = step.title || '';
    document.getElementById('stepDescInput').value = step.description || '';
    document.getElementById('stepSessionInput').value = step.session || '';
    document.getElementById('stepFieldInput').value = step.field || '';

    const selectorInput = document.getElementById('stepSelectorInput');
    const valueInput = document.getElementById('stepValueInput');
    const delayInput = document.getElementById('stepDelayInput');
    if (selectorInput) selectorInput.value = step.selector || '';
    if (valueInput) valueInput.value = step.value || '';
    if (delayInput) delayInput.value = step.rpaDelay !== undefined ? step.rpaDelay : 3.5;

    const selectorContainer = document.getElementById('selectorContainer');
    if (selectorContainer) selectorContainer.style.display = (step.type === 'chapter' || step.type === 'textblock') ? 'none' : 'block';

    const isChapter = step.type === 'chapter';
    const isTextBlock = step.type === 'textblock';
    document.getElementById('titleLabel').textContent = isChapter ? 'Kapitel Name' : (isTextBlock ? 'Block Titel' : 'Titel des Schritts');

    // Hide/Show meta fields based on type
    const descGroup = document.getElementById('stepDescInput').closest('.form-group');
    const sessionGroup = document.getElementById('stepSessionInput').closest('.form-group');
    const fieldGroup = document.getElementById('stepFieldInput').closest('.form-group');

    if (isChapter || isTextBlock) {
        if (descGroup) descGroup.style.display = 'none';
        if (sessionGroup) sessionGroup.style.display = 'none';
        if (fieldGroup) fieldGroup.style.display = 'none';
    } else {
        if (descGroup) descGroup.style.display = 'block';
        if (sessionGroup) sessionGroup.style.display = 'block';
        if (fieldGroup) fieldGroup.style.display = 'block';
    }

    if (isChapter || isTextBlock) {
        tempImage = null;
        renderCanvas();
    } else {
        // Falls Session/Feld fehlen aber im Titel stehen kÃ¶nnten, Parsing triggern
        if ((!step.session || !step.field) && step.title) {
            updateStepMeta('title', step.title);
        }

        // Load Image
        const img = new Image();
        img.onload = () => {
            tempImage = img;
            renderCanvas();
        };
        img.src = step.dataUrl;
    }
}

function renderSidebar() {
    const list = document.getElementById('stepList');
    list.innerHTML = '';

    currentSession.steps.forEach((step, index) => {
        const li = document.createElement('li');
        let typeClass = '';
        if (step.type === 'chapter') typeClass = 'chapter';
        else if (step.type === 'textblock') typeClass = 'textblock';

        const isSelectedForMerge = selectedStepsForMerge.has(index);
        li.className = `step-item ${index === currentStepIndex ? 'active' : ''} ${typeClass} ${isSelectedForMerge ? 'selected-for-merge' : ''}`;
        li.draggable = true;
        li.dataset.index = index;

        li.onclick = (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (selectedStepsForMerge.has(index)) {
                    selectedStepsForMerge.delete(index);
                } else {
                    selectedStepsForMerge.add(index);
                }
                renderSidebar();
            } else if (e.shiftKey && currentStepIndex !== -1) {
                // Shift+Click: Select range between currentStepIndex and clicked index
                const start = Math.min(currentStepIndex, index);
                const end = Math.max(currentStepIndex, index);

                // Toggle entire range based on whether the clicked index is already selected
                const shouldSelect = !selectedStepsForMerge.has(index);
                for (let i = start; i <= end; i++) {
                    if (shouldSelect) selectedStepsForMerge.add(i);
                    else selectedStepsForMerge.delete(i);
                }
                renderSidebar();
            } else {
                // Standard selection (clears merge selection if not holding modifiers)
                // selectedStepsForMerge.clear(); // OPTIONAL: uncomment if we want to clear on normal click

                // Force immediate save of previous step if it was a textblock
                const editor = document.getElementById('richEditor');
                if (editor) {
                    const prevStep = currentSession.steps[currentStepIndex];
                    if (prevStep && prevStep.type === 'textblock') {
                        prevStep.content = editor.innerHTML;
                        saveSession(true); // Immediate save
                    }
                }
                selectStep(index);
            }
        };

        // Drag Events
        li.addEventListener('dragstart', handleDragStart);
        li.addEventListener('dragover', handleDragOver);
        li.addEventListener('drop', handleDrop);
        li.addEventListener('dragend', handleDragEnd);

        if (step.type === 'chapter') {
            li.innerHTML = `
                <div class="step-number">🔖</div>
                <div class="step-info">
                    <div class="step-title" style="font-weight: bold; color: #4b5563;">${escapeHtml(step.title || 'Neues Kapitel')}</div>
                    <div class="step-desc">Kapitel-Abschnitt</div>
                </div>
            `;
        } else if (step.type === 'textblock') {
            li.innerHTML = `
                <div class="step-number">📝</div>
                <div class="step-info">
                    <div class="step-title" style="font-weight: bold; color: var(--primary);">${escapeHtml(step.title || 'Textblock')}</div>
                    <div class="step-desc">Freitext / Formatierung</div>
                </div>
            `;
        } else {
            li.innerHTML = `
                <div class="step-number">${index + 1}</div>
                <div class="step-info">
                    <div class="step-title">${escapeHtml(step.title || 'Schritt ' + (index + 1))}</div>
                    <div class="step-desc">${escapeHtml(step.description || 'Keine Beschreibung')}</div>
                </div>
            `;
        }
        list.appendChild(li);
    });
}

function renderCanvas() {
    const container = document.getElementById('canvasWrapper');
    container.innerHTML = '';

    const step = currentSession.steps[currentStepIndex];
    if (!step) return;

    if (step.type === 'chapter') {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #4b5563;">
                <div style="font-size: 64px; margin-bottom: 20px;">🔖</div>
                <h3>Kapitel: ${escapeHtml(step.title || 'Unbenanntes Kapitel')}</h3>
                <p>Dieser Trenner wird im Export als Inhaltsverzeichnis-Eintrag verwendet.</p>
            </div>
        `;
        return;
    }

    if (step.type === 'textblock') {
        container.innerHTML = `
            <div class="rich-editor-container">
                <div class="rich-editor-toolbar">
                    <button class="format-btn" data-command="bold" title="Fett"><b>B</b></button>
                    <button class="format-btn" data-command="italic" title="Kursiv"><i>I</i></button>
                    <button class="format-btn" data-command="underline" title="Unterstrichen"><u>U</u></button>
                    <div style="flex: 1"></div>
                    <span style="font-size: 11px; color: var(--text-muted); align-self: center;">Wird automatisch gespeichert</span>
                </div>
                <div class="rich-editor-content" contenteditable="true" id="richEditor">
                    ${step.content || '<p>Hier Text eingeben...</p>'}
                </div>
            </div>
        `;
        const editor = document.getElementById('richEditor');

        // Formatting function
        const format = (cmd) => {
            document.execCommand(cmd, false, null);
            editor.focus();
            step.content = editor.innerHTML;
            saveSession();
        };

        // Add listeners to toolbar buttons
        container.querySelectorAll('.format-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                format(btn.dataset.command);
            });
        });

        const syncContent = () => {
            if (step.content !== editor.innerHTML) {
                step.content = editor.innerHTML;
                saveSession();
            }
        };

        editor.addEventListener('input', syncContent);
        editor.addEventListener('blur', syncContent);

        // Focus editor initially
        setTimeout(() => editor.focus(), 100);
        return;
    }

    if (!tempImage) return;

    const canvas = document.createElement('canvas');
    canvas.width = tempImage.naturalWidth;
    canvas.height = tempImage.naturalHeight;
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '70vh';

    if (currentMode !== 'view') canvas.style.cursor = 'crosshair';

    const ctx = canvas.getContext('2d');
    ctx.drawImage(tempImage, 0, 0);

    const dpr = step.meta?.devicePixelRatio || 1;

    // Draw all markers
    if (step.markers) {
        step.markers.forEach((m, i) => drawMarker(ctx, m, i + 1, dpr, selectedMarkerIndices.includes(i)));
    } else if (step.rect) {
        // Compatibility
        drawMarker(ctx, { type: 'rect', ...step.rect }, null, dpr, false);
    }

    container.appendChild(canvas);
}

function drawMarker(ctx, m, number, dpr, isSelected) {
    ctx.save();
    if (isSelected) {
        ctx.shadowColor = 'rgba(79, 70, 229, 0.8)';
        ctx.shadowBlur = 15;
    }

    if (m.type === 'rect') {
        const offset = 5; // Adjusted to 5 to match preview/bake methods and account for stroke width
        const rx = (m.x - offset) * dpr;
        const ry = (m.y - offset) * dpr;
        const rw = (m.width + (offset * 2)) * dpr;
        const rh = (m.height + (offset * 2)) * dpr;

        ctx.strokeStyle = isSelected ? '#4f46e5' : '#bc0003';
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        roundRect(ctx, rx, ry, rw, rh, 8, false, true);

        if (number) {
            drawMarkerNumber(ctx, rx, ry, number, dpr);
        }
    } else if (m.type === 'arrow') {
        ctx.strokeStyle = isSelected ? '#4f46e5' : 'red';
        ctx.fillStyle = isSelected ? '#4f46e5' : 'red';
        ctx.lineWidth = 4;
        drawArrow(ctx, m.x1 * dpr, m.y1 * dpr, m.x2 * dpr, m.y2 * dpr);
    } else if (m.type === 'blur') {
        const rx = m.x * dpr;
        const ry = m.y * dpr;
        const rw = m.width * dpr;
        const rh = m.height * dpr;

        // Apply Blur
        ctx.save();
        ctx.beginPath();
        ctx.rect(rx, ry, rw, rh);
        ctx.clip();
        ctx.filter = 'blur(8px)';
        ctx.drawImage(ctx.canvas, 0, 0);
        ctx.filter = 'none';
        ctx.restore();

        // Border
        ctx.strokeStyle = isSelected ? 'rgba(79, 70, 229, 0.5)' : 'rgba(0,0,0,0.1)';
        ctx.lineWidth = isSelected ? 3 : 1;
        ctx.strokeRect(rx, ry, rw, rh);
    }
    ctx.restore();
}

function drawMarkerNumber(ctx, rx, ry, number, dpr) {
    const fontSize = 16 * dpr;
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    const text = number.toString();
    const metrics = ctx.measureText(text);
    const padding = 6 * dpr;
    const bgW = metrics.width + padding * 2;
    const bgH = fontSize + padding;

    ctx.fillStyle = '#bc0003';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rx, ry - bgH - 2, bgW, bgH, 4 * dpr);
    else ctx.rect(rx, ry - bgH - 2, bgW, bgH);
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.fillText(text, rx + padding, ry - padding - 2);
}

function updateStepMeta(key, value) {
    if (currentStepIndex === -1) return;
    const step = currentSession.steps[currentStepIndex];
    if (step[key] === value) return; // Ignore if no change

    step[key] = value;

    // History only for meaningful text changes
    if (key === 'title') pushHistory(`Titel geÃ¤ndert: ${value}`);
    if (key === 'description' && value) pushHistory(`Beschreibung aktualisiert`);
    if (key === 'field' && value) pushHistory(`Tabellenfeld gesetzt: ${value}`);

    saveSession();

    if (key === 'title' && step.type !== 'chapter' && step.type !== 'textblock') {
        // Auto-parsing logic for technical strings from an ERP system
        // Example: "Item (sales_order_123 - part_number_abc)"
        // Session: e.g. session_id_1, module_name_123
        const sessionRegex = /\b([a-z]{2,6}\d{4,}[a-z]\d{2,})\b/i;
        // Field: e.g. table_field_1, section_key_456
        const fieldRegex = /\b([a-z]{2,6}\d{3,}\.[a-z0-9_.-]{1,})\b/i;

        const sessionMatch = value.match(sessionRegex);
        const fieldMatch = value.match(fieldRegex);

        let updatedAnything = false;

        if (sessionMatch) {
            const session = sessionMatch[0];
            currentSession.steps[currentStepIndex].session = session;
            document.getElementById('stepSessionInput').value = session;
            updatedAnything = true;
        }
        if (fieldMatch) {
            const field = fieldMatch[0];
            currentSession.steps[currentStepIndex].field = field;
            document.getElementById('stepFieldInput').value = field;
            updatedAnything = true;
        }

        if (updatedAnything) {
            const currentStep = currentSession.steps[currentStepIndex];

            // Bereinigung vom Feld im Step Objekt (falls notwendig)
            if (currentStep.field && currentStep.field.includes('-n')) {
                currentStep.field = currentStep.field.split('-n')[0];
                document.getElementById('stepFieldInput').value = currentStep.field;
            }

            // Wenn beides vorhanden ist, Titel auf "EntwicklerunterstÃ¼tzung" setzen
            if (currentStep.session && currentStep.field) {
                const newTitle = "EntwicklerunterstÃ¼tzung";
                if (currentStep.title !== newTitle) {
                    currentStep.title = newTitle;
                    document.getElementById('stepTitleInput').value = newTitle;
                    value = newTitle;
                }
            } else {
                // Nur Fallback-Cleaning falls nicht beides da ist
                let cleanTitle = value;
                cleanTitle = cleanTitle.replace(/^Klick auf ["'](.*)["']$/, '$1');
                if (cleanTitle.includes('(')) {
                    cleanTitle = cleanTitle.split('(')[0].trim();
                }

                if (cleanTitle && cleanTitle !== value) {
                    currentStep.title = cleanTitle;
                    document.getElementById('stepTitleInput').value = cleanTitle;
                    value = cleanTitle;
                }
            }
            saveSession();
        }
    }

    if (key === 'title' || key === 'description') {
        const items = document.querySelectorAll('.step-item');
        if (items[currentStepIndex]) {
            const el = items[currentStepIndex].querySelector(key === 'title' ? '.step-title' : '.step-desc');
            if (el) el.textContent = value || (key === 'title' ? ('Schritt ' + (currentStepIndex + 1)) : 'Keine Beschreibung');
        }
    }
}

function resetCurrentMarkers() {
    if (currentStepIndex === -1) return;
    const step = currentSession.steps[currentStepIndex];

    if (confirm('Möchtest du alle Marker (Punkt, Viereck, Pfeile, Verpixelungen) für diesen Schritt entfernen?')) {
        pushUndoState('marker_change', 'Alle Marker gelöscht');
        delete step.x;
        delete step.y;
        delete step.rect;
        step.markers = [];
        selectedMarkerIndex = -1;
        selectedMarkerIndices = [];

        pushHistory('Aktion: Alle Marker gelöscht');
        saveSession();
        renderCanvas();
    }
}

function deleteCurrentStep() {
    if (currentStepIndex === -1) return;
    if (!confirm('Diesen Schritt wirklich lÃ¶schen?')) return;

    const stepToDelete = currentSession.steps[currentStepIndex];

    // Initialize global undo stack if missing
    if (!currentSession.undoStack) currentSession.undoStack = [];

    // Save deletion to global history
    currentSession.undoStack.push({
        type: 'delete',
        index: currentStepIndex,
        step: stepToDelete
    });

    // Clear redo stack on new action
    currentSession.redoStack = [];

    currentSession.steps.splice(currentStepIndex, 1);
    pushHistory('Aktion: Schritt gelÃ¶scht');
    saveSession();
    renderSidebar();
    if (currentSession.steps.length > 0) selectStep(Math.max(0, currentStepIndex - 1));
    else {
        currentStepIndex = -1;
        document.getElementById('canvasWrapper').innerHTML = '<div class="empty-state"><p>Keine Schritte vorhanden</p></div>';
    }
}

let saveTimeout = null;
async function saveSession(immediate = false) {
    if (immediate) {
        if (saveTimeout) clearTimeout(saveTimeout);
        await chrome.storage.local.set({ activeSession: currentSession });
        await triggerAutoSaveBackup();
        return;
    }

    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        await chrome.storage.local.set({ activeSession: currentSession });
        saveTimeout = null;
        await triggerAutoSaveBackup();
    }, 500); // 500ms debounce
}

let lastBackupTime = 0;
const BACKUP_INTERVAL_MS = 60 * 1000; // 1 Minute

async function triggerAutoSaveBackup() {
    const now = Date.now();
    if (now - lastBackupTime < BACKUP_INTERVAL_MS) {
        return; // Überspringen falls erst kürzlich gesichert
    }

    try {
        const data = await chrome.storage.local.get('auto_backups');
        let backups = data.auto_backups || [];
        
        // Leere/ungültige Sessions ignorieren
        if (!currentSession || !currentSession.steps || currentSession.steps.length === 0) {
            return;
        }

        const currentDataStr = JSON.stringify(currentSession);
        
        // Doppelte Backups vermeiden
        if (backups.length > 0) {
            const lastBackup = backups[0];
            if (JSON.stringify(lastBackup.sessionData) === currentDataStr) {
                return;
            }
        }

        const newBackup = {
            id: 'backup_' + now + '_' + Math.random().toString(36).substr(2, 5),
            timestamp: now,
            title: currentSession.title || 'Dokumentation',
            stepsCount: currentSession.steps.length,
            sessionData: JSON.parse(currentDataStr)
        };

        backups.unshift(newBackup);

        // Maximal 15 Backups aufbewahren
        if (backups.length > 15) {
            backups = backups.slice(0, 15);
        }

        await chrome.storage.local.set({ auto_backups: backups });
        lastBackupTime = now;
        console.log(`[Auto-Save] Backup erfolgreich erstellt: ${new Date(now).toLocaleTimeString()}`);
    } catch (e) {
        console.error('[Auto-Save] Fehler beim Sichern:', e);
    }
}

async function renderBackupList() {
    const backupList = document.getElementById('backupList');
    if (!backupList) return;

    backupList.innerHTML = '';

    try {
        const data = await chrome.storage.local.get('auto_backups');
        const backups = data.auto_backups || [];

        if (backups.length === 0) {
            backupList.innerHTML = '<div style="padding: 30px; text-align: center; color: var(--text-muted); font-size: 12px; font-weight: 500;">Keine automatischen Backups vorhanden.</div>';
            return;
        }

        backups.forEach(backup => {
            const item = document.createElement('div');
            item.className = 'backup-item';

            const date = new Date(backup.timestamp);
            const timeStr = date.toLocaleString('de-DE', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });

            item.innerHTML = `
                <div class="backup-info">
                    <div class="backup-title" title="${escapeHtml(backup.title)}">${escapeHtml(backup.title)}</div>
                    <div class="backup-meta">
                        <span>📅 ${timeStr}</span>
                        <span>📸 ${backup.stepsCount} Schritte</span>
                    </div>
                </div>
                <div class="backup-actions">
                    <button class="primary backup-btn-restore" data-id="${backup.id}">🔄 Wiederherstellen</button>
                    <button style="color: #ef4444; border-color: #fca5a5; background: transparent; cursor: pointer;" class="backup-btn-delete" data-id="${backup.id}">🗑️</button>
                </div>
            `;

            // Klick-Events binden
            item.querySelector('.backup-btn-restore').onclick = () => restoreBackup(backup.id);
            item.querySelector('.backup-btn-delete').onclick = () => deleteBackup(backup.id);

            backupList.appendChild(item);
        });
    } catch (e) {
        console.error('Error rendering backup list:', e);
        backupList.innerHTML = '<div style="padding: 20px; text-align: center; color: #ef4444; font-size: 12px;">Fehler beim Laden der Backups.</div>';
    }
}

async function restoreBackup(backupId) {
    try {
        const data = await chrome.storage.local.get('auto_backups');
        const backups = data.auto_backups || [];
        const backup = backups.find(b => b.id === backupId);

        if (!backup) {
            alert('Backup nicht gefunden.');
            return;
        }

        if (confirm(`Möchtest du das Backup vom ${new Date(backup.timestamp).toLocaleString('de-DE')} wirklich wiederherstellen?\n\nDeine aktuelle Session wird überschrieben.`)) {
            currentSession = JSON.parse(JSON.stringify(backup.sessionData));
            
            document.getElementById('documentTitleInput').value = currentSession.title || 'Dokumentation';
            document.getElementById('sessionVersionInput').value = currentSession.version || '1.0';
            document.getElementById('sessionTagsInput').value = (currentSession.tags || []).join(', ');
            
            const exportTitle = document.getElementById('exportTitleInput');
            if (exportTitle) exportTitle.value = currentSession.title;

            await saveSession(true);

            renderSidebar();
            if (currentSession.steps.length > 0) {
                selectStep(0);
            } else {
                currentStepIndex = -1;
                document.getElementById('canvasWrapper').innerHTML = '<div class="empty-state"><p>Keine Schritte vorhanden</p></div>';
            }

            document.getElementById('backupModal').style.display = 'none';
            alert('Backup erfolgreich wiederhergestellt!');
        }
    } catch (e) {
        console.error('Restore backup error:', e);
        alert('Fehler beim Wiederherstellen des Backups.');
    }
}

async function deleteBackup(backupId) {
    try {
        const data = await chrome.storage.local.get('auto_backups');
        let backups = data.auto_backups || [];
        backups = backups.filter(b => b.id !== backupId);

        await chrome.storage.local.set({ auto_backups: backups });
        renderBackupList();
    } catch (e) {
        console.error('Delete backup error:', e);
    }
}

async function clearAllBackups() {
    if (confirm('Möchtest du wirklich alle automatischen Backups unwiderruflich löschen?')) {
        try {
            await chrome.storage.local.set({ auto_backups: [] });
            renderBackupList();
        } catch (e) {
            console.error('Clear all backups error:', e);
        }
    }
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    if (typeof radius === 'undefined') radius = 5;
    if (typeof radius === 'number') {
        radius = { tl: radius, tr: radius, br: radius, bl: radius };
    } else {
        var defaultRadius = { tl: 0, tr: 0, br: 0, bl: 0 };
        for (var side in defaultRadius) {
            radius[side] = radius[side] || defaultRadius[side];
        }
    }
    ctx.beginPath();
    ctx.moveTo(x + radius.tl, y);
    ctx.lineTo(x + width - radius.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
    ctx.lineTo(x + width, y + height - radius.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
    ctx.lineTo(x + radius.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
    ctx.lineTo(x, y + radius.tl);
    ctx.quadraticCurveTo(x, y, x + radius.tl, y);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

async function getBase64Logo() {
    try {
        const response = await fetch(chrome.runtime.getURL('assets/logo.png'));
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error('Logo Error:', e);
        return null;
    }
}


async function exportSession(format) {
    const titleInput = document.getElementById('exportTitleInput');
    const docTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : 'Dokumentation';
    document.getElementById('exportModal').style.display = 'none';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeTitle = docTitle.replace(/[^a-zA-Z0-9_\- Ã¤Ã¶Ã¼Ã„Ã–ÃœÃŸ]/g, '_');
    const folderName = `eZNotes-${safeTitle}-${timestamp}`;

    // Bake markers into images for export (only for static HTML/PDF format)
    const exportSteps = [];
    for (let step of currentSession.steps) {
        const hasNoMarkers = !step.x && !step.y && !step.rect && (!step.markers || step.markers.length === 0);
        if (step.type === 'chapter' || step.type === 'textblock' || hasNoMarkers) {
            exportSteps.push({ ...step });
        } else {
            // Only bake for static HTML export, not for tour as tour renders overlays live
            const bakedUrl = (format === 'html') ? await bakeMarkersIntoImage(step) : step.dataUrl;
            exportSteps.push({ ...step, dataUrl: bakedUrl });
        }
    }

    if (format === 'html' || format === 'tour') {
        const logo = await getBase64Logo();
        const exportData = {
            title: docTitle,
            date: new Date().toLocaleString(),
            steps: exportSteps,
            logo: logo
        };

        await chrome.storage.local.set({ exportData: exportData });
        chrome.tabs.create({ url: format === 'tour' ? 'ui/tour.html' : 'ui/viewer.html' });
    } else if (format === 'standalone') {
        await downloadStandaloneTour(docTitle, safeTitle);
    }
}

async function downloadStandaloneTour(docTitle, safeTitle) {
    const logo = await getBase64Logo();

    // No baking for standalone as tour.js renders overlays
    const exportSteps = [];
    for (let step of currentSession.steps) {
        exportSteps.push({ ...step });
    }

    const exportData = {
        title: docTitle,
        date: new Date().toLocaleString(),
        steps: exportSteps,
        logo: logo
    };

    try {
        // Fetch template files
        const [html, css, js] = await Promise.all([
            fetch(chrome.runtime.getURL('ui/tour.html')).then(r => r.text()),
            fetch(chrome.runtime.getURL('css/tour.css')).then(r => r.text()),
            fetch(chrome.runtime.getURL('js/tour.js')).then(r => r.text())
        ]);

        // Build single file
        let fullHtml = html;

        // Inject CSS
        fullHtml = fullHtml.replace('<link rel="stylesheet" href="../css/tour.css">', `<style>${css}</style>`);

        // Inject JS + Data
        const injectedJs = `
            window.__data = ${JSON.stringify(exportData)};
            ${js}
        `;
        fullHtml = fullHtml.replace('<script src="../js/tour.js"></script>', `<script>${injectedJs}</script>`);

        // Download
        const blob = new Blob([fullHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        chrome.downloads.download({
            url: url,
            filename: `Klickanleitung-${safeTitle}.html`,
            saveAs: true
        });
    } catch (err) {
        console.error('Standalone Export Error:', err);
        alert('Fehler beim Export: ' + err.message);
    }
}

function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/markdown' });
    chrome.downloads.download({ url: URL.createObjectURL(blob), filename: filename, saveAs: false });
}

function downloadDataUrl(filename, dataUrl) {
    return new Promise(resolve => {
        chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false }, () => resolve());
    });
}

function escapeHtml(unsafe) {
    return (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function backupSession() {
    const data = JSON.stringify(currentSession, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eZNotes-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
}

function restoreSession(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const session = JSON.parse(event.target.result);
            if (session.steps && Array.isArray(session.steps)) {
                if (confirm('Aktuelle Session Ã¼berschreiben?')) {
                    currentSession = session;
                    await saveSession();
                    renderSidebar();
                    if (currentSession.steps.length > 0) selectStep(0);
                }
            } else {
                alert('UngÃ¼ltiges Backup-Format.');
            }
        } catch (err) {
            console.error('Restore Error:', err);
            alert('Fehler beim Laden des Backups.');
        }
    };
    reader.readAsText(file);
}

async function quickCopyImage() {
    if (currentStepIndex === -1) return;
    const step = currentSession.steps[currentStepIndex];

    try {
        const response = await fetch(step.dataUrl);
        const blob = await response.blob();

        await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': blob })
        ]);

        const btn = document.getElementById('btnQuickCopy');
        const oldText = btn.textContent;
        btn.textContent = 'âœ… Bild kopiert!';
        setTimeout(() => btn.textContent = oldText, 2000);
    } catch (err) {
        console.error('QuickCopy Error:', err);
        alert('Fehler beim Kopieren des Bildes.');
    }
}

async function copyYouTrackMarkdown() {
    const titleInput = document.getElementById('exportTitleInput');
    const docTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : 'Dokumentation';

    let md = `# ${docTitle}\n\n`;
    md += `*Erstellt am: ${new Date().toLocaleString()}*\n\n---\n\n`;

    let imageCounter = 1;
    for (let step of currentSession.steps) {
        if (step.type === 'chapter') {
            md += `## 🔖 ${step.title}\n\n`;
            if (step.description) md += `${step.description}\n\n`;
        } else if (step.type === 'textblock') {
            md += `### 📝 ${step.title}\n\n`;
            let content = step.content || '';
            // Basic HTML to Markdown conversion for the textblock
            let contentText = content.replace(/<br\s*\/?>/gi, '\n');
            contentText = contentText.replace(/<\/p>/gi, '\n\n');
            contentText = contentText.replace(/<[^>]*>/g, '');
            md += `${contentText.trim()}\n\n`;
        } else {
            md += `### Schritt ${imageCounter}: ${step.title || 'Ohne Titel'}\n\n`;
            if (step.description) md += `${step.description}\n\n`;

            // ERP Data
            if (step.session || step.field) {
                md += `> **System-Info:**\n`;
                if (step.session) md += `> - Session: \`${step.session}\`\n`;
                if (step.field) md += `> - Feld: \`${step.field}\`\n`;
                md += `\n`;
            }

            // Image Reference (Markdown format)
            md += `![Schritt ${imageCounter}](step${imageCounter}.png)\n\n`;

            // Bake markers into the image and trigger programmatic download
            const bakedUrl = await bakeMarkersIntoImage(step);
            if (bakedUrl) {
                const link = document.createElement('a');
                link.href = bakedUrl;
                link.download = `step${imageCounter}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }

            imageCounter++;
        }
    }

    md += `---\n*Exportiert mit eZNotes*`;

    try {
        await navigator.clipboard.writeText(md);
        alert('YouTrack Markdown wurde erfolgreich in die Zwischenablage kopiert!\n\nDie dazugehörigen Bilder wurden automatisch heruntergeladen.\n\nSo fügst du es in YouTrack ein:\n1. Drücke Strg+V im YouTrack-Editor, um den Text einzufügen.\n2. Ziehe die heruntergeladenen Bilder per Drag & Drop direkt in YouTrack.');
    } catch (err) {
        console.error('Clipboard Error:', err);
        const textArea = document.createElement("textarea");
        textArea.value = md;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            alert('YouTrack Markdown wurde in die Zwischenablage kopiert (Fallback-Methode)!\n\nDie Bilder wurden automatisch heruntergeladen.\n\nSo fügst du es in YouTrack ein:\n1. Drücke Strg+V im YouTrack-Editor, um den Text einzufügen.\n2. Ziehe die heruntergeladenen Bilder per Drag & Drop direkt in YouTrack.');
        } catch (e) {
            alert('Fehler beim Kopieren. Die Bilder wurden heruntergeladen, aber der Text konnte nicht kopiert werden. Bitte kopiere den Text manuell.');
        }
        document.body.removeChild(textArea);
    }
}

// --- NEW FUNCTIONS FOR MANUAL STEP MANAGEMENT ---

function addChapterStep() {
    const newChapter = {
        id: Date.now().toString(),
        type: 'chapter',
        title: 'Neues Kapitel',
        description: '',
        meta: {
            timestamp: Date.now()
        }
    };

    if (!currentSession.steps) currentSession.steps = [];
    currentSession.steps.push(newChapter);

    pushHistory('Aktion: Kapitel hinzugefÃ¼gt');
    saveSession().then(() => {
        renderSidebar();
        selectStep(currentSession.steps.length - 1);
    });
}

function addTextBlockStep() {
    const newBlock = {
        id: Date.now().toString(),
        type: 'textblock',
        title: 'Neuer Textblock',
        content: '<p>Hier Text eingeben...</p>',
        meta: {
            timestamp: Date.now()
        }
    };

    if (!currentSession.steps) currentSession.steps = [];
    currentSession.steps.push(newBlock);

    pushHistory('Aktion: Textblock hinzugefÃ¼gt');
    saveSession().then(() => {
        renderSidebar();
        selectStep(currentSession.steps.length - 1);
    });
}

function mergeSelectedSteps() {
    if (selectedStepsForMerge.size < 2) {
        alert('Bitte wÃ¤hle mindestens zwei Schritte mit Strg+Klick aus, um sie zusammenzufÃ¼hren.');
        return;
    }

    const indices = Array.from(selectedStepsForMerge).sort((a, b) => a - b);
    const baseStepIndex = indices[0];
    const baseStep = currentSession.steps[baseStepIndex];

    if (baseStep.type === 'chapter' || baseStep.type === 'textblock') {
        alert('Der erste markierte Schritt darf kein Kapitel oder Textblock sein.');
        return;
    }

    if (!confirm(`${indices.length} Schritte zusammenfÃ¼hren? Der erste Schritt wird als Basis verwendet.`)) return;

    // Save state to undo stack before merging
    if (!currentSession.undoStack) currentSession.undoStack = [];
    currentSession.undoStack.push({
        type: 'merge',
        prevSteps: JSON.parse(JSON.stringify(currentSession.steps))
    });
    if (currentSession.undoStack.length > 30) currentSession.undoStack.shift();

    // Clear redo stack on new action
    currentSession.redoStack = [];

    // Initialize markers array if not exists
    if (!baseStep.markers) baseStep.markers = [];

    // Add original rect if exists
    if (baseStep.rect && baseStep.markers.length === 0) {
        baseStep.markers.push({ ...baseStep.rect });
        delete baseStep.rect;
    }

    // Merge others
    for (let i = 1; i < indices.length; i++) {
        const stepToMerge = currentSession.steps[indices[i]];
        if (stepToMerge.markers) {
            baseStep.markers.push(...stepToMerge.markers.map(m => ({ ...m })));
        } else if (stepToMerge.rect) {
            // Legacy fallback
            baseStep.markers.push({ type: 'rect', ...stepToMerge.rect });
        }
    }

    // Remove merged steps (from end to start to keep indices valid)
    const reversedIndices = indices.slice(1).reverse();
    reversedIndices.forEach(idx => {
        currentSession.steps.splice(idx, 1);
    });

    pushHistory(`Aktion: ${indices.length} Schritte zusammengefÃ¼hrt`);

    selectedStepsForMerge.clear();
    saveSession().then(() => {
        renderSidebar();
        selectStep(currentSession.steps.indexOf(baseStep));
        alert('Schritte erfolgreich zusammengefÃ¼hrt!');
    });
}

function handleImageImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Bitte wÃ¤hle eine Bilddatei aus.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        addNewStep(event.target.result, file.name);
    };
    reader.readAsDataURL(file);
}

function handlePaste(e) {
    // Only paste if not in an input/textarea (unless it's the specific add button context, but global is fine if we check target)
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = (event) => {
                addNewStep(event.target.result, 'EingefÃ¼gtes Bild');
            };
            reader.readAsDataURL(blob);
        }
    }
}

function addNewStep(dataUrl, fileName) {
    const newStep = {
        id: Date.now().toString(),
        title: fileName.split('.')[0],
        description: '',
        dataUrl: dataUrl,
        meta: {
            devicePixelRatio: 1,
            timestamp: Date.now()
        }
    };

    if (!currentSession.steps) currentSession.steps = [];
    currentSession.steps.push(newStep);

    saveSession().then(() => {
        renderSidebar();
        selectStep(currentSession.steps.length - 1);
        alert('Neuer Schritt hinzugefÃ¼gt!');
    });
}

async function bakeMarkersIntoImage(step) {
    if (!step.dataUrl) return null;
    const hasMarkers = step.markers && step.markers.length > 0;
    const hasLegacyMarkers = step.x || step.y || step.rect;
    if (!hasMarkers && !hasLegacyMarkers) return step.dataUrl;

    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const dpr = step.meta?.devicePixelRatio || 1;

            if (step.markers) {
                step.markers.forEach((m, i) => {
                    // We use the same drawMarker logic but baked
                    // Let's re-implement simply here to avoid dependency on global state/isSelected
                    ctx.save();
                    if (m.type === 'rect') {
                        const offset = 5; // Adjusted from 3 to 5 to account for editor's 4px centered stroke width
                        const rx = (m.x - offset) * dpr;
                        const ry = (m.y - offset) * dpr;
                        const rw = (m.width + (offset * 2)) * dpr;
                        const rh = (m.height + (offset * 2)) * dpr;
                        ctx.strokeStyle = '#bc0003';
                        ctx.lineWidth = 4 * dpr;
                        bakeRoundRect(ctx, rx, ry, rw, rh, 8 * dpr);
                        ctx.stroke();
                        bakeMarkerNumber(ctx, rx, ry, i + 1, dpr);
                    } else if (m.type === 'arrow') {
                        ctx.strokeStyle = 'red';
                        ctx.fillStyle = 'red';
                        ctx.lineWidth = 4 * dpr;
                        drawArrow(ctx, m.x1 * dpr, m.y1 * dpr, m.x2 * dpr, m.y2 * dpr);
                    } else if (m.type === 'blur') {
                        const rx = m.x * dpr;
                        const ry = m.y * dpr;
                        const rw = m.width * dpr;
                        const rh = m.height * dpr;
                        ctx.save();
                        ctx.beginPath();
                        ctx.rect(rx, ry, rw, rh);
                        ctx.clip();
                        ctx.filter = 'blur(8px)';
                        ctx.drawImage(canvas, 0, 0);
                        ctx.filter = 'none';
                        ctx.restore();
                        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(rx, ry, rw, rh);
                    }
                    ctx.restore();
                });
            } else if (step.rect) {
                // Legacy rect support
                const offset = 5; // Adjusted from 3 to 5 to account for editor's 4px centered stroke width
                const rx = (step.rect.x - offset) * dpr;
                const ry = (step.rect.y - offset) * dpr;
                const rw = (step.rect.width + (offset * 2)) * dpr;
                const rh = (step.rect.height + (offset * 2)) * dpr;
                ctx.strokeStyle = '#bc0003';
                ctx.lineWidth = 4 * dpr;
                bakeRoundRect(ctx, rx, ry, rw, rh, 8 * dpr);
                ctx.stroke();
            } else if (typeof step.x === 'number') {
                // Legacy point support
                const pxX = step.x * dpr;
                const pxY = step.y * dpr;
                ctx.beginPath();
                ctx.arc(pxX, pxY, 30 * dpr, 0, Math.PI * 2);
                ctx.lineWidth = 6 * dpr;
                ctx.strokeStyle = '#bc0003';
                ctx.stroke();
            }
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(step.dataUrl);
        img.src = step.dataUrl;
    });
}

// Helper for baking roundRect without using the global context function if not needed
function bakeRoundRect(ctx, x, y, width, height, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function bakeMarkerNumber(ctx, rx, ry, number, dpr) {
    const fontSize = 16 * dpr;
    ctx.font = `bold ${fontSize}px Inter, sans-serif`;
    const text = number.toString();
    const metrics = ctx.measureText(text);
    const padding = 6 * dpr;
    const bgW = metrics.width + padding * 2;
    const bgH = fontSize + padding;

    ctx.fillStyle = '#bc0003';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rx, ry - bgH - 2, bgW, bgH, 4 * dpr);
    else ctx.rect(rx, ry - bgH - 2, bgW, bgH);
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.fillText(text, rx + padding, ry - padding - 2);
}


// Helper to get directory handle for folder-saving
async function getRootHandle() {
    return new Promise((resolve) => {
        const request = indexedDB.open('eZNotesDB', 1);
        request.onsuccess = () => {
            const db = request.result;
            try {
                const tx = db.transaction('handles', 'readonly');
                const store = tx.objectStore('handles');
                const getReq = store.get('rootFolder');
                getReq.onsuccess = () => resolve(getReq.result);
                getReq.onerror = () => resolve(null);
            } catch (e) { resolve(null); }
        };
        request.onerror = () => resolve(null);
    });
}

async function saveToLibrary() {
    const titleInput = document.getElementById('documentTitleInput');
    const docTitle = titleInput && titleInput.value.trim() ? titleInput.value.trim() : (currentSession.title || 'Dokumentation');

    currentSession.title = docTitle;
    currentSession.timestamp = Date.now();
    currentSession.version = document.getElementById('sessionVersionInput').value || "1.0";

    pushHistory(`Archiviert in Bibliothek (v${currentSession.version})`);

    try {
        // 1. Save to chrome.storage (for quick access in UI)
        const data = await chrome.storage.local.get('saved_sessions');
        let saved = data.saved_sessions || [];
        const index = saved.findIndex(s => s.id === currentSession.id);
        if (index !== -1) {
            saved[index] = JSON.parse(JSON.stringify(currentSession));
        } else {
            saved.push(JSON.parse(JSON.stringify(currentSession)));
        }
        await chrome.storage.local.set({ saved_sessions: saved });

        // 2. Try to save to LOCAL DIRECTORY (if set)
        const rootHandle = await getRootHandle();
        const safeTitle = docTitle.replace(/[/\\?%*:|"<>]/g, '_');
        const fileName = `${safeTitle} (${currentSession.version || '1.0'}).json`;

        if (rootHandle) {
            const options = { mode: 'readwrite' };
            if (await rootHandle.queryPermission(options) === 'granted') {
                const fileHandle = await rootHandle.getFileHandle(fileName, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(JSON.stringify(currentSession, null, 2));
                await writable.close();
                alert(`Erfolgreich archiviert!\nDie Datei wurde direkt im Stammverzeichnis gespeichert:\n${fileName}`);
                return;
            }
        }

        // 3. Fallback: Save to Downloads/library
        const dlPath = `library/${fileName}`;
        const blob = new Blob([JSON.stringify(currentSession, null, 2)], { type: 'application/json' });
        const reader = new FileReader();
        reader.onload = () => {
            chrome.downloads.download({
                url: reader.result,
                filename: dlPath,
                saveAs: false
            });
        };
        reader.readAsDataURL(blob);

        alert(`Archiviert!\n(Hinweis: Kein Stammverzeichnis verbunden, Datei liegt in Downloads/library/)`);

    } catch (err) {
        console.error('Library Save Error:', err);
        alert('Fehler beim Archivieren: ' + err.message);
    }
}

function pushHistory(action) {
    if (!currentSession.history) currentSession.history = [];
    currentSession.history.push({
        timestamp: Date.now(),
        action: action,
        version: currentSession.version || "1.0"
    });
    // Keep only last 100 actions to avoid data bloat
    if (currentSession.history.length > 100) currentSession.history.shift();
}

async function playAllSteps() {
    const lockData = await chrome.storage.local.get('featuresUnlocked');
    if (!lockData.featuresUnlocked) {
        alert('Diese Funktion ist gesperrt. Bitte schalte die Bibliotheksfunktionen im Hauptmenü frei.');
        return;
    }

    if (!currentSession.steps || currentSession.steps.length === 0) return;

    const automationSteps = currentSession.steps.filter(s => s.selector);

    if (automationSteps.length === 0) {
        alert('Keine automatisierbaren Schritte gefunden.');
        return;
    }

    // Automatisierung starten (Silent)
    const indicator = document.createElement('div');
    indicator.innerText = '● Automatisierung läuft...';
    indicator.style = 'position:fixed; top:10px; right:10px; background:red; color:white; padding:5px 10px; z-index:9999; border-radius:4px;';
    document.body.appendChild(indicator);

    for (let i = 0; i < automationSteps.length; i++) {
        const step = automationSteps[i];

        // Tab suchen für jeden Schritt (falls Domain wechselt)
        const hostname = step.meta?.hostname || '';
        const domainMatch = hostname.split('.').slice(-2).join('.');
        const tabs = await chrome.tabs.query({});
        let targetTab = tabs.find(t => {
            try {
                if (!t.url) return false;
                const tabUrl = new URL(t.url);
                return tabUrl.hostname === hostname || tabUrl.hostname.includes(hostname) || (domainMatch && tabUrl.hostname.includes(domainMatch));
            } catch (e) { return false; }
        });

        if (targetTab) {
            chrome.tabs.sendMessage(targetTab.id, {
                type: 'PLAY_STEP',
                selector: step.selector,
                elementText: step.title,
                value: step.value
            });
            chrome.tabs.update(targetTab.id, { active: true });
        }

        if (i < automationSteps.length - 1) {
            const delayMs = typeof step.rpaDelay === 'number' ? step.rpaDelay * 1000 : 3500;
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    indicator.remove();
}

async function playStepOnSite() {
    const lockData = await chrome.storage.local.get('featuresUnlocked');
    if (!lockData.featuresUnlocked) {
        alert('Diese Funktion ist gesperrt. Bitte schalte die Bibliotheksfunktionen im Hauptmenü frei.');
        return;
    }

    if (currentStepIndex === -1) return;
    const step = currentSession.steps[currentStepIndex];
    if (!step.selector) return;

    const tabs = await chrome.tabs.query({});
    const hostname = step.meta?.hostname || '';
    const domainMatch = hostname.split('.').slice(-2).join('.');

    let targetTab = tabs.find(t => {
        try {
            if (!t.url) return false;
            const tabUrl = new URL(t.url);
            return tabUrl.hostname === hostname || tabUrl.hostname.includes(hostname) || (domainMatch && tabUrl.hostname.includes(domainMatch));
        } catch (e) { return false; }
    });

    if (targetTab) {
        chrome.tabs.sendMessage(targetTab.id, {
            type: 'PLAY_STEP',
            selector: step.selector,
            elementText: step.title,
            value: step.value
        });
        chrome.tabs.update(targetTab.id, { active: true });
    }
}

// --- [Point 7] Interaktive Overlay Guide starten ---
async function startOverlayGuide() {
    const lockData = await chrome.storage.local.get('featuresUnlocked');
    if (!lockData.featuresUnlocked) {
        alert('Diese Funktion ist gesperrt. Bitte schalte die Bibliotheksfunktionen im Hauptmenü frei.');
        return;
    }

    document.getElementById('exportModal').style.display = 'none';

    // Wir nehmen den Hostname des ersten Bild-Schritts
    const firstStep = currentSession.steps.find(s => s.dataUrl && s.meta?.hostname);
    if (!firstStep) {
        alert('Keine gültigen Schritte für einen Guide gefunden.');
        return;
    }

    const hostname = firstStep.meta.hostname || '';
    const domainMatch = hostname.split('.').slice(-2).join('.');

    const tabs = await chrome.tabs.query({});
    let targetTab = tabs.find(t => {
        try {
            if (!t.url) return false;
            const tabUrl = new URL(t.url);
            return tabUrl.hostname === hostname || tabUrl.hostname.includes(hostname) || (domainMatch && tabUrl.hostname.includes(domainMatch));
        } catch (e) { return false; }
    });

    // Fallback: Aktueller Tab wenn Bestätigt (für schwierige Iframe/Portal-Apps)
    if (!targetTab) {
        const lastTabs = await chrome.tabs.query({ active: true, currentWindow: false });
        const lastTab = lastTabs[0];
        const confirmMsg = `Die Zielseite "${hostname}" wurde nicht direkt gefunden.\n\nSoll der Guide auf dem aktuell aktiven Tab gestartet werden?`;
        if (lastTab && confirm(confirmMsg)) {
            targetTab = lastTab;
        }
    }

    if (!targetTab) {
        alert(`Bitte öffnen Sie zuerst die Zielseite (${hostname}), um den Guide zu starten.`);
        return;
    }

    // RPA Live View direkt auf dem Ziel-Tab starten (Kapitel und Textblöcke überspringen)
    const guideSteps = currentSession.steps.filter(s => s.type !== 'chapter' && s.type !== 'textblock');

    if (guideSteps.length === 0) {
        alert('Keine ausführbaren Schritte für den RPA Live View gefunden.');
        return;
    }

    chrome.tabs.sendMessage(targetTab.id, {
        type: 'START_LIVE_VIEW',
        steps: guideSteps
    });

    chrome.tabs.update(targetTab.id, { active: true });
}

async function checkForUpdates() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/SaschaArend/eZNotes/main/manifest.json');
        if (!response.ok) return;
        const remoteManifest = await response.json();
        const remoteVersion = remoteManifest.version;
        const localVersion = chrome.runtime.getManifest().version;

        if (remoteVersion && remoteVersion !== localVersion) {
            const banner = document.getElementById('editorUpdateBanner');
            const versionSpan = document.getElementById('editorRemoteVersion');
            if (banner && versionSpan) {
                versionSpan.textContent = remoteVersion;
                banner.style.display = 'block';
                banner.onclick = () => {
                    alert(`Ein neues Update für eZNotes ist verfügbar!\n\nLokal installiert: v${localVersion}\nVerfügbar auf GitHub: v${remoteVersion}\n\nBitte schließe Google Chrome komplett und führe die Datei "update.bat" im Projektordner aus, um das Update automatisch durchzuführen.`);
                };
            }
        }
    } catch (e) {
        console.warn('[UpdateCheck] Fehler:', e);
    }
}

