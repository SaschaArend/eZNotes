let savedSessions = [];
let filteredSessions = [];
let selectedTag = null;
let rootDirHandle = null;
let currentHistorySession = null;
let selectedSessionIds = new Set();

// IndexedDB setup for storing non-serializable directory handles
const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('eZNotesDB', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

async function setHandle(name, handle) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(handle, name);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getHandle(name) {
    const db = await dbPromise;
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readonly');
        const request = tx.objectStore('handles').get(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(tx.error);
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    await loadSessions();
    setupEventListeners();

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.theme) {
            if (changes.theme.newValue === 'dark') {
                document.body.classList.add('dark-theme');
            } else {
                document.body.classList.remove('dark-theme');
            }
        }
    });
});

async function loadSessions() {
    // 1. Regular saved sessions from storage
    const data = await chrome.storage.local.get('saved_sessions');
    savedSessions = data.saved_sessions || [];

    // 2. Try to load and scan root directory
    rootDirHandle = await getHandle('rootFolder');
    if (rootDirHandle) {
        // Need to check for permission again after tab restart
        const options = { mode: 'readwrite' };
        if (await rootDirHandle.queryPermission(options) === 'granted') {
            await scanRootDirectory();
        } else {
            document.getElementById('directoryStatus').style.display = 'flex';
            document.getElementById('directoryPathText').textContent = '⚠️ Zugriff auf Stammverzeichnis erforderlich';
            document.getElementById('btnSyncDir').textContent = 'Zulassen';
        }
    }

    filteredSessions = [...savedSessions];
    applySorting();
    renderTagCloud();
    renderLibrary();
}

async function scanRootDirectory() {
    if (!rootDirHandle) return;

    try {
        const newSessions = [];
        for await (const entry of rootDirHandle.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                const file = await entry.getFile();
                const text = await file.text();
                try {
                    const json = JSON.parse(text);
                    if (json.steps && Array.isArray(json.steps)) {
                        // FIX: Ensure title is loaded (prefer JSON title, fallback to Filename)
                        json.title = json.title || entry.name.replace('.json', '');

                        // Mark it as synced from file system
                        json.fromFile = entry.name;
                        newSessions.push(json);
                    }
                } catch (e) { }
            }
        }

        // Merge with existing storage sessions (avoid duplicates by ID)
        const storageData = await chrome.storage.local.get('saved_sessions');
        const existing = storageData.saved_sessions || [];

        // Use a map to merge. File system wins if IDs match.
        const mergeMap = new Map();
        existing.forEach(s => mergeMap.set(s.id, s));
        newSessions.forEach(s => mergeMap.set(s.id, s));

        savedSessions = Array.from(mergeMap.values());
        await chrome.storage.local.set({ saved_sessions: savedSessions });

        // IMPORTANT: Update filters and UI
        applyFilters();
        renderTagCloud();

        document.getElementById('directoryStatus').style.display = 'flex';
        document.getElementById('directoryPathText').textContent = `Stammverzeichnis: ${rootDirHandle.name}`;
        document.getElementById('btnSyncDir').textContent = 'Aktualisieren';

        // Ensure OLD directory exists
        await rootDirHandle.getDirectoryHandle('OLD', { create: true });

        console.log(`Scan abgeschlossen. ${newSessions.length} Dokumente aus Ordner geladen.`);
    } catch (err) {
        console.error('Directory Scan Error:', err);
        showToast('Fehler beim Scannen des Ordners');
    }
}

function setupEventListeners() {
    document.getElementById('searchInput').addEventListener('input', (e) => {
        applyFilters();
    });

    document.getElementById('sortSelect').addEventListener('change', () => {
        applySorting();
        renderLibrary();
    });


    // Close button (closes current tab)
    const btnClose = document.getElementById('btnClose');
    if (btnClose) {
        btnClose.addEventListener('click', () => {
            window.close();
        });
    }

    // Modal Close
    document.getElementById('closeHistory').onclick = () => {
        document.getElementById('historyModal').style.display = 'none';
    };

    window.onclick = (e) => {
        const modal = document.getElementById('historyModal');
        if (e.target === modal) modal.style.display = 'none';
    };

    document.getElementById('btnClearHistory').onclick = async () => {
        if (!currentHistorySession) return;

        if (confirm('Möchtest du die gesamte Historie für dieses Dokument löschen? Dieser Vorgang kann nicht rückgängig gemacht werden.')) {
            currentHistorySession.history = [];

            // Add a fresh entry so it's not empty
            currentHistorySession.history.push({
                timestamp: Date.now(),
                action: 'Historie manuell geleert',
                version: currentHistorySession.version || '1.0'
            });

            await updateSessionInStorageAndFilesystem(currentHistorySession);
            showHistory(currentHistorySession);
            showToast('Historie geleert');
        }
    };

    // Root Directory Buttons
    document.getElementById('btnSetRoot').onclick = async () => {
        try {
            const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
            await setHandle('rootFolder', handle);
            rootDirHandle = handle;
            await scanRootDirectory();
            showToast('Stammverzeichnis verbunden');
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err);
                alert('Fehler beim Zugriff auf das Verzeichnis.');
            }
        }
    };

    document.getElementById('btnSyncDir').onclick = async () => {
        if (!rootDirHandle) return;
        const options = { mode: 'readwrite' };
        if (await rootDirHandle.queryPermission(options) !== 'granted') {
            await rootDirHandle.requestPermission(options);
        }
        await scanRootDirectory();
        applyFilters();
        renderTagCloud();
        showToast('Verzeichnis synchronisiert');
    };

    // Bulk Action Buttons
    document.getElementById('btnCancelSelection').onclick = () => {
        selectedSessionIds.clear();
        updateSelectionUI();
        renderLibrary();
    };

    document.getElementById('btnBulkMerge').onclick = mergeSelectedSessions;

    document.getElementById('btnThemeToggle')?.addEventListener('click', toggleTheme);
}

function applySorting() {
    const sortBy = document.getElementById('sortSelect').value;
    filteredSessions.sort((a, b) => {
        if (sortBy === 'date_desc') return (b.timestamp || 0) - (a.timestamp || 0);
        if (sortBy === 'date_asc') return (a.timestamp || 0) - (b.timestamp || 0);
        if (sortBy === 'name_asc') return (a.title || '').localeCompare(b.title || '');
        if (sortBy === 'steps_desc') return (b.steps?.length || 0) - (a.steps?.length || 0);
        return 0;
    });
}


function renderTagCloud() {
    const cloud = document.getElementById('tagCloud');
    cloud.innerHTML = '';

    // Get all unique tags
    const allTags = new Set();
    savedSessions.forEach(s => {
        if (s.tags) s.tags.forEach(t => allTags.add(t));
    });

    if (allTags.size === 0) return;

    // "All" Chip
    const allChip = document.createElement('div');
    allChip.className = `tag-chip ${selectedTag === null ? 'active' : ''}`;
    allChip.textContent = 'Alle';
    allChip.onclick = () => {
        selectedTag = null;
        applyFilters();
        renderTagCloud();
    };
    cloud.appendChild(allChip);

    Array.from(allTags).sort().forEach(tag => {
        const chip = document.createElement('div');
        chip.className = `tag-chip ${selectedTag === tag ? 'active' : ''}`;
        chip.textContent = tag;
        chip.onclick = () => {
            selectedTag = (selectedTag === tag) ? null : tag;
            applyFilters();
            renderTagCloud();
        };
        cloud.appendChild(chip);
    });
}

function applyFilters() {
    const query = document.getElementById('searchInput').value.toLowerCase();

    filteredSessions = savedSessions.filter(s => {
        // Basic Search
        const inTitle = (s.title || '').toLowerCase().includes(query);
        const inDesc = (s.description || '').toLowerCase().includes(query);
        const inTags = (s.tags || []).some(t => t.toLowerCase().includes(query));

        // DEEP SEARCH (Point 7)
        let inSteps = false;
        if (s.steps) {
            inSteps = s.steps.some(step =>
                (step.title || '').toLowerCase().includes(query) ||
                (step.description || '').toLowerCase().includes(query) ||
                (step.session || '').toLowerCase().includes(query) ||
                (step.field || '').toLowerCase().includes(query)
            );
        }

        const matchesQuery = inTitle || inDesc || inTags || inSteps;
        const matchesTag = selectedTag === null || (s.tags || []).includes(selectedTag);

        return matchesQuery && matchesTag;
    });

    renderLibrary();
}

function renderLibrary() {
    // ... logic remains but we add Tags to the card
    const grid = document.getElementById('libraryGrid');
    const stats = document.getElementById('statsLabel');
    grid.innerHTML = '';

    stats.textContent = `Geladen: ${filteredSessions.length} Dokumentationen`;

    if (filteredSessions.length === 0) {
        grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><h2>Keine Treffer</h2></div>`;
        return;
    }

    applySorting();

    filteredSessions.forEach((session, index) => {
        const isSelected = selectedSessionIds.has(session.id);
        const card = document.createElement('div');
        card.className = `session-card ${isSelected ? 'selected' : ''}`;

        const dateStr = session.timestamp ? new Date(session.timestamp).toLocaleString('de-DE') : 'Unbekannt';
        const stepCount = session.steps ? session.steps.length : 0;
        const firstImg = session.steps?.find(s => s.dataUrl)?.dataUrl;

        // Tags list HTML
        const tagsHtml = (session.tags || []).map(t => `<span style="font-size: 10px; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; margin-right: 4px;">${t}</span>`).join('');

        card.innerHTML = `
            <input type="checkbox" class="card-checkbox" ${isSelected ? 'checked' : ''}>
            <div class="session-badge">V ${session.version || '1.0'}</div>
            <div class="session-title">${escapeHtml(session.title || 'Dokumentation')}</div>
            <div style="margin-bottom: 8px;">${tagsHtml}</div>
            <div class="session-meta">
                <div class="meta-item">📅 ${dateStr}</div>
                <div class="meta-item">📸 ${stepCount} Schritte</div>
            </div>
            <div class="session-preview" style="${firstImg ? `background-image: url(${firstImg})` : 'background: #27272a;'}"></div>
            <div class="card-actions">
                <button class="action-btn primary btn-load">✏️ Öffnen</button>
                <button class="action-btn btn-history">📜 Historie</button>
                <button class="action-btn danger btn-delete">🗑️</button>
            </div>
        `;

        // Checkbox Logic
        card.querySelector('.card-checkbox').onclick = (e) => {
            e.stopPropagation();
            toggleSelection(session.id);
        };

        card.onclick = (e) => {
            if (e.target.closest('.card-actions') || e.target.closest('.card-checkbox')) return;
            toggleSelection(session.id);
        };

        card.querySelector('.btn-load').onclick = () => loadSession(session.id);
        card.querySelector('.btn-delete').onclick = () => deleteSession(session.id);
        card.querySelector('.btn-history').onclick = () => showHistory(session);

        grid.appendChild(card);
    });
}

function toggleSelection(id) {
    if (selectedSessionIds.has(id)) {
        selectedSessionIds.delete(id);
    } else {
        selectedSessionIds.add(id);
    }
    updateSelectionUI();
    renderLibrary();
}

function updateSelectionUI() {
    const bar = document.getElementById('selectionToolbar');
    const countText = document.getElementById('selectedCountText');
    const count = selectedSessionIds.size;

    if (count > 0) {
        bar.classList.add('show');
        countText.textContent = count;
    } else {
        bar.classList.remove('show');
    }
}

function showHistory(session) {
    currentHistorySession = session;
    const modal = document.getElementById('historyModal');
    const list = document.getElementById('historyList');
    const title = document.getElementById('historyTitle');

    if (!modal || !list) return;

    title.textContent = `Historie: ${session.title || 'Dokumentation'}`;
    list.innerHTML = '';

    // Create a temporary history if none exists for display
    let historyToShow = session.history || [];

    if (historyToShow.length === 0) {
        // Generic first entry if we have at least a timestamp
        historyToShow.push({
            timestamp: session.timestamp || Date.now(),
            action: 'Dokument erstellt / archiviert',
            version: session.version || '1.0'
        });
    }

    // Show newest first
    const sortedHistory = [...historyToShow].reverse();

    sortedHistory.forEach(h => {
        const date = new Date(h.timestamp);
        const timeStr = date.toLocaleString('de-DE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        const item = document.createElement('div');
        item.className = 'history-item';

        // Escape the action text for safety
        const safeAction = escapeHtml(h.action);
        const safeVersion = escapeHtml(h.version || '1.0');

        item.innerHTML = `
            <div class="history-line"></div>
            <div class="history-dot"></div>
            <div class="history-content">
                <div class="history-time">${timeStr}</div>
                <div class="history-action">
                    ${safeAction}
                    <span class="history-version">v${safeVersion}</span>
                </div>
            </div>
        `;
        list.appendChild(item);
    });

    modal.style.display = 'flex';
}

async function loadSession(id) {
    const session = savedSessions.find(s => s.id === id);
    if (!session) return;

    if (confirm(`Möchtest du "${session.title}" in den Editor laden? \nEine neue Version wird automatisch erstellt.`)) {
        // --- NEW: Static Versioning & History ---
        if (!session.history) session.history = [];

        const oldVersion = session.version || "1.0";
        // Simple auto-increment (e.g. 1.0 -> 1.1 or 1.10)
        let parts = oldVersion.split('.');
        if (parts.length > 1) {
            parts[1] = parseInt(parts[1]) + 1;
        } else {
            parts.push("1");
        }
        const newVersion = parts.join('.');

        session.history.push({
            timestamp: Date.now(),
            action: 'Geladen aus Bibliothek',
            oldVersion: oldVersion,
            newVersion: newVersion
        });

        session.version = newVersion;
        session.isActive = true;

        // FIX: Create a NEW ID so it doesn't overwrite the old version in the library/file system
        session.id = Date.now().toString() + Math.random().toString(36).substr(2, 5);

        // Update ONLY the activeSession slot for the editor
        await chrome.storage.local.set({
            activeSession: session
        });

        window.location.href = 'editor.html';
    }
}

async function deleteSession(id) {
    const session = savedSessions.find(s => s.id === id);
    if (!session) return;

    const msg = session.fromFile ? `Dokumentation "${session.title}" in den Ordner "OLD" verschieben?` : `Dokumentation "${session.title}" wirklich unwiderruflich löschen?`;

    if (confirm(msg)) {
        // 1. Move file if it's from the root directory
        if (session.fromFile && rootDirHandle) {
            try {
                const options = { mode: 'readwrite' };
                if (await rootDirHandle.queryPermission(options) === 'granted') {
                    const oldDir = await rootDirHandle.getDirectoryHandle('OLD', { create: true });
                    const fileHandle = await rootDirHandle.getFileHandle(session.fromFile);

                    // Move/Rename is supported in newer Chromium as .move()
                    // Fallback is copy-then-delete
                    if (fileHandle.move) {
                        await fileHandle.move(oldDir, session.fromFile);
                    } else {
                        const file = await fileHandle.getFile();
                        const newFileHandle = await oldDir.getFileHandle(session.fromFile, { create: true });
                        const writable = await newFileHandle.createWritable();
                        await writable.write(await file.arrayBuffer());
                        await writable.close();
                        await rootDirHandle.removeEntry(session.fromFile);
                    }
                }
            } catch (err) {
                console.error('Move to OLD failed:', err);
            }
        }

        // 2. Remove from local memory and storage
        savedSessions = savedSessions.filter(s => s.id !== id);
        await chrome.storage.local.set({ saved_sessions: savedSessions });

        showToast(session.fromFile ? 'In "OLD" verschoben' : 'Dokumentation gelöscht');
        filteredSessions = filteredSessions.filter(s => s.id !== id);
        renderLibrary();
    }
}

function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

async function updateSessionInStorageAndFilesystem(session) {
    // 1. Update in local storage
    const idx = savedSessions.findIndex(s => s.id === session.id);
    if (idx !== -1) {
        savedSessions[idx] = JSON.parse(JSON.stringify(session));
        await chrome.storage.local.set({ saved_sessions: savedSessions });
    }

    // 2. Update file in root directory if applicable
    if (session.fromFile && rootDirHandle) {
        try {
            const options = { mode: 'readwrite' };
            if (await rootDirHandle.queryPermission(options) === 'granted') {
                const fileHandle = await rootDirHandle.getFileHandle(session.fromFile, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(JSON.stringify(session, null, 2));
                await writable.close();
            }
        } catch (err) {
            console.error('Failed to update file after history clear:', err);
        }
    }
}

async function mergeSelectedSessions() {
    const ids = Array.from(selectedSessionIds);
    if (ids.length < 2) {
        alert('Bitte wähle mindestens zwei Dokumente zum Zusammenführen aus.');
        return;
    }

    const sessionsToMerge = savedSessions.filter(s => ids.includes(s.id));
    const newTitle = prompt('Titel für die neue zusammengeführte Dokumentation:', `Zusammenführung (${sessionsToMerge.length} Dokumente)`);
    if (!newTitle) return;

    // Combine steps
    let combinedSteps = [];
    sessionsToMerge.forEach(s => {
        combinedSteps = combinedSteps.concat(s.steps || []);
    });

    const newSession = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        title: newTitle,
        version: "1.0",
        timestamp: Date.now(),
        steps: combinedSteps,
        history: [{
            timestamp: Date.now(),
            action: `Zusammengeführt aus: ${sessionsToMerge.map(s => s.title).join(', ')}`,
            version: "1.0"
        }],
        tags: Array.from(new Set(sessionsToMerge.flatMap(s => s.tags || [])))
    };

    // Save
    savedSessions.push(newSession);
    await chrome.storage.local.set({ saved_sessions: savedSessions });

    // Save to filesystem if root exists
    if (rootDirHandle) {
        const fileName = `${newTitle.replace(/[/\\?%*:|"<>]/g, '_')} (1.0).json`;
        try {
            const fileHandle = await rootDirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(newSession, null, 2));
            await writable.close();
        } catch (e) { console.error(e); }
    }

    selectedSessionIds.clear();
    updateSelectionUI();
    renderLibrary();
    showToast('Dokumente erfolgreich zusammengeführt');
}


function escapeHtml(unsafe) {
    return (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function initTheme() {
    chrome.storage.local.get(['theme'], (result) => {
        if (result.theme === 'dark') {
            document.body.classList.add('dark-theme');
        } else {
            document.body.classList.remove('dark-theme');
        }
    });
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-theme');
    chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
}
