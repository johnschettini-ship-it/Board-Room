// Run: npx tsx tools/fluid-harness.ts shipped=1 zoom=1   (or zoom=3 pins=1,3,5)
// Measures how fluid the Svg pane is: replays a busy, seeded minute of office
// work, applies the hooks module's film policy (copied from register.tsx
// currentFilm, with knobs), and at 16 samples a second compares what the pane
// would show with what the office really looks like.
//   freeze  = the film ran out while the office was moving (picture holds)
//   wrong   = the shown frame differs from the real one by > 400 px (a stale prediction)
//   jump    = a new film starts > 400 px away from the frame shown just before
import { createOffice } from '../hooks/world.ts'
import { shoot, filmSvg } from '../hooks/stage.ts'

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')))
const P = {
  gate: +(args.gate ?? 1),          // min seconds between event-driven shots
  reshootCut: args.reshootCut === '1', // a film cut short (budget) reshoots at its end, gate or not
  fps: +(args.fps ?? 8),
  seconds: +(args.seconds ?? 2),
  zoom: +(args.zoom ?? 1),
  pins: args.pins ? args.pins.split(',').map(Number) : [],
  seed: +(args.seed ?? 7),
  adaptive: args.adaptive === '1', // film only as far ahead as films have lately been used
  shipped: args.shipped === '1',   // the policy as shipped in register.tsx (overrides the knobs above)
  slide: args.slide !== '0',
}
function mulberry32(a: number) { return () => { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const o: any = createOffice({ random: mulberry32(P.seed), theme: 'night', motion: 'auto', zoom: 1 })
o.setZoom(P.zoom); for (const r of P.pins) o.togglePin(r)
const R = mulberry32(P.seed * 31 + 1)

// ---- a busy minute ----
type Ev = { t: number; f: () => void }
const evs: Ev[] = []
const ROLES = ['research', 'build', 'review', 'design', 'qa'], TOOLS: Record<string, string> = { research: 'Read', build: 'Edit', review: 'Bash', design: 'Write', qa: 'Bash' }
evs.push({ t: 0.5, f: () => { o.startMission('Busy minute'); o.machineStep('main', 'claude-opus-5-5', 'high') } })
evs.push({ t: 3, f: () => o.setCards([{ id: 'a', title: 'Read', role: 'none', status: 'in_progress' }, { id: 'b', title: 'Build', role: 'none', status: 'pending' }]) })
let t = 5, n = 0
while (t < 52) {
  const role = ROLES[Math.floor(R() * ROLES.length)]!, id = `c${n++}`, dur = 0.3 + R() * 3.5, fail = R() < 0.12
  const at = t
  evs.push({ t: at, f: () => { o.toolStart(id, role, TOOLS[role], 'x.ts', { run: 'main' }) } })
  evs.push({ t: at + dur, f: () => { o.toolEnd(id, !fail); if (fail && role === 'qa') o.bug('qa', 'build', 'failing test') } })
  if (R() < 0.15) evs.push({ t: at + 0.2, f: () => { o.machineStepEnd('main'); o.machineStep('main', 'claude-opus-5-5', 'high') } })
  t += 0.4 + R() * 2.1
}
evs.push({ t: 53, f: () => { o.toolStart('ship', 'build', 'Bash', 'git commit', { ship: true, run: 'main' }); o.toolEnd('ship', true) } })
evs.push({ t: 54, f: () => o.turnEnd('answer') })
evs.sort((p, q) => p.t - q.t)

// ---- policy state (register.tsx currentFilm) ----
let horizon = 2, film: any = null, frames: Uint32Array[] = [], lastShot = -Infinity, filmFps = 0, shots = 0, bytes = 0, shootMs = 0
const DIFF = (a: Uint32Array, b: Uint32Array) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d }
const FILM_FPS = [20, 10, 8, 5, 4]
const baseFps = (zoom: number): number => (zoom >= 3 ? 8 : zoom === 2 ? 10 : 20)
const lowerFps = (f: number): number => FILM_FPS.find(x => x < f) ?? 4
const higherFps = (f: number, cap: number): number => Math.min(cap, [...FILM_FPS].reverse().find(x => x > f) ?? cap)
let pans = 0
function maybeShoot(): boolean {
  const idle = o.ticker().phase === 'Idle'
  const elapsed = film ? o.simT - film.startT : 0
  let due: boolean
  if (P.shipped) {
    due = !film || film.zoom !== o.zoom || (film.cutAt !== null && elapsed >= film.cutAt - 1e-6) ||
      (o.simT - lastShot >= 0.25 && (o.version !== film.version || elapsed >= film.seconds - 0.25))
  } else {
    const ranOut = film && elapsed >= film.seconds - 1e-6
    due = !film || film.zoom !== o.zoom ||
      (film.cutAt !== null && elapsed >= film.cutAt - 1e-6) ||
      (P.reshootCut && film.cut && ranOut) ||
      (o.simT - lastShot >= P.gate && o.version !== film.version) ||
      (P.adaptive ? elapsed >= film.seconds - 0.25 : (o.simT - lastShot >= 1 && elapsed >= film.seconds - 0.5))
  }
  if (!due) return false
  if ((P.adaptive || P.shipped) && film) horizon = Math.min(P.seconds, Math.max(0.75, horizon * 0.5 + elapsed * 0.75))
  lastShot = o.simT
  let fps: number
  if (P.shipped) { const base = baseFps(o.zoom); if (!filmFps || filmFps > base) filmFps = base; fps = idle ? lowerFps(filmFps) : filmFps }
  else { if (!filmFps) filmFps = P.fps; fps = idle ? Math.max(2, Math.round(filmFps / 2)) : filmFps }
  const caught: Uint32Array[] = []
  const orig = o.film
  o.film = (c: number, dt: number, cb: any, cut?: any) => orig(c, dt, (k: number, f: any, v: any) => { caught.push(f.base.u32.slice()); return cb(k, f, v) }, cut)
  const t0 = performance.now()
  film = shoot(o, fps, idle ? 6 : (P.adaptive || P.shipped) ? horizon : P.seconds, 131072 - 4096, 'auto', P.slide)
  shootMs += performance.now() - t0
  o.film = orig
  frames = caught.slice(0, Math.round(film.seconds / film.dt) + 1)
  if (film.pan) pans++
  if (P.shipped) { const base = baseFps(o.zoom); filmFps = film.cut ? lowerFps(filmFps) : higherFps(filmFps, base) }
  else filmFps = film.cut ? Math.max(4, Math.round(filmFps / 2)) : Math.min(P.fps, filmFps * 2)
  shots++; bytes += filmSvg(film, 0).length
  return true
}
/** The view part of a (possibly wider, sliding) film frame. */
function viewOf(fr: Uint32Array, k: number): Uint32Array {
  if (!film.pan) return fr
  const VW = film.viewW, W = film.width, H = film.height, off = film.pan[k] ?? 0, out = new Uint32Array(VW * H)
  for (let y = 0; y < H; y++) out.set(fr.subarray(y * W + off, y * W + off + VW), y * VW)
  return out
}

// ---- run: 16 samples a second, the policy at the app's 8 ticks a second ----
const SAMPLE = 1 / 40, END = 62
let aligned = 0, pending: number[] = [], lat: number[] = []
let ei = 0, shown: Uint32Array | null = null, freeze = 0, wrong = 0, jumps = 0, jumpPx = 0, prevTruth: Uint32Array | null = null, k = 0
for (let s = 0; s * SAMPLE < END; s++) {
  const now = s * SAMPLE
  while (ei < evs.length && evs[ei]!.t <= o.simT + 1e-9) { evs[ei++]!.f(); pending.push(o.simT) }
  const fresh = s % 5 === 0 ? maybeShoot() : false
  if (fresh) { for (const te of pending) lat.push(o.simT - te); pending = [] }
  // the ideal picture for the app: now, drawn with the film's camera (cuts, pins)
  let truth: Uint32Array = new Uint32Array(0)
  // a sliding film follows the live camera; a cutting one, the camera's target
  if (film && film.pan) truth = o.render().base.u32.slice()
  else o.film(1, 0, (_k: number, f: any) => { truth = f.base.u32.slice() }, true)
  if (film && frames.length) {
    const raw = (o.simT - film.startT) / film.dt
    const idx = Math.min(frames.length - 1, Math.floor(raw + 1e-6))
    const next = viewOf(frames[idx]!, idx)
    // a snap: a new film replaces a picture that had drifted from the real one
    if (fresh && shown && shown.length === truth.length) { const d = DIFF(shown, truth); if (d > 400) { jumps++; jumpPx += d } }
    const moving = prevTruth && prevTruth.length === truth.length && DIFF(prevTruth, truth) > 40
    if (raw > frames.length - 1 + 0.5 && moving) freeze += SAMPLE
    // stale: at the film's own frame times, the shown frame is not the real one
    const onFrame = Math.abs(raw - Math.round(raw)) < 1e-6
    if (onFrame) { aligned++; if (next.length === truth.length && DIFF(next, truth) > 400) wrong++ }
    shown = next
  }
  prevTruth = truth
  o.advance(SAMPLE)
  k++
}
console.log(JSON.stringify({ policy: P, freezeSeconds: +freeze.toFixed(2), stalePct: Math.round(wrong / Math.max(1, aligned) * 100), latencyAvgMs: Math.round(lat.reduce((a, b) => a + b, 0) / Math.max(1, lat.length) * 1000), latencyP90Ms: Math.round((lat.sort((a, b) => a - b)[Math.floor(lat.length * 0.9)] ?? 0) * 1000), snaps: jumps, avgSnapPx: jumps ? Math.round(jumpPx / jumps) : 0, shots, slidingFilms: pans, kbSent: Math.round(bytes / 1024), kbPerShot: Math.round(bytes / 1024 / shots), cpuMsPerSecond: Math.round(shootMs / END) }))
