// The office for surfaces that draw Svg (desktop, mobile, VS Code), as a short
// film: one base frame, then layers that hold only the pixels that changed in
// each later frame (the rest transparent). All layers share one atlas PNG and
// CSS reveals each at its time, so the client plays the film with no further
// messages. A re-render rewrites the delays from the clock, so the film
// resumes in phase (docs/design-panel/facts.md: CSS with negative delays
// resumes after a markup change; SMIL restarts, so it is not used).
//
// The office films itself ahead of time and then rewinds (world.ts film()),
// and a tape of its random draws makes the live run match the film until the
// next outside event. The camera cuts instead of panning in a film (a pan
// would change every pixel of every frame); a cut ends the film there, and
// the next film starts after it. Confetti and disco lights are decoration, so
// they are a small CSS overlay, not pixels.
import { base64, encodePNG } from './raster.ts'
import type { Motion, Office } from './types.ts'

/** Changed pixels per film before it is cut short (a full room is 42,240). */
const CHANGE_BUDGET = 45000
/** Changes are boxed per band of rows, and split where a row band has a wide gap. */
const BAND = 32
const GAP = 32

type Layer = { t: number; x: number; y: number; w: number; h: number; px: Uint8Array; ax: number; ay: number }
type Party = { hx: number; inFx: boolean; from: number }

export type Film = {
  /** office.version when filmed: a later outside event makes the film a guess. */
  version: number
  /** office.simT of the first frame. */
  startT: number
  /** Seconds the film covers (its last frame holds after that). */
  seconds: number
  /** Seconds between frames. */
  dt: number
  /** Seconds into the film at which the camera cuts: shoot the next film then. */
  cutAt: number | null
  width: number
  height: number
  zoom: number
  head: string
  layers: Layer[]
  party: Party | null
  /** Characters of everything but the per-render delays. */
  size: number
  /** True when the change budget or the size limit ended the film early. */
  cut: boolean
}

/** The changed pixels of `cur` against `prev`, boxed per band and gap; unchanged pixels transparent. */
function changeBoxes(prev: Uint32Array, cur: Uint32Array, W: number, H: number): { x: number; y: number; w: number; h: number; n: number; px: Uint8Array }[] {
  const out: { x: number; y: number; w: number; h: number; n: number; px: Uint8Array }[] = []
  const cols = new Uint8Array(W)
  for (let b0 = 0; b0 < H; b0 += BAND) {
    const b1 = Math.min(H, b0 + BAND)
    cols.fill(0)
    let any = false
    for (let y = b0; y < b1; y++) for (let x = 0, i = y * W; x < W; x++, i++) if (prev[i] !== cur[i]) { cols[x] = 1; any = true }
    if (!any) continue
    // Column runs, merged across gaps narrower than GAP.
    let x = 0
    while (x < W) {
      while (x < W && !cols[x]) x++
      if (x >= W) break
      let end = x, gap = 0
      for (let k = x; k < W; k++) { if (cols[k]) { end = k; gap = 0 } else if (++gap > GAP) break }
      const x0 = x, x1 = end
      let y0 = b1, y1 = -1, n = 0
      for (let y = b0; y < b1; y++) for (let c = x0, i = y * W + x0; c <= x1; c++, i++) if (prev[i] !== cur[i]) { n++; if (y < y0) y0 = y; if (y > y1) y1 = y }
      const w = x1 - x0 + 1, h = y1 - y0 + 1, px = new Uint8Array(w * h * 4), o32 = new Uint32Array(px.buffer)
      for (let r = 0; r < h; r++) for (let c = 0, i = (y0 + r) * W + x0, o = r * w; c < w; c++, i++, o++) if (prev[i] !== cur[i]) o32[o] = cur[i]! | 0xff000000
      out.push({ x: x0, y: y0, w, h, n, px })
      x = end + 1
    }
  }
  return out
}

/** Shelf-packs the layers into one transparent atlas; sets each layer's ax/ay. */
function atlas(layers: Layer[]): { w: number; h: number; png: string } | null {
  if (!layers.length) return null
  const area = layers.reduce((s, l) => s + l.w * l.h, 0)
  const w = Math.max(...layers.map(l => l.w), Math.min(1024, Math.ceil(Math.sqrt(area) * 1.2)))
  let x = 0, y = 0, shelf = 0
  for (const l of [...layers].sort((p, q) => q.h - p.h)) {
    if (x + l.w > w) { x = 0; y += shelf; shelf = 0 }
    l.ax = x; l.ay = y; x += l.w; shelf = Math.max(shelf, l.h)
  }
  const h = y + shelf
  const buf = new Uint8Array(w * h * 4)
  for (const l of layers) for (let r = 0; r < l.h; r++) buf.set(l.px.subarray(r * l.w * 4, (r + 1) * l.w * 4), ((l.ay + r) * w + l.ax) * 4)
  return { w, h, png: base64(encodePNG(buf, w, h, true)) }
}

function style(motion: Motion): string {
  return 'image{image-rendering:crisp-edges;image-rendering:pixelated}' +
    '.p,.q{opacity:0;animation:on 1ms forwards}@keyframes on{to{opacity:1}}' +
    '.c{shape-rendering:crispEdges;animation:cf linear infinite}@keyframes cf{50%{transform:translate(5px,92px)}to{transform:translate(0,184px)}}' +
    '.d{mix-blend-mode:screen;opacity:.16;shape-rendering:crispEdges;animation:linear infinite}' +
    // Reduced motion: confetti and disco go, and the film holds its first frame
    // between redraws, unless the person chose full motion.
    `@media (prefers-reduced-motion: reduce){.fx{display:none}${motion === 'full' ? '' : '.p{animation:none}'}}`
}

const COLS = ['#f4b942', '#5ec8e5', '#f27fb2', '#78d98e', '#b08cf5', '#ff9b5c']
/**
 * Falling confetti and five roaming disco lights over the town hall. Every
 * phase comes from the office clock `now`, so a redraw or a new film carries
 * on where the last one was; the layout is the same for every party.
 */
function partyMarkup(p: Party, now: number, elapsed: number): string {
  let r = 7
  const rnd = (): number => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296 }
  const phase = (dur: number, off: number): string => `-${((now + off) % dur).toFixed(2)}s`
  let s = ''
  for (let i = 0; i < 5; i++) {
    // A Lissajous path like the page's (cos t*1.1, sin t*1.7), sampled into 9 stops.
    const stops = Array.from({ length: 9 }, (_, k) => {
      const t = (k / 8) * Math.PI * 2 + i * 1.3
      return `${Math.round((k / 8) * 100)}%{transform:translate(${Math.round(Math.cos(t * 1.1 + i) * 80)}px,${Math.round(Math.sin(t * 1.7 + i * 2) * 30)}px)}`
    }).join('')
    const dur = 7 + i * 0.6
    s += `<style>@keyframes d${i}{${stops}}</style><circle class="d" cx="${p.hx + 120}" cy="100" r="10" fill="${COLS[i]}" style="animation-name:d${i};animation-duration:${dur.toFixed(1)}s;animation-delay:${phase(dur, 0)}"/>`
  }
  for (let i = 0; i < 40; i++) {
    const dur = 4.2 + rnd() * 3, off = rnd() * dur
    s += `<rect class="c" x="${p.hx + Math.floor(rnd() * 240)}" y="-6" width="${rnd() < 0.5 ? 2 : 1}" height="1" fill="${COLS[i % 6]}" style="animation-duration:${dur.toFixed(2)}s;animation-delay:${phase(dur, off)}"/>`
  }
  return `<g class="q${p.inFx ? ' fx' : ''}" style="animation-delay:${(p.from - elapsed).toFixed(3)}s">${s}</g>`
}
const PARTY_SIZE = 7600

function assemble(base: string, W: number, H: number, layers: Layer[], party: Party | null, motion: Motion): { head: string; size: number } {
  const a = atlas(layers)
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}"><style>${style(motion)}</style>` +
    (a ? `<defs><image id="a" width="${a.w}" height="${a.h}" href="data:image/png;base64,${a.png}"/></defs>` : '') +
    `<image width="${W}" height="${H}" href="data:image/png;base64,${base}"/>`
  // Markup on top of the head: ≈85 characters per box, ≈50 per frame.
  const frames = new Set(layers.map(l => l.t)).size
  return { head, size: head.length + layers.length * 85 + frames * 50 + (party ? PARTY_SIZE : 0) + 10 }
}

/**
 * Films the office ahead for up to `seconds` at `fps` and packs it as an Svg
 * film of at most `limit` characters. The office ends where it started.
 */
export function shoot(o: Office, fps: number, seconds: number, limit: number, motion: Motion): Film {
  const dt = 1 / fps
  const layers: Layer[] = []
  let prev: Uint32Array | null = null, base = '', W = 0, H = 0, changed = 0, frames = 0, cam0 = 0
  let fxFrom: number | null = null, cutAt: number | null = null, budgetHit = false
  const count = Math.max(1, Math.round(seconds * fps) + 1)
  o.film(count, dt, (k, f, camX) => {
    if (k === 0) {
      W = f.width; H = f.height; cam0 = camX
      base = base64(encodePNG(f.base.data, W, H, false))
      prev = f.base.u32.slice()
    } else {
      if (camX !== cam0) { cutAt = k * dt; return false }
      const boxes = changeBoxes(prev!, f.base.u32, W, H)
      let add = 0
      for (const b of boxes) add += b.n
      if (changed + add > CHANGE_BUDGET) { budgetHit = true; return false }
      changed += add
      for (const b of boxes) layers.push({ t: k * dt, x: b.x, y: b.y, w: b.w, h: b.h, px: b.px, ax: 0, ay: 0 })
      if (boxes.length) prev!.set(f.base.u32)
    }
    if (f.fx && fxFrom === null) fxFrom = k * dt
    frames = k + 1
    return true
  }, true)
  let party: Party | null = null
  if (fxFrom !== null && motion !== 'reduced') {
    const hall = o.rooms().findIndex(r => r.name === 'Town hall')
    party = { hx: hall * 240 - cam0, inFx: motion !== 'full', from: fxFrom }
  }
  // Over the limit after compression: drop the second half of the film until it fits.
  let keep = frames, kept = layers, built = assemble(base, W, H, kept, party, motion)
  while (built.size > limit && keep > 1) {
    keep = Math.max(1, Math.floor(keep / 2))
    kept = layers.filter(l => l.t < (keep - 0.5) * dt)
    built = assemble(base, W, H, kept, party, motion)
  }
  return {
    version: o.version, startT: o.simT, seconds: (keep - 1) * dt, dt, cutAt: keep === frames ? cutAt : null,
    width: W, height: H, zoom: o.zoom, head: built.head, layers: kept, party, size: built.size,
    cut: budgetHit || keep < frames,
  }
}

/** The film's markup for a moment `elapsed` seconds after its first frame. */
export function filmSvg(f: Film, elapsed: number): string {
  let s = f.head, t = -1
  // One timed group per frame; each box inside is a window onto the atlas.
  for (const l of f.layers) {
    if (l.t !== t) { s += `${t < 0 ? '' : '</g>'}<g class="p" style="animation-delay:${(l.t - elapsed).toFixed(3)}s">`; t = l.t }
    s += `<svg x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" viewBox="${l.ax} ${l.ay} ${l.w} ${l.h}"><use href="#a"/></svg>`
  }
  if (t >= 0) s += '</g>'
  if (f.party) s += partyMarkup(f.party, f.startT + elapsed, elapsed)
  return s + '</svg>'
}
