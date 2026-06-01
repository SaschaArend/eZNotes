document.getElementById('btnPrint').addEventListener('click', () => {
    window.print();
});

chrome.storage.local.get('exportData', (data) => {
    if (!data.exportData) {
        document.getElementById('content').innerHTML = '<p>Keine Daten gefunden.</p>';
        return;
    }

    const { title, date, steps, logo } = data.exportData;

    document.title = title;

    let html = `
        <div class="viewer-header">
            <div>
                <h1>${escapeHtml(title)}</h1>
                <p class="meta">Dokumentation erstellt am ${escapeHtml(date)}</p>
            </div>
            ${logo ? `<img src="${logo}" class="viewer-logo">` : ''}
        </div>
    `;

    let stepCount = 0;
    steps.forEach((step, i) => {
        if (step.type === 'chapter') {
            html += `
                <div class="step chapter-step">
                    <h2>${escapeHtml(step.title || 'Kapitel')}</h2>
                    <div class="chapter-divider"></div>
                </div>
            `;
        } else if (step.type === 'textblock') {
            html += `
                <div class="step textblock-step">
                    <h2>📝 ${escapeHtml(step.title || 'Information')}</h2>
                    <div class="textblock-content">
                        ${step.content || ''}
                    </div>
                </div>
            `;
        } else {
            stepCount++;
            html += `
                <div class="step">
                    <h2><span class="step-number">${stepCount}</span> ${escapeHtml(step.title || 'Schritt')}</h2>
                    ${(step.session || step.field) ? `
                        <div class="infor-meta-box">
                            ${step.session ? `
                                <div class="meta-item">
                                    <span class="meta-icon">🖥️</span>
                                    <span class="meta-label">Session:</span>
                                    <span class="meta-value">${escapeHtml(step.session)}</span>
                                </div>
                            ` : ''}
                            ${step.field ? `
                                <div class="meta-item">
                                    <span class="meta-icon">📋</span>
                                    <span class="meta-label">Feld:</span>
                                    <span class="meta-value">${escapeHtml(step.field)}</span>
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}
                    <img src="${step.dataUrl}" alt="Schritt ${stepCount}">
                    ${step.description ? `<div class="desc">${escapeHtml(step.description)}</div>` : ''}
                </div>
            `;
        }
    });

    document.getElementById('content').innerHTML = html;

    // PDF Download Event Listener
    document.getElementById('btnDownloadPDF').addEventListener('click', () => {
        const element = document.getElementById('content');
        const cleanTitle = title.replace(/[^\w\s\-_äöüÄÖÜß]/g, '').trim();
        const filename = `${cleanTitle || 'eZNotes-Dokumentation'}.pdf`;

        const opt = {
            margin:       [15, 12, 15, 12], // [top, left, bottom, right] in mm für perfekten Abstand auf allen Seiten
            filename:     filename,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { 
                scale: 2, 
                useCORS: true,
                logging: false,
                letterRendering: true,
                scrollX: 0,
                scrollY: 0
            },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak:    { mode: ['css', 'legacy'] }
        };

        const btn = document.getElementById('btnDownloadPDF');
        const originalText = btn.innerHTML;
        btn.innerHTML = '⏳ PDF wird generiert...';
        btn.disabled = true;

        html2pdf().set(opt).from(element).save().then(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }).catch(err => {
            console.error('PDF Generierungsfehler:', err);
            btn.innerHTML = originalText;
            btn.disabled = false;
            alert('Fehler bei der PDF-Erstellung: ' + err.message);
        });
    });

    // HTML Download Event Listener
    document.getElementById('btnDownloadHTML').addEventListener('click', () => {
        const cleanTitle = title.replace(/[^\w\s\-_äöüÄÖÜß]/g, '').trim();
        const filename = `${cleanTitle || 'eZNotes-Dokumentation'}.html`;

        // Extrahiere alle CSS-Styles aus dem Document Head
        const styles = Array.from(document.querySelectorAll('style')).map(s => s.innerHTML).join('\n');

        // Konstruiere die vollständige, eigenständige HTML-Datei
        const htmlContent = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
        ${styles}
    </style>
</head>
<body>
    <div id="content">
        ${document.getElementById('content').innerHTML}
    </div>
</body>
</html>`;

        // Erstelle Blob und triggere den Download
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
});

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
