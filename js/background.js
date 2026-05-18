



chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // Keep channel open for async responses
});

async function handleMessage(message, sender, sendResponse) {
  try {
    if (!message) return;

    // Autosave-Nachricht vom Content-Script
    if (message.type === 'autosave') {
      console.log('[BG] Autosave-Anfrage erhalten:', {
        filename: message.filename,
        hostname: message.hostname,
        title: message.title
      });

      chrome.downloads.download({
        url: message.dataUrl,
        filename: message.filename,
        conflictAction: "uniquify",
        saveAs: false  // Verwende hinterlegten Pfad ohne Dialog
      }, (id) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.error('[BG] Autosave-Download-Fehler:', err);
        } else {
          console.info('[BG] Autosave-Download erfolgreich gestartet, id:', id);
        }
      });
      return;
    }

    if (message.type === 'requestCapture') {
      const windowId = sender?.tab?.windowId;
      chrome.tabs.captureVisibleTab(windowId, { format: 'png', quality: 100 }, (dataUrl) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.error('[BG] requestCapture Fehler:', err);
          sendResponse({ error: err.message });
        } else {
          sendResponse({ imageDataUrl: dataUrl });
        }
      });
      return;
    }

    if (message.type !== 'capture') {
      console.log('[BG] Nachricht ignoriert (nicht vom Typ capture):', message.type);
      return;
    }

    console.info('[BG] Capture-Request erhalten:', {
      sender: { tab: sender?.tab?.id, frameId: sender?.frameId }
    });

    const cfg = await chrome.storage.sync.get([
      "recording", "autosave", "copyOnClick", "preset", "markerNumber", "markerText", "lineColor", "lineWidth",
      "arrowAngle", "arrowLength", "doubleArrow"
    ]);

    const windowId = sender?.tab?.windowId;

    const imageDataUrl = await new Promise((resolve, reject) => {
      chrome.tabs.captureVisibleTab(windowId, {
        format: 'png',
        quality: 100
      }, (dataUrl) => {
        const err = chrome.runtime.lastError;
        if (err) {
          console.error('[BG] captureVisibleTab Fehler:', err);
          return reject(err);
        }
        if (!dataUrl) {
          return reject(new Error('Kein Screenshot erhalten'));
        }
        resolve(dataUrl);
      });
    });

    const meta = {
      devicePixelRatio: message.devicePixelRatio || 1,
      hostname: (() => {
        try { return message.hostname || new URL(sender?.tab?.url || '').hostname || 'unknown'; }
        catch { return message.hostname || 'unknown'; }
      })(),
      title: message.title || sender?.tab?.title || 'Seite',
      timestamp: new Date().toISOString()
    };

    // Copy-on-Click Logic
    if (cfg.copyOnClick && !message.noCopy && sender?.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        type: 'copyToClipboard',
        image: imageDataUrl,
        preset: cfg.preset ?? "red-circle",
        meta,
        style: {
          number: cfg.markerNumber ?? 1,
          text: cfg.markerText ?? "",
          color: cfg.lineColor ?? "#ff0000",
          width: cfg.lineWidth ?? 6
        },
        arrowSettings: {
          angle: cfg.arrowAngle ?? "45",
          length: cfg.arrowLength ?? "medium",
          double: cfg.doubleArrow ?? false
        }
      }).catch(e => console.warn('[BG] Could not send copyToClipboard message:', e));
    }

    // Check for active session
    const sessionData = await chrome.storage.local.get('activeSession');
    const activeSession = sessionData.activeSession;

    if (activeSession && activeSession.isActive) {
      if (activeSession.isPaused) {
        console.log('[BG] Session is paused, skipping step capture.');
        return;
      }

      // Create Step Object
      const step = {
        id: Date.now(),
        dataUrl: imageDataUrl,
        title: message.elementText ? `Klick auf "${message.elementText}"` : (message.title || 'Schritt'),
        description: '',
        session: '',
        field: '',
        timestamp: new Date().toISOString(),
        x: message.clientX,
        y: message.clientY,
        rect: message.targetRect,
        meta: meta,
        isSensitive: message.isSensitive || false,
        logs: message.logs || []
      };

      // ERP System specific parsing
      const sessionRegex = /([a-z]{2,6}\d{4,}[a-z]\d{2,})/i;
      const fieldRegex = /([a-z]{2,6}\d{3,}\.[a-z0-9_.-]{1,})/i;
      const combinedRegex = /([a-z0-9]{5,15})-([a-z0-9_.-]{3,})/i;
      let found = false;

      if (step.logs && step.logs.length > 0) {
        for (let i = step.logs.length - 1; i >= 0; i--) {
          const log = step.logs[i].content;
          const match = log.match(/Click on\s+([a-z0-9]{5,15})-([a-z0-9_.-]+)/i);
          if (match) {
            step.session = match[1];
            step.field = match[2];
            found = true;
            break;
          }
        }
      }

      if (!found && message.elementText) {
        const match = message.elementText.match(combinedRegex);
        if (match) {
          step.session = match[1];
          step.field = match[2];
          found = true;
        } else {
          const sMatch = message.elementText.match(sessionRegex);
          const fMatch = message.elementText.match(fieldRegex);
          if (sMatch) step.session = sMatch[1];
          if (fMatch) step.field = fMatch[1];
          if (step.session && step.field) found = true;
        }
      }

      if (found || (step.session && step.field)) {
        if (step.field && step.field.includes('-n')) {
          step.field = step.field.split('-n')[0];
        }
        step.title = "Entwicklerunterstützung";
      }

      if (!activeSession.steps) activeSession.steps = [];
      activeSession.steps.push(step);

      try {
        await chrome.storage.local.set({ activeSession: activeSession });
        if (sender?.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'sessionSaved',
            count: activeSession.steps.length
          }).catch(e => console.warn('[BG] Could not send sessionSaved message:', e));
        }
      } catch (storageError) {
        console.error('[BG] Storage Error:', storageError);
        if (sender?.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'sessionError',
            message: 'Speicher voll!'
          }).catch(e => console.warn('[BG] Could not send sessionError message:', e));
        }
      }

      if (cfg.copyOnClick) return;
    }

    // Screenshot Preview / Autosave (Standard Recording)
    if (cfg.recording && !cfg.copyOnClick && sender?.tab?.id) {
      const responseData = {
        type: "screenshotReady",
        image: imageDataUrl,
        preset: cfg.preset ?? "red-circle",
        autosave: cfg.autosave ?? false,
        meta,
        style: {
          number: cfg.markerNumber ?? 1,
          text: cfg.markerText ?? "",
          color: cfg.lineColor ?? "#ff0000",
          width: cfg.lineWidth ?? 6
        },
        arrowSettings: {
          angle: cfg.arrowAngle ?? "45",
          length: cfg.arrowLength ?? "medium",
          double: cfg.doubleArrow ?? false
        }
      };

      chrome.tabs.sendMessage(sender.tab.id, responseData).catch(e => console.warn('[BG] Could not send screenshotReady message:', e));
    }

  } catch (e) {
    console.error('[BG] Unerwarteter Fehler im handleMessage:', e);
  }
}

