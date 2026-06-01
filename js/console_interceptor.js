(function () {
  const capturedLogs = [];

  function addLog(type, args) {
    const content = Array.from(args).map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    capturedLogs.push({
      type: type,
      content: content,
      timestamp: Date.now()
    });

    if (capturedLogs.length > 500) {
      capturedLogs.shift();
    }
  }

  function hookConsole(win) {
    if (!win || !win.console) return;
    if (win.console.__ezHooked) return;

    try {
      const originalLog = win.console.log;
      const originalInfo = win.console.info;
      const originalError = win.console.error;
      const originalWarn = win.console.warn;
      const originalDebug = win.console.debug;

      win.console.log = function (...args) {
        addLog('log', args);
        if (originalLog) originalLog.apply(win.console, args);
      };

      win.console.info = function (...args) {
        addLog('info', args);
        if (originalInfo) originalInfo.apply(win.console, args);
      };

      win.console.error = function (...args) {
        addLog('error', args);
        if (originalError) originalError.apply(win.console, args);
      };

      win.console.warn = function (...args) {
        addLog('warn', args);
        if (originalWarn) originalWarn.apply(win.console, args);
      };

      win.console.debug = function (...args) {
        addLog('debug', args);
        if (originalDebug) originalDebug.apply(win.console, args);
      };

      win.console.__ezHooked = true;
    } catch (e) {
      // Ignore cross-origin errors
    }
  }

  // Hook current window immediately
  hookConsole(window);

  // Hook all existing same-origin frames
  function hookAllFrames() {
    try {
      for (let i = 0; i < window.frames.length; i++) {
        try {
          hookConsole(window.frames[i]);
        } catch (e) {}
      }
    } catch (e) {}
  }
  hookAllFrames();

  // Periodically hook same-origin frames to catch dynamically created ones
  setInterval(hookAllFrames, 300);

  // Observe DOM for added iframes
  try {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (!node) return;
          if (node.tagName === 'IFRAME') {
            node.addEventListener('load', () => {
              try {
                hookConsole(node.contentWindow);
              } catch (e) {}
            });
            try {
              hookConsole(node.contentWindow);
            } catch (e) {}
          } else if (node.querySelectorAll) {
            node.querySelectorAll('iframe').forEach(iframe => {
              iframe.addEventListener('load', () => {
                try {
                  hookConsole(iframe.contentWindow);
                } catch (e) {}
              });
              try {
                hookConsole(iframe.contentWindow);
              } catch (e) {}
            });
          }
        });
      });
    });

    observer.observe(document.documentElement || document, {
      childList: true,
      subtree: true
    });
  } catch (e) {}

  // Listen for request from Content Script
  window.addEventListener('GET_EZ_LOGS_REQ', () => {
    window.dispatchEvent(new CustomEvent('EZ_LOGS_RESPONSE_EV', {
      detail: capturedLogs
    }));
  });
})();
