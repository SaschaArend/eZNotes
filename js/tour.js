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
            slide.innerHTML = `
                <div class="background" style="background: linear-gradient(135deg, #1e293b 0%, #020617 100%); color: white;">
                    <div style="font-size: 42px; margin-bottom: 20px;">🔖</div>
                    <div class="title" style="color: white;">${escapeHtml(slideData.title || 'Kapitel')}</div>
                    <div class="subtitle" style="color: var(--text-muted);">Prozessabschnitt</div>
                </div>
            `;
        } else if (slideData.type === 'textblock') {
            slide.innerHTML = `
                <div class="background" style="background: var(--bg-dark); padding: 80px 40px; text-align: left; align-items: flex-start; justify-content: flex-start; overflow-y: auto;">
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
        } else {
            // Standard slide with image and marker(s)
            const markers = slideData.markers || [];
            slide.innerHTML = `
                <div class="image-container">
                    <div class="image-wrapper">
                        <img src="${slideData.dataUrl}" class="step-img" id="img-${i}">
                        ${markers.map((m, mi) => {
                if (m.type === 'blur') return '';
                // Only the active marker pulses and is primary
                const isActive = slideData.activeMarkerIndex === mi;
                const isOthersVisible = true; // Still show other markers but static? Or only show active one?
                // User wants to go through them individually, so let's only show the ACTIVE one clearly.
                return `
                                <div class="box marker-box ${isActive ? 'pulse' : 'dimmed'}" 
                                     id="box-${i}-${mi}" 
                                     style="${isActive ? '' : 'display: none;'}">
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
                                    ${slideData.session ? `<div>SC: ${escapeHtml(slideData.session)}</div>` : ''}
                                    ${slideData.field ? `<div>TF: ${escapeHtml(slideData.field)}</div>` : ''}
                                </div>
                            ` : ''}
                            ${slideData.description ? `<div style="margin-top:12px; line-height: 1.5; color: #cbd5e1;">${escapeHtml(slideData.description)}</div>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }
        container.appendChild(slide);

        // Click box event
        slide.onclick = () => nextSlide();
        slide.style.cursor = 'pointer';

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
    const rect = img.getBoundingClientRect();
    if (rect.width === 0) {
        setTimeout(() => positionOverlays(index, slideData), 100);
        return;
    }

    const setBoxStyle = (box, marker) => {
        const offset = 3;
        const rx = marker.x - offset;
        const ry = marker.y - offset;
        const rw = marker.width + (offset * 2);
        const rh = marker.height + (offset * 2);

        const xRatio = (rx * dpr) / img.naturalWidth;
        const yRatio = (ry * dpr) / img.naturalHeight;
        const bWidth = (rw * dpr) / img.naturalWidth * 100;
        const bHeight = (rh * dpr) / img.naturalHeight * 100;

        box.style.width = bWidth + '%';
        box.style.height = bHeight + '%';
        box.style.left = (xRatio * 100) + '%';
        box.style.top = (yRatio * 100) + '%';

        return { xRatio: (marker.x + marker.width / 2) * dpr / img.naturalWidth, yRatio: (marker.y + marker.height / 2) * dpr / img.naturalHeight };
    };

    let targetXRatio = 0, targetYRatio = 0;

    if (slideData.markers && slideData.markers.length > 0) {
        slideData.markers.forEach((m, mi) => {
            if (m.type === 'blur') return;
            const box = document.getElementById(`box-${index}-${mi}`);
            const pos = box ? setBoxStyle(box, m) : null;
            if (mi === slideData.activeMarkerIndex && pos) {
                targetXRatio = pos.xRatio;
                targetYRatio = pos.yRatio;
            }
        });
        // Fallback to first if active not set
        if (!targetXRatio && slideData.markers.length > 0) {
            const first = slideData.markers[0];
            targetXRatio = (first.x + first.width / 2) * dpr / img.naturalWidth;
            targetYRatio = (first.y + first.height / 2) * dpr / img.naturalHeight;
        }
    } else if (slideData.rect) {
        const box = document.getElementById(`box-${index}`);
        if (box) {
            const pos = setBoxStyle(box, slideData.rect);
            targetXRatio = pos.xRatio;
            targetYRatio = pos.yRatio;
        }
    } else if (slideData.x && slideData.y) {
        targetXRatio = (slideData.x * dpr) / img.naturalWidth;
        targetYRatio = (slideData.y * dpr) / img.naturalHeight;
        const box = document.getElementById(`box-${index}`);
        if (box) {
            const boxSize = 60;
            box.style.width = boxSize + 'px';
            box.style.height = boxSize + 'px';
            box.style.left = `calc(${targetXRatio * 100}% - ${boxSize / 2}px)`;
            box.style.top = `calc(${targetYRatio * 100}% - ${boxSize / 2}px)`;
        }
    }

    if (!targetXRatio) {
        bubble.className = "bubble";
        bubble.style.left = "50%";
        bubble.style.top = "50%";
        bubble.style.transform = "translate(-50%, -50%)";
        bubble.style.position = "absolute";
        return;
    }

    // Precise Bubble Positioning logic
    let bubbleClass = 'arrow-left';
    let bubbleLeft = targetXRatio * 100 + 5; // Balanced offset
    let bubbleTop = targetYRatio * 100 - 8; // Anchor point adjustment

    if (targetXRatio > 0.65) {
        bubbleClass = 'arrow-right';
        bubbleLeft = targetXRatio * 100 - 35;
    }

    // Vertical limit adjustments to stay on screen
    if (targetYRatio > 0.8) {
        bubbleTop = targetYRatio * 100 - 25;
    } else if (targetYRatio < 0.1) {
        bubbleTop = targetYRatio * 100 + 5;
    }

    bubble.className = `bubble ${bubbleClass}`;
    bubble.style.left = bubbleLeft + '%';
    bubble.style.top = bubbleTop + '%';
    bubble.style.transform = ''; // Clear center transform
}

function showSlide(n) {
    const slides = document.querySelectorAll(".mySlides");
    if (!slides.length) return;

    if (n >= slides.length) n = slides.length - 1;
    if (n < 0) n = 0;

    currentSlideIndex = n;

    slides.forEach(s => {
        s.style.display = "none";
        const img = s.querySelector('.step-img');
        if (img) img.classList.remove('zoom-in');
    });

    const activeSlide = slides[currentSlideIndex];
    activeSlide.style.display = "flex";

    const activeImg = activeSlide.querySelector('.step-img');
    if (activeImg) {
        setTimeout(() => activeImg.classList.add('zoom-in'), 50);
    }

    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');
    if (btnPrev) btnPrev.disabled = (currentSlideIndex === 0);
    if (btnNext) btnNext.disabled = (currentSlideIndex === slides.length - 1);

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

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
