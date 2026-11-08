// The typed surface of the office simulation (world.ts).
import type { Px } from './raster.ts'

export type RoleId = 'lead' | 'research' | 'design' | 'build' | 'review' | 'qa' | 'none'
export type Motion = 'auto' | 'full' | 'reduced'
export type ThemeId = 'night' | 'sunset' | 'day'
export type Sfx = 'start' | 'done' | 'duet' | 'bug' | 'ship' | 'clap'

export type OfficeOptions = {
  random?: () => number
  theme?: ThemeId
  motion?: Motion
  zoom?: number
  onSfx?: (kind: Sfx) => void
  /** How fast the crew walks: slow (0.6x), normal (the page's pace) or fast (1.6x). */
  walkSpeed?: 'slow' | 'normal' | 'fast'
}

export type Frame = { width: number; height: number; base: Px; fx: Px | null }

export type RoomInfo = {
  index: number
  name: string
  current: boolean
  inView: boolean
  /** Pinned in a 2/3-room view (shown side by side whatever the camera does). */
  pinned: boolean
  agents: { id: string; name: string; color: string }[]
}

export type CrewInfo = {
  id: string
  name: string
  role: RoleId
  roleLabel: string
  color: string
  status: string
  done: number
  selected: boolean
  working: boolean
  /** Tokens this turn attributed to this crew member (see stepDone). */
  tokens: number
}

export type Ticker = { phase: string; beat: number; done: number; total: number; duets: number; clock: string; title: string }

export type StatusLine =
  | { state: 'running'; name: string; role: string; color: string; tool: string; label: string; seconds: number; running: number }
  | { state: 'finished'; name: string; role: string; color: string; tool: string; label: string; seconds: number; ok: boolean; running: number }
  | { state: 'idle'; seconds: number; running: number }

export type Card = { id: string; title: string; role: RoleId; status: 'pending' | 'in_progress' | 'completed' }

/** A call's crew member, tool and target, and the model of the run that asked for it ('' when unknown). */
export type Who = { name: string; role: string; color: string; tool: string; label: string; model: string; modelColor: string; sub: boolean }
export type StripInfo = {
  open: boolean
  thinking: number | null
  turnSeconds: number
  running: (Who & { id: string; seconds: number; waiting: boolean })[]
  failures: (Who & { id: string })[]
  recent: (Who & { id: string; ok: boolean; seconds: number })[]
  receipt: string | null
  /** The main loop's model, short ('' before its first request). */
  mainModel: string
  /** Successful ship calls this turn (commit, push, pull request, release, deploy). */
  shipped: number
}
export type ContextInfo = { tokens: number | null; window: number | null; percent: number | null; compacting: boolean }
export type Kpis = {
  tokensIn: number
  tokensOut: number
  /** Share of input served from cache, 0..1. */
  cached: number
  calls: number
  failed: number
  running: number
  planDone: number
  planTotal: number
  seconds: number
  requests: number
  /** The whole session's tokens and model requests. */
  sessionTokens: number
  sessionRequests: number
  /** Running subagents in the boardroom: seated, standing, and counted at the door. */
  boardroom: { seated: number; standing: number; more: number }
}
export type Usage = { model?: string; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
export type MachineInfo = {
  key: string
  name: string
  description: string
  model: string
  effort: string
  color: string
  on: boolean
  requests: number
  parentId: string | null
  seconds: number
  usage: Usage | null
  /** False for a subagent listed as running whose model requests the office has not seen yet. */
  seen: boolean
}
export type MachinesInfo = { list: MachineInfo[]; more: number; on: number }

export type Snapshot = {
  simT: number
  phase: string | null
  title: string | null
  idle: boolean
  duets: number
  cards: { id: string; title: string; role: RoleId; state: string }[]
  agents: {
    id: string
    name: string
    role: RoleId
    state: string
    room: string
    x: number
    y: number
    working: boolean
    dancing: boolean
    tool: string | null
    running: number
    bubble: string | null
    duet: { giver: string; taker: string; kind: string } | null
    delivering: { to: string; kind: string } | null
    done: number
  }[]
  receptionist: string | null
  view: { zoom: number; start: number; room: string; slots: number[] | null; pinned: string[]; autoCam: boolean }
  particles: { total: number; confetti: number }
  status: StatusLine
  ticker: Ticker
  log: { t: number; text: string; role: RoleId | null }[]
  announce: string
  strip: StripInfo
  machines: MachinesInfo
  kpis: Kpis
  tokens: Record<RoleId, number>
  context: ContextInfo
  ships: string[]
}

export interface Office {
  advance(seconds: number): void
  render(): Frame
  /**
   * Films `count` frames `dt` seconds apart from now, then rewinds; the live
   * run then replays the same random draws until the next outside event.
   * onFrame may return false to stop early. Returns the frames filmed.
   */
  film(count: number, dt: number, onFrame: (k: number, frame: Frame, view: { key: string; hallX: number | null; camX?: number }) => boolean | void, cut?: boolean | { x: number; w: number }): number
  /** The live camera's x over the next frames (no drawing), whether rooms are pinned, and the view width. */
  camPath(count: number, dt: number): { xs: number[]; pinned: boolean; width: number }
  /** 2/3-room view: pin or unpin a room (pinned rooms show side by side); clearPins unpins all. */
  togglePin(room: number): void
  clearPins(): void
  readonly pinned: number[]
  /** Bumped by every outside event, press or setting change. */
  readonly version: number
  readonly zoom: number
  setZoom(z: number): void
  readonly autoCam: boolean
  setAutoCam(on: boolean): void
  goRoom(r: number): void
  prevRoom(): void
  nextRoom(): void
  canPrev(): boolean
  canNext(): boolean
  toggleFollow(id: string): void
  readonly selectedId: string | null
  setTheme(t: ThemeId): void
  setMotion(m: Motion): void
  rooms(): RoomInfo[]
  crew(): CrewInfo[]
  ticker(): Ticker
  statusLine(): StatusLine
  snapshot(): Snapshot
  crewSprite(id: string): Px
  startMission(text: string): void
  toolStart(id: string, role: RoleId, tool: string, label?: string, extra?: { run?: string; ship?: boolean }): unknown
  toolEnd(id: string, ok: boolean): void
  handoff(from: RoleId, to: RoleId, kind: 'handoff' | 'rework', title?: string): void
  bug(from?: RoleId, to?: RoleId, title?: string): void
  turnEnd(reason?: string): void
  setCards(cards: Card[]): void
  turnStart(): void
  markWaiting(tool: string): boolean
  machineStep(key: string, model: string, effort?: string | number): void
  machineStepEnd(key: string): void
  machineDone(key: string, usage?: Usage | null, durationMs?: number): void
  machineInfo(key: string, info: { type?: string; description?: string; parentId?: string }): void
  /** One model request finished: add its usage, split across the crew whose tools it asked for. */
  stepDone(key: string, usage: Partial<Usage> | null | undefined, roles: RoleId[]): void
  kpis(): Kpis
  /** Claude Code's plan mode: the crew meets in the boardroom until it ends. */
  setPlanMode(on: boolean): void
  readonly planMode: boolean
  /** Split view: the free slot stays on the work room (the town hall during a ship). */
  lockWorkSlot(on: boolean): void
  /** A subagent the engine lists as running, before any of its requests is seen. */
  machineSeed(key: string, info: { type?: string; description?: string; parentId?: string | null }): void
  /** The main loop's context window: figures from the engine (window, and tokens when known). */
  setContext(c: { tokens?: number; window?: number }): void
  compactStart(trigger?: string): void
  compactEnd(): void
  context(): ContextInfo
  strip(): StripInfo
  machines(): MachinesInfo
  toolRole(id: string): (Who & { ok: boolean | null; seconds: number }) | null
  readonly simT: number
}
