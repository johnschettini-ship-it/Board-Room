// Digital Workplace: the pixel-art office docked beside the chat, its crew
// acting out Claude's real activity.
//
// Hooks only observe: each one hands the event on with next(e) unchanged, does
// a few microseconds of bookkeeping, and swallows its own errors (plus a
// .catch that replays next), so a fault here never blocks or alters a tool
// call, a prompt or a turn. Frames are painted on a timer, never inside a
// tool call.
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'
import { createOffice } from './world.ts'
import { base64, encodePNG } from './raster.ts'
import { classifyText, routeTool, type Route } from './classify.ts'
import type { Card, Frame, Motion, Office, Sfx, StatusLine, ThemeId } from './types.ts'

const PLUGIN = 'digital-workplace'
const PANE = 'digital-workplace'
const TITLE = 'Digital Workplace'
const SELF_PREFIX = `mcp__${PLUGIN}__`
const SVG_LIMIT = 131072

type Engine = EngineInterface
type TerminalArt = 'auto' | 'blocks' | 'image'
type Options = { openOnStart: boolean; motion: Motion; theme: 'auto' | ThemeId; frameRate: number; terminalArt: TerminalArt }
type Cells = { no: number; zoom: number; columns: number; rows: number; cells: string }
type TrackedCard = Card & { seen: number }
type Encoded = { no: number; zoom: number; svg: string; png: string; width: number; height: number; sizes: [number, number] }

// ---- module state (a reload starts it over; the pane itself stays open) ----
let opts: Options = { openOnStart: true, motion: 'auto', theme: 'auto', frameRate: 8, terminalArt: 'auto' }
let office: Office | null = null
let paneOpen = false
let started = false
let busy = false
let lastTick = 0
let frameNo = 0
let soundOn = false
let soundBroken = false
let loopStop: AbortController | null = null
let missionNo = 0
let callSeq = 0
let todoCards: TrackedCard[] = []
const taskCards = new Map<string, TrackedCard>()
const sfxQueue: Sfx[] = []
const sprites = new Map<string, string>()
let cache: Encoded = { no: -1, zoom: 0, svg: '', png: '', width: 240, height: 176, sizes: [0, 0] }
let lastPixels: Uint32Array | null = null
let lastHadFx = false
let rendered: { no: number; zoom: number; frame: Frame } | null = null
let termPng = { no: -1, zoom: 0, png: '' }
let cellCache: Cells = { no: -1, zoom: 0, columns: 0, rows: 0, cells: '' }
let cellBuf = new Uint32Array(0)
let composed = new Uint8ClampedArray(0)
/** What this terminal can draw: pictures (kitty, Ghostty), pictures in fullscreen (iTerm2), or blocks. */
let termArt: 'image' | 'iterm' | 'blocks' = 'blocks'

function themeFor(t: Options['theme']): ThemeId {
  if (t !== 'auto') return t
  const hr = new Date().getHours()
  return hr >= 7 && hr < 17 ? 'day' : hr >= 17 && hr < 20 ? 'sunset' : 'night'
}

function ensureOffice(): Office {
  if (!office) {
    office = createOffice({
      theme: themeFor(opts.theme),
      motion: opts.motion,
      zoom: 1,
      onSfx: kind => { if (soundOn && sfxQueue.length < 8) sfxQueue.push(kind) },
    })
  }
  return office
}

const mmss = (s: number): string => {
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function statusText(s: StatusLine): string {
  if (s.state === 'running') return `● ${s.name} (${s.role}) · ${s.tool}${s.label ? ` · ${s.label}` : ''} · ${mmss(s.seconds)}`
  if (s.state === 'finished') return `○ ${s.name} (${s.role}) · ${s.tool}${s.label ? ` · ${s.label}` : ''} · took ${mmss(s.seconds)}`
  return '○ Crew idle'
}

// ---- plan cards ----
function openCards(): Card[] {
  const all = [...todoCards, ...taskCards.values()]
  return all.filter(c => c.status !== 'completed' || c.seen === missionNo).map(({ id, title, role, status }) => ({ id, title, role, status }))
}
function asStatus(v: unknown): Card['status'] {
  return v === 'completed' || v === 'in_progress' ? v : 'pending'
}
function planBefore(tool: string, input: Record<string, unknown>): boolean {
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    todoCards = (input.todos as { content?: unknown; status?: unknown }[]).slice(0, 24).map((t, i) => {
      const title = String(t?.content ?? '')
      return { id: `todo-${i}`, title, role: classifyText(title), status: asStatus(t?.status), seen: missionNo }
    })
    return true
  }
  if (tool === 'TaskUpdate' && typeof input.taskId === 'string') {
    if (input.status === 'deleted') return taskCards.delete(input.taskId)
    const c = taskCards.get(input.taskId)
    const title = typeof input.subject === 'string' ? input.subject : c?.title ?? `Task ${input.taskId}`
    taskCards.set(input.taskId, { id: `task-${input.taskId}`, title, role: c && title === c.title ? c.role : classifyText(title), status: input.status ? asStatus(input.status) : c?.status ?? 'pending', seen: missionNo })
    return true
  }
  return false
}
function planAfter(tool: string, input: Record<string, unknown>, result: unknown): boolean {
  const r = (result ?? {}) as Record<string, unknown>
  if (tool === 'TaskCreate') {
    const task = (r.task ?? {}) as { id?: unknown; subject?: unknown }
    const id = String(task.id ?? `local-${taskCards.size + 1}`)
    const title = String(task.subject ?? input.subject ?? '')
    taskCards.set(id, { id: `task-${id}`, title, role: classifyText(`${title} ${String(input.description ?? '')}`), status: 'pending', seen: missionNo })
    return true
  }
  if (tool === 'TaskList' && Array.isArray(r.tasks)) {
    for (const t of r.tasks as { id?: unknown; subject?: unknown; status?: unknown }[]) {
      const id = String(t.id ?? '')
      if (!id) continue
      const prev = taskCards.get(id)
      const title = String(t.subject ?? prev?.title ?? '')
      taskCards.set(id, { id: `task-${id}`, title, role: prev?.role ?? classifyText(title), status: asStatus(t.status), seen: prev?.seen ?? missionNo })
    }
    return true
  }
  return false
}

// ---- tool calls ----
/** Starts the crew on a call; true when an activity was opened that must be closed. */
function before(route: Route, tool: string, input: Record<string, unknown>, id: string): boolean {
  const o = ensureOffice()
  let opened = false
  if (route.kind === 'launch') o.handoff('lead', route.role, 'handoff', route.title)
  else if (route.kind === 'work') { o.toolStart(id, route.role, tool, route.label); opened = true }
  try { if (planBefore(tool, input)) o.setCards(openCards()) } catch { /* a malformed plan draws no cards */ }
  return opened
}
function after(route: Route, tool: string, input: Record<string, unknown>, ran: ToolCallResult): void {
  const o = ensureOffice()
  const failed = ran.deny !== undefined || ran.isError === true
  if (route.kind === 'work' && route.isCheck && ran.isError === true) o.bug('qa', 'build', /test|spec|jest|vitest|pytest|mocha/i.test(route.label) ? 'failing test' : 'failing check')
  if (!failed && planAfter(tool, input, ran.result)) o.setCards(openCards())
}

// ---- drawing ----
/** One paint per frame, shared by every surface that draws it. */
function renderFrame(o: Office): Frame {
  if (rendered && rendered.no === frameNo && rendered.zoom === o.zoom) return rendered.frame
  const frame = o.render()
  rendered = { no: frameNo, zoom: o.zoom, frame }
  return frame
}

/** The frame with its motion layer laid over it, for terminals (no media queries there). */
function composite(f: Frame): Uint8ClampedArray {
  if (!f.fx || opts.motion === 'reduced') return f.base.data
  if (composed.length !== f.base.data.length) composed = new Uint8ClampedArray(f.base.data.length)
  const b = new Uint32Array(f.base.data.buffer), x = new Uint32Array(f.fx.data.buffer), o = new Uint32Array(composed.buffer)
  for (let i = 0; i < o.length; i++) o[i] = x[i]! >>> 24 ? x[i]! : b[i]!
  return composed
}

/** PNG for terminals that show pictures (kitty, Ghostty, iTerm2). */
function terminalPng(o: Office): string {
  if (termPng.no === frameNo && termPng.zoom === o.zoom && termPng.png) return termPng.png
  const f = renderFrame(o)
  const png = f.fx ? base64(encodePNG(composite(f), f.width, f.height, false)) : encodeFrame(o).png
  termPng = { no: frameNo, zoom: o.zoom, png }
  return png
}

// Quadrant glyphs by mask (bit 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right
// set = foreground). All are width-1 BMP block elements.
const QUAD = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588]
const sampleBuf = new Uint32Array(4096)

/** The most common colour in a frame area: flat pixel-art colours, never muddy blends. */
function dominant(src: Uint32Array, W: number, x0: number, x1: number, y0: number, y1: number): number {
  let n = 0
  for (let y = y0; y < y1; y++) for (let x = x0, i = y * W + x0; x < x1 && n < sampleBuf.length; x++, i++) sampleBuf[n++] = src[i]! & 0xffffff
  if (n === 1) return sampleBuf[0]!
  const a = sampleBuf.subarray(0, n).sort()
  let best = a[0]!, bestRun = 0, run = 0
  for (let k = 0; k < n; k++) {
    run = k > 0 && a[k] === a[k - 1] ? run + 1 : 1
    if (run > bestRun) { bestRun = run; best = a[k]! }
  }
  return best
}
const dist2 = (p: number, q: number): number => {
  const dr = ((p >> 16) & 255) - ((q >> 16) & 255), dg = ((p >> 8) & 255) - ((q >> 8) & 255), db = (p & 255) - (q & 255)
  return dr * dr + dg * dg + db * db
}

/**
 * The office in quarter blocks for every other terminal: each cell holds 2x2
 * samples (the dominant colour of the area each covers) drawn with the block
 * glyph and the two colours that fit them best, both taken from the art.
 */
function blockCells(o: Office, columns: number): Cells {
  const f = renderFrame(o)
  const rows = Math.max(4, Math.min(256, Math.round((columns * f.height) / f.width / 2)))
  if (cellCache.no === frameNo && cellCache.zoom === o.zoom && cellCache.columns === columns && cellCache.rows === rows) return cellCache
  const W = f.width, H = f.height, comp = composite(f)
  const src = new Uint32Array(comp.buffer, comp.byteOffset, comp.length / 4)
  // Pixels are little-endian RGBA; repack each sample as 0xRRGGBB.
  const rgb = (v: number): number => ((v & 255) << 16) | (v & 0xff00) | ((v >> 16) & 255)
  const GX = columns * 2, GY = rows * 2, n = columns * rows * 3
  if (cellBuf.length !== n) cellBuf = new Uint32Array(n)
  const q = [0, 0, 0, 0]
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < columns; cx++) {
      for (let k = 0; k < 4; k++) {
        const gx = cx * 2 + (k & 1), gy = ry * 2 + (k >> 1)
        const x0 = Math.floor((gx * W) / GX), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * W) / GX))
        const y0 = Math.floor((gy * H) / GY), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * H) / GY))
        q[k] = rgb(dominant(src, W, x0, x1, y0, y1))
      }
      // Try every split of the four samples into two groups; each group is
      // painted with the one of its own samples that fits the group best.
      let bestErr = Infinity, bestMask = 0, fg = q[0]!, bg = q[0]!
      for (let m = 0; m < 8; m++) {
        let err = 0, cf = q[0]!, cb = q[0]!
        for (const set of [m, ~m & 15]) {
          let pick = -1, pickErr = Infinity
          for (let a = 0; a < 4; a++) {
            if (!(set >> a & 1)) continue
            let e = 0
            for (let b = 0; b < 4; b++) if (set >> b & 1) e += dist2(q[a]!, q[b]!)
            if (e < pickErr) { pickErr = e; pick = a }
          }
          if (pick < 0) continue
          err += pickErr
          if (set === m) cf = q[pick]!
          else cb = q[pick]!
        }
        if (err < bestErr) { bestErr = err; bestMask = m; fg = cf; bg = cb }
      }
      const cell = (ry * columns + cx) * 3
      cellBuf[cell] = bestMask ? QUAD[bestMask]! : 0x2588 // one colour: a full block in it
      cellBuf[cell + 1] = bestMask ? fg : bg
      cellBuf[cell + 2] = bg
    }
  }
  cellCache = { no: frameNo, zoom: o.zoom, columns, rows, cells: base64(new Uint8Array(cellBuf.buffer, 0, n * 4)) }
  return cellCache
}

async function detectTerminal($: Engine): Promise<void> {
  if (opts.terminalArt !== 'auto') { termArt = opts.terminalArt; return }
  const [term, program, kitty, tmux, lcTerminal] = await Promise.all([
    $.env.get('TERM'), $.env.get('TERM_PROGRAM'), $.env.get('KITTY_WINDOW_ID'), $.env.get('TMUX'), $.env.get('LC_TERMINAL'),
  ])
  if (tmux) termArt = 'blocks' // pictures need tmux passthrough, which is off by default
  else if (kitty || /kitty|ghostty/i.test(term ?? '') || /ghostty/i.test(program ?? '')) termArt = 'image'
  else if (/iterm/i.test(program ?? '') || /iterm/i.test(lcTerminal ?? '')) termArt = 'iterm'
  else termArt = 'blocks'
}

function encodeFrame(o: Office): Encoded {
  if (cache.no === frameNo && cache.zoom === o.zoom && cache.svg) return cache
  const f = renderFrame(o)
  // A quiet room repeats frames: skip the encode when no pixel changed.
  const px = f.base.u32
  if (cache.svg && !f.fx && !lastHadFx && lastPixels && lastPixels.length === px.length && cache.width === f.width) {
    let same = true
    for (let i = 0; i < px.length; i++) if (px[i] !== lastPixels[i]) { same = false; break }
    if (same) { cache = { ...cache, no: frameNo, zoom: o.zoom }; return cache }
  }
  if (lastPixels && lastPixels.length === px.length) lastPixels.set(px)
  else lastPixels = px.slice()
  lastHadFx = !!f.fx
  const png = base64(encodePNG(f.base.data, f.width, f.height, false))
  let fx = f.fx ? base64(encodePNG(f.fx.data, f.width, f.height, true)) : ''
  const shell = (body: string): string =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f.width * 2}" height="${f.height * 2}" viewBox="0 0 ${f.width} ${f.height}">` +
    '<style>image{image-rendering:crisp-edges;image-rendering:pixelated}@media (prefers-reduced-motion: reduce){.fx{display:none}}</style>' +
    `<image width="${f.width}" height="${f.height}" href="data:image/png;base64,${png}"/>${body}</svg>`
  let svg = shell(fx ? `<image class="fx" width="${f.width}" height="${f.height}" href="data:image/png;base64,${fx}"/>` : '')
  if (svg.length > SVG_LIMIT) { fx = ''; svg = shell('') }
  cache = { no: frameNo, zoom: o.zoom, svg, png, width: f.width, height: f.height, sizes: [png.length, fx.length] }
  return cache
}

function spriteSvg(o: Office, id: string): string {
  let s = sprites.get(id)
  if (!s) {
    const px = o.crewSprite(id)
    s = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="40" viewBox="0 0 13 20"><style>image{image-rendering:crisp-edges;image-rendering:pixelated}</style>' +
      `<image width="13" height="20" href="data:image/png;base64,${base64(encodePNG(px.data, 13, 20, true))}"/></svg>`
    sprites.set(id, s)
  }
  return s
}

function playSfx($: Engine, kind: Sfx): void {
  if (!soundOn || soundBroken) return
  void $.audio.play({ asset: `sounds/${kind}.wav` }).catch(() => {})
}
function setSound($: Engine, on: boolean): void {
  soundOn = on
  loopStop?.abort()
  loopStop = null
  if (!on) return
  const stop = new AbortController()
  loopStop = stop
  void $.audio.play({ asset: 'sounds/loop.wav' }, { shouldLoop: true, gain: 0.6, signal: stop.signal }).catch(() => {
    if (stop.signal.aborted) return
    soundBroken = true
    soundOn = false
    $.ui.invalidate('ui.render')
  })
}

async function tick($: Engine): Promise<void> {
  if (busy) return
  busy = true
  try {
    const now = await $.clock.now()
    const dt = lastTick ? (now - lastTick) / 1000 : 0
    lastTick = now
    const o = ensureOffice()
    o.advance(dt)
    if (opts.theme === 'auto' && frameNo % 240 === 0) o.setTheme(themeFor('auto'))
    while (sfxQueue.length) playSfx($, sfxQueue.shift()!)
    frameNo++
    if (paneOpen) $.ui.invalidate('ui.render')
  } catch {
    // A failed frame is skipped; the next tick tries again.
  } finally {
    busy = false
  }
}

let lastOpenReason = ''
async function showPane($: Engine): Promise<boolean> {
  const r = await $.ui.open({ id: PANE, title: TITLE })
  paneOpen = true
  frameNo++
  lastOpenReason = r.isPlaced ? '' : r.reason
  return r.isPlaced
}

/** Where the engine says the pane is, and why it is not drawn when it is not. */
async function paneReport($: Engine): Promise<string> {
  const pane = (await $.ui.panes()).find(p => p.id === PANE)
  if (!pane) return 'Pane: closed. Run /workplace to show it.'
  const state = `Pane: open · shown ${pane.isShown ? 'yes' : 'no'} · placed ${pane.isPlaced ? 'yes' : 'no'}`
  if (pane.isPlaced) return state
  if (!lastOpenReason) { const r = await $.ui.open({ id: PANE, title: TITLE }); lastOpenReason = r.isPlaced ? '' : r.reason }
  return lastOpenReason ? `${state} · engine says: ${lastOpenReason}` : state
}

function summary(o: Office): string {
  const s = o.snapshot()
  const status = new Map(o.crew().map(c => [c.id, c.status]))
  return [
    `Phase: ${s.ticker.phase}${s.title ? ` · "${s.title}"` : ''} · ${s.ticker.clock}`,
    `Status: ${statusText(s.status)}`,
    ...s.agents.map(a => `${a.name} (${a.role}): ${status.get(a.id) ?? a.state} · ${a.room}${a.bubble ? ` · bubble ${a.bubble}` : ''}${a.duet ? ` · duet ${a.duet.giver}->${a.duet.taker} (${a.duet.kind})` : ''}`),
    `Cards: ${s.cards.length ? s.cards.map(c => `[${c.state}] ${c.title} -> ${c.role}`).join('; ') : 'none'}`,
    `View: ${s.view.room}, ${s.view.zoom} room(s), auto camera ${s.view.autoCam ? 'on' : 'off'} · pane ${paneOpen ? 'open' : 'hidden'}`,
    'Recent:',
    ...s.log.slice(-8).map(l => `  ${s.simT - l.t < 0.05 ? 'now' : `${(s.simT - l.t).toFixed(1)}s ago`} · ${l.text}`),
  ].join('\n')
}

export const register: Register = (on, options) => {
  opts = {
    openOnStart: options.openOnStart !== false,
    motion: options.motion === 'reduced' || options.motion === 'full' ? options.motion : 'auto',
    theme: options.theme === 'night' || options.theme === 'sunset' || options.theme === 'day' ? options.theme : 'auto',
    frameRate: typeof options.frameRate === 'number' ? options.frameRate : 8,
    terminalArt: options.terminalArt === 'blocks' || options.terminalArt === 'image' ? options.terminalArt : 'auto',
  }

  on('session.start', async ($, e, next) => {
    try {
      ensureOffice()
      try { await detectTerminal($) } catch { termArt = 'blocks' }
      await $.command.register({ name: 'workplace', description: 'Show or hide the Digital Workplace pane (show, hide, status)', argumentHint: '[show|hide|status]', immediate: true })
      await $.tool.register({
        name: 'crew_status',
        description: 'Digital Workplace: report what the office crew is doing right now (phase, who works on which tool, duets, plan cards). Read-only.',
        inputSchema: { type: 'object', properties: {} },
      })
      if (!started) {
        started = true
        const ms = Math.round(1000 / Math.min(10, Math.max(2, opts.frameRate)))
        $.clock.every(ms, () => void tick($))
      }
      paneOpen = (await $.ui.panes()).some(p => p.id === PANE)
      if (!paneOpen && opts.openOnStart) await showPane($)
    } catch {
      // The office is optional: Claude Code carries on without it.
    }
    return next(e)
  })

  on('command.run', { command: 'workplace' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'status') return { text: `${summary(ensureOffice())}\n${await paneReport($)}` }
    // A bare /workplace hides the pane only when it is really on screen; an
    // open pane on a hidden tab, or one waiting for room, is brought forward.
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    const onScreen = !!pane && pane.isShown && pane.isPlaced
    const show = arg === 'show' || arg === 'open' || (arg !== 'hide' && arg !== 'close' && !onScreen)
    if (show) {
      const placed = await showPane($)
      return { text: placed ? 'Digital Workplace pane shown.' : `Digital Workplace pane opened but not drawn yet. Engine says: ${lastOpenReason}` }
    }
    paneOpen = false
    await $.ui.close({ id: PANE })
    return { text: 'Digital Workplace pane hidden. Run /workplace to show it again.' }
  })

  on('ui.close', { id: PANE }, ($, e, next) => {
    paneOpen = false
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', ($, e, next) => {
    try {
      if (!e.isMeta && !e.command && e.text.trim()) {
        missionNo++
        const o = ensureOffice()
        o.startMission(e.text)
        const open = openCards()
        if (open.length) o.setCards(open)
        frameNo++
      }
    } catch {
      // never in the way of a prompt
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__digital-workplace__crew_status' }, async $ => ({ result: `${summary(ensureOffice())}\n${await paneReport($)}` }))
    .catch(($, e, next) => (next.called ? next(e) : { result: 'The Digital Workplace status is not available right now.' }))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const id = e.tool_use_id ?? `call-${++callSeq}`
    let route: Route = { kind: 'ignore' }
    let opened = false
    try {
      route = routeTool(tool, input, SELF_PREFIX)
      opened = before(route, tool, input, id)
    } catch { /* never in the way of a tool */ }
    let ok = false
    try {
      const ran = await next(e)
      ok = ran.deny === undefined && ran.isError !== true
      try { after(route, tool, input, ran) } catch { /* never in the way of a tool */ }
      return ran
    } finally {
      // Runs on success, failure and abort alike, so no crew member is left working.
      if (opened) { try { ensureOffice().toolEnd(id, ok) } catch { /* ignore */ } }
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', ($, e, next) => {
    try {
      if (!e.agentId) ensureOffice().turnEnd(e.reason)
    } catch {
      // never in the way of a turn
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    const o = ensureOffice()
    const t = o.ticker()
    const s = o.statusLine()
    const rooms = o.rooms()
    const crew = o.crew()
    const here = rooms.find(r => r.current)?.name ?? ''
    const alt = `Digital Workplace office, ${here} in view. ${statusText(s).slice(2)}`
    const redraw = (): void => { frameNo++; $.ui.invalidate('ui.render') }
    const beat = ['▪▫▫▫', '▫▪▫▫', '▫▫▪▫', '▫▫▫▪'][t.beat] ?? '▫▫▫▫'
    const ticker = `${t.phase}  ${beat}${t.total ? `  ${t.done}/${t.total} cards` : ''}  Duets ${t.duets}  ${t.clock}`
    const statusColor = s.state === 'idle' ? undefined : s.color

    if (e.surface === 'terminal') {
      const { Box, Text, Button, Image, Raster } = $.ui.resolve(e)
      const pictures = termArt === 'image' || (termArt === 'iterm' && e.viewport?.isFullscreen === true)
      // Fit the office to the pane: leave two rows under it for the status
      // line and the ticker, and keep its shape by narrowing it if needed.
      const f = renderFrame(o)
      const maxRows = Math.max(6, (e.props.scroll?.bodyRows ?? 40) - 2)
      const fitCols = Math.floor((maxRows * 2 * f.width) / f.height)
      const columns = Math.max(20, Math.min(pictures ? 255 : 512, e.props.bodyColumns, fitCols))
      let view
      if (pictures) {
        const rows = Math.max(6, Math.min(255, Math.round((columns * f.height) / f.width / 2)))
        view = <Image key="view" source={{ png: terminalPng(o) }} columns={columns} rows={rows} alt={alt} />
      } else {
        const c = blockCells(o, columns)
        view = <Raster key="view" columns={c.columns} rows={c.rows} cells={c.cells} />
      }
      return (
        <Box flexDirection="column">
          {view}
          <Text color={statusColor} dimColor={s.state === 'idle'}>{statusText(s)}</Text>
          <Text>{ticker}</Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button key="prev" label="‹" dimColor={!o.canPrev()} onPress={() => { o.prevRoom(); redraw() }} />
            {rooms.map(r => (
              <Button key={`room-${r.index}`} variant={r.current ? 'primary' : undefined} onPress={() => { o.goRoom(r.index); redraw() }}>
                {r.name}{r.agents.map(a => <Text color={a.color}>■</Text>)}
              </Button>
            ))}
            <Button key="next" label="›" dimColor={!o.canNext()} onPress={() => { o.nextRoom(); redraw() }} />
          </Box>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            {[1, 2, 3].map(z => <Button key={`zoom-${z}`} label={String(z)} variant={o.zoom === z ? 'primary' : undefined} onPress={() => { o.setZoom(z); redraw() }} />)}
            <Button key="cam" label="Auto camera" variant={o.autoCam ? 'primary' : undefined} onPress={() => { o.setAutoCam(!o.autoCam); redraw() }} />
            <Button key="sound" label={soundBroken ? 'No audio here' : soundOn ? 'Sound on' : 'Sound off'} variant={soundOn ? 'primary' : undefined} onPress={() => { if (!soundBroken) setSound($, !soundOn); redraw() }} />
          </Box>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {crew.map(c => (
              <Box key={`card-${c.id}`} flexDirection="column" width={26}>
                <Button key={`crew-${c.id}`} variant={c.selected ? 'primary' : undefined} onPress={() => { o.toggleFollow(c.id); redraw() }}>
                  <Text color={c.color} bold>{c.name}</Text> <Text dimColor>{c.roleLabel}</Text>
                </Button>
                <Text dimColor wrap="truncate-end">{c.status}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const f = encodeFrame(o)
    return (
      <Box flexDirection="column" gap={1}>
        <Svg source={f.svg} alt={alt} />
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          <Button key="prev" label="‹" dimColor={!o.canPrev()} onPress={() => { o.prevRoom(); redraw() }} />
          {rooms.map(r => (
            <Button key={`room-${r.index}`} variant={r.current ? 'primary' : undefined} onPress={() => { o.goRoom(r.index); redraw() }}>
              {r.name} {r.agents.map(a => <Text color={a.color}>■</Text>)}
            </Button>
          ))}
          <Button key="next" label="›" dimColor={!o.canNext()} onPress={() => { o.nextRoom(); redraw() }} />
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1} alignItems="center">
          <Text dimColor>Rooms in view</Text>
          {[1, 2, 3].map(z => <Button key={`zoom-${z}`} label={String(z)} variant={o.zoom === z ? 'primary' : undefined} onPress={() => { o.setZoom(z); redraw() }} />)}
          <Button key="cam" label="Auto camera" variant={o.autoCam ? 'primary' : undefined} onPress={() => { o.setAutoCam(!o.autoCam); redraw() }} />
          <Button key="sound" label={soundBroken ? 'No audio here' : soundOn ? 'Sound on' : 'Sound off'} variant={soundOn ? 'primary' : undefined} onPress={() => { if (!soundBroken) setSound($, !soundOn); redraw() }} />
        </Box>
        <Text mono size="footnote">{ticker}</Text>
        <Text mono size="footnote" color={statusColor} dimColor={s.state === 'idle'}>{statusText(s)}</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {crew.map(c => (
            <Box key={`card-${c.id}`} flexDirection="row" gap={1} width="48%" alignItems="flex-start">
              <Svg source={spriteSvg(o, c.id)} alt={`${c.name}, ${c.roleLabel}`} width={26} height={40} />
              <Box flexDirection="column" flexShrink={1}>
                <Button key={`crew-${c.id}`} variant={c.selected ? 'primary' : undefined} onPress={() => { o.toggleFollow(c.id); redraw() }}>
                  <Text color={c.color} bold>{c.name}</Text> <Text dimColor>{c.roleLabel}</Text>
                </Button>
                <Text size="footnote" dimColor wrap="truncate-end">{c.status}</Text>
                <Text size="caption" dimColor>{`${c.done} done`}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
