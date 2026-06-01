document.addEventListener('DOMContentLoaded', async () => {
  // Explicitly query DOM elements
  const btnLibrary = document.getElementById('btnLibrary');
  const unlockFeaturesLink = document.getElementById('unlockFeatures');
  const copyOnClick = document.getElementById('copyOnClick');
  const smartCrop = document.getElementById('smartCrop');
  const devMode = document.getElementById('devMode');

  // --- Session UI Elements ---
  const toggleSessionBtn = document.getElementById('toggleSession');
  const pauseSessionBtn = document.getElementById('pauseSession');
  const sessionStatus = document.getElementById('sessionStatus');
  const sessionCount = document.getElementById('sessionCount');
  const sessionControls = document.getElementById('sessionControls');
  const openEditorBtn = document.getElementById('openEditor');

  // 🔥 HOTKEY-FUNKTIONALITÄT 🔥
  document.addEventListener('keydown', async (e) => {
    if (!e.ctrlKey && !e.metaKey) return;

    e.preventDefault();
    e.stopPropagation();

    const key = e.key.toLowerCase();
    console.log(`[Hotkey] Ctrl+${key.toUpperCase()} gedrückt`);

    try {
      switch (key) {
        case 's': // Ctrl+S - Quick-Save
          await handleQuickSave();
          break;
        case 'c': // Ctrl+C - Screenshot kopieren
          await handleCopyScreenshot();
          showHotkeyFeedback('📋 Screenshot kopiert!');
          break;
        case 'd': // Ctrl+D - Download öffnen
          await handleDownload();
          showHotkeyFeedback('💾 Download gestartet!');
          break;
        default:
          console.log(`[Hotkey] Unbekannter Hotkey: Ctrl+${key.toUpperCase()}`);
      }
    } catch (error) {
      console.error('[Hotkey] Fehler bei Hotkey-Ausführung:', error);
      showHotkeyFeedback('❌ Fehler!', true);
    }
  });

  async function handleQuickSave() {
    showHotkeyFeedback('⚡ Quick-Save aktiviert', false, 1500);
  }

  async function handleCopyScreenshot() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { type: 'copyScreenshot' });
    }
  }

  async function handleDownload() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      chrome.tabs.sendMessage(activeTab.id, { type: 'triggerDownload' });
    }
  }

  function showHotkeyFeedback(message, isError = false, duration = 3000) {
    let feedback = document.getElementById('hotkeyFeedback');
    if (!feedback) {
      feedback = document.createElement('div');
      feedback.id = 'hotkeyFeedback';
      document.body.appendChild(feedback);
    }
    feedback.textContent = message;
    feedback.style.background = isError ? '#ef4444' : '#10b981';
    feedback.style.opacity = '1';
    feedback.style.transform = 'translateX(-50%) translateY(0)';

    setTimeout(() => {
      feedback.style.opacity = '0';
      feedback.style.transform = 'translateX(-50%) translateY(-10px)';
    }, duration);
  }

  // Load current settings
  const cfg = await chrome.storage.sync.get(["recording", "copyOnClick", "smartCrop", "devMode"]);

  // Force recording false if not already, then remove from further logic
  if (cfg.recording !== false) {
    chrome.storage.sync.set({ recording: false });
  }

  copyOnClick.checked = !!cfg.copyOnClick;
  smartCrop.checked = !!cfg.smartCrop;
  devMode.checked = !!cfg.devMode;

  copyOnClick.addEventListener('change', () => {
    chrome.storage.sync.set({ copyOnClick: copyOnClick.checked });
  });

  devMode.addEventListener('change', () => {
    chrome.storage.sync.set({ devMode: devMode.checked });
  });

  smartCrop.addEventListener('change', () => {
    chrome.storage.sync.set({ smartCrop: smartCrop.checked });
  });

  // --- Session Logic ---
  async function updateSessionUI() {
    const data = await chrome.storage.local.get('activeSession');
    const session = data.activeSession;

    sessionControls.style.display = 'block';

    if (session && session.isActive) {
      if (session.isPaused) {
        sessionStatus.textContent = 'Pausiert';
        sessionStatus.style.color = '#f59e0b';
        pauseSessionBtn.textContent = 'Fortsetzen';
      } else {
        sessionStatus.textContent = 'Aktiv';
        sessionStatus.style.color = '#10b981';
        pauseSessionBtn.textContent = 'Pause';
      }
      sessionCount.textContent = `${session.steps ? session.steps.length : 0} Schritte`;
      toggleSessionBtn.textContent = 'Beenden';
      toggleSessionBtn.style.background = '#ef4444';
      pauseSessionBtn.style.display = 'block';
    } else {
      sessionStatus.textContent = 'Inaktiv';
      sessionStatus.style.color = '';
      sessionCount.textContent = '0 Schritte';
      toggleSessionBtn.textContent = 'Start';
      toggleSessionBtn.style.background = '';
      pauseSessionBtn.style.display = 'none';
    }
  }

  toggleSessionBtn.addEventListener('click', async () => {
    const data = await chrome.storage.local.get('activeSession');
    let session = data.activeSession;

    if (session && session.isActive) {
      // STOP SESSION
      session.isActive = false;
      await chrome.storage.local.set({ activeSession: session });
      chrome.tabs.create({ url: 'ui/editor.html' });
    } else {
      // START SESSION
      session = {
        isActive: true,
        isPaused: false,
        startTime: new Date().toISOString(),
        steps: []
      };
      await chrome.storage.local.set({ activeSession: session });
    }
    updateSessionUI();
  });

  pauseSessionBtn.addEventListener('click', async () => {
    const data = await chrome.storage.local.get('activeSession');
    let session = data.activeSession;

    if (session && session.isActive) {
      session.isPaused = !session.isPaused;
      await chrome.storage.local.set({ activeSession: session });
      updateSessionUI();
    }
  });

  openEditorBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'ui/editor.html' });
  });

  if (btnLibrary) {
    btnLibrary.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('ui/library.html') });
    });
  }

  // --- Lock Status Logic ---
  function updateLockStatus(unlocked) {
    if (unlocked) {
      if (btnLibrary) {
        btnLibrary.disabled = false;
        btnLibrary.style.opacity = '1';
        btnLibrary.title = 'Bibliothek öffnen';
      }
      if (unlockFeaturesLink) {
        unlockFeaturesLink.textContent = '🔓';
        unlockFeaturesLink.title = 'Funktionen sperren';
      }
    } else {
      if (btnLibrary) {
        btnLibrary.disabled = true;
        btnLibrary.style.opacity = '0.4';
        btnLibrary.title = 'Bibliothek gesperrt (Freischalten über Sascha Arend Link)';
      }
      if (unlockFeaturesLink) {
        unlockFeaturesLink.textContent = '🔒';
        unlockFeaturesLink.title = 'Funktionen freischalten';
      }
    }
  }

  // Lock system event listener
  if (unlockFeaturesLink) {
    unlockFeaturesLink.addEventListener('click', async (e) => {
      e.preventDefault();
      const data = await chrome.storage.local.get('featuresUnlocked');
      const currentlyUnlocked = !!data.featuresUnlocked;

      if (currentlyUnlocked) {
        if (confirm('Möchten Sie die Bibliotheksfunktionen wieder sperren?')) {
          await chrome.storage.local.set({ featuresUnlocked: false });
        }
      } else {
        const pw = prompt('Bitte Passwort eingeben, um Bibliotheksfunktionen freizuschalten:');
        if (pw === 'eZNotesBeta') {
          await chrome.storage.local.set({ featuresUnlocked: true });
          alert('Bibliotheksfunktionen freigeschaltet!');
        } else if (pw !== null) {
          alert('Falsches Kennwort!');
        }
      }
    });
  }

  // Synchronize lock status in real-time
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.featuresUnlocked !== undefined) {
      updateLockStatus(!!changes.featuresUnlocked.newValue);
    }
  });

  // Get initial lock status & session UI
  const lockData = await chrome.storage.local.get('featuresUnlocked');
  updateLockStatus(!!lockData.featuresUnlocked);
  updateSessionUI();

  // Check for updates asynchronously
  checkForUpdates();

  async function checkForUpdates() {
    try {
      const response = await fetch('https://raw.githubusercontent.com/SaschaArend/eZNotes/main/manifest.json');
      if (!response.ok) return;
      const remoteManifest = await response.json();
      const remoteVersion = remoteManifest.version;
      const localVersion = chrome.runtime.getManifest().version;

      if (remoteVersion && remoteVersion !== localVersion) {
        const banner = document.getElementById('updateBanner');
        const remoteVersionText = document.getElementById('remoteVersionText');
        const btnUpdateInfo = document.getElementById('btnUpdateInfo');
        
        if (banner && remoteVersionText) {
          remoteVersionText.textContent = remoteVersion;
          banner.style.display = 'flex';
          
          if (btnUpdateInfo) {
            btnUpdateInfo.onclick = () => {
              alert(`Ein neues Update für eZNotes ist verfügbar!\n\nInstalliert: v${localVersion}\nVerfügbar auf GitHub: v${remoteVersion}\n\nBitte schließe Google Chrome komplett und führe die Datei "update.bat" im Projektordner aus, um das Update automatisch durchzuführen.`);
            };
          }
        }
      }
    } catch (e) {
      console.warn('[UpdateCheck] Fehler:', e);
    }
  }
});
