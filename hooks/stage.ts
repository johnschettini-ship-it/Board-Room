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
type Party = { hx: number; hy: number; inFx: boolean; from: number }

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
  /** Width of the view (the frames may be wider when the camera slides across them). */
  viewW: number
  /** The base frame's <image> tag (inside the camera group). */
  baseTag: string
  /** Per frame, the camera's x offset into the frames; null when it does not move. */
  pan: number[] | null
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
    s += `<style>@keyframes d${i}{${stops}}</style><circle class="d" cx="120" cy="100" r="10" fill="${COLS[i]}" style="animation-name:d${i};animation-duration:${dur.toFixed(1)}s;animation-delay:${phase(dur, 0)}"/>`
  }
  for (let i = 0; i < 40; i++) {
    const dur = 4.2 + rnd() * 3, off = rnd() * dur
    s += `<rect class="c" x="${Math.floor(rnd() * 240)}" y="-6" width="${rnd() < 0.5 ? 2 : 1}" height="1" fill="${COLS[i % 6]}" style="animation-duration:${dur.toFixed(2)}s;animation-delay:${phase(dur, off)}"/>`
  }
  // Drawn in the town hall's own box (side by side or stacked), clipped to it.
  return `<g class="q${p.inFx ? ' fx' : ''}" style="animation-delay:${(p.from - elapsed).toFixed(3)}s"><svg x="${p.hx}" y="${p.hy}" width="240" height="176">${s}</svg></g>`
}
const PARTY_SIZE = 7600

/** The camera slide: one keyframe per film frame, linear in between (smooth at any refresh rate). */
function camCss(pan: number[] | null, dt: number, motion: Motion): string {
  if (!pan || pan.length < 2 || pan.every(v => v === pan[0])) return ''
  const n = pan.length, stops = pan.map((v, k) => `${+(k / (n - 1) * 100).toFixed(6)}%{transform:translateX(${-v}px)}`).join('')
  return `.cam{animation:cam ${+((n - 1) * dt).toFixed(6)}s linear forwards}@keyframes cam{${stops}}` +
    (motion === 'full' ? '' : `@media (prefers-reduced-motion: reduce){.cam{animation:none;transform:translateX(${-pan[0]!}px)}}`)
}
function assemble(base: string, W: number, H: number, viewW: number, layers: Layer[], party: Party | null, motion: Motion, pan: number[] | null, dt: number): { head: string; baseTag: string; size: number } {
  const a = atlas(layers)
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${viewW * 2}" height="${H * 2}" viewBox="0 0 ${viewW} ${H}"><style>${style(motion)}${camCss(pan, dt, motion)}</style>` +
    (a ? `<defs><image id="a" width="${a.w}" height="${a.h}" href="data:image/png;base64,${a.png}"/></defs>` : '')
  const baseTag = `<image width="${W}" height="${H}" href="data:image/png;base64,${base}"/>`
  // Markup on top of the head: ≈85 characters per box, ≈50 per frame.
  const frames = new Set(layers.map(l => l.t)).size
  return { head, baseTag, size: head.length + baseTag.length + layers.length * 85 + frames * 50 + (party ? PARTY_SIZE : 0) + 80 }
}

/**
 * Films the office ahead for up to `seconds` at `fps` and packs it as an Svg
 * film of at most `limit` characters. The office ends where it started.
 */
export function shoot(o: Office, fps: number, seconds: number, limit: number, motion: Motion, slide = true): Film {
  const dt = 1 / fps
  const layers: Layer[] = []
  let prev: Uint32Array | null = null, base = '', W = 0, H = 0, changed = 0, frames = 0, key0 = '', hallX: number | null = null, hallY = 0
  let fxFrom: number | null = null, cutAt: number | null = null, budgetHit = false
  const count = Math.max(1, Math.round(seconds * fps) + 1)
  // A camera move that keeps the frames within three rooms slides (the frames
  // cover every room it passes and CSS moves the view): up to two rooms with
  // one in view, one with two, none with three. Longer jumps and pinned rooms cut.
  const path = slide ? o.camPath(count, dt) : null
  let strip: { x: number; w: number } | null = null
  if (path && !path.pinned) {
    const lo = Math.min(...path.xs), hi = Math.max(...path.xs)
    if (hi > lo && path.width + hi - lo <= 720) strip = { x: lo, w: path.width + hi - lo }
  }
  const viewW = path ? path.width : 0, offsets: number[] = []
  o.film(count, dt, (k, f, view) => {
    if (k === 0) {
      W = f.width; H = f.height; key0 = view.key; hallX = view.hallX; hallY = view.hallY ?? 0
      base = base64(encodePNG(f.base.data, W, H, false))
      prev = f.base.u32.slice()
    } else {
      if (view.key !== key0) { cutAt = k * dt; return false } // a camera cut or another set of rooms
      const boxes = changeBoxes(prev!, f.base.u32, W, H)
      let add = 0
      for (const b of boxes) add += b.n
      if (changed + add > CHANGE_BUDGET) { budgetHit = true; return false }
      changed += add
      for (const b of boxes) layers.push({ t: k * dt, x: b.x, y: b.y, w: b.w, h: b.h, px: b.px, ax: 0, ay: 0 })
      if (boxes.length) prev!.set(f.base.u32)
    }
    if (f.fx && fxFrom === null) fxFrom = k * dt
    offsets.push(view.camX ?? 0)
    frames = k + 1
    return true
  }, strip ?? true)
  const vw = strip ? viewW : W
  const panOf = (n: number): number[] | null => (strip ? offsets.slice(0, n) : null)
  let party: Party | null = null
  if (fxFrom !== null && motion !== 'reduced' && hallX !== null) {
    party = { hx: hallX, hy: hallY, inFx: motion !== 'full', from: fxFrom }
  }
  // Over the limit after compression: drop the second half of the film until it fits.
  let keep = frames, kept = layers, built = assemble(base, W, H, vw, kept, party, motion, panOf(keep), dt)
  while (built.size > limit && keep > 1) {
    keep = Math.max(1, Math.floor(keep / 2))
    kept = layers.filter(l => l.t < (keep - 0.5) * dt)
    built = assemble(base, W, H, vw, kept, party, motion, panOf(keep), dt)
  }
  return {
    version: o.version, startT: o.simT, seconds: (keep - 1) * dt, dt, cutAt: keep === frames ? cutAt : null,
    width: W, height: H, zoom: o.zoom, head: built.head, layers: kept, party, size: built.size,
    cut: budgetHit || keep < frames, viewW: vw, baseTag: built.baseTag, pan: panOf(keep),
  }
}

/** An Svg's markup drawn at `width` CSS pixels (its height in proportion): the box takes the markup's size, up to the pane. */
export function sized(svg: string, width: number | null): string {
  if (!width) return svg
  const m = /^<svg [^>]*?width="(\d+)" height="(\d+)"/.exec(svg)
  if (!m) return svg
  const w = Math.round(width), h = Math.round((width * +m[2]!) / +m[1]!)
  return svg.replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}"`)
}

/** The film's markup for a moment `elapsed` seconds after its first frame. */
export function filmSvg(f: Film, elapsed: number): string {
  // The camera group: slides when the film pans, else holds its one offset.
  const slides = !!f.pan && f.pan.length > 1 && f.pan.some(v => v !== f.pan![0])
  let s = f.head + (slides ? `<g class="cam" style="animation-delay:${(-elapsed).toFixed(3)}s">` : f.pan && f.pan[0] ? `<g transform="translate(${-f.pan[0]} 0)">` : '<g>') + f.baseTag, t = -1
  // One timed group per frame; each box inside is a window onto the atlas.
  for (const l of f.layers) {
    if (l.t !== t) { s += `${t < 0 ? '' : '</g>'}<g class="p" style="animation-delay:${(l.t - elapsed).toFixed(3)}s">`; t = l.t }
    s += `<svg x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" viewBox="${l.ax} ${l.ay} ${l.w} ${l.h}"><use href="#a"/></svg>`
  }
  if (t >= 0) s += '</g>'
  if (f.party) s += partyMarkup(f.party, f.startT + elapsed, elapsed)
  return s + '</g></svg>'
}
