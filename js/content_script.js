
(function () {
  let overlayOpen = false;
  let enabled = false;
  let copyOnClickEnabled = false;
  let devModeEnabled = false;
  let sessionActive = false;

  // Console-Log-Snapshots via Script Injection (für Main World Zugriff)
  let capturedLogs = [];

  function injectConsoleInterceptor() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('js/console_interceptor.js');
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  }

  injectConsoleInterceptor();

  let logUpdateResolver = null;

  function requestLogsUpdate() {
    return new Promise((resolve) => {
      logUpdateResolver = resolve;
      window.dispatchEvent(new CustomEvent('GET_EZ_LOGS_REQ'));
      // Timeout falls der Interceptor nicht antwortet
      setTimeout(() => {
        if (logUpdateResolver === resolve) {
          logUpdateResolver = null;
          resolve();
        }
      }, 200);
    });
  }

  window.addEventListener('EZ_LOGS_RESPONSE_EV', (event) => {
    if (event.detail) {
      capturedLogs = event.detail;
      console.log('[EzNotes] Logs empfangen:', capturedLogs.length);
    }
    if (logUpdateResolver) {
      logUpdateResolver();
      logUpdateResolver = null;
    }
  });

  // Initiale Einstellungen laden
  chrome.storage.sync.get(["recording", "copyOnClick", "devMode"], (cfg) => {
    enabled = cfg.recording ?? false;
    copyOnClickEnabled = cfg.copyOnClick ?? false;
    devModeEnabled = cfg.devMode ?? false;
  });

  chrome.storage.local.get("activeSession", (res) => {
    sessionActive = res.activeSession?.isActive ?? false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.recording) enabled = changes.recording.newValue;
      if (changes.copyOnClick) copyOnClickEnabled = changes.copyOnClick.newValue;
      if (changes.devMode) devModeEnabled = changes.devMode.newValue;
    }
    if (area === 'local' && changes.activeSession) {
      sessionActive = changes.activeSession.newValue?.isActive ?? false;
    }
  });


  // Klick-Listener
  window.addEventListener('click', async (ev) => {
    if (!enabled && !copyOnClickEnabled && !devModeEnabled && !sessionActive) return;
    if (overlayOpen) return;

    // Bestehende Feedbacks sofort entfernen, damit sie nicht im Screenshot landen
    document.querySelectorAll('.ez-feedback').forEach(el => el.remove());

    const target = ev.target.closest('button, a, input, select, [role="button"]') || ev.target;
    const targetRect = target.getBoundingClientRect();

    // Basis-Daten erfassen
    const click = {
      type: 'capture',
      clientX: ev.clientX,
      clientY: ev.clientY,
      targetRect: {
        x: targetRect.left,
        y: targetRect.top,
        width: targetRect.width,
        height: targetRect.height
      },
      devicePixelRatio: window.devicePixelRatio || 1,
      hostname: location.hostname,
      title: document.title,
      timestamp: Date.now(),
      elementText: extractElementText(target),
      isSensitive: isSensitiveData(target) || isSensitiveData(target.parentElement)
    };

    window.__lastClickTemp = click;
    flashClick(ev.clientX, ev.clientY);

    // Kurz warten, damit Logs von der Seite generiert werden können
    setTimeout(async () => {
      await requestLogsUpdate();
      click.logs = capturedLogs; // Die jetzt aktualisierten Logs anhängen

      // Entwicklermodus: Tabellenfeld detection
      if (devModeEnabled) {
        handleDevModePopup(click);
      }

      if (enabled || copyOnClickEnabled || sessionActive) {
        bubbleCoordinateRequest(click);
      }
    }, 100);
  }, true);

  // --- ENTWICKLERMODUS LOGIK ---
  function handleDevModePopup(click) {
    const combinedRegex = /([a-z0-9]{5,15})-([a-z0-9_.-]{3,})/i;
    const sessionRegex = /([a-z]{2,6}\d{4,}[a-z]\d{2,})/i;
    const fieldRegex = /([a-z]{2,6}\d{3,}\.[a-z0-9_.-]{1,})/i;

    let session = "";
    let field = "";
    let found = false;

    // 1. In Logs suchen
    if (click.logs && click.logs.length > 0) {
      for (let i = click.logs.length - 1; i >= 0; i--) {
        const log = click.logs[i].content;
        const match = log.match(/Click on\s+([a-z0-9]{5,15})-([a-z0-9_.-]+)/i);
        if (match) {
          session = match[1];
          field = match[2];
          found = true;
          break;
        }
      }
    }

    // 2. Fallback Element Text
    if (!found && click.elementText) {
      const match = click.elementText.match(combinedRegex);
      if (match) {
        session = match[1];
        field = match[2];
        found = true;
      } else {
        const sMatch = click.elementText.match(sessionRegex);
        const fMatch = click.elementText.match(fieldRegex);
        if (sMatch) session = sMatch[1];
        if (fMatch) field = fMatch[1];
        if (session && field) found = true;
      }
    }

    if (found || (session && field)) {
      // Bereinigung falls nötig
      if (field.includes('-n')) field = field.split('-n')[0];

      const message = `🛠️ [DEV MODE]\nSession: ${session}\nFeld: ${field}`;
      showHotkeyFeedback(message, false, 5000);
    }
  }

  // Reicht Koordinaten an den Vater weiter, um Offsets zu addieren (Cross-Origin safe)
  function bubbleCoordinateRequest(clickData) {
    if (window === window.top) {
      // Wir sind ganz oben, ab ans Background Script
      chrome.runtime.sendMessage(clickData);
    } else {
      window.parent.postMessage({
        type: 'EZ_ADD_OFFSET_REQ',
        clickData: clickData
      }, '*');
    }
  }

  // Empfängt Koordinaten-Anfragen von Kindern
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'EZ_ADD_OFFSET_REQ') {
      const clickData = event.data.clickData;

      // Finde das iFrame-Element, das die Nachricht geschickt hat
      const frames = document.querySelectorAll('iframe, frame');
      let sourceFrame = null;
      for (let f of frames) {
        if (f.contentWindow === event.source) {
          sourceFrame = f;
          break;
        }
      }

      if (sourceFrame) {
        const rect = sourceFrame.getBoundingClientRect();
        // Offset addieren
        clickData.clientX += rect.left;
        clickData.clientY += rect.top;
        clickData.targetRect.x += rect.left;
        clickData.targetRect.y += rect.top;

        // Weiter blubbern
        bubbleCoordinateRequest(clickData);
      }
    }
  });




  // Nachricht vom Hintergrunddienst oder Popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'screenshotReady') {
      showOverlay(msg.image, msg.preset, msg.meta.devicePixelRatio, msg.style, msg.autosave, msg.arrowSettings);
    } else if (msg.type === 'copyToClipboard') {
      processCopyToClipboard(msg.image, msg.preset, msg.meta.devicePixelRatio, msg.style, msg.arrowSettings);
    } else if (msg.type === 'copyScreenshot') {
      handleCopyScreenshot();
    } else if (msg.type === 'triggerDownload') {
      handleTriggerDownload();
    } else if (msg.type === 'sessionSaved') {
      showHotkeyFeedback(`✅ Zu Session hinzugefügt (${msg.count})`, false);
    } else if (msg.type === 'sessionError') {
      showHotkeyFeedback(`❌ ${msg.message}`, true, 5000);
    }
  });


  // Kurzer Klick-Blitz am Bildschirm
  function flashClick(x, y) {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      left: x + 'px',
      top: y + 'px',
      width: '20px',
      height: '20px',
      borderRadius: '50%',
      background: 'rgba(0,150,255,0.6)',
      transform: 'translate(-50%,-50%)',
      zIndex: 2147483646,
      pointerEvents: 'none',
      opacity: '1',
      transition: 'opacity 300ms ease-out'
    });
    document.body.appendChild(el);
    setTimeout(() => (el.style.opacity = '0'), 50);
    setTimeout(() => el.remove(), 350);
  }

  // 🔥 NEUE HOTKEY-FUNKTIONEN 🔥

  // Screenshot kopieren (Ctrl+C)
  async function handleCopyScreenshot() {
    console.log('[Hotkey] Copy Screenshot gestartet');
    try {
      // Aktuellen Screenshot mit Einstellungen abrufen
      const cfg = await chrome.storage.sync.get([
        "preset", "lineColor", "lineWidth", "markerNumber", "markerText"
      ]);

      // Screenshot anfordern vom Background (da Content Script keinen Zugriff auf chrome.tabs hat)
      chrome.runtime.sendMessage({ type: 'requestCapture' }, async (response) => {
        if (!response || !response.imageDataUrl) {
          throw new Error('Screenshot-Erfassung fehlgeschlagen');
        }

        const imageDataUrl = response.imageDataUrl;

        // Canvas mit Screenshot und Marker erstellen
        const canvas = document.createElement('canvas');
        const img = new Image();

        img.onload = async () => {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');

          // Hintergrund zeichnen
          ctx.drawImage(img, 0, 0);

          // Marker zeichnen
          const pos = window.__lastClickTemp;
          if (pos) {
            const x = Math.round(pos.clientX * (window.devicePixelRatio || 1));
            const y = Math.round(pos.clientY * (window.devicePixelRatio || 1));

            const style = {
              color: cfg.lineColor || '#ff0000',
              width: cfg.lineWidth || 6,
              number: cfg.markerNumber || 1,
              text: cfg.markerText || 'Hinweis'
            };

            window.DrawingUtils.drawPreset(ctx, x, y, cfg.preset || 'yellow-ring', style, {});
          }

          // Clipboard API verwenden
          try {
            canvas.toBlob(async (blob) => {
              if (blob) {
                const data = [new ClipboardItem({ 'image/png': blob })];
                await navigator.clipboard.write(data);
                console.log('[Copy] Screenshot erfolgreich in Zwischenablage kopiert');
                showHotkeyFeedback('📋 Screenshot kopiert!', false);
              }
            }, 'image/png', 1.0);
          } catch (clipboardError) {
            console.error('[Copy] Clipboard-Fehler:', clipboardError);
            showHotkeyFeedback('❌ Clipboard-Zugriff verweigert!', true);
          }
        };

        img.onerror = () => {
          console.error('[Copy] Bildladen fehlgeschlagen');
        };

        img.src = imageDataUrl;
      });

      img.onerror = () => {
        console.error('[Copy] Bildladen fehlgeschlagen');
        throw new Error('Bildladen fehlgeschlagen');
      };

      img.src = imageDataUrl;

    } catch (error) {
      console.error('[Copy] Screenshot kopieren fehlgeschlagen:', error);
      showHotkeyFeedback('❌ Copy fehlgeschlagen!', true);
      throw error;
    }
  }

  // Download triggeren (Ctrl+D)
  async function handleTriggerDownload() {
    console.log('[Hotkey] Trigger Download gestartet');
    try {
      // Prüfe ob Overlay geöffnet ist und Download-Button anklicke
      const downloadBtn = document.querySelector('.screenshot-overlay button[title*="Download"]');
      if (downloadBtn) {
        downloadBtn.click();
        console.log('[Hotkey] Download-Button geklickt');
      } else {
        // Falls kein Overlay, erstelle einen neuen Screenshot
        console.log('[Hotkey] Kein Overlay gefunden, erstelle neuen Screenshot');
        showHotkeyFeedback('💾 Erstelle Screenshot...', false, 1500);

        // Senden einer Klick-Nachricht an sich selbst
        const click = {
          clientX: window.innerWidth / 2, // Zentrum des Bildschirms
          clientY: window.innerHeight / 2,
          devicePixelRatio: window.devicePixelRatio || 1,
          type: 'capture',
          hostname: location.hostname,
          title: document.title,
          timestamp: Date.now()
        };

        window.__lastClickTemp = click;
        chrome.runtime.sendMessage(click);
        flashClick(click.clientX, click.clientY);
      }

    } catch (error) {
      console.error('[Hotkey] Download trigger fehlgeschlagen:', error);
      showHotkeyFeedback('❌ Download fehlgeschlagen!', true);
      throw error;
    }
  }

  // Visuelles Feedback für Hotkeys (falls im Content Script benötigt)
  function showHotkeyFeedback(message, isError = false, duration = 800) {
    // Bestehende Feedbacks sofort entfernen
    document.querySelectorAll('.ez-feedback').forEach(el => el.remove());

    // Erstelle temporäres Feedback-Element
    const feedback = document.createElement('div');
    feedback.className = 'ez-feedback';
    feedback.textContent = message;
    Object.assign(feedback.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      background: isError ? '#ef4444' : '#10b981',
      color: 'white',
      padding: '8px 16px',
      borderRadius: '6px',
      fontSize: '12px',
      fontWeight: '500',
      zIndex: '2147483647',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      transition: 'all 0.3s ease',
      pointerEvents: 'none',
      opacity: '1',
      whiteSpace: 'pre-wrap'
    });

    document.body.appendChild(feedback);

    setTimeout(() => {
      feedback.style.opacity = '0';
      feedback.style.transform = 'translateY(-10px)';
      setTimeout(() => feedback.remove(), 200);
    }, duration);
  }

  // Kopieren in die Zwischenablage bei Klick (automatisch)
  async function processCopyToClipboard(dataUrl, preset, dpr, style, arrowSettings) {
    console.log('[CopyOnClick] Verarbeite Screenshot für Zwischenablage');

    const canvas = document.createElement('canvas');
    const img = new Image();

    img.onload = async () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');

      // Hintergrund zeichnen
      ctx.drawImage(img, 0, 0);

      // Koordinaten berechnen
      const pos = window.__lastClickTemp;
      if (pos) {
        const x = Math.round(pos.clientX * dpr);
        const y = Math.round(pos.clientY * dpr);

        // Marker zeichnen
        window.DrawingUtils.drawPreset(ctx, x, y, preset, style, arrowSettings);
      }

      // In Zwischenablage kopieren
      try {
        canvas.toBlob(async (blob) => {
          if (blob) {
            const data = [new ClipboardItem({ 'image/png': blob })];
            await navigator.clipboard.write(data);
            console.log('[CopyOnClick] Screenshot erfolgreich kopiert');
            showHotkeyFeedback('📋 Kopiert!', false, 1500);
          }
        }, 'image/png', 1.0);
      } catch (err) {
        console.error('[CopyOnClick] Fehler beim Kopieren:', err);
      }
    };
    img.src = dataUrl;
  }








  // Overlay mit Canvas
  function showOverlay(dataUrl, preset, dpr, style, autosave, arrowSettings) {
    // Vorheriges Overlay schließen falls vorhanden
    if (overlayOpen) {
      const existingOverlay = document.querySelector('.screenshot-overlay');
      if (existingOverlay) {
        existingOverlay.remove();
      }
      overlayOpen = false;

      // Kurze Verzögerung um sicherzustellen, dass das alte Overlay entfernt wurde
      setTimeout(() => {
        proceedWithOverlay(dataUrl, preset, dpr, style, autosave, arrowSettings);
      }, 100);
    } else {
      proceedWithOverlay(dataUrl, preset, dpr, style, autosave, arrowSettings);
    }
  }


  function proceedWithOverlay(dataUrl, preset, dpr, style, autosave, arrowSettings) {
    overlayOpen = true;

    // Bei Autosave: Overlay direkt schließen nach Verarbeitung
    if (autosave) {
      processAutosaveScreenshot(dataUrl, preset, dpr, style);
      return;
    }




    // Close Button mit SVG Icon
    const btnClose = document.createElement('button');
    btnClose.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 6L6 18M6 6L18 18" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    Object.assign(btnClose.style, {
      background: 'transparent',
      border: 'none',
      padding: '4px',
      borderRadius: '50%',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '32px',
      height: '32px',
      transition: 'background 0.2s ease'
    });

    btnClose.onmouseover = () => btnClose.style.background = 'rgba(255,255,255,0.2)';
    btnClose.onmouseout = () => btnClose.style.background = 'transparent';

    btnClose.onclick = () => {
      overlay.remove();
      overlayOpen = false;
    };

    // ESC-Key Listener für "X"-Button-Aktivierung (nach btnClose-Erstellung)
    const escapeHandler = (e) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        // ESC soll das gleiche machen wie der Close-Button
        btnClose.click();
      }
    };
    document.addEventListener('keydown', escapeHandler);

    const overlay = document.createElement('div');
    overlay.className = 'screenshot-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: 2147483647,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center'
    });

    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'relative',
      background: '#fff',
      borderRadius: '6px',
      maxWidth: '95vw',
      maxHeight: '95vh',
      overflow: 'hidden',
      boxShadow: '0 10px 30px rgba(0,0,0,0.35)'
    });

    const canvas = document.createElement('canvas');
    const img = new Image();

    img.onload = () => {
      console.log('[Overlay] Bild geladen, Dimensionen:', img.naturalWidth, 'x', img.naturalHeight);

      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');

      // Hintergrund zeichnen
      ctx.drawImage(img, 0, 0);

      // Koordinaten berechnen und Marker zeichnen
      const pos = window.__lastClickTemp;
      const x = Math.round(pos.clientX * dpr);
      const y = Math.round(pos.clientY * dpr);

      console.log('[Overlay] Marker-Position:', { clientX: pos.clientX, clientY: pos.clientY, dpr, calculatedX: x, calculatedY: y });
      console.log('[Overlay] Marker-Style:', { preset, style });


      // Marker zeichnen (mit arrowSettings)
      window.DrawingUtils.drawPreset(ctx, x, y, preset, style, arrowSettings);

      // Canvas zur Anzeige hinzufügen
      container.appendChild(canvas);

      console.log('[Overlay] Canvas erfolgreich gerendert mit Marker');
    };

    img.onerror = () => {
      console.error('[Overlay] Fehler beim Laden des Screenshot-Bildes');
    };

    img.src = dataUrl;

    const controls = document.createElement('div');
    Object.assign(controls.style, {
      position: 'absolute',
      right: '12px',
      top: '12px',
      display: 'flex',
      gap: '8px',
      background: 'rgba(0,0,0,0.7)',
      padding: '8px',
      borderRadius: '20px',
      backdropFilter: 'blur(10px)'
    });

    // Download Button mit SVG Icon
    const btnDL = document.createElement('button');
    btnDL.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7 10L12 15L17 10" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12 15V3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    Object.assign(btnDL.style, {
      background: 'transparent',
      border: 'none',
      padding: '4px',
      borderRadius: '50%',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '32px',
      height: '32px',
      transition: 'background 0.2s ease'
    });

    btnDL.onmouseover = () => btnDL.style.background = 'rgba(255,255,255,0.2)';
    btnDL.onmouseout = () => btnDL.style.background = 'transparent';

    btnDL.onclick = () => {
      // Sicherstellen, dass Canvas vollständig gerendert ist
      if (canvas.width === 0 || canvas.height === 0) {
        console.error('[Download] Canvas noch nicht gerendert!');
        return;
      }

      const safeTitle = document.title.replace(/[^\p{L}\p{N}\-_ ]/gu, '').slice(0, 60);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `clickshot-${location.hostname}-${safeTitle}-${timestamp}.png`;

      console.log('[Download] Erstelle Download:', { filename, canvasSize: `${canvas.width}x${canvas.height}` });

      try {
        const dataURL = canvas.toDataURL('image/png', 1.0);
        const a = document.createElement('a');
        a.href = dataURL;
        a.download = filename;
        a.style.display = 'none';

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        console.log('[Download] Download erfolgreich gestartet:', filename);
      } catch (error) {
        console.error('[Download] Fehler beim Erstellen des Downloads:', error);
      }
    };

    controls.appendChild(btnDL);
    controls.appendChild(btnClose);
    container.appendChild(controls);
    container.appendChild(canvas);
    overlay.appendChild(container);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        overlayOpen = false;
      }
    });

    document.body.appendChild(overlay);
  }


  // Autosave-Verarbeitung ohne Overlay-Anzeige
  async function processAutosaveScreenshot(dataUrl, preset, dpr, style) {
    console.log('[Autosave] Verarbeite Screenshot ohne Overlay-Anzeige');

    // Overlay-Zustand sofort zurücksetzen für weitere Klicks
    overlayOpen = false;

    // Canvas mit Screenshot und Marker erstellen
    const canvas = document.createElement('canvas');
    const img = new Image();

    img.onload = async () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');

      // Hintergrund zeichnen
      ctx.drawImage(img, 0, 0);

      // Koordinaten berechnen und Marker zeichnen
      const pos = window.__lastClickTemp;
      const x = Math.round(pos.clientX * dpr);
      const y = Math.round(pos.clientY * dpr);

      console.log('[Autosave] Marker-Position:', { clientX: pos.clientX, clientY: pos.clientY, dpr, calculatedX: x, calculatedY: y });


      // Marker zeichnen (mit arrowSettings für Kompatibilität)
      window.DrawingUtils.drawPreset(ctx, x, y, preset, style, {}); // Leerer arrowSettings für Autosave

      // Fortlaufende Nummer abrufen und Dateinamen erstellen
      const screenshotNumber = await getNextScreenshotNumber();
      const filename = `${screenshotNumber}-${location.hostname}.png`;

      console.log('[Autosave] Erstelle Screenshot:', { filename, canvasSize: `${canvas.width}x${canvas.height}` });

      try {
        const dataURL = canvas.toDataURL('image/png', 1.0);

        // Download starten
        chrome.runtime.sendMessage({
          type: 'autosave',
          dataUrl: dataURL,
          filename: filename,
          hostname: location.hostname,
          title: document.title
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Autosave] Fehler beim Senden an Background:', chrome.runtime.lastError);
          } else {
            console.log('[Autosave] Screenshot erfolgreich gespeichert:', filename);
          }
        });

      } catch (error) {
        console.error('[Autosave] Fehler beim Erstellen des Screenshots:', error);
      }
    };

    img.onerror = () => {
      console.error('[Autosave] Fehler beim Laden des Screenshot-Bildes');
    };

    img.src = dataUrl;
  }

  // Fortlaufende Screenshot-Nummer abrufen
  function getNextScreenshotNumber() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['screenshotCounter'], (result) => {
        const current = result.screenshotCounter || 0;
        const next = current + 1;

        // Counter aktualisieren
        chrome.storage.sync.set({ screenshotCounter: next });

        resolve(next);
      });
    });
  }



  // Hilfsfunktion: Text eines Elements schlau extrahieren
  function extractElementText(el) {
    if (!el) return '';
    // 1. Spezielle Inputs
    if (el.tagName === 'INPUT') {
      if (el.type === 'submit' || el.type === 'button') return el.value;
      return el.placeholder || el.name || el.id || '';
    }
    // 2. Aria-Label
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    // 3. Button/Link Text
    let text = el.innerText || el.textContent || '';
    text = text.trim().split('\n')[0]; // Nur erste Zeile
    if (text.length > 50) text = text.substring(0, 47) + '...';
    return text;
  }

  // PRÜFUNG AUF SENSIBLE DATEN
  function isSensitiveData(el) {
    if (!el) return false;
    // Prüfe Input-Typen
    if (el.tagName === 'INPUT' && (el.type === 'password' || el.type === 'tel')) return true;

    // Prüfe Textinhalte (E-Mail, IBAN, etc.)
    const text = el.innerText || el.value || '';
    const patterns = {
      email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
      iban: /[A-Z]{2}\d{2}[A-Z0-9]{11,31}/,
      creditCard: /\b(?:\d[ -]*?){13,16}\b/
    };

    for (const key in patterns) {
      if (patterns[key].test(text)) return true;
    }

    // Prüfe Klassen/IDs auf verdächtige Begriffe
    const sensitiveTerms = ['password', 'secret', 'token', 'auth', 'cvv', 'cardnumber', 'private'];
    const attrString = (el.id + el.className + (el.name || '')).toLowerCase();
    if (sensitiveTerms.some(term => attrString.includes(term))) return true;

    return false;
  }

})();
