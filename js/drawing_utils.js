/**
 * Shared drawing utilities for EzNotes markers and arrows
 */
const DrawingUtils = {
    drawPreset(ctx, x, y, preset, style, arrowSettings) {
        const color = style?.color || '#ff0000';
        const width = style?.width || 6;

        ctx.globalCompositeOperation = 'source-over';

        switch (preset) {
            case 'yellow-ring':
                ctx.strokeStyle = 'yellow';
                ctx.lineWidth = 8;
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 2;
                ctx.beginPath();
                ctx.arc(x, y, 30, 0, Math.PI * 2);
                ctx.stroke();
                ctx.shadowBlur = 0;
                break;

            case 'numbered': {
                ctx.lineWidth = width;
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 2;
                ctx.beginPath();
                ctx.arc(x, y, 24, 0, Math.PI * 2);
                ctx.stroke();
                const num = String(style?.number ?? 1);
                ctx.font = 'bold 28px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowBlur = 0;
                ctx.fillStyle = '#ffffff';
                ctx.fillText(num, x, y + 1);
                break;
            }

            case 'arrow': {
                ctx.lineWidth = width;
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 2;

                const angleDeg = arrowSettings?.angle ? parseInt(arrowSettings.angle) : 45;
                const lengthSetting = arrowSettings?.length || 'medium';
                const isDouble = arrowSettings?.double || false;

                let len = 60;
                if (lengthSetting === 'short') len = 30;
                else if (lengthSetting === 'long') len = 90;

                const angleRad = (angleDeg * Math.PI) / 180;
                const tipX = x;
                const tipY = y;
                const tailX = x - len * Math.cos(angleRad);
                const tailY = y - len * Math.sin(angleRad);

                ctx.beginPath();
                ctx.moveTo(tailX, tailY);
                ctx.lineTo(tipX, tipY);
                ctx.stroke();

                const angle = Math.atan2(tipY - tailY, tipX - tailX);
                this.drawArrowHead(ctx, tipX, tipY, angle, width, color);

                if (isDouble) {
                    const backTailX = x + len * Math.cos(angleRad);
                    const backTailY = y + len * Math.sin(angleRad);
                    ctx.beginPath();
                    ctx.moveTo(backTailX, backTailY);
                    ctx.lineTo(tipX, tipY);
                    ctx.stroke();
                    const backAngle = angle + Math.PI;
                    this.drawArrowHead(ctx, tipX, tipY, backAngle, width, color);
                }
                break;
            }

            case 'text-label': {
                const text = style?.text?.trim() || 'Hinweis';
                ctx.lineWidth = width;
                ctx.strokeStyle = color;
                ctx.fillStyle = color;
                ctx.shadowColor = 'rgba(0,0,0,0.3)';
                ctx.shadowBlur = 2;

                const padding = 8;
                ctx.font = '16px system-ui, sans-serif';
                ctx.shadowBlur = 0;
                const metrics = ctx.measureText(text);
                const boxW = metrics.width + padding * 2;
                const boxH = 26;
                const boxX = x - boxW - 40;
                const boxY = y - boxH / 2;

                ctx.save();
                ctx.fillStyle = 'rgba(255,255,255,0.95)';
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                this.roundRect(ctx, boxX, boxY, boxW, boxH, 6, true, true);
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, boxX + padding, y);
                ctx.restore();

                const arrowStartX = boxX + boxW;
                const arrowStartY = y;
                const arrowEndX = x - 15;
                const arrowEndY = y;

                ctx.beginPath();
                ctx.moveTo(arrowStartX, arrowStartY);
                ctx.lineTo(arrowEndX, arrowEndY);
                ctx.stroke();

                const arrowAngle = Math.atan2(arrowEndY - arrowStartY, arrowEndX - arrowStartX);
                this.drawArrowHead(ctx, arrowEndX, arrowEndY, arrowAngle, width, color);

                ctx.beginPath();
                ctx.arc(x, y, 12, 0, Math.PI * 2);
                ctx.stroke();
                break;
            }
        }
    },

    drawArrowHead(ctx, x, y, angle, width, color) {
        const size = Math.max(10, width * 2);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
    },

    roundRect(ctx, x, y, w, h, r, fill, stroke) {
        if (typeof r === 'number') {
            r = { tl: r, tr: r, br: r, bl: r };
        }
        if (w < 2 * r.tl) r.tl = w / 2;
        if (h < 2 * r.tl) r.tl = h / 2;
        ctx.beginPath();
        ctx.moveTo(x + r.tl, y);
        ctx.arcTo(x + w, y, x + w, y + h, r.tr || r.tl);
        ctx.arcTo(x + w, y + h, x, y + h, r.br || r.tl);
        ctx.arcTo(x, y + h, x, y, r.bl || r.tl);
        ctx.arcTo(x, y, x + w, y, r.tl);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }
};

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DrawingUtils;
} else {
    window.DrawingUtils = DrawingUtils;
}
