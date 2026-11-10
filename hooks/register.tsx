// Digital Workplace: the pixel-art office docked beside the chat, its crew
// acting out Claude's real activity.
//
// Hooks only observe: each one hands the event on with next(e) unchanged, does
// a few microseconds of bookkeeping, and swallows its own errors (plus a
// .catch that replays next), so a fault here never blocks or alters a tool
// call, a prompt or a turn. Frames are painted on a timer, never inside a
// tool call.
import type { Elements, EngineInterface, Register, ToolCallResult } from 'claude-code'
import { createOffice } from './world.ts'
import { base64, encodePNG } from './raster.ts'
import { filmSvg, shoot, sized, type Film } from './stage.ts'
import { routeTool, type Route } from './classify.ts'
import type { Card, CardInfo, ContextInfo, Frame, Kpis, MachineInfo, Motion, Office, ReplayEvent, RoleId, ScreenPage, Sfx, StatusLine, StripInfo, ThemeId, Usage } from './types.ts'

const PLUGIN = 'digital-workplace'
const PANE = 'digital-workplace'
const TITLE = 'Digital Workplace'
const SELF_PREFIX = `mcp__${PLUGIN}__`
const SVG_LIMIT = 131072
/** Blocks the app can put ahead of the person's words in a prompt (multiline, non-greedy). */
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g

type Engine = EngineInterface
type TerminalArt = 'auto' | 'blocks' | 'image'
type QuickActions = 'off' | 'fill' | 'send'
type Layout = 'auto' | 'stacked' | 'side'
type Smoothness = 'smooth' | 'balanced' | 'light'
type CrewView = 'compact' | 'cards'
type Options = { openOnStart: boolean; motion: Motion; theme: 'auto' | ThemeId; frameRate: number; terminalArt: TerminalArt; toolChips: boolean; walkSpeed: 'slow' | 'normal' | 'fast'; view: 'split' | 'single'; quickActions: QuickActions; layout: Layout; smoothness: Smoothness; crew: CrewView }
type Cells = { no: number; zoom: number; columns: number; rows: number; cells: string }
type TrackedCard = Card & { seen: number }
type Encoded = { no: number; zoom: number; svg: string; png: string; width: number; height: number; sizes: [number, number] }

// ---- module state (a reload starts it over; the pane itself stays open) ----
let opts: Options = { openOnStart: true, motion: 'auto', theme: 'auto', frameRate: 8, terminalArt: 'auto', toolChips: false, walkSpeed: 'normal', view: 'split', quickActions: 'off', layout: 'auto', smoothness: 'balanced', crew: 'compact' }
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
// The Svg surfaces' film (stage.ts) and when it was shot, in office seconds.
let film: Film | null = null
let lastShot = -Infinity
let forceShot = false
// Frames per second of the next film: halved after a film was cut short (busy rooms), back up after a full one.
let filmFps = 0
let paneSig = ''
// Which surfaces draw the pane: null until known (then films and full-rate redraws both run).
let surfaceKinds: readonly string[] | null = null
let surfacesAt = -Infinity
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
      walkSpeed: opts.walkSpeed,
      zoom: 1,
      onSfx: kind => { if (soundOn && sfxQueue.length < 8) sfxQueue.push(kind) },
    })
    // The standard view: the boardroom pinned beside the room where the work is.
    if (opts.view === 'split') { office.setZoom(2); office.togglePin(3); office.lockWorkSlot(true) }
    office.setPlanUsage(planUsage())
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

// ---- truth strip, compute rows, status line (native text: readable, cheap) ----
type Line = { key: string; text: string; color?: string; dim?: boolean; agent?: string }
const k = (n: number): string => (n >= 999950 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
function stripLines(st: StripInfo): Line[] {
  const out: Line[] = []
  if (st.receipt) {
    const finished = /^(Done|Shipped)/.test(st.receipt), clean = finished && !st.failures.length
    out.push({ key: 'h', text: `${clean ? '✓' : finished ? '✗' : '■'} ${st.receipt}`, color: clean ? '#6fdc8c' : '#ff9b5c' })
  }
  else if (st.running.length) out.push({ key: 'h', text: `● Working · ${mmss(st.turnSeconds)}`, color: '#f4b942' })
  else if (st.thinking !== null) out.push({ key: 'h', text: `◌ Zorya thinking · ${mmss(st.thinking)}`, color: '#f4b942' })
  else if (st.open) out.push({ key: 'h', text: `● Working · ${mmss(st.turnSeconds)}`, color: '#f4b942' })
  else out.push({ key: 'h', text: '○ Crew idle', dim: true })
  // Same shape as the old status line: name (role) · raw tool · target · time.
  for (const r of st.running.slice(0, 4)) {
    const model = r.model && (r.sub || r.model !== st.mainModel) ? ` · ${r.model}` : ''
    const head = `${r.name} (${r.role}) · ${r.tool}${r.label ? ` · ${r.label}` : ''}${model}`
    out.push(r.waiting
      ? { key: `r${r.id}`, text: `? ${head} · ${mmss(r.seconds)} · asked for your OK`, color: '#f4b942' }
      : { key: `r${r.id}`, text: `● ${head} · ${mmss(r.seconds)}`, color: r.color })
  }
  if (st.running.length > 4) out.push({ key: 'rm', text: `  +${st.running.length - 4} more running`, dim: true })
  for (const f of st.failures.slice(0, 2)) out.push({ key: `f${f.id}`, text: `✗ ${f.name} (${f.role}) · ${f.tool}${f.label ? ` · ${f.label}` : ''} failed`, color: '#ff6b6b' })
  if (st.failures.length > 2) out.push({ key: 'fm', text: `  +${st.failures.length - 2} more failed`, color: '#ff6b6b' })
  if (st.open && !st.running.length && !st.failures.length && st.recent[0]) {
    const r = st.recent[0]
    out.push({ key: 'rc', text: `○ ${r.name} (${r.role}) · ${r.tool}${r.label ? ` · ${r.label}` : ''} · took ${mmss(r.seconds)}`, dim: true })
  }
  return out
}
function kpiLine(kp: Kpis): Line | null {
  if (!kp.requests && !kp.calls) return null
  const cached = kp.tokensIn ? ` (${Math.round(kp.cached * 100)}% cached)` : ''
  const plan = kp.planTotal ? ` · Plan ${kp.planDone}/${kp.planTotal}` : ''
  return { key: 'kpi', text: `Tokens ${k(kp.tokensIn)} in${cached} · ${k(kp.tokensOut)} out · Calls ${kp.calls}${kp.failed ? ` (${kp.failed} failed)` : ''}${plan} · ${kp.requests} req · ${mmss(kp.seconds)}`, dim: true }
}
/** The strip with the turn's KPIs under its first line. */
function truthLines(o: Office): Line[] {
  const lines = stripLines(o.strip()), kp = kpiLine(o.kpis())
  if (kp) lines.splice(1, 0, kp)
  return lines
}
function machineLine(m: MachineInfo): Line {
  const indent = m.key === 'main' ? '' : '  '
  // A subagent's row is named by its task (ten "general-purpose" rows tell nothing apart).
  const label = m.key === 'main' ? 'main' : clipText(m.description || m.name, 34)
  if (!m.seen) return { key: m.key, agent: m.key, text: `${indent}● ${label} · running, model not seen yet · ${mmss(m.seconds)}`, dim: true }
  const head = `${indent}${m.on ? '●' : '○'} ${label} · ${m.model}${m.effort ? ` · ${m.effort}` : ''}`
  const u: Usage | null = m.usage
  if (m.on) return { key: m.key, agent: m.key, text: `${head} · ${m.requests} req${u ? ` · ${k(u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens)} in · ${k(u.output_tokens)} out` : ''} · ${mmss(m.seconds)}`, color: m.color }
  const tokens = u ? ` · ${k(u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens)} in${u.cache_read_input_tokens ? ` (${k(u.cache_read_input_tokens)} cached)` : ''} · ${k(u.output_tokens)} out` : ''
  return { key: m.key, agent: m.key, text: `${head}${tokens} · ${mmss(m.seconds)}`, dim: true }
}
// What the account spends: a subscription's plan windows (no dollars: the
// plan is not billed per token), or an API key's dollars. From the engine's
// session figures (session.usage at start, session.measure after each turn).
type Limit = { kind: string; percentUsed: number; resetsAt?: string }
let account: { limits: Limit[]; usd: number | null } = { limits: [], usd: null }
let wallNow = 0
const WINDOW_NAMES: Record<string, string> = { five_hour: '5-hour', seven_day: 'weekly', spend_limit: 'spend limit' }
function untilText(iso?: string): string {
  const ms = iso && wallNow ? Date.parse(iso) - wallNow : NaN
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return ` (resets in ${d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`})`
}
function setAccount(u: { rateLimits?: readonly Limit[]; cost?: { usd: number } } | undefined): void {
  if (!u) return
  if (Array.isArray(u.rateLimits)) account = { ...account, limits: u.rateLimits.filter(l => Number.isFinite(l.percentUsed)).map(l => ({ kind: String(l.kind), percentUsed: l.percentUsed, resetsAt: l.resetsAt })) }
  if (u.cost && Number.isFinite(u.cost.usd)) account = { ...account, usd: u.cost.usd }
  office?.setPlanUsage(planUsage())
}
const WINDOW_TAGS: Record<string, string> = { five_hour: '5H', seven_day: 'WEEK', spend_limit: 'SPEND' }
/** The boardroom screen's plan page: the same figures as the usage line (dollars only where dollars are spent). */
function planUsage(): { windows: { label: string; pct: number }[]; usd: number | null } {
  const windows = account.limits.map(l => ({ label: WINDOW_TAGS[l.kind] ?? l.kind.replace(/_/g, ' ').toUpperCase().slice(0, 6), pct: l.percentUsed }))
  const spends = account.limits.length ? account.limits.some(l => l.kind === 'spend_limit') : (account.usd ?? 0) > 0
  return { windows, usd: spends ? account.usd : null }
}
function usageLine(o: Office): Line | null {
  const kp = o.kpis(), tokens = kp.sessionTokens ? `${k(kp.sessionTokens)} tokens since the office opened` : ''
  if (account.limits.length) {
    const parts = account.limits.map(l => `${WINDOW_NAMES[l.kind] ?? l.kind.replace(/_/g, ' ')} ${l.percentUsed}%${untilText(l.resetsAt)}`)
    const spend = account.limits.some(l => l.kind === 'spend_limit') && account.usd !== null ? ` · $${account.usd.toFixed(2)}` : ''
    const top = Math.max(...account.limits.map(l => l.percentUsed))
    return { key: 'use', text: `Plan · ${parts.join(' · ')}${spend}${tokens ? ` · ${tokens}` : ''}`, color: top >= 95 ? '#ff6b6b' : top >= 80 ? '#f4b942' : undefined, dim: top < 80 }
  }
  if (account.usd !== null && account.usd > 0) return { key: 'use', text: `API · $${account.usd.toFixed(2)} this session${tokens ? ` · ${tokens}` : ''}`, dim: true }
  return tokens ? { key: 'use', text: `Session · ${tokens}`, dim: true } : null
}
function contextText(c: ContextInfo): string {
  if (c.compacting) return ' · context: compacting…'
  if (c.tokens === null || !c.window) return ''
  return ` · context ${c.percent}% (${k(c.tokens)} of ${k(c.window)})`
}
const clipText = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function computeLines(o: Office): Line[] {
  const mi = o.machines(), ctx = contextText(o.context()), use = usageLine(o)
  if (!mi.list.length && !ctx && !use) return []
  const out: Line[] = [{ key: 'ch', text: `Compute · ⚡${mi.on} on${ctx}`, dim: true }, ...(use ? [use] : []), ...mi.list.map(machineLine)]
  if (mi.more) out.push({ key: 'cm', text: `  +${mi.more} more machines`, dim: true })
  return out
}
function statusBar(o: Office): string | undefined {
  const st = o.strip(), on = o.machines().on, power = on ? ` · ⚡${on}` : ''
  const r = st.running.find(x => x.waiting) ?? st.running[st.running.length - 1]
  if (r) return `Workplace: ${r.name} ▸ ${r.tool}${r.label ? ` ${r.label}` : ''} ${mmss(r.seconds)}${r.waiting ? ' · asked for your OK' : ''}${st.running.length > 1 ? ` +${st.running.length - 1}` : ''}${power}`
  if (st.thinking !== null) return `Workplace: Zorya thinking ${mmss(st.thinking)}${power}`
  if (st.receipt && st.turnSeconds >= 0 && o.ticker().phase !== 'Idle') return `Workplace: ${st.receipt}`
  return undefined
}
const chips = new Map<string, { text: string; color: string }>()

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
      return { id: `todo-${i}`, title, role: 'none', status: asStatus(t?.status), seen: missionNo }
    })
    return true
  }
  if (tool === 'TaskUpdate' && typeof input.taskId === 'string') {
    if (input.status === 'deleted') return taskCards.delete(input.taskId)
    const c = taskCards.get(input.taskId)
    const title = typeof input.subject === 'string' ? input.subject : c?.title ?? `Task ${input.taskId}`
    taskCards.set(input.taskId, { id: `task-${input.taskId}`, title, role: 'none', status: input.status ? asStatus(input.status) : c?.status ?? 'pending', seen: missionNo })
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
    taskCards.set(id, { id: `task-${id}`, title, role: 'none', status: 'pending', seen: missionNo })
    return true
  }
  if (tool === 'TaskList' && Array.isArray(r.tasks)) {
    for (const t of r.tasks as { id?: unknown; subject?: unknown; status?: unknown }[]) {
      const id = String(t.id ?? '')
      if (!id) continue
      const prev = taskCards.get(id)
      const title = String(t.subject ?? prev?.title ?? '')
      taskCards.set(id, { id: `task-${id}`, title, role: 'none', status: asStatus(t.status), seen: prev?.seen ?? missionNo })
    }
    return true
  }
  return false
}

// ---- interactive pane: every detail stays closed until it is pressed ----
type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>
/** The open detail: a compute row's agent or a plan card. */
let detail: { kind: 'agent'; key: string } | { kind: 'card'; id: string } | null = null
let cardsOpen = false
let moreRooms = false
/** The rooms the tab row always shows, in world order: where the work happens. "+N rooms" shows the rest. */
const MAIN_ROOMS = [1, 3, 5]
const SCREEN_PAGES: ScreenPage[] = ['turn', 'session', 'plan']
const PAGE_NAMES: Record<ScreenPage, string> = { turn: 'Turn', session: 'Session', plan: 'Plan' }
/** Prompts the quick-action buttons put in the prompt box (fill) or send (send). Off by default. */
const QUICK = [
  { key: 'qa-tests', label: 'Run tests', text: "Run the project's tests and report what fails." },
  { key: 'qa-review', label: 'Review', text: 'Review the changes so far for bugs and risks.' },
  { key: 'qa-commit', label: 'Commit', text: 'Commit the current changes with a clear message.' },
  { key: 'qa-status', label: 'Status', text: 'Summarize what is done and what remains.' },
]
/** A quick action's prompt on its way: the mod's own prompt.submit hook may not see it. */
let quickSent: string | null = null
async function quickAction($: Engine, text: string): Promise<void> {
  try {
    if (opts.quickActions === 'send') {
      quickSent = text
      await $.prompt.submit({ text })
      if (quickSent === text) { quickSent = null; newTask(text) }
      return
    }
    // Fill keeps the person's draft: the prompt goes after it.
    const draft = (await $.prompt.read()).text
    if (draft.trim()) await $.prompt.fill({ text: `${/\s$/.test(draft) ? '' : ' '}${text}`, mode: 'append' })
    else await $.prompt.fill({ text, mode: 'replace' })
  } catch { /* no prompt box here */ }
}

const agoText = (s: number): string => {
  if (s < 1) return 'just now'
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`
}
function agentLines(m: MachineInfo): string[] {
  const u = m.usage
  return [
    m.key === 'main' ? 'Main loop: the conversation itself' : `Task: ${m.description || 'not named'}`,
    `Type ${m.type || 'unknown'} · model ${m.seen ? m.model || 'unknown' : 'not seen yet'}${m.effort ? ` · effort ${m.effort}` : ''} · ${m.on ? 'running' : 'finished'} ${mmss(m.seconds)}`,
    `${m.requests} request${m.requests === 1 ? '' : 's'}${u ? ` · ${k(u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens)} in (${k(u.cache_read_input_tokens)} cached) · ${k(u.output_tokens)} out` : ' · no tokens reported yet'}`,
    `Last tool: ${m.lastTool || 'none yet'}`,
  ]
}
/** A plan card's detail. Plan items name no crew member: "busy meanwhile" is who had calls while it was open. */
function cardText(c: CardInfo): string {
  const who = c.workers.length ? ` · busy meanwhile: ${c.workers.join(', ')}` : ''
  if (c.state === 'queued') return 'Not started yet'
  if (c.state === 'working') return `In progress for ${mmss(c.seconds)}${who}`
  return c.seconds > 0 ? `Done in ${mmss(c.seconds)}${who}` : 'Done'
}
const cardMark = (st: CardInfo['state']): string => (st === 'done' ? '✓' : st === 'working' ? '●' : '○')

// ---- the picture: stacked or side by side, as large as the pane allows ----
// A pane's size comes in cells of the app's code font (RenderViewport); these
// are that font's advance and line height in CSS pixels, as measured on the
// desktop app (Windows): a 116x63-cell pane drew about 897x1318 px.
const CELL_W = 7.7
const CELL_H = 20.5
/**
 * Height of the text and buttons around the picture: per strip or compute row,
 * and the rest (tabs, buttons, ticker, crew cards). Measured on the desktop
 * app: 2 rows needed about 410 px, 6 rows about 460 px; these keep a margin.
 */
const TEXT_ROW_PX = 16
const CHROME_PX = 184
/**
 * The crew block under the picture. As cards: three rows, about 206 px
 * (measured). Compact: one row of chips, about 36 px, two rows where the pane
 * is narrower than the chips (about 620 px for the six of them).
 */
const CREW_CARDS_PX = 206
const CREW_ROW_PX = 36
const CREW_CHIPS_PX = 620
const crewPx = (wPx: number): number => (opts.crew === 'cards' ? CREW_CARDS_PX : Math.ceil(CREW_CHIPS_PX / Math.max(240, wPx)) * CREW_ROW_PX)
/** The pane's last size in cells, the picture's width in CSS pixels, and the surface that drew it (for /workplace status). */
let paneFit: { cols: number; rows: number; width: number; surface: string } | null = null
/**
 * Side by side or stacked, whichever draws the rooms larger in this pane (with
 * some hysteresis), and the picture's width. The height left for the picture
 * is the pane's less the text and buttons around it (estimated). Side by side
 * never draws smaller than before (two pixels per office pixel, up to the pane).
 */
function fitPicture(o: Office, cols: number, rows: number, textRows: number): { stacked: boolean; width: number } {
  const n = o.zoom, wPx = cols * CELL_W
  const hPx = Math.max(176, rows * CELL_H - (textRows * TEXT_ROW_PX + CHROME_PX + crewPx(wPx)))
  const side = Math.min(wPx / (n * 240), hPx / 176), stack = Math.min(wPx / 240, hPx / (n * 176))
  let stacked = o.stacked
  if (n < 2) stacked = false
  else if (opts.layout !== 'auto') stacked = opts.layout === 'stacked'
  else if (stacked ? side > stack * 1.15 : stack > side * 1.15) stacked = !stacked
  const width = stacked ? Math.round(240 * Math.max(1, stack)) : Math.round(n * 240 * Math.max(2, side))
  return { stacked, width }
}
/** Both offices (live and replay) take the same layout. */
function setLayout(stacked: boolean): void {
  const live = ensureOffice()
  if (live.stacked !== stacked) { live.setStacked(stacked); forceShot = true }
  if (replay && replay.office.stacked !== stacked) { replay.office.setStacked(stacked); forceShot = true }
}

// ---- replay: the latest task again, in a second office ----
/** Pauses longer than this are shortened in a replay (seconds). */
const REPLAY_GAP = 2
type Replay = { office: Office; events: ReplayEvent[]; times: number[]; next: number; clock: number; end: number; paused: boolean; title: string }
let replay: Replay | null = null
/** The office the pane shows: the replay while one is open, else the live office. */
const shown = (): Office => replay?.office ?? ensureOffice()
/** A new picture source: the film and the frame caches start over. */
function resetStage(): void {
  film = null
  lastShot = -Infinity
  forceShot = true
  filmFps = 0
  horizon = 2
  paneSig = ''
  dropFrameCaches()
}
/** Plays the latest task's events again, in order and with their pauses shortened, in a fresh office. */
function startReplay(): boolean {
  const live = ensureOffice()
  const events = live.replayLog()
  if (events.length < 2) return false
  const o = createOffice({ theme: themeFor(opts.theme), motion: opts.motion, walkSpeed: opts.walkSpeed, zoom: 1 })
  o.setZoom(live.zoom)
  for (const r of live.pinned) o.togglePin(r)
  if (opts.view === 'split') o.lockWorkSlot(true)
  o.setScreenPage(live.screenPage)
  o.setStacked(live.stacked)
  const times: number[] = []
  let at = 0
  events.forEach((ev, i) => { if (i > 0) at += Math.min(REPLAY_GAP, Math.max(0, ev.t - events[i - 1]!.t)); times.push(at) })
  replay = { office: o, events, times, next: 0, clock: 0, end: at + 4, paused: false, title: live.ticker().title }
  stepReplay(0)
  resetStage()
  return true
}
function stepReplay(dt: number): void {
  const r = replay
  if (!r || r.paused) return
  r.clock = Math.min(r.end, r.clock + dt)
  const api = r.office as unknown as Record<string, unknown>
  while (r.next < r.events.length && r.times[r.next]! <= r.clock) {
    const ev = r.events[r.next++]!
    const f = api[ev.name]
    if (typeof f === 'function') { try { (f as (...a: unknown[]) => unknown).apply(r.office, ev.args) } catch { /* a bad event is skipped */ } }
  }
  r.office.advance(dt)
  if (r.clock >= r.end) r.paused = true
}
function stopReplay(): void {
  replay = null
  resetStage()
}

/** A new task: the crew starts a mission titled from the prompt. */
function newTask(text: string): void {
  missionNo++
  const o = ensureOffice()
  // Title the mission from the person's own words, not app-injected
  // reminders; with nothing left, startMission falls back to 'Untitled task'.
  o.startMission(text.replace(SYSTEM_REMINDER, '').trim())
  const open = openCards()
  if (open.length) o.setCards(open)
  frameNo++
}

// ---- tool calls ----
/** Starts the crew on a call; true when an activity was opened that must be closed. */
function before(route: Route, tool: string, input: Record<string, unknown>, id: string, agentId?: string): boolean {
  const o = ensureOffice()
  let opened = false
  if (route.kind === 'launch') o.handoff('lead', route.role, 'handoff', route.title)
  else if (route.kind === 'work') { o.toolStart(id, route.role, tool, route.label, { run: agentId ?? 'main', ship: route.isShip === true }); opened = true }
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

/** Frames rendered during a film are future frames: the per-frame caches must not keep them. */
function dropFrameCaches(): void {
  rendered = null
  cache = { ...cache, no: -1 }
  termPng = { ...termPng, no: -1 }
  cellCache = { ...cellCache, no: -1 }
  lastPixels = null
}

/**
 * The current film, shot again when it runs out, after an outside event (at
 * most once a second, L2 in the design verdict), or at once after a press.
 */
// Film rates must land on the office's 25 ms steps (40/n fps). The frame rate
// is what the app pays for (each frame repaints its changes at the drawn size);
// how often films are shot hardly matters to it. Measured on a busy minute,
// stacked 2-room view, mod + app (Chromium) in % of one core: smooth 10 fps
// 11 + 11, balanced 8 fps 10 + 9, light 5 fps 7 + 6; one room drawn 893 px
// wide: 20 fps 11 + 18, 10 fps 7 + 11. An idle office films one step lower.
const FILM_FPS = [20, 10, 8, 5, 4]
const FILM_RATES: Record<Smoothness, [number, number, number]> = { smooth: [20, 10, 8], balanced: [10, 8, 5], light: [5, 5, 4] }
const baseFps = (zoom: number): number => FILM_RATES[opts.smoothness][Math.min(3, Math.max(1, zoom)) - 1]!
const lowerFps = (f: number): number => FILM_FPS.find(x => x < f) ?? 4
const higherFps = (f: number, cap: number): number => Math.min(cap, [...FILM_FPS].reverse().find(x => x > f) ?? cap)
/** How far ahead to film: about as far as recent films were actually used. */
let horizon = 2

/**
 * The current film, shot again (measured on a busy minute: no freezes, events
 * on screen in about 0.1 s instead of 0.5 s):
 * - soon after an outside event (0.25 s, so a burst of events is one shot);
 * - when it runs out or was cut short (a busy room filled its budget);
 * - at once after a press, a zoom change or a camera cut.
 */
function currentFilm(o: Office): { film: Film | null; fresh: boolean } {
  const idle = o.ticker().phase === 'Idle'
  const elapsed = film ? o.simT - film.startT : 0
  const due = !film || forceShot || film.zoom !== o.zoom ||
    (film.cutAt !== null && elapsed >= film.cutAt - 1e-6) ||
    (o.simT - lastShot >= 0.25 && (o.version !== film.version || elapsed >= film.seconds - 0.25))
  if (!due) return { film, fresh: false }
  if (film) horizon = Math.min(2, Math.max(0.75, horizon * 0.5 + elapsed * 0.75))
  // Set first: a shot that throws must not be retried on every tick.
  lastShot = o.simT
  forceShot = false
  const base = baseFps(o.zoom)
  if (!filmFps || filmFps > base) filmFps = base
  const fps = idle ? lowerFps(filmFps) : filmFps
  try {
    film = shoot(o, fps, idle ? 6 : horizon, SVG_LIMIT - 4096, opts.motion)
    filmFps = film.cut ? lowerFps(filmFps) : higherFps(filmFps, base)
  } catch {
    // Keep the last film (or none: the pane then draws a single frame).
  } finally {
    dropFrameCaches()
  }
  return { film, fresh: true }
}
/** The frameRate setting, clamped to 2-10 like the tick. */
const frameRate = (): number => Math.min(10, Math.max(2, Math.round(opts.frameRate) || 8))

/** A room tab: in a 2/3-room view it pins or unpins the room; in a 1-room view it goes there. */
function roomPress(o: Office, room: number): void {
  if (o.zoom > 1) o.togglePin(room)
  else o.goRoom(room)
}

/** What the Svg surfaces show as text and buttons: they redraw only when it changes. */
function signature(o: Office): string {
  const t = o.ticker()
  return [
    truthLines(o).map(l => l.text).join('|'), computeLines(o).map(l => l.text).join('|'),
    `${t.phase}${t.total}${t.done}${t.duets}${t.clock}`, o.crew().map(c => (opts.crew === 'cards' || c.selected ? `${c.status}${c.done}${c.tokens}${c.selected}` : `${c.working}`)).join('|'),
    o.rooms().map(r => `${r.current}${r.inView}${r.pinned}${r.agents.map(a => a.color).join('')}`).join(','), o.zoom, o.autoCam, soundOn, soundBroken,
    o.screenPage, replay ? `${replay.paused}${Math.floor(replay.clock)}` : '', JSON.stringify(detail), cardsOpen, moreRooms,
    o.selectedId ? o.history(o.selectedId)[0]?.endT ?? '' : '', ensureOffice().replaySize > 1,
  ].join('#')
}

async function surfacesNow($: Engine, simT: number): Promise<readonly string[] | null> {
  if (simT - surfacesAt < 5) return surfaceKinds
  surfacesAt = simT
  try { surfaceKinds = await $.session.surfaces() } catch { surfaceKinds = null }
  return surfaceKinds
}

/**
 * When the app last drew the pane (wall ms). A session in the background is
 * not drawn: after DORMANT_MS without a draw the office stops filming (the
 * picture is shot again on the next draw) and only asks for a draw now and
 * then, so a pane that comes back into view wakes within PROBE_MS.
 */
let drawnAt = 0
let probeAt = 0
const DORMANT_MS = 3000
const PROBE_MS = 2000
const dormant = (): boolean => !!drawnAt && wallNow - drawnAt > DORMANT_MS

async function tick($: Engine): Promise<void> {
  if (busy) return
  busy = true
  try {
    const now = await $.clock.now()
    wallNow = now
    const dt = lastTick ? (now - lastTick) / 1000 : 0
    lastTick = now
    const o = ensureOffice()
    o.advance(dt)
    if (replay) stepReplay(dt)
    if (opts.theme === 'auto' && frameNo % 240 === 0) o.setTheme(themeFor('auto'))
    while (sfxQueue.length) playSfx($, sfxQueue.shift()!)
    frameNo++
    if (paneOpen) {
      const kinds = await surfacesNow($, o.simT)
      const terminal = kinds === null || kinds.includes('terminal')
      const pictures = kinds === null || kinds.some(k => k !== 'terminal')
      let redraw = false
      const v = shown()
      // Svg surfaces play a film on their own: redraw for a new film or new text only.
      // A paused replay shows a still frame.
      if (!drawnAt) drawnAt = now
      if (pictures) {
        const sig = signature(v)
        if (dormant()) {
          // Not drawn lately: no films; new text or a probe asks for a draw.
          if (sig !== paneSig || now - probeAt >= PROBE_MS) { paneSig = sig; probeAt = now; redraw = true }
        } else {
          const fresh = replay?.paused ? false : currentFilm(v).fresh
          if (fresh || sig !== paneSig) { paneSig = sig; redraw = true }
        }
      }
      // Terminals redraw every frame; an idle office needs only a quarter of the rate.
      if (terminal && !replay?.paused && (v.ticker().phase !== 'Idle' || frameNo % 4 === 0)) redraw = true
      if (redraw) $.ui.invalidate('ui.render')
    }
    const bar = statusBar(o)
    if (bar !== lastStatus) { lastStatus = bar; $.ui.status(bar) }
  } catch {
    // A failed frame is skipped; the next tick tries again.
  } finally {
    busy = false
  }
}

let lastOpenReason = ''
let lastStatus: string | undefined
const agentsAsked = new Set<string>()
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
  const drawn = drawnAt ? (dormant() ? ` · not drawn for ${Math.round((wallNow - drawnAt) / 1000)} s (not filming)` : ' · drawn') : ''
  const rate = film ? ` · films ${Math.round(1 / film.dt)} fps (${opts.smoothness})` : ''
  const fit = (paneFit ? ` · ${paneFit.surface} ${paneFit.cols}×${paneFit.rows} cells · ${ensureOffice().stacked ? 'stacked' : 'side by side'} · picture ${paneFit.width} px` : '') + rate + drawn
  if (pane.isPlaced) return state + fit
  if (!lastOpenReason) { const r = await $.ui.open({ id: PANE, title: TITLE }); lastOpenReason = r.isPlaced ? '' : r.reason }
  return lastOpenReason ? `${state} · engine says: ${lastOpenReason}` : state
}

/** Which crew member a requested tool call belongs to; planning, hand-offs and the mod's own tools are Zorya's. */
function roleOf(name: string, input: unknown): RoleId {
  try {
    const r = routeTool(String(name), (input && typeof input === 'object' ? input : {}) as Record<string, unknown>, SELF_PREFIX)
    return r.kind === 'work' ? r.role : 'lead'
  } catch { return 'lead' }
}

async function describeAgent($: Engine, id: string): Promise<void> {
  try {
    const a = (await $.agent.list()).find(x => x.id === id)
    if (a) ensureOffice().machineInfo(id, { type: a.type, description: a.description, parentId: a.parentId })
  } catch { /* the label just stays generic */ }
}

function summary(o: Office): string {
  const s = o.snapshot()
  const status = new Map(o.crew().map(c => [c.id, c.status]))
  return [
    `Phase: ${s.ticker.phase}${s.title ? ` · "${s.title}"` : ''} · ${s.ticker.clock}`,
    `Status: ${statusText(s.status)}`,
    ...s.agents.map(a => `${a.name} (${a.role}): ${status.get(a.id) ?? a.state} · ${a.room}${a.bubble ? ` · bubble ${a.bubble}` : ''}${a.duet ? ` · duet ${a.duet.giver}->${a.duet.taker} (${a.duet.kind})` : ''}${s.tokens[a.role] ? ` · ${k(s.tokens[a.role])} new tokens` : ''}`),
    ...(s.kpis.boardroom.seated ? [`Boardroom: ${s.kpis.boardroom.seated} subagent(s) seated${s.kpis.boardroom.standing ? `, ${s.kpis.boardroom.standing} standing` : ''}${s.kpis.boardroom.more ? `, +${s.kpis.boardroom.more} counted at the door` : ''}`] : []),
    `Cards: ${s.cards.length ? s.cards.map(c => `[${c.state}] ${c.title} -> ${c.role}`).join('; ') : 'none'}`,
    `View: ${s.view.slots ? s.view.slots.map(r => o.rooms()[r]!.name).join(' + ') : s.view.room}, ${s.view.zoom} room(s)${s.view.pinned.length ? `, pinned ${s.view.pinned.join(', ')}` : ''}, auto camera ${s.view.autoCam ? 'on' : 'off'}${s.view.stacked ? ' · stacked' : ''} · pane ${paneOpen ? 'open' : 'hidden'} · screen ${PAGE_NAMES[o.screenPage]}${replay ? ` · replay ${replay.paused ? 'paused' : 'playing'} ${mmss(replay.clock)}/${mmss(replay.end)}` : ''}`,
    'Strip:',
    ...truthLines(o).map(l => `  ${l.text}`),
    ...computeLines(o).map(l => `  ${l.text}`),
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
    toolChips: options.toolChips === true,
    walkSpeed: options.walkSpeed === 'slow' || options.walkSpeed === 'fast' ? options.walkSpeed : 'normal',
    view: options.view === 'single' ? 'single' : 'split',
    quickActions: options.quickActions === 'fill' || options.quickActions === 'send' ? options.quickActions : 'off',
    layout: options.layout === 'stacked' || options.layout === 'side' ? options.layout : 'auto',
    smoothness: options.smoothness === 'smooth' || options.smoothness === 'light' ? options.smoothness : 'balanced',
    crew: options.crew === 'cards' ? 'cards' : 'compact',
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
      // Subagents already running when the office opened (a restart mid-run).
      try {
        for (const a of await $.agent.list()) {
          if (a.status === 'running' || a.status === 'waiting' || a.status === 'pending') ensureOffice().machineSeed(a.id, { type: a.type, description: a.description, parentId: a.parentId ?? null })
          agentsAsked.add(a.id)
        }
      } catch { /* not offered here */ }
      // The window size (and the fill, if a response already came) for the context tank.
      try { const u = await $.session.usage(); if (u?.context) ensureOffice().setContext({ tokens: u.context.tokens, window: u.context.window }); setAccount(u as never) } catch { /* not offered here */ }
      if (!started) {
        started = true
        const ms = Math.round(1000 / frameRate())
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
    // The argument hint reads [show|hide|status]: "[status]" means status.
    const arg = e.args.trim().toLowerCase().replace(/^\[\s*(.*?)\s*\]$/, '$1')
    if (arg === 'status') return { text: `${summary(ensureOffice())}\n${await paneReport($)}` }
    // A word the command does not know changes nothing: it only says how to use it.
    if (!['', 'show', 'open', 'hide', 'close'].includes(arg)) return { text: `Unknown option "${e.args.trim()}". Use /workplace (show or hide), /workplace show, /workplace hide or /workplace status.` }
    // A bare /workplace hides the pane only when it is really on screen; an
    // open pane on a hidden tab, or one waiting for room, is brought forward.
    const pane = (await $.ui.panes()).find(p => p.id === PANE)
    const onScreen = !!pane && pane.isShown && pane.isPlaced
    const show = arg === 'show' || arg === 'open' || (arg !== 'hide' && arg !== 'close' && !onScreen)
    if (show) {
      const placed = await showPane($)
      if (placed) return { text: 'Digital Workplace pane shown.' }
      // Kept to one short line: Claude reads command replies too.
      if (lastOpenReason.startsWith('no-surface')) return { text: 'No drawing surface in this session (cloud sessions cannot show mod panes). Open it in a local desktop or terminal session to see the office.' }
      return { text: `Digital Workplace pane opened but not drawn yet. Engine says: ${lastOpenReason}` }
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
      if (quickSent !== null && e.text === quickSent) quickSent = null
      if (!e.isMeta && !e.command && e.text.trim()) newTask(e.text)
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
      opened = before(route, tool, input, id, (e as { agentId?: string }).agentId)
    } catch { /* never in the way of a tool */ }
    let ok = false
    try {
      const ran = await next(e)
      ok = ran.deny === undefined && ran.isError !== true
      try { after(route, tool, input, ran) } catch { /* never in the way of a tool */ }
      // An approved plan ends plan mode (the next event will say so too).
      if (tool === 'ExitPlanMode' && ok) { try { ensureOffice().setPlanMode(false) } catch { /* ignore */ } }
      return ran
    } finally {
      // Runs on success, failure and abort alike, so no crew member is left working.
      if (opened) {
        try {
          const o = ensureOffice()
          const info = o.toolRole(id)
          o.toolEnd(id, ok)
          if (info && opts.toolChips) {
            chips.set(id, { text: `${info.name} · ${info.tool}${info.label ? ` ${info.label}` : ''} ${ok ? '✓' : '✗'} ${mmss(info.seconds)}`, color: info.color })
            if (chips.size > 500) chips.delete(chips.keys().next().value!)
          }
        } catch { /* ignore */ }
      }
    }
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    try { if (!e.agentId) ensureOffice().turnStart() } catch { /* never in the way of a turn */ }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Each model request powers its machine (main loop or subagent) on; the
  // stream itself passes through untouched.
  on('turn.step', async function* ($, e, next) {
    const key = e.agentId ?? 'main'
    try {
      ensureOffice().machineStep(key, e.model, e.effort)
      if (e.agentId && !agentsAsked.has(e.agentId)) { agentsAsked.add(e.agentId); void describeAgent($, e.agentId) }
    } catch { /* never in the way of a turn */ }
    let r: { usage?: unknown; toolUses?: readonly { name: string; input: unknown }[] } | undefined
    try {
      r = yield* next(e)
      return r as never
    } finally {
      try {
        const o = ensureOffice()
        o.machineStepEnd(key)
        // The request's tokens go to the crew whose tools it asked for (none: Zorya).
        if (r) o.stepDone(key, r.usage as Partial<Usage> | null, (r.toolUses ?? []).map(t => roleOf(t.name, t.input)))
      } catch { /* ignore */ }
    }
  })

  // The context window, as the status line has it: pushed after each main turn.
  on('session.measure', ($, e, next) => {
    try {
      const c = (e as { context?: { tokens?: number; window?: number } }).context
      if (c) ensureOffice().setContext({ tokens: c.tokens, window: c.window })
      setAccount(e as never)
    } catch { /* never in the way */ }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Compaction: the boardroom tank drains while the conversation is summarized.
  on('classic.PreCompact', async ($, e, next) => {
    try { ensureOffice().compactStart(String((e as { trigger?: unknown }).trigger ?? 'auto')) } catch { /* never in the way */ }
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.PostCompact', async ($, e, next) => {
    try { ensureOffice().compactEnd() } catch { /* never in the way */ }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', ($, e, next) => {
    try {
      const o = ensureOffice()
      const usage = (e.usage ?? null) as Usage | null
      if (e.agentId) o.machineDone(e.agentId, usage, e.durationMs)
      else { o.machineDone('main', usage, e.durationMs); o.turnEnd(e.reason) }
    } catch {
      // never in the way of a turn
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Plan mode: every classic event reports the session's permission mode. A
  // prompt or a tool call in plan mode starts the boardroom meeting; one in
  // another mode ends it.
  const planFrom = (e: unknown): void => {
    const mode = (e as { permission_mode?: unknown }).permission_mode
    if (typeof mode === 'string') { try { ensureOffice().setPlanMode(mode === 'plan') } catch { /* never in the way */ } }
  }
  on('classic.UserPromptSubmit', async ($, e, next) => { planFrom(e); return next(e) }).catch(($, e, next) => next(e))
  on('classic.PreToolUse', async ($, e, next) => { planFrom(e); return next(e) }).catch(($, e, next) => next(e))

  // The permission dialog is about to show: that call is waiting on the person, not working.
  // A settings hook may decide first; only an undecided request reaches the
  // person. No event says when they answer, so the mark reads "asked for your
  // OK", which stays true after they approve and the tool runs.
  on('classic.PermissionRequest', async ($, e, next) => {
    const r = await next(e)
    try {
      const decided = r as { decision?: unknown; block?: unknown } | undefined
      if (decided?.decision === undefined && !decided?.block && ensureOffice().markWaiting(String(e.tool_name))) frameNo++
    } catch { /* never in the way */ }
    return r
  }).catch(($, e, next) => next(e))

  if (opts.toolChips) {
    on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
      const row = await next(e)
      const chip = chips.get(e.requestId)
      if (!chip) return row
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {row}
          <Text color={chip.color} dimColor>{chip.text}</Text>
        </Box>
      )
    }).catch(($, e, next) => next(e))
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    drawnAt = wallNow
    const live = ensureOffice()
    // While a replay is open, the pane (pictures, strip, crew, buttons) shows it; the status bar stays live.
    const o = shown()
    const t = o.ticker()
    const s = o.statusLine()
    const rooms = o.rooms()
    const crew = o.crew()
    const here = rooms.find(r => r.current)?.name ?? ''
    const alt = `${replay ? 'Replay of the latest task' : 'Digital Workplace office'}, ${here} in view. ${statusText(s).slice(2)}`
    const redraw = (): void => { frameNo++; forceShot = true; $.ui.invalidate('ui.render') }
    const beat = ['▪▫▫▫', '▫▪▫▫', '▫▫▪▫', '▫▫▫▪'][t.beat] ?? '▫▫▫▫'
    const ticker = `${t.phase}  ${beat}${t.total ? `  ${t.done}/${t.total} cards` : ''}  Duets ${t.duets}  ${t.clock}`
    const terminal = e.surface === 'terminal'
    const { Box, Text, Button } = $.ui.resolve(e) as Kit
    // The layout follows the pane's shape (Svg surfaces; a terminal keeps it, unless the setting forces one).
    let pictureW: number | null = null
    if (!terminal && e.props.bodyColumns > 0) {
      const fit = fitPicture(o, e.props.bodyColumns, e.props.scroll?.bodyRows ?? 40, truthLines(o).length + computeLines(o).length)
      setLayout(fit.stacked)
      pictureW = fit.width
      paneFit = { cols: e.props.bodyColumns, rows: e.props.scroll?.bodyRows ?? 0, width: fit.width, surface: e.surface }
    } else if (opts.layout !== 'auto') setLayout(opts.layout === 'stacked' && o.zoom > 1)
    // Svg surfaces draw small type; terminals have one size.
    const note = terminal ? {} : ({ size: 'footnote' } as const)
    const mono = terminal ? {} : ({ mono: true, size: 'footnote' } as const)
    const gaps = terminal ? { columnGap: 1 } : { columnGap: 1, rowGap: 1 }
    const strip = truthLines(o)
    const compute = computeLines(o)
    const cards = o.cards()
    const followed = crew.find(c => c.selected)

    // Room tabs: the three work rooms, any room in view, and "+N rooms" for the rest.
    const tabs = moreRooms ? rooms : rooms.filter(r => MAIN_ROOMS.includes(r.index) || (o.zoom > 1 ? r.inView : r.current) || r.pinned)
    const hidden = rooms.filter(r => !tabs.includes(r))
    const roomRow = (
      <Box key="rooms" flexDirection="row" flexWrap="wrap" {...gaps}>
        <Button key="prev" label="‹" dimColor={!o.canPrev()} onPress={() => { o.prevRoom(); redraw() }} />
        {tabs.map(r => (
          <Button key={`room-${r.index}`} variant={(o.zoom > 1 ? r.inView : r.current) ? 'primary' : undefined} onPress={() => { roomPress(o, r.index); redraw() }}>
            {r.pinned ? '◆ ' : ''}{r.name}{terminal ? '' : ' '}{r.agents.map(a => <Text color={a.color}>■</Text>)}
          </Button>
        ))}
        {(hidden.length > 0 || moreRooms) && (
          <Button key="rooms-more" dimColor onPress={() => { moreRooms = !moreRooms; redraw() }}>
            {moreRooms ? 'Fewer rooms' : `+${hidden.length} rooms `}{hidden.flatMap(r => r.agents).map(a => <Text color={a.color}>■</Text>)}
          </Button>
        )}
        <Button key="next" label="›" dimColor={!o.canNext()} onPress={() => { o.nextRoom(); redraw() }} />
      </Box>
    )
    const flipScreen = (): void => {
      const p = SCREEN_PAGES[(SCREEN_PAGES.indexOf(o.screenPage) + 1) % SCREEN_PAGES.length]!
      live.setScreenPage(p)
      replay?.office.setScreenPage(p)
      redraw()
    }
    const controls = (
      <Box key="controls" flexDirection="row" flexWrap="wrap" {...gaps} alignItems="center">
        {!terminal && (paneFit?.cols ?? 0) >= 110 && <Text dimColor>{o.zoom > 1 ? 'Rooms in view · tap a room to pin it' : 'Rooms in view'}</Text>}
        {[1, 2, 3].map(z => <Button key={`zoom-${z}`} label={String(z)} variant={o.zoom === z ? 'primary' : undefined} onPress={() => { o.setZoom(z); redraw() }} />)}
        <Button key="cam" label="Auto camera" variant={o.autoCam ? 'primary' : undefined} onPress={() => { o.setAutoCam(!o.autoCam); redraw() }} />
        {o.pinned.length > 0 && <Button key="unpin" label="Unpin" onPress={() => { o.clearPins(); redraw() }} />}
        <Button key="sound" label={soundBroken ? 'No audio here' : soundOn ? 'Sound on' : 'Sound off'} variant={soundOn ? 'primary' : undefined} onPress={() => { if (!soundBroken) setSound($, !soundOn); redraw() }} />
        <Button key="screen" label={`Screen: ${PAGE_NAMES[o.screenPage]}`} onPress={flipScreen} />
        {!replay && live.replaySize > 1 && <Button key="replay" label="▶ Replay task" onPress={() => { if (startReplay()) redraw() }} />}
      </Box>
    )
    const r = replay
    const replayBar = r && (
      <Box key="replay-bar" flexDirection="row" flexWrap="wrap" {...gaps} alignItems="center">
        <Text color="#b08cf5" bold>{`${r.clock >= r.end ? 'Replay finished' : r.paused ? 'Replay paused' : 'Replaying'}${r.title ? ` "${clipText(r.title, 40)}"` : ''} · ${mmss(r.clock)} / ${mmss(r.end)}`}</Text>
        <Button key="replay-pause" label={r.paused ? '▶ Play' : '⏸ Pause'} onPress={() => { if (r.clock >= r.end) startReplay(); else r.paused = !r.paused; redraw() }} />
        <Button key="replay-again" label="↺ Again" onPress={() => { startReplay(); redraw() }} />
        <Button key="replay-live" variant="primary" label="■ Live" onPress={() => { stopReplay(); redraw() }} />
      </Box>
    )
    const tickerRow = (
      <Box key="ticker" flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
        <Text {...mono}>{ticker}</Text>
        {cards.length > 0 && <Button key="plan" dimColor={!cardsOpen} label={`Cards ${cardsOpen ? '▾' : '▸'}`} onPress={() => { cardsOpen = !cardsOpen; if (!cardsOpen && detail?.kind === 'card') detail = null; redraw() }} />}
      </Box>
    )
    const cardList = cardsOpen && cards.length > 0 && (
      <Box key="cards" flexDirection="column">
        {cards.map(c => {
          const open = detail?.kind === 'card' && detail.id === c.id
          return (
            <Box key={`cardrow-${c.id}`} flexDirection="column">
              <Button key={`plan-${c.id}`} plain onPress={() => { detail = open ? null : { kind: 'card', id: c.id }; redraw() }}>
                <Text color={c.state === 'working' ? '#f4b942' : c.state === 'done' ? '#6fdc8c' : undefined} dimColor={c.state === 'queued'} {...note}>{`${cardMark(c.state)} ${clipText(c.title, 70)}`}</Text>
              </Button>
              {open && <Text key={`cardinfo-${c.id}`} dimColor {...note}>{`   ${cardText(c)}`}</Text>}
            </Box>
          )
        })}
      </Box>
    )
    // Compute rows: each machine row opens its agent's detail.
    const computeBox = compute.length > 0 && (
      <Box key="compute" flexDirection="column">
        {compute.map(l => {
          if (!l.agent) return <Text key={`c-${l.key}`} color={l.color} dimColor={l.dim} wrap="truncate-end" {...mono}>{l.text}</Text>
          const key = l.agent, open = detail?.kind === 'agent' && detail.key === key
          const m = open ? o.machines().list.find(x => x.key === key) : undefined
          return (
            <Box key={`agentrow-${key}`} flexDirection="column">
              <Button key={`agent-${key}`} plain onPress={() => { detail = open ? null : { kind: 'agent', key }; redraw() }}>
                <Text color={l.color} dimColor={l.dim} {...mono}>{`${l.text} ${open ? '▾' : '▸'}`}</Text>
              </Button>
              {open && (m ? agentLines(m) : ['No longer listed.']).map((x, i) => <Text key={`agentinfo-${key}-${i}`} color="#a8e6ff" wrap="truncate-end" {...mono}>{`    ${x}`}</Text>)}
            </Box>
          )
        })}
      </Box>
    )
    const quick = opts.quickActions !== 'off' && !replay && (
      <Box key="quick" flexDirection="row" flexWrap="wrap" {...gaps} alignItems="center">
        <Text dimColor {...note}>{opts.quickActions === 'send' ? 'Send to Claude:' : 'Put in the prompt:'}</Text>
        {QUICK.map(q => <Button key={q.key} label={q.label} onPress={() => void quickAction($, q.text)} />)}
      </Box>
    )
    // Following a crew member also opens their recent calls.
    const hist = followed ? o.history(followed.id) : []
    const history = followed && (
      <Box key="history" flexDirection="column">
        {opts.crew === 'compact' && <Text key="crew-detail" dimColor wrap="truncate-end" {...note}>{`${followed.name} · ${followed.roleLabel} · ${followed.status} · ${followed.done} done${followed.tokens ? ` · ${k(followed.tokens)} new tokens` : ''}`}</Text>}
        <Text color={followed.color} bold {...note}>{`${followed.name}'s recent calls`}</Text>
        {hist.length
          ? hist.map((call, i) => (
            <Text key={`hist-${i}`} color={call.ok ? undefined : '#ff6b6b'} dimColor={call.ok} wrap="truncate-end" {...note}>
              {`${call.ok ? '✓' : '✗'} ${call.tool}${call.label ? ` ${call.label}` : ''} · ${mmss(call.seconds)}${call.model ? ` · ${call.model}` : ''} · ${agoText(call.ago)}`}
            </Text>
          ))
          : <Text dimColor {...note}>No calls yet.</Text>}
      </Box>
    )

    // Compact: one chip per crew member (name, role, a dot while working). Pressing
    // one follows them and opens their detail and recent calls below.
    const chips = opts.crew === 'compact' && (
      <Box key="crew" flexDirection="row" flexWrap="wrap" {...gaps}>
        {crew.map(c => (
          <Button key={`crew-${c.id}`} variant={c.selected ? 'primary' : undefined} onPress={() => { o.toggleFollow(c.id); redraw() }}>
            <Text color={c.color} bold>{c.name}</Text> <Text dimColor>{c.roleLabel}</Text>{c.working ? <Text color={c.color}> ●</Text> : ''}
          </Button>
        ))}
      </Box>
    )

    if (terminal) {
      const { Image, Raster } = $.ui.resolve(e)
      const pictures = termArt === 'image' || (termArt === 'iterm' && e.viewport?.isFullscreen === true)
      // Fit the office to the pane: leave two rows under it for the status
      // line and the ticker, and keep its shape by narrowing it if needed.
      const bodyRows = e.props.scroll?.bodyRows ?? 40
      // Too small for pixels: the strip and compute rows alone stay readable.
      const office = e.props.bodyColumns >= 40 && bodyRows >= 14
      const f = renderFrame(o)
      const maxRows = Math.max(6, bodyRows - 2 - strip.length)
      const fitCols = Math.floor((maxRows * 2 * f.width) / f.height)
      const columns = Math.max(20, Math.min(pictures ? 255 : 512, e.props.bodyColumns, fitCols))
      let view
      if (!office) view = null
      else if (pictures) {
        const rows = Math.max(6, Math.min(255, Math.round((columns * f.height) / f.width / 2)))
        view = <Image key="view" source={{ png: terminalPng(o) }} columns={columns} rows={rows} alt={alt} />
      } else {
        const c = blockCells(o, columns)
        view = <Raster key="view" columns={c.columns} rows={c.rows} cells={c.cells} />
      }
      return (
        <Box flexDirection="column">
          {strip.map(l => <Text key={`s-${l.key}`} color={l.color} dimColor={l.dim} wrap="truncate-end">{l.text}</Text>)}
          {replayBar}
          {view}
          {tickerRow}
          {cardList}
          {computeBox}
          {roomRow}
          {controls}
          {quick}
          {chips || <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {crew.map(c => (
              <Box key={`card-${c.id}`} flexDirection="column" width={26}>
                <Button key={`crew-${c.id}`} variant={c.selected ? 'primary' : undefined} onPress={() => { o.toggleFollow(c.id); redraw() }}>
                  <Text color={c.color} bold>{c.name}</Text> <Text dimColor>{c.roleLabel}</Text>
                </Button>
                <Text dimColor wrap="truncate-end">{c.status}</Text>
              </Box>
            ))}
          </Box>}
          {history}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    const cur = replay?.paused ? null : currentFilm(o).film
    const svg = sized(cur ? filmSvg(cur, Math.max(0, o.simT - cur.startT)) : encodeFrame(o).svg, pictureW)
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="strip" flexDirection="column">
          {strip.map(l => <Text key={`s-${l.key}`} mono size="footnote" color={l.color} dimColor={l.dim} wrap="truncate-end">{l.text}</Text>)}
        </Box>
        {replayBar}
        <Box key="view" flexDirection="column" alignItems="center">
          <Svg source={svg} alt={alt} />
        </Box>
        {roomRow}
        {controls}
        {tickerRow}
        {cardList}
        {computeBox}
        {quick}
        {chips || <Box flexDirection="row" flexWrap="wrap" columnGap={1} rowGap={1}>
          {crew.map(c => (
            <Box key={`card-${c.id}`} flexDirection="row" gap={1} width="48%" alignItems="flex-start">
              <Svg source={spriteSvg(o, c.id)} alt={`${c.name}, ${c.roleLabel}`} width={26} height={40} />
              <Box flexDirection="column" flexShrink={1}>
                <Button key={`crew-${c.id}`} variant={c.selected ? 'primary' : undefined} onPress={() => { o.toggleFollow(c.id); redraw() }}>
                  <Text color={c.color} bold>{c.name}</Text> <Text dimColor>{c.roleLabel}</Text>
                </Button>
                <Text size="footnote" dimColor wrap="truncate-end">{c.status}</Text>
                <Text size="caption" dimColor>{`${c.done} done${c.tokens ? ` · ${k(c.tokens)} new tokens` : ''}`}</Text>
              </Box>
            </Box>
          ))}
        </Box>}
        {history}
      </Box>
    )
  })

}
