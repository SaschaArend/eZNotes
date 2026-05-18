document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

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

  const copyOnClick = document.getElementById('copyOnClick');
  const devMode = document.getElementById('devMode');

  // --- Session UI Elements ---
  const toggleSessionBtn = document.getElementById('toggleSession');
  const pauseSessionBtn = document.getElementById('pauseSession');
  const sessionStatus = document.getElementById('sessionStatus');
  const sessionCount = document.getElementById('sessionCount');
  const sessionControls = document.getElementById('sessionControls');
  const openEditorBtn = document.getElementById('openEditor');

  // Load current settings
  const cfg = await chrome.storage.sync.get(["recording", "copyOnClick", "devMode"]);

  // Force recording false if not already, then remove from further logic
  if (cfg.recording !== false) {
    chrome.storage.sync.set({ recording: false });
  }

  copyOnClick.checked = !!cfg.copyOnClick;
  devMode.checked = !!cfg.devMode;


  copyOnClick.addEventListener('change', () => {
    chrome.storage.sync.set({ copyOnClick: copyOnClick.checked });
  });

  devMode.addEventListener('change', () => {
    chrome.storage.sync.set({ devMode: devMode.checked });
  });

  // --- Session Logic ---
  async function updateSessionUI() {
    const data = await chrome.storage.local.get('activeSession');
    const session = data.activeSession;

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
      sessionControls.style.display = 'block';
      pauseSessionBtn.style.display = 'block';
    } else {
      sessionStatus.textContent = 'Inaktiv';
      sessionStatus.style.color = '';
      sessionCount.textContent = '0 Schritte';
      toggleSessionBtn.textContent = 'Start';
      toggleSessionBtn.style.background = '';
      sessionControls.style.display = 'none';
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

  // Initial UI Update
  updateSessionUI();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.theme) {
      if (changes.theme.newValue === 'dark') {
        document.body.classList.add('dark-theme');
      } else {
        document.body.classList.remove('dark-theme');
      }
    }
  });

  if (btnLibrary) {
    btnLibrary.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('ui/library.html') });
    });
  }

  document.getElementById('btnThemeToggle')?.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-theme');
    chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
  });
});

function initTheme() {
  chrome.storage.local.get(['theme'], (result) => {
    if (result.theme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  });
}
