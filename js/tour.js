let currentSlideIndex = 0;
let slidesData = [];

function init() {
    if (window.__data) {
        startTour(window.__data);
    } else {
        chrome.storage.local.get('exportData', (data) => {
            if (data.exportData) {
                startTour(data.exportData);
            } else {
                document.body.innerHTML = '<div class="background"><h1>Keine Daten gefunden.</h1></div>';
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', init);
if (document.readyState !== 'loading') init();

function startTour(data) {
    const { title, date, steps, logo } = data;
    document.title = title;

    // Expand steps into slides (one slide per marker in steps with markers)
    slidesData = [];
    steps.forEach((step, stepIdx) => {
        if (step.type === 'chapter' || step.type === 'textblock') {
            slidesData.push({ ...step, originalStepIdx: stepIdx });
        } else {
            const markers = (step.markers || []).filter(m => m.type !== 'blur');
            if (markers.length === 0) {
                // Background only slide if no markers
                slidesData.push({ ...step, originalStepIdx: stepIdx });
            } else {
                // Create a slide for EACH marker
                markers.forEach((marker, markerIdx) => {
                    slidesData.push({
                        ...step,
                        activeMarkerIndex: step.markers.indexOf(marker),
                        subLabel: markers.length > 1 ? ` (${markerIdx + 1}/${markers.length})` : '',
                        originalStepIdx: stepIdx
                    });
                });
            }
        }
    });

    const logoImg = document.getElementById('tourLogo');
    if (logo && logoImg) {
        logoImg.src = logo;
        logoImg.style.display = 'block';
    }

    renderSlides(title);
    updateProgress();
    showSlide(0);
}

function renderSlides(docTitle) {
    const container = document.getElementById('slideshow');
    const progressContainer = document.getElementById('progressContainer');

    container.innerHTML = '';
    progressContainer.innerHTML = '';

    // 1. Start Slide
    const startSlide = document.createElement('div');
    startSlide.className = 'mySlides fade';
    startSlide.innerHTML = `
        <div class="background">
            <div class="title">${escapeHtml(docTitle)}</div>
            <div class="subtitle">Interaktive Klickanleitung</div>
            <div class="subtitle">${new Date().toLocaleDateString()}</div>
            <button class="start-btn" id="startTourBtn">Tour Starten</button>
        </div>
    `;
    container.appendChild(startSlide);
    document.getElementById('startTourBtn').addEventListener('click', nextSlide);

    // 2. Expanded Step Slides
    slidesData.forEach((slideData, i) => {
        const slide = document.createElement('div');
        slide.className = 'mySlides fade';

        if (slideData.type === 'chapter') {
            slide.style.cursor = 'pointer';
            slide.innerHTML = `
                <div class="background" style="background: linear-gradient(135deg, #1e293b 0%, #020617 100%); color: white; cursor: pointer;">
                    <div style="font-size: 42px; margin-bottom: 20px;">🔖</div>
                    <div class="title" style="color: white;">${escapeHtml(slideData.title || 'Kapitel')}</div>
                    <div class="subtitle" style="color: var(--text-muted);">Prozessabschnitt</div>
                </div>
            `;
            slide.onclick = () => {
                nextSlide();
            };
        } else if (slideData.type === 'textblock') {
            slide.style.cursor = 'pointer';
            slide.innerHTML = `
                <div class="background" style="background: var(--bg-dark); padding: 80px 40px; text-align: left; align-items: flex-start; justify-content: flex-start; overflow-y: auto; cursor: pointer;">
                    <div style="max-width: 900px; width: 100%; margin: 60px auto; animation: slideUp 0.8s ease-out;">
                        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 32px;">
                            <span style="background: rgba(79, 70, 229, 0.1); color: var(--primary-light); padding: 8px 18px; border-radius: 20px; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Information</span>
                            <div style="flex: 1; height: 1px; background: rgba(255,255,255,0.06);"></div>
                        </div>
                        <h1 style="font-size: 48px; font-weight: 800; color: white; margin-bottom: 40px; line-height: 1.2; letter-spacing: -0.03em;">
                            ${escapeHtml(slideData.title || 'Wichtiger Hinweis')}
                        </h1>
                        <div class="text-content" style="font-size: 22px; line-height: 1.8; color: var(--text-muted);">
                            ${slideData.content || ''}
                        </div>
                    </div>
                </div>
            `;
            slide.onclick = () => {
                nextSlide();
            };
        } else {
            // Standard slide with image and marker(s)
            const markers = slideData.markers || [];
            slide.innerHTML = `
                <div class="image-container">
                    <div class="image-wrapper"><img src="${slideData.dataUrl}" class="step-img" id="img-${i}">
                        ${markers.map((m, mi) => {
                if (m.type === 'blur') return '';
                const isActive = slideData.activeMarkerIndex === mi;
                return `
                                <div class="box marker-box ${isActive ? 'pulse' : 'dimmed'}" 
                                     id="box-${i}-${mi}" 
                                     style="position: absolute; z-index: 100; ${isActive ? 'cursor: pointer; pointer-events: auto;' : 'display: none;'}">
                                </div>
                            `;
            }).join('')}
                        <div class="bubble" id="bubble-${i}">
                            <div style="font-size: 11px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
                                Schritt ${i + 1} von ${slidesData.length} ${slideData.subLabel || ''}
                            </div>
                            <b>${escapeHtml(slideData.title || 'Schritt ' + (i + 1))}</b>
                            ${(slideData.session || slideData.field) ? `
                                <div style="font-size: 11px; font-family: 'JetBrains Mono', monospace; color: var(--primary-light); margin: 12px 0; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06);">
                                    ${slideData.session ? `<div>SC: <span class="copy-trigger" data-copy="${slideData.session}" title="Klicken zum Kopieren">${escapeHtml(slideData.session)}</span></div>` : ''}
                                    ${slideData.field ? `<div>TF: <span class="copy-trigger" data-copy="${slideData.field}" title="Klicken zum Kopieren">${escapeHtml(slideData.field)}</span></div>` : ''}
                                </div>
                            ` : ''}
                            ${slideData.description ? `<div style="margin-top:12px; line-height: 1.5; color: #cbd5e1;">${escapeHtml(slideData.description)}</div>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }
        container.appendChild(slide);

        // container.appendChild(slide);

        // Click box event has been moved specifically to the highlighted boxes.

        // Progress segment
        const segment = document.createElement('div');
        segment.className = 'progress-segment';
        segment.onclick = (e) => {
            e.stopPropagation();
            showSlide(i + 1);
        };
        progressContainer.appendChild(segment);

        // Positioning
        if (slideData.type !== 'chapter' && slideData.type !== 'textblock') {
            const img = document.getElementById(`img-${i}`);
            if (img) {
                if (img.complete) {
                    positionOverlays(i, slideData);
                } else {
                    img.onload = () => positionOverlays(i, slideData);
                }
            }
        }
    });

    // 3. End Slide
    const endSlide = document.createElement('div');
    endSlide.className = 'mySlides fade';
    endSlide.innerHTML = `
        <div class="background">
            <div class="title">Vielen Dank!</div>
            <div class="subtitle">Die Dokumentations-Tour ist beendet.</div>
            <button class="start-btn" id="restartTourBtn">Tour neu starten</button>
        </div>
    `;
    container.appendChild(endSlide);
    document.getElementById('restartTourBtn').addEventListener('click', () => showSlide(0));
}

function positionOverlays(index, slideData) {
    if (slideData.type === 'chapter' || slideData.type === 'textblock') return;
    const img = document.getElementById(`img-${index}`);
    const bubble = document.getElementById(`bubble-${index}`);

    if (!img || !bubble) return;

    const dpr = slideData.meta?.devicePixelRatio || 1;
    const rect = {
        width: img.offsetWidth,
        height: img.offsetHeight
    };
    if (rect.width === 0) {
        // Only retry positioning if this slide is the currently visible active slide
        const slides = document.querySelectorAll(".mySlides");
        if (slides[currentSlideIndex] === slides[index + 1]) {
            setTimeout(() => positionOverlays(index, slideData), 100);
        }
        return;
    }

    const setBoxStyle = (box, marker) => {
        const offset = 5; // Adjusted from 3 to 5 to account for editor's 4px centered stroke width
        const rx = marker.x - offset;
        const ry = marker.y - offset;
        const rw = marker.width + (offset * 2);
        const rh = marker.height + (offset * 2);

        const xRatio = (rx * dpr) / img.naturalWidth;
        const yRatio = (ry * dpr) / img.naturalHeight;
        const bWidth = (rw * dpr) / img.naturalWidth * rect.width;
        const bHeight = (rh * dpr) / img.naturalHeight * rect.height;

        box.style.width = bWidth + 'px';
        box.style.height = bHeight + 'px';
        box.style.left = (xRatio * rect.width) + 'px';
        box.style.top = (yRatio * rect.height) + 'px';

        return {
            xRatio: (marker.x + marker.width / 2) * dpr / img.naturalWidth,
            yRatio: (marker.y + marker.height / 2) * dpr / img.naturalHeight,
            leftRatio: marker.x * dpr / img.naturalWidth,
            rightRatio: (marker.x + marker.width) * dpr / img.naturalWidth,
            topRatio: marker.y * dpr / img.naturalHeight,
            bottomRatio: (marker.y + marker.height) * dpr / img.naturalHeight
        };
    };

    let activePos = null;

    if (slideData.markers && slideData.markers.length > 0) {
        slideData.markers.forEach((m, mi) => {
            if (m.type === 'blur') return;
            const box = document.getElementById(`box-${index}-${mi}`);
            const pos = box ? setBoxStyle(box, m) : null;
            if (mi === slideData.activeMarkerIndex && pos) {
                activePos = pos;

                // Dynamically bind handlers to bypass CSP block
                box.onclick = (e) => {
                    e.stopPropagation();
                    nextSlide();
                };
                box.onmouseover = () => {
                    box.style.boxShadow = '0 0 15px 5px rgba(239, 68, 68, 0.7)';
                };
                box.onmouseout = () => {
                    box.style.boxShadow = '';
                };
            }
        });
        // Fallback to first if active not set
        if (!activePos && slideData.markers.length > 0) {
            const first = slideData.markers.find(m => m.type !== 'blur') || slideData.markers[0];
            activePos = {
                xRatio: (first.x + first.width / 2) * dpr / img.naturalWidth,
                yRatio: (first.y + first.height / 2) * dpr / img.naturalHeight,
                leftRatio: first.x * dpr / img.naturalWidth,
                rightRatio: (first.x + first.width) * dpr / img.naturalWidth,
                topRatio: first.y * dpr / img.naturalHeight,
                bottomRatio: (first.y + first.height) * dpr / img.naturalHeight
            };
        }
    } else if (slideData.rect) {
        const box = document.getElementById(`box-${index}`);
        if (box) {
            activePos = setBoxStyle(box, slideData.rect);
        }
    } else if (slideData.x && slideData.y) {
        const targetXRatio = (slideData.x * dpr) / img.naturalWidth;
        const targetYRatio = (slideData.y * dpr) / img.naturalHeight;
        const box = document.getElementById(`box-${index}`);
        const boxSize = 60;
        if (box) {
            box.style.width = boxSize + 'px';
            box.style.height = boxSize + 'px';
            box.style.left = `calc(${targetXRatio * 100}% - ${boxSize / 2}px)`;
            box.style.top = `calc(${targetYRatio * 100}% - ${boxSize / 2}px)`;
        }
        activePos = {
            xRatio: targetXRatio,
            yRatio: targetYRatio,
            leftRatio: targetXRatio - (boxSize / 2) / rect.width,
            rightRatio: targetXRatio + (boxSize / 2) / rect.width,
            topRatio: targetYRatio - (boxSize / 2) / rect.height,
            bottomRatio: targetYRatio + (boxSize / 2) / rect.height
        };
    }

    if (!activePos) {
        bubble.className = "bubble";
        bubble.style.left = "50%";
        bubble.style.top = "50%";
        bubble.style.transform = "translate(-50%, -50%)";
        bubble.style.position = "absolute";
        return;
    }

    // Precise Bubble Positioning logic using pixels and container boundaries
    let bubbleClass = 'arrow-left';
    // Position bubble to the right of the highlight box (rightRatio * rect.width + 16px)
    let leftPx = activePos.rightRatio * rect.width + 16;
    
    // Position bubble top to align the bubble arrow with the target vertical center of the highlight
    // Arrow vertical center is 36px from top of bubble by default (top: 24px + 12px border)
    let topPx = activePos.yRatio * rect.height - 36;

    // Check if the bubble would overflow the right side of the container (340px bubble width)
    if (leftPx + 340 > rect.width) {
        // Not enough space on the right. Try placing it on the left of the highlight box (leftRatio * rect.width - 340px - 16px)
        const leftSpaceOption = activePos.leftRatio * rect.width - 340 - 16;
        if (leftSpaceOption >= 10) {
            bubbleClass = 'arrow-right';
            leftPx = leftSpaceOption;
        } else {
            // Not enough space on either side! Let's choose the side with more space
            const rightSpace = rect.width - (activePos.rightRatio * rect.width);
            const leftSpace = activePos.leftRatio * rect.width;
            if (rightSpace > leftSpace) {
                bubbleClass = 'arrow-left';
                leftPx = Math.max(10, Math.min(rect.width - 350, activePos.rightRatio * rect.width + 16));
            } else {
                bubbleClass = 'arrow-right';
                leftPx = Math.max(10, Math.min(rect.width - 350, activePos.leftRatio * rect.width - 340 - 16));
            }
        }
    } else {
        // Ensure leftPx doesn't overflow left boundary
        leftPx = Math.max(10, leftPx);
    }

    // Dynamic vertical positioning with exact arrow alignment
    const bubbleHeight = bubble.offsetHeight || 220;
    
    // Clamp topPx so the bubble stays fully within the image container (with 10px padding from top/bottom)
    topPx = Math.max(10, Math.min(rect.height - bubbleHeight - 10, topPx));

    // Calculate exact arrow vertical position to point to activePos.yRatio * rect.height
    // vertical center of highlight is y = activePos.yRatio * rect.height.
    // Relative to the bubble top (topPx), the center is y - topPx.
    // The arrow's top CSS property needs to align the arrow center with this.
    // Since arrow is a 12px border (24px height), its vertical center is at top + 12px.
    // So arrowTop = (y - topPx) - 12.
    let arrowTop = (activePos.yRatio * rect.height) - topPx - 12;
    
    // Clamp arrowTop to stay within bubble body, leaving at least 16px from top and bottom edges
    arrowTop = Math.max(16, Math.min(bubbleHeight - 40, arrowTop));

    bubble.className = `bubble ${bubbleClass}`;
    bubble.style.left = leftPx + 'px';
    bubble.style.top = topPx + 'px';
    bubble.style.transform = ''; // Clear center transform
    bubble.style.setProperty('--arrow-top', arrowTop + 'px');
}

function showSlide(n) {
    const slides = document.querySelectorAll(".mySlides");
    if (!slides.length) return;

    if (n >= slides.length) n = slides.length - 1;
    if (n < 0) n = 0;

    currentSlideIndex = n;

    slides.forEach(s => {
        s.style.display = "none";
        const wrapper = s.querySelector('.image-wrapper');
        if (wrapper) wrapper.classList.remove('zoom-in');
    });

    const activeSlide = slides[currentSlideIndex];
    activeSlide.style.display = "flex";

    const activeWrapper = activeSlide.querySelector('.image-wrapper');
    if (activeWrapper) {
        setTimeout(() => activeWrapper.classList.add('zoom-in'), 50);
    }

    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');
    if (btnPrev) btnPrev.disabled = (currentSlideIndex === 0);
    if (btnNext) btnNext.disabled = (currentSlideIndex === slides.length - 1);

    // Immediately trigger positioning overlays for the active slide
    const slideDataIndex = currentSlideIndex - 1;
    if (slidesData[slideDataIndex]) {
        const slideData = slidesData[slideDataIndex];
        if (slideData.type !== 'chapter' && slideData.type !== 'textblock') {
            positionOverlays(slideDataIndex, slideData);
        }
    }

    updateProgress();
}

function nextSlide() { showSlide(currentSlideIndex + 1); }
function prevSlide() { showSlide(currentSlideIndex - 1); }

function updateProgress() {
    const segments = document.querySelectorAll('.progress-segment');
    segments.forEach((seg, i) => {
        seg.classList.toggle('active', i < currentSlideIndex);
    });
}

document.getElementById('btnPrev').addEventListener('click', (e) => { e.stopPropagation(); prevSlide(); });
document.getElementById('btnNext').addEventListener('click', (e) => { e.stopPropagation(); nextSlide(); });

document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ') nextSlide();
    if (e.key === 'ArrowLeft') prevSlide();
});

window.addEventListener('resize', () => {
    const dataIndex = currentSlideIndex - 1;
    if (slidesData[dataIndex]) {
        positionOverlays(dataIndex, slidesData[dataIndex]);
    }
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

// Global Copy-to-Clipboard Listener for Tour Bubble
window.addEventListener('click', (e) => {
    const copyTarget = e.target.closest('[data-copy]');
    if (copyTarget) {
        const text = copyTarget.dataset.copy;
        navigator.clipboard.writeText(text).then(() => {
            const originalHtml = copyTarget.innerHTML;
            copyTarget.innerHTML = '<span style="color: #10b981;">Kopiert!</span>';
            copyTarget.style.pointerEvents = 'none';
            setTimeout(() => {
                copyTarget.innerHTML = originalHtml;
                copyTarget.style.pointerEvents = 'auto';
            }, 1000);
        }).catch(err => {
            console.error('Copy failed:', err);
        });
    }
});
