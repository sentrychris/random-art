/* -------------------------- helpers -------------------------- */
const ric = window.requestIdleCallback || (fn => requestAnimationFrame(() => fn({ timeRemaining: () => 0 })));

function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Katakana “alien” characters
function randomAlienChar() {
    const start = 0x31; // Unicode for '1'
    const end   = 0x3A; // Unicode for '9' + 1
    return start + ((Math.random() * (end - start)) | 0);
}

/* ------------------ minimal 2D simplex noise ------------------ */
function makeSimplex() {
    const seed = Math.floor(Math.random() * (9000 - 1000 + 1)) + 1000;
    let s = seed >>> 0;
    const rnd = () => (s = (s ^ (s << 13)) >>> 0, s = (s ^ (s >>> 17)) >>> 0, s = (s ^ (s << 5)) >>> 0, (s & 0xffff) / 0xffff);

    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;

    function grad2(h, x, y) {
        switch (h & 7) {
            case 0: return  x + y;
            case 1: return  x - y;
            case 2: return -x + y;
            case 3: return -x - y;
            case 4: return  x;
            case 5: return -x;
            case 6: return  y;
            default:return -y;
        }
    }

    function noise2D(xin, yin) {
        let n0, n1, n2;
        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const t = (i + j) * G2;
        const X0 = i - t, Y0 = j - t;
        const x0 = xin - X0, y0 = yin - Y0;

        let i1, j1;
        if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }

        const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
        const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;

        const ii = i & 255, jj = j & 255;
        const gi0 = perm[ii + perm[jj]];
        const gi1 = perm[ii + i1 + perm[jj + j1]];
        const gi2 = perm[ii + 1 + perm[jj + 1]];

        let t0 = 0.5 - x0 * x0 - y0 * y0;
        n0 = t0 < 0 ? 0 : (t0 *= t0, t0 * t0 * grad2(gi0, x0, y0));

        let t1 = 0.5 - x1 * x1 - y1 * y1;
        n1 = t1 < 0 ? 0 : (t1 *= t1, t1 * t1 * grad2(gi1, x1, y1));

        let t2 = 0.5 - x2 * x2 - y2 * y2;
        n2 = t2 < 0 ? 0 : (t2 *= t2, t2 * t2 * grad2(gi2, x2, y2));

        return 70 * (n0 + n1 + n2); // ~[-1,1]
    }

    return { noise2D };
}

/* -------------------- BINARY CANVAS -------------------- */
(() => {
    const root = document.getElementById('static-alpha-grid');
    if (!root) return;
    const canvas = root.querySelector('.binary-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });

    const targetFPS = 30;
    const frameInterval = 1000 / targetFPS;

    // smooth swirl field params
    const noise = makeSimplex(90210);
    const fieldScale = 0.9;     // lower = larger curls
    const timeScale  = 0.06;    // animation speed
    const curlStep   = 0.003;   // finite diff step in normalized units
    const offsetMag  = 0.55;    // glyph drift in cell units
    const alphaBase  = 0.10;    // min opacity
    const alphaGain  = 0.85;    // opacity range
    const alphaGamma = 1.25;    // response curve

    let cols = 0, rows = 0;
    let cellW = 0, cellH = 0, ascent = 0;
    let buf;
    let rafId = 0;
    let lastMs = 0;
    let lastCanvasW = 0, lastCanvasH = 0;
    let rootRect = { width: 1, height: 1 };

    function measureFont() {
        const style = getComputedStyle(root);
        const font = `${style.fontWeight} 12px / ${style.lineHeight} ${style.fontFamily}`;
        ctx.font = font;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        const m = ctx.measureText('M');
        const metrics = ctx.measureText('Hg');
        const emH = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
                 || parseFloat(style.lineHeight) || m.actualBoundingBoxAscent * 2 || 16;
        cellW = Math.ceil(m.width);
        cellH = Math.ceil(emH);
        ascent = metrics.actualBoundingBoxAscent || Math.ceil(emH * 0.8);
    }

    function resize() {
        const rect = root.getBoundingClientRect();
        rootRect = { width: rect.width, height: rect.height };

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cw = Math.max(1, Math.floor(rect.width  * dpr));
        const ch = Math.max(1, Math.floor(rect.height * dpr));

        if (cw === lastCanvasW && ch === lastCanvasH) return;
        lastCanvasW = cw; lastCanvasH = ch;

        canvas.width  = cw;
        canvas.height = ch;
        canvas.style.width  = `${Math.floor(rect.width)}px`;
        canvas.style.height = `${Math.floor(rect.height)}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        measureFont();

        cols = Math.max(1, Math.floor(rect.width / (cellW * 2)));
        rows = Math.max(1, Math.floor(rect.height / cellH) + 1);

        buf = new Uint16Array(cols * rows);
        for (let i = 0; i < buf.length; i++) buf[i] = randomAlienChar();

        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function tick() {
        if (!buf) return;
        const flips = Math.max(100, Math.floor(cols * rows * 0.02));
        for (let i = 0; i < flips; i++) {
            const idx = (Math.random() * buf.length) | 0;
            buf[idx] = randomAlienChar();
        }
    }

    // Divergence-free curl field from simplex noise
    function curlField(nx, ny, t) {
        const f = fieldScale;
        const tt = t * timeScale;

        const n = (x, y) =>
            0.6 * noise.noise2D(f * x + tt,             f * y - tt) +
            0.3 * noise.noise2D(f * x * 1.9,            f * y * 1.9 + tt * 0.7) +
            0.1 * noise.noise2D(f * x * 4.1 - tt * 0.3, f * y * 4.1);

        const e = curlStep;

        const dphidx = (n(nx + e, ny) - n(nx - e, ny)) / (2 * e);
        const dphidy = (n(nx, ny + e) - n(nx, ny - e)) / (2 * e);

        let vx =  dphidy;
        let vy = -dphidx;

        const len = Math.hypot(vx, vy) + 1e-6;
        vx /= len; vy /= len;

        const aRaw = 0.5 + 0.5 * Math.tanh(0.8 * n(nx + 1.234, ny - 2.345));
        const alpha = alphaBase + alphaGain * Math.pow(aRaw, alphaGamma);

        return { vx, vy, alpha };
    }

    function render(ms) {
        const t = ms * 0.001;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const style = getComputedStyle(root);
        ctx.fillStyle = style.color || 'rgba(255,255,255,1)';

        const w = Math.max(rootRect.width, 1);
        const h = Math.max(rootRect.height, 1);

        for (let rr = 0; rr < rows; rr++) {
            const y0 = rr * cellH + ascent;
            const ny = (rr * cellH) / h;

            for (let col = 0; col < cols; col++) {
                const idx = rr * cols + col;
                const x0 = col * (cellW * 2);
                const nx = x0 / w;

                const f = curlField(nx, ny, t);

                const ox = f.vx * offsetMag * cellW;
                const oy = f.vy * offsetMag * cellH;

                ctx.globalAlpha = f.alpha;
                ctx.fillText(String.fromCharCode(buf[idx]), x0 + ox, y0 + oy);
            }
        }
        ctx.globalAlpha = 1;
    }

    function loop(ts) {
        if (prefersReducedMotion()) {
            if (!lastMs) render(ts);
            rafId = requestAnimationFrame(loop);
            return;
        }
        if (document.hidden) {
            rafId = requestAnimationFrame(loop);
            return;
        }
        if (ts - lastMs >= frameInterval) {
            lastMs = ts || 0;
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
