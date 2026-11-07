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
}

export type Frame = { width: number; height: number; base: Px; fx: Px | null }

export type RoomInfo = {
  index: number
  name: string
  current: boolean
  inView: boolean
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
}

export type Ticker = { phase: string; beat: number; done: number; total: number; duets: number; clock: string; title: string }

export type StatusLine =
  | { state: 'running'; name: string; role: string; color: string; tool: string; label: string; seconds: number; running: number }
  | { state: 'finished'; name: string; role: string; color: string; tool: string; label: string; seconds: number; ok: boolean; running: number }
  | { state: 'idle'; seconds: number; running: number }

export type Card = { id: string; title: string; role: RoleId; status: 'pending' | 'in_progress' | 'completed' }

export type Who = { name: string; role: string; color: string; tool: string; label: string }
export type StripInfo = {
  open: boolean
  thinking: number | null
  turnSeconds: number
  running: (Who & { id: string; seconds: number; waiting: boolean })[]
  failures: (Who & { id: string })[]
  recent: (Who & { id: string; ok: boolean; seconds: number })[]
  receipt: string | null
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
  view: { zoom: number; start: number; room: string; autoCam: boolean }
  particles: { total: number; confetti: number }
  status: StatusLine
  ticker: Ticker
  log: { t: number; text: string; role: RoleId | null }[]
  announce: string
  strip: StripInfo
  machines: MachinesInfo
}

export interface Office {
  advance(seconds: number): void
  render(): Frame
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
  toolStart(id: string, role: RoleId, tool: string, label?: string): unknown
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
  strip(): StripInfo
  machines(): MachinesInfo
  toolRole(id: string): (Who & { ok: boolean | null; seconds: number }) | null
  readonly simT: number
}
