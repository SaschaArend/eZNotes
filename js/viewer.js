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
                        <div style="margin-bottom: 16px; font-size: 12px; font-family: 'JetBrains Mono', monospace; color: var(--text-muted); background: #f1f5f9; padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                            ${step.session ? `<div><strong>Session:</strong> ${escapeHtml(step.session)}</div>` : ''}
                            ${step.field ? `<div><strong>Feld:</strong> ${escapeHtml(step.field)}</div>` : ''}
                        </div>
                    ` : ''}
                    <img src="${step.dataUrl}" alt="Schritt ${stepCount}">
                    ${step.description ? `<div class="desc">${escapeHtml(step.description)}</div>` : ''}
                </div>
            `;
        }
    });

    document.getElementById('content').innerHTML = html;
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
