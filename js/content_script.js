
(function () {
  let overlayOpen = false;
  let enabled = false;
  let copyOnClickEnabled = false;
  let devModeEnabled = false;
  let sessionActive = false;

  // Console-Log-Snapshots via Script Injection (für Main World Zugriff)
  let capturedLogs = [];

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
      selector: getCssSelector(target)
    };

    window.__lastClickTemp = click;
    // flashClick(ev.clientX, ev.clientY); // Auskommentiert, damit der Kreis nicht auf Screenshots erscheint

    // Kurz warten, damit Logs von der Seite generiert werden können oder Layout-Shifts (Menüs etc.) fertig sind
    setTimeout(async () => {
      // [FIX] Re-capture targetRect nach dem Delay, um Shifting Elements (z.B. Accordions) abzufangen
      const refreshedRect = target.getBoundingClientRect();
      click.targetRect = {
        x: refreshedRect.left,
        y: refreshedRect.top,
        width: refreshedRect.width,
        height: refreshedRect.height
      };
      // Auch clientX/Y falls nötig anpassen? Nein, der Klickpunkt bleibt wo er war, 
      // aber der Marker (Viereck) sollte das Ziel nun korrekt umschließen.

      await requestLogsUpdate();
      click.logs = capturedLogs; // Die jetzt aktualisierten Logs anhängen

      // Entwicklermodus: Tabellenfeld detection
      if (devModeEnabled) {
        handleDevModePopup(click);
      }

      if (enabled || copyOnClickEnabled || sessionActive) {
        bubbleCoordinateRequest(click);
      }
    }, 150);
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
    } else if (msg.type === 'PLAY_STEP') {
      console.log('[eZNotes] PLAY_STEP erhalten');
      handlePlayStep(msg.selector, msg.elementText, msg.value);
    } else if (msg.type === 'START_LIVE_VIEW') {
      console.log('[eZNotes] START_LIVE_VIEW erhalten');
      startLiveView(msg.steps);
    } else if (msg.type === 'LIVE_VIEW_SYNC') {
      // Synchronisation von anderen Frames (meistens vom Top-Frame gesteuert)
      liveViewSteps = msg.steps || [];
      currentLiveViewIndex = msg.index || 0;
      updateLiveViewUI(true); // true = silent update (kein UI-Re-Render)
    } else if (msg.type === 'LIVE_VIEW_CLOSE') {
      stopLiveView();
    }
  });

  // Hilfsfunktion für Multi-Frame Relay
  function relayToAllFrames(type, data) {
    chrome.runtime.sendMessage({
      type: 'RELAY_TO_TAB',
      data: { type, ...data }
    });
  }

  // --- AUTOMATISIERUNG (Point 10) ---
  function handlePlayStep(selector, expectedText, value) {
    let el = document.querySelector(selector);

    // Fallback für ältere, ungescapte Selektoren (z.B. mit : in IDs)
    if (!el && selector.includes(':') && !selector.includes('\\:')) {
      try {
        const escapedSelector = selector.replace(/:/g, '\\:');
        el = document.querySelector(escapedSelector);
      } catch (e) { }
    }

    if (!el) {
      // In Multi-Frame Umgebungen ignorieren wir Fehler in Frames ohne das Element
      console.log('[eZNotes] Element in diesem Frame nicht gefunden:', selector);
      return;
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Visuelles Feedback vor dem Klick
    setTimeout(() => {
      const rect = el.getBoundingClientRect();
      flashClick(rect.left + rect.width / 2, rect.top + rect.height / 2);

      // RPA-style Click Simulation (Detaillierter für Infor LN Menüs)
      if (value && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        simulateRpaClick(el);
        setTimeout(() => {
          if (el.isContentEditable) {
            el.innerText = value;
          } else {
            el.value = value;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          showHotkeyFeedback(`✍️ Text eingefügt: "${value}"`, false);
        }, 100);
      } else {
        simulateRpaClick(el);
        showHotkeyFeedback(`▶️ Klick auf "${expectedText || 'Element'}"`, false);
      }
    }, 600);
  }

  function getCssSelector(el) {
    if (!(el instanceof Element)) return '';
    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();
      if (current.id) {
        // IDs mit Sonderzeichen (z.B. : in Infor LN) müssen escaped werden
        selector += '#' + CSS.escape(current.id);
        path.unshift(selector);
        break;
      } else {
        let sib = current, nth = 1;
        while (sib = sib.previousElementSibling) {
          if (sib.nodeName.toLowerCase() == selector) nth++;
        }
        if (nth != 1) selector += ":nth-of-type(" + nth + ")";
      }
      path.unshift(selector);
      current = current.parentNode;
    }
    return path.join(" > ");
  }

  function simulateRpaClick(el) {
    el.focus();

    // Pointer Events für moderne Frameworks (wie Infor CloudSuite)
    const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    eventTypes.forEach(type => {
      const isPointer = type.startsWith('pointer');
      const EventClass = isPointer ? window.PointerEvent : window.MouseEvent;

      const ev = new EventClass(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        buttons: 1,
        pointerId: 1,
        isPrimary: true
      });
      el.dispatchEvent(ev);
    });
  }



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
        // flashClick(click.clientX, click.clientY); // Auskommentiert, damit der Kreis nicht auf Screenshots erscheint
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

    // 0. Suche nach verknüpften Labels (Standard & ERP-spezifisch)
    let labelText = '';

    // a) Standard label[for]
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) labelText = label.innerText || label.textContent;
    }

    // b) ERP-spezifischer Suffix (z.B. tccom4100s000-tccom100.inet-n15-label)
    if (!labelText && el.id && el.id.includes('-')) {
      const labelEl = document.getElementById(el.id + '-label');
      if (labelEl) labelText = labelEl.innerText || labelEl.textContent;
    }

    // c) Umschließendes Label
    if (!labelText && el.labels && el.labels.length > 0) {
      labelText = el.labels[0].innerText || el.labels[0].textContent;
    }

    if (labelText) {
      labelText = labelText.trim().replace(/:$/, ''); // Doppelpunkt am Ende entfernen
      if (labelText) return labelText;
    }

    // 1. Spezielle Inputs
    if (el.tagName === 'INPUT') {
      if (el.type === 'submit' || el.type === 'button') return el.value;
      if (el.placeholder) return el.placeholder;
      if (el.name && !el.name.includes('#')) return el.name;
    }

    // 2. Aria-Label
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;

    // 3. Button/Link Text
    let text = el.innerText || el.textContent || '';
    text = text.trim().split('\n')[0]; // Nur erste Zeile

    // Fallback: Wenn der Text wie ein technischer Selektor aussieht, lieber "Element"
    if (text.includes('#') || text.includes('.') || (text.includes('-') && text.length > 20)) {
      return 'Element';
    }

    if (text.length > 50) text = text.substring(0, 47) + '...';
    return text;
  }

  // --- LIVE VIEW OVERLAY ---
  let liveViewSteps = [];
  let currentLiveViewIndex = 0;
  let liveViewOverlayEl = null;
  let liveViewHighlightEl = null;

  let activeScrollListener = null;

  function startLiveView(steps) {
    if (!steps || steps.length === 0) return;
    liveViewSteps = steps;
    currentLiveViewIndex = 0;

    // UI nur im Top-Frame rendern
    if (window === window.top) {
      renderLiveViewUI();
    }

    updateLiveViewUI();
  }

  function renderLiveViewUI() {
    if (liveViewOverlayEl) liveViewOverlayEl.remove();

    liveViewOverlayEl = document.createElement('div');
    liveViewOverlayEl.className = 'ez-rpa-live-view';
    Object.assign(liveViewOverlayEl.style, {
      position: 'fixed',
      bottom: '30px',
      right: '30px',
      width: '320px',
      background: 'white',
      borderRadius: '12px',
      boxShadow: '0 10px 40px rgba(15,23,42,0.15)',
      zIndex: '2147483647',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      border: '1px solid rgba(15,23,42,0.08)'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      background: '#f8fafc',
      color: '#0f172a',
      padding: '14px 18px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      fontWeight: '700',
      fontSize: '12px',
      borderBottom: '1px solid #e2e8f0',
      letterSpacing: '0.05em',
      textTransform: 'uppercase'
    });
    header.innerHTML = `
      <span>Live-Vorschau</span>
      <span id="ez-rpa-counter" style="background: #e2e8f0; color: #475569; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600;"></span>
    `;

    const body = document.createElement('div');
    Object.assign(body.style, {
      padding: '18px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    });
    body.innerHTML = `
      <div id="ez-rpa-title" style="font-weight: 700; font-size: 15px; color: #0f172a; line-height: 1.4;"></div>
      <div id="ez-rpa-desc" style="font-size: 13px; color: #64748b; min-height: 40px; margin-top: 4px; line-height: 1.5; white-space: pre-wrap;"></div>
    `;

    const footer = document.createElement('div');
    Object.assign(footer.style, {
      padding: '14px 18px',
      background: '#f8fafc',
      borderTop: '1px solid #e2e8f0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    });

    const btnStyle = "padding: 8px 14px; border-radius: 8px; border: 1px solid #d1d5db; font-size: 12px; cursor: pointer; font-weight: 600; transition: all 0.2s; font-family: inherit;";

    footer.innerHTML = `
      <div style="display: flex; gap: 8px;">
        <button id="ez-rpa-prev" style="${btnStyle} background: white; color: #334155;">Zurück</button>
        <button id="ez-rpa-next" style="${btnStyle} background: #4f46e5; border-color: #4f46e5; color: white;">Weiter</button>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button id="ez-rpa-play" style="${btnStyle} background: #10b981; border-color: #10b981; color: white; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0;" title="Aktion ausführen">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        </button>
        <button id="ez-rpa-close" style="${btnStyle} background: transparent; border: none; color: #94a3b8; width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 18px;" title="Schließen">✕</button>
      </div>
    `;

    liveViewOverlayEl.appendChild(header);
    liveViewOverlayEl.appendChild(body);
    liveViewOverlayEl.appendChild(footer);

    document.body.appendChild(liveViewOverlayEl);

    document.getElementById('ez-rpa-prev').onclick = () => {
      if (currentLiveViewIndex > 0) {
        currentLiveViewIndex--;
        syncLiveViewAcrossFrames();
      }
    };

    document.getElementById('ez-rpa-next').onclick = () => {
      if (currentLiveViewIndex < liveViewSteps.length - 1) {
        currentLiveViewIndex++;
        syncLiveViewAcrossFrames();
      }
    };

    document.getElementById('ez-rpa-play').onclick = () => {
      const step = liveViewSteps[currentLiveViewIndex];
      // Broadcast Play-Step an alle Frames
      relayToAllFrames('PLAY_STEP', {
        selector: step.selector,
        elementText: step.title,
        value: step.value
      });
    };

    document.getElementById('ez-rpa-close').onclick = () => {
      relayToAllFrames('LIVE_VIEW_CLOSE', {});
      stopLiveView();
    };
  }

  function syncLiveViewAcrossFrames() {
    updateLiveViewUI();
    relayToAllFrames('LIVE_VIEW_SYNC', {
      index: currentLiveViewIndex,
      steps: liveViewSteps
    });
  }

  function updateLiveViewUI(silent = false) {
    if (window === window.top && liveViewOverlayEl) {
      const step = liveViewSteps[currentLiveViewIndex];
      document.getElementById('ez-rpa-counter').textContent = `${currentLiveViewIndex + 1} / ${liveViewSteps.length}`;
      document.getElementById('ez-rpa-title').textContent = step.title || 'Schritt';

      // Zeige ausschließlich den Beschreibungstext
      document.getElementById('ez-rpa-desc').textContent = step.description || 'Keine Beschreibung vorhanden.';

      // Button-Status aktualisieren
      document.getElementById('ez-rpa-prev').style.opacity = currentLiveViewIndex === 0 ? '0.4' : '1';
      document.getElementById('ez-rpa-prev').disabled = currentLiveViewIndex === 0;
      document.getElementById('ez-rpa-next').style.opacity = currentLiveViewIndex === liveViewSteps.length - 1 ? '0.4' : '1';
      document.getElementById('ez-rpa-next').disabled = currentLiveViewIndex === liveViewSteps.length - 1;
    }

    const step = liveViewSteps[currentLiveViewIndex];
    if (step) {
      highlightTargetElement(step.selector);
    }
  }

  function highlightTargetElement(selector, retryCount = 0) {
    // Alten Marker und Scroll-Listener entfernen
    if (liveViewHighlightEl) {
      liveViewHighlightEl.remove();
      liveViewHighlightEl = null;
    }
    if (activeScrollListener) {
      window.removeEventListener('scroll', activeScrollListener, { capture: true });
      activeScrollListener = null;
    }

    if (!selector) return;

    let el = document.querySelector(selector);
    if (!el && selector.includes(':') && !selector.includes('\\:')) {
      try { el = document.querySelector(selector.replace(/:/g, '\\:')); } catch (e) { }
    }

    if (!el) {
      if (retryCount < 10) { // Versuche es bis zu 2 Sekunden lang
        setTimeout(() => highlightTargetElement(selector, retryCount + 1), 200);
      }
      return;
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const rect = el.getBoundingClientRect();
    liveViewHighlightEl = document.createElement('div');
    Object.assign(liveViewHighlightEl.style, {
      position: 'fixed',
      boxSizing: 'border-box',
      top: rect.top + 'px',
      left: rect.left + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
      border: '3px solid #4f46e5',
      borderRadius: '6px',
      backgroundColor: 'rgba(79, 70, 229, 0.08)',
      pointerEvents: 'auto',
      cursor: 'pointer',
      zIndex: '2147483646',
      transition: 'all 0.15s ease',
      boxShadow: '0 0 0 9999px rgba(0,0,0,0.15)' // Zarte Verdunkelung des Rests für Fokus!
    });

    // Position bei Scrollen (auch in Containern) aktualisieren
    activeScrollListener = () => {
      const currentEl = document.querySelector(selector);
      if (currentEl && liveViewHighlightEl) {
        const currentRect = currentEl.getBoundingClientRect();
        Object.assign(liveViewHighlightEl.style, {
          top: currentRect.top + 'px',
          left: currentRect.left + 'px',
          width: currentRect.width + 'px',
          height: currentRect.height + 'px'
        });
      }
    };
    window.addEventListener('scroll', activeScrollListener, { capture: true, passive: true });

    liveViewHighlightEl.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();

      const currentStepObj = liveViewSteps[currentLiveViewIndex];
      handlePlayStep(currentStepObj.selector, currentStepObj.title, currentStepObj.value);

      setTimeout(() => {
        if (currentLiveViewIndex < liveViewSteps.length - 1) {
          currentLiveViewIndex++;
          syncLiveViewAcrossFrames();
        } else {
          relayToAllFrames('LIVE_VIEW_CLOSE', {});
          stopLiveView();
        }
      }, 500);
    };

    document.body.appendChild(liveViewHighlightEl);
  }

  function stopLiveView() {
    if (liveViewOverlayEl) liveViewOverlayEl.remove();
    if (liveViewHighlightEl) liveViewHighlightEl.remove();
    if (activeScrollListener) {
      window.removeEventListener('scroll', activeScrollListener, { capture: true });
    }
    liveViewOverlayEl = null;
    liveViewHighlightEl = null;
    activeScrollListener = null;
    liveViewSteps = [];
  }

})();
