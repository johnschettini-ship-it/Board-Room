function buildLights() {
  // Same lighting as the page: a shade over everything, each lamp cutting a
  // radial hole (destination-out of a linear radial gradient), then the alpha
  // quantised to 11 levels with a 4x4 Bayer dither. Kept as an alpha map.
  const T = THEMES[themeKey], L = 11, A = new Uint8Array(W * H);
  A.fill(Math.round(T.alpha * 255));
  for (const [x, y, r, s] of LIGHTS) {
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W, Math.ceil(x + r)), y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H, Math.ceil(y + r));
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      const d = Math.hypot(px + 0.5 - x, py + 0.5 - y);
      if (d >= r) continue;
      const src = Math.round(s * (1 - d / r) * 255) / 255, i = py * W + px;
      A[i] = Math.round(A[i] * (1 - src));
    }
  }
  for (let i = 0, n = W * H; i < n; i++) {
    const x = i % W, y = (i / W) | 0, a = A[i] / 255, t = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
    const q = Math.min(L - 1, Math.floor(a * (L - 1) + t)) / (L - 1);
    A[i] = Math.round(q * 255);
  }
  return A;
}
function applyTheme(key) {
  themeKey = key; flickers = []; antennas = [];
  bgCanvas = buildBackground().freeze(); lightA = buildLights();
}
