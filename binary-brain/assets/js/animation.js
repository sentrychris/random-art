/* -------------------------- helpers -------------------------- */
const ric = window.requestIdleCallback || (fn => requestAnimationFrame(() => fn({ timeRemaining: () => 0 })));

function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// -------------------- BINARY CANVAS (0/1) --------------------
(() => {
    const root = document.getElementById('static-alpha-grid');
    if (!root) return; // guard
    const canvas = root.querySelector('.binary-canvas');
    if (!canvas) return; // guard
    const ctx = canvas.getContext('2d', { alpha: true });

    // tunables
    const targetFPS = 30;
    const frameInterval = 1000 / targetFPS;

    let cols = 0, rows = 0;
    let cellW = 0, cellH = 0, ascent = 0;
    /** @type {Uint8Array} */
    let buf;
    let rafId = 0;
    let lastMs = 0;
    let lastCanvasW = 0, lastCanvasH = 0; // track actual backing size

    function measureFont() {
        const style = getComputedStyle(root);
        const font = `${style.fontWeight} 14px / ${style.lineHeight} ${style.fontFamily}`;
        ctx.font = font;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'center';

        // Use a digit for width; better match for 0/1 glyphs than 'M'
        const m0 = ctx.measureText('0');
        const metrics = ctx.measureText('Hg');
        const emH = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
            || parseFloat(style.lineHeight) || m0.actualBoundingBoxAscent * 2 || 16;

        cellW = Math.ceil(m0.width);
        cellH = Math.ceil(emH);
        ascent = metrics.actualBoundingBoxAscent || Math.ceil(emH * 0.8);
    }

    function resize() {
        const rect = root.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cw = Math.max(1, Math.floor(rect.width  * dpr));
        const ch = Math.max(1, Math.floor(rect.height * dpr));

        // skip if no effective change
        if (cw === lastCanvasW && ch === lastCanvasH) return;
        lastCanvasW = cw; lastCanvasH = ch;

        canvas.width  = cw;
        canvas.height = ch;
        canvas.style.width  = `${Math.floor(rect.width)}px`;
        canvas.style.height = `${Math.floor(rect.height)}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        measureFont();

        // keep some horizontal spacing between digits
        const xStride = cellW * 2;

        cols = Math.max(1, Math.floor(rect.width / xStride));
        rows = Math.max(1, Math.floor(rect.height / cellH) + 1);

        buf = new Uint8Array(cols * rows);
        // Initialize with random 0/1
        for (let i = 0; i < buf.length; i++) buf[i] = Math.random() < 0.5 ? 0 : 1;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // cache stride on ctx for render()
        ctx._xStride = xStride;
    }

    function tick() {
        if (!buf) return;
        const flips = Math.max(100, Math.floor(cols * rows * 0.02));
        for (let i = 0; i < flips; i++) {
            const idx = (Math.random() * buf.length) | 0;
            // Flip bit or set random bit; flipping gives nicer sparkle
            buf[idx] ^= 1;
        }
    }

    function render(ms) {
    const t = ms * 0.003; // speed
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const chunkX = 8, chunkY = 2;

    // cycling hue, fixed saturation/lightness so it never goes black
    const hue = (ms * 0.02) % 360;
    const sat = 100;   // %
    const light = 50;  // % -- stay mid so it's always visible
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;

    // pulsing opacity (clamped so it never disappears)
    const base = 0.4;   // minimum alpha (higher than 0.15)
    const range = 0.6;  // variation
    const gamma = 1.6;
    const xStride = ctx._xStride || (cellW * 2);

    for (let r0 = 0; r0 < rows; r0 += chunkY) {
        const maxR = Math.min(rows, r0 + chunkY);
        for (let c0 = 0; c0 < cols; c0 += chunkX) {
            const digitCount = Math.min(chunkX, cols - c0);
            const phase = (c0 * 0.55 / chunkX) + (r0 * 0.55 / chunkY) + t;
            const u = (Math.sin(phase) + 1) * 0.5;
            const v = Math.pow(u, gamma);
            ctx.globalAlpha = base + range * v; // never below 0.4

            for (let rr = r0; rr < maxR; rr++) {
                const y = rr * cellH + ascent;
                const rowBase = rr * cols + c0;
                for (let cc = 0; cc < digitCount; cc++) {
                    const idx = rowBase + cc;
                    const px = (c0 + cc) * xStride;
                    const chCode = 48 + buf[idx];
                    ctx.fillText(String.fromCharCode(chCode), px, y);
                }
            }
        }
    }
    ctx.globalAlpha = 1;
}
    function loop(ts) {
        if (prefersReducedMotion()) {
            if (!lastMs) render(ts); // render once
            rafId = requestAnimationFrame(loop);
            return;
        }
        if (document.hidden) {
            rafId = requestAnimationFrame(loop);
            return;
        }
        if (ts - lastMs >= frameInterval) {
            lastMs = ts;
            tick();
            render(ts);
        }
        rafId = requestAnimationFrame(loop);
    }

    let resizeTO;
    function onResize() {
        clearTimeout(resizeTO);
        resizeTO = setTimeout(() => {
            cancelAnimationFrame(rafId);
            resize();
            lastMs = 0;
            rafId = requestAnimationFrame(loop);
        }, 100);
    }

    addEventListener('resize', onResize, { passive: true });
    addEventListener('orientationchange', onResize, { passive: true });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            cancelAnimationFrame(rafId);
        } else {
            lastMs = 0;
            rafId = requestAnimationFrame(loop);
        }
    }, { passive: true });

    // initial
    resize();
    rafId = requestAnimationFrame(loop);
})();
