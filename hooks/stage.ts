// The office for surfaces that draw Svg (desktop, mobile, VS Code), as a short
// film: one base frame, then one layer per later frame that holds only the
// pixels that changed (the rest transparent). All layers share one atlas PNG
// and CSS reveals each at its time, so the client plays the film with no
// further messages. A re-render only moves the start offset, so the film
// resumes in phase (docs/design-panel/facts.md: CSS with negative delays
// resumes after a markup change; SMIL restarts, so it is not used).
//
// The office films itself ahead of time and then rewinds (world.ts film()),
// and a tape of its random draws makes the live run match the film until the
// next outside event. Confetti and disco lights are decoration, so they are a
// small CSS overlay, not pixels: per-pixel confetti would fill the budget in
// a fraction of a second.
import { base64, encodePNG } from './raster.ts'
import type { Motion, Office } from './types.ts'

/** Changed pixels per film before it is cut short (a full room is 42,240). */
const CHANGE_BUDGET = 45000

type Layer = { t: number; x: number; y: number; w: number; h: number; px: Uint8Array; ay: number }

export type Film = {
  /** office.version when filmed: a later outside event makes the film a guess. */
  version: number
  /** office.simT of the first frame. */
  startT: number
  /** Seconds the film covers (its last frame holds after that). */
  seconds: number
  /** Seconds between frames. */
  dt: number
  width: number
  height: number
  zoom: number
  head: string
  layers: Layer[]
  /** Confetti and disco markup, or ''. */
  party: string
  /** Characters of everything but the per-render delays. */
  size: number
  /** True when the change budget or the size limit ended the film early. */
  cut: boolean
}

/**
 * The pixels of `cur` that differ from `prev`, inside their bounding box, with
 * every unchanged pixel transparent; null when nothing changed.
 */
function changeLayer(prev: Uint32Array, cur: Uint32Array, W: number, H: number): { x: number; y: number; w: number; h: number; n: number; px: Uint8Array } | null {
  let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0
  for (let y = 0; y < H; y++) for (let x = 0, i = y * W; x < W; x++, i++) {
    if (prev[i] !== cur[i]) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  }
  if (x1 < 0) return null
  const w = x1 - x0 + 1, h = y1 - y0 + 1, px = new Uint8Array(w * h * 4), out = new Uint32Array(px.buffer)
  for (let r = 0; r < h; r++) for (let c = 0, i = (y0 + r) * W + x0, o = r * w; c < w; c++, i++, o++) {
    if (prev[i] !== cur[i]) out[o] = cur[i]! | 0xff000000
  }
  return { x: x0, y: y0, w, h, n, px }
}

/** Stacks the layers into one transparent atlas; sets each layer's ay. */
function atlas(layers: Layer[]): { w: number; h: number; png: string } | null {
  if (!layers.length) return null
  const w = Math.max(...layers.map(l => l.w))
  let h = 0
  for (const l of layers) { l.ay = h; h += l.h }
  const buf = new Uint8Array(w * h * 4)
  for (const l of layers) for (let r = 0; r < l.h; r++) buf.set(l.px.subarray(r * l.w * 4, (r + 1) * l.w * 4), ((l.ay + r) * w) * 4)
  return { w, h, png: base64(encodePNG(buf, w, h, true)) }
}

const STYLE =
  'image{image-rendering:crisp-edges;image-rendering:pixelated}' +
  '.p{opacity:0;animation:on 1ms forwards}@keyframes on{to{opacity:1}}' +
  '.c{shape-rendering:crispEdges;animation:cf linear infinite}@keyframes cf{50%{transform:translate(5px,92px)}to{transform:translate(0,184px)}}' +
  '.d{mix-blend-mode:screen;opacity:.16;shape-rendering:crispEdges;animation:linear infinite}' +
  '@media (prefers-reduced-motion: reduce){.fx{display:none}.p{animation:none}}'

/** Falling confetti and five roaming disco lights over the town hall, from x = hx. */
function partyMarkup(hx: number, H: number, inFx: boolean, seed: number): string {
  const COLS = ['#f4b942', '#5ec8e5', '#f27fb2', '#78d98e', '#b08cf5', '#ff9b5c']
  let r = seed >>> 0
  const rnd = (): number => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296 }
  let s = ''
  for (let i = 0; i < 5; i++) {
    // A Lissajous path like the page's (cos t*1.1, sin t*1.7), sampled into 9 stops.
    const stops = Array.from({ length: 9 }, (_, k) => {
      const t = (k / 8) * Math.PI * 2 + i * 1.3
      return `${Math.round((k / 8) * 100)}%{transform:translate(${Math.round(Math.cos(t * 1.1 + i) * 80)}px,${Math.round(Math.sin(t * 1.7 + i * 2) * 30)}px)}`
    }).join('')
    s += `<style>@keyframes d${i}{${stops}}</style><circle class="d" cx="${hx + 120}" cy="100" r="10" fill="${COLS[i]}" style="animation-name:d${i};animation-duration:${(7 + i * 0.6).toFixed(1)}s"/>`
  }
  for (let i = 0; i < 40; i++) {
    const dur = 4.2 + rnd() * 3
    s += `<rect class="c" x="${hx + Math.floor(rnd() * 240)}" y="-6" width="${rnd() < 0.5 ? 2 : 1}" height="1" fill="${COLS[i % 6]}" style="animation-duration:${dur.toFixed(2)}s;animation-delay:-${(rnd() * dur).toFixed(2)}s"/>`
  }
  return inFx ? `<g class="fx">${s}</g>` : `<g>${s}</g>`
}

function assemble(base: string, W: number, H: number, layers: Layer[], party: string): { head: string; size: number } {
  const a = atlas(layers)
  const head =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H * 2}" viewBox="0 0 ${W} ${H}"><style>${STYLE}</style>` +
    (a ? `<defs><image id="a" width="${a.w}" height="${a.h}" href="data:image/png;base64,${a.png}"/></defs>` : '') +
    `<image width="${W}" height="${H}" href="data:image/png;base64,${base}"/>`
  // ≈125 characters of markup per layer on top of the head.
  return { head, size: head.length + layers.length * 125 + party.length + 10 }
}

/**
 * Films the office ahead for up to `seconds` at `fps` and packs it as an Svg
 * film of at most `limit` characters. The office ends where it started.
 */
export function shoot(o: Office, fps: number, seconds: number, limit: number, motion: Motion): Film {
  const dt = 1 / fps
  const layers: Layer[] = []
  let prev: Uint32Array | null = null, base = '', W = 0, H = 0, changed = 0, frames = 0, party = false, cam0 = 0
  const count = Math.max(1, Math.round(seconds * fps) + 1)
  o.film(count, dt, (k, f, camX) => {
    if (k === 0) {
      W = f.width; H = f.height; cam0 = camX
      base = base64(encodePNG(f.base.data, W, H, false))
      prev = f.base.u32.slice()
    } else {
      const l = changeLayer(prev!, f.base.u32, W, H)
      if (l) {
        if (changed + l.n > CHANGE_BUDGET) return false
        changed += l.n
        layers.push({ t: k * dt, x: l.x, y: l.y, w: l.w, h: l.h, px: l.px, ay: 0 })
        prev!.set(f.base.u32)
      }
    }
    if (f.fx) party = true
    frames = k + 1
    return true
  })
  let partyHtml = ''
  if (party && motion !== 'reduced') {
    const hall = o.rooms().findIndex(r => r.name === 'Town hall')
    partyHtml = partyMarkup(hall * 240 - cam0, H, motion !== 'full', Math.floor(o.simT * 10))
  }
  // Over the limit after compression: drop the second half of the film until it fits.
  let keep = frames, built = assemble(base, W, H, layers, partyHtml)
  while (built.size > limit && keep > 1) {
    keep = Math.max(1, Math.floor(keep / 2))
    built = assemble(base, W, H, layers.filter(l => l.t < (keep - 0.5) * dt), partyHtml)
  }
  return {
    version: o.version, startT: o.simT, seconds: (keep - 1) * dt, dt, width: W, height: H, zoom: o.zoom,
    head: built.head, layers: layers.filter(l => l.t < (keep - 0.5) * dt), party: partyHtml, size: built.size,
    cut: keep < count,
  }
}

/** The film's markup for a moment `elapsed` seconds after its first frame. */
export function filmSvg(f: Film, elapsed: number): string {
  let s = f.head
  for (const l of f.layers) {
    s += `<svg class="p" style="animation-delay:${(l.t - elapsed).toFixed(3)}s" x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" viewBox="0 ${l.ay} ${l.w} ${l.h}"><use href="#a"/></svg>`
  }
  return s + f.party + '</svg>'
}
