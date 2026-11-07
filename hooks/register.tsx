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

/**
 * The office in coloured half blocks for every other terminal: each cell is
 * '▀' with the upper pixel as its foreground and the lower as its background,
 * each pixel the average of the frame area it covers.
 */
function blockCells(o: Office, columns: number): Cells {
  const f = renderFrame(o)
  const rows = Math.max(4, Math.min(256, Math.round((columns * f.height) / f.width / 2)))
  if (cellCache.no === frameNo && cellCache.zoom === o.zoom && cellCache.columns === columns && cellCache.rows === rows) return cellCache
  const W = f.width, H = f.height, src = composite(f), V = rows * 2, n = columns * rows * 3
  if (cellBuf.length !== n) cellBuf = new Uint32Array(n)
  for (let ty = 0; ty < V; ty++) {
    const y0 = Math.floor((ty * H) / V), y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * H) / V))
    for (let tx = 0; tx < columns; tx++) {
      const x0 = Math.floor((tx * W) / columns), x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * W) / columns))
      let r = 0, g = 0, b = 0, c = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0, i = (y * W + x0) * 4; x < x1; x++, i += 4) { r += src[i]!; g += src[i + 1]!; b += src[i + 2]!; c++ }
      }
      const rgb = ((Math.round(r / c) << 16) | (Math.round(g / c) << 8) | Math.round(b / c)) >>> 0
      const cell = ((ty >> 1) * columns + tx) * 3
      if (ty & 1) cellBuf[cell + 2] = rgb
      else { cellBuf[cell] = 0x2580; cellBuf[cell + 1] = rgb }
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

async function showPane($: Engine): Promise<boolean> {
  const r = await $.ui.open({ id: PANE, title: TITLE })
  paneOpen = true
  frameNo++
  return r.isPlaced
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
    if (arg === 'status') return { text: summary(ensureOffice()) }
    const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
    const show = arg === 'show' || arg === 'open' || (arg !== 'hide' && arg !== 'close' && !isOpen)
    if (show) {
      const placed = await showPane($)
      return { text: placed ? 'Digital Workplace pane shown.' : 'Digital Workplace pane opened; it shows once there is room for it.' }
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

  on('tool.call', { tool: 'mcp__digital-workplace__crew_status' }, async () => ({ result: summary(ensureOffice()) }))
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
      let view
      if (pictures) {
        const f = renderFrame(o)
        const columns = Math.max(20, Math.min(255, e.props.bodyColumns))
        const rows = Math.max(6, Math.min(255, Math.round((columns * f.height) / f.width / 2)))
        view = <Image key="view" source={{ png: terminalPng(o) }} columns={columns} rows={rows} alt={alt} />
      } else {
        const c = blockCells(o, Math.max(20, Math.min(512, e.props.bodyColumns)))
        view = <Raster key="view" columns={c.columns} rows={c.rows} cells={c.cells} />
      }
      return (
        <Box flexDirection="column">
          {view}
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
          <Text>{ticker}</Text>
          <Text color={statusColor} dimColor={s.state === 'idle'}>{statusText(s)}</Text>
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
