import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { bashLabel, classifyBash, classifyText, isShipCommand, routeTool } from '../hooks/classify.ts'

const PLUGIN = 'digital-workplace'
const STATUS = 'mcp__digital-workplace__crew_status'
const SURFACES = ['desktop', 'mobile', 'vscode', 'terminal'] as const
const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: 'digital-workplace',
  props: { title: 'Digital Workplace', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const PRESENTATION = { isFullscreen: true, columns: 160 }
const say = (...a: unknown[]): void => (globalThis as { console?: { log(...x: unknown[]): void } }).console?.log(...a)
const prompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

/** The world beneath the plugin: an engine that places panes, a mocked clock, a tool that answers. */
function world(on: On, shown = true, openReason?: string, surfaces?: string[]) {
  const clock = mock.clock(on)
  const hold = { release: (): void => {} }
  const perm: { decision?: unknown } = {}
  const panes = new Set<string>()
  const counts = { invalidate: 0, audio: 0 }
  on('command.register', () => ({ value: { command: 'workplace' } }))
  on('tool.register', () => ({ value: { tool: STATUS } }))
  on('ui.open', (_, e) => { if (openReason) return { value: { isPlaced: false, reason: openReason } }; panes.add(e.id); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: 'Digital Workplace', isShown: shown, isFocused: false, isPlaced: true })) }))
  on('ui.close', (_, e) => { panes.delete(e.id); return { value: undefined } })
  on('ui.invalidate', () => { counts.invalidate++; return { value: undefined } })
  on('audio.play', () => { counts.audio++; return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('classic.PreCompact', () => ({}))
  on('classic.PostCompact', () => ({}))
  on('ui.status', () => ({ value: undefined }))
  if (surfaces) on('session.surfaces', () => ({ value: surfaces as never }))
  on('classic.PermissionRequest', () => (perm.decision ? { decision: perm.decision } : {}) as never)
  on('ui.render', { component: 'ToolUse' }, ($, e) => { const { Text } = $.ui.resolve(e); return <Text>row</Text> })
  on('tool.call', (_, e) => {
    const cmd = String((e as { command?: unknown }).command ?? '')
    if (e.tool === 'Bash' && /fail/.test(cmd)) return { isError: true as const, result: 'Exit code 1', text: 'Exit code 1\n1 failing' }
    if (e.tool === 'Bash' && /hold/.test(cmd)) return new Promise(r => { hold.release = () => r({ result: { ok: true, tool: e.tool } }) })
    if (e.tool === 'TaskCreate') return { result: { task: { id: '7', subject: String((e as { subject?: unknown }).subject) } } }
    return { result: { ok: true, tool: e.tool } }
  })
  on('agent.list', () => ({ value: [{ id: 'a1', type: 'Explore', description: 'Find the hooks API', status: 'running' }] }))
  // A model request that streams one chunk, then waits until the test lets it finish.
  const step = { release: (): void => {}, usage: null as unknown, toolUses: [] as unknown[] }
  on('turn.step', async function* (_, e) {
    const gate = new Promise<void>(r => { step.release = r })
    yield { kind: 'text', index: 0, text: '…' }
    await gate
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: step.toolUses, stopReason: 'end_turn', usage: step.usage } as never
  })
  return { clock, panes, counts, hold, step, perm }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function start($: any) {
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
}
/** What the crew is doing, as the mod's own status tool reports it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function crew($: any): Promise<string> {
  const r = await $.tool.call({ tool: STATUS })
  return String(r.result)
}
const line = (summary: string, name: string): string => summary.split('\n').find(l => l.startsWith(name + ' ')) ?? ''
const turnDone = { answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' as const }

test('1. the pane opens at start and shows the office within 2 s, on every surface', async ($, on) => {
  const w = world(on)
  const t0 = performance.now()
  await start($)
  expect(w.panes.has('digital-workplace')).toBe(true)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'terminal') {
      // no picture support named in the environment: coloured half blocks
      const raster = await ui.find({ type: 'Raster', key: 'view' })
      expect(raster?.props.columns).toBe(60)
      expect(raster?.props.rows).toBe(22)
      const bytes = Uint8Array.from(atob(String(raster?.props.cells)), ch => ch.charCodeAt(0))
      expect(bytes.length).toBe(60 * 22 * 12)
      const glyph = new DataView(bytes.buffer).getUint32(0, true)
      expect(glyph === 0x20 || (glyph >= 0x2580 && glyph <= 0x259f)).toBe(true)
    } else {
      const svg = await ui.find({ type: 'Svg' })
      const src = String(svg?.props.source ?? '')
      expect(src.startsWith('<svg')).toBe(true)
      expect(src).toContain('data:image/png;base64,')
      expect(src.length).toBeLessThan(131072)
      expect(src).toContain('prefers-reduced-motion')
    }
    expect(await ui.find({ type: 'Button', key: 'room-3' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'zoom-2' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'cam' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'sound' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'crew-kit' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Crew idle/ })).toBeDefined()
    await ui.unmount()
  }
  const ms = performance.now() - t0
  say(`pane open + first frame on 4 surfaces: ${ms.toFixed(0)} ms`)
  expect(ms).toBeLessThan(2000)
  // and it keeps redrawing on the timer: slowly while idle, at the full rate while busy
  let before = w.counts.invalidate
  await w.clock.advance(1000)
  expect(w.counts.invalidate - before).toBeGreaterThanOrEqual(2)
  expect(w.counts.invalidate - before).toBeLessThan(7)
  await $.prompt.submit(prompt('Go'))
  before = w.counts.invalidate
  await w.clock.advance(1000)
  expect(w.counts.invalidate - before).toBeGreaterThanOrEqual(7)
})

test('2. a message alone keeps the crew at their desks; Zorya thinks in the boardroom', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('What does the director do?'))
  await w.clock.advance(1500)
  const s = await crew($)
  expect(s).toContain('Phase: Working · "What does the director do?"')
  expect(s).toContain('Zorya is thinking it over')
  expect(line(s, 'Zorya')).toContain(' · Boardroom')
  for (const name of ['Qix', 'Lumi', 'Brix', 'Vex', 'Pip']) expect(line(s, name)).toContain(' · Open office')
  expect(s).not.toMatch(/Walking to the briefing|In the briefing/)
})

test('2a. a plan gathers the crew in the boardroom and Zorya briefs, until the first tool runs', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Build a Claude Code mod called "Digital Workplace" that docks my pixel-art office page as a side pane next to the chat.'))
  await w.clock.advance(500)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Read the page', status: 'in_progress', activeForm: 'Reading' }, { content: 'Port it', status: 'pending', activeForm: 'Porting' }] } as never)
  await w.clock.advance(250)
  let s = await crew($)
  expect(s).toContain('Phase: Briefing · "Build a Claude Code mod called "Digital Workplace" that d..."')
  expect(s).toContain('The crew is heading to the boardroom for the briefing.')
  // the crew pops in through the door and walks to the seats; the briefing starts once all sit
  for (let i = 0; i < 24 && !/Phase: Zorya is briefing/.test(s); i++) { await w.clock.advance(250); s = await crew($) }
  expect(s).toContain('Phase: Zorya is briefing')
  expect(s.split('\n').filter(l => / · Boardroom/.test(l)).length).toBeGreaterThanOrEqual(5)
  expect(s).toContain('View: Boardroom')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Zorya is briefing/ })).toBeDefined()
  await ui.unmount()
  // the first real tool call ends the briefing; a second plan in the same task does not gather again
  await $.tool.call({ tool: 'Read', file_path: '/work/page.html' })
  await w.clock.advance(250)
  expect(await crew($)).toMatch(/Phase: Working/)
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Read the page', status: 'completed', activeForm: 'Reading' }, { content: 'Port it', status: 'in_progress', activeForm: 'Porting' }] } as never)
  await w.clock.advance(250)
  expect(await crew($)).not.toContain('Phase: Briefing')
})

test('2b. the mission title leaves out system-reminder blocks the app puts before the prompt', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('<system-reminder>\nfoo\n</system-reminder>\nhi'))
  await w.clock.advance(250)
  const s = await crew($)
  expect(s).toContain('Phase: Working · "hi"')
  expect(s).toContain('Reception logged a new request: "hi".')
  expect(s).not.toContain('system-reminder')
})

test('3. Read, Edit and a test run put Qix, Brix and Pip to work within 1 s', async ($, on) => {
  const w = world(on)
  await start($)
  const cases = [
    { call: { tool: 'Read', file_path: '/work/agent-boardroom.html' }, name: 'Qix', role: 'Research', room: 'Open office' },
    { call: { tool: 'Edit', file_path: '/work/hooks/raster.ts', old_string: 'a', new_string: 'b' }, name: 'Brix', role: 'Build', room: 'Open office' },
    { call: { tool: 'Bash', command: 'npm test' }, name: 'Pip', role: 'QA', room: 'Open office' },
  ] as const
  for (const c of cases) {
    const t0 = performance.now()
    await $.tool.call(c.call as never)
    const hookMs = performance.now() - t0
    await w.clock.advance(125) // one frame
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const status = await ui.find({ type: 'Text', text: new RegExp(`^○ ${c.name} \\(${c.role}\\) · ${c.call.tool}`) })
    expect(status).toBeDefined()
    await ui.unmount()
    let s = await crew($)
    expect(line(s, c.name)).toMatch(/Heading to the|Read|Edit|Bash|Finishing/)
    // walking there, then working at the desk
    await w.clock.advance(5000)
    s = await crew($)
    expect(line(s, c.name)).toContain(` · ${c.room}`)
    say(`${c.call.tool}: hook path ${hookMs.toFixed(1)} ms (test kit included); ${line(s, c.name)}`)
  }
  // Lumi takes UI files
  await $.tool.call({ tool: 'Write', file_path: '/work/pane.css', content: 'a{}' })
  await w.clock.advance(125)
  expect(line(await crew($), 'Lumi')).toMatch(/Heading to the open office|Write/)
  // Vex takes git diff
  await $.tool.call({ tool: 'Bash', command: 'git diff --stat' })
  await w.clock.advance(125)
  expect(line(await crew($), 'Vex')).toMatch(/Heading to the open office|Bash/)
})

test('3b. a long tool call shows its role, tool and a ticking elapsed time', async ($, on) => {
  let release: () => void = () => {}
  on('tool.call', { tool: 'Grep' }, () => new Promise(r => { release = () => r({ result: { matches: 1 } }) }))
  const w = world(on)
  await start($)
  const pending = $.tool.call({ tool: 'Grep', pattern: 'register' } as never)
  await w.clock.advance(3000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^● Qix \(Research\) · Grep · register · 0:0[23]$/ })).toBeDefined()
  await ui.unmount()
  release()
  await pending
})

test('4. a failing test shows the bug bubble and the Pip-to-Brix duet', async ($, on) => {
  const w = world(on)
  await start($)
  const r = await $.tool.call({ tool: 'Bash', command: 'npm test -- --fail' } as never)
  expect(r.isError).toBe(true) // the failure reaches Claude unchanged
  await w.clock.advance(125)
  let s = await crew($)
  expect(line(s, 'Pip')).toContain('bubble bug')
  let duet = ''
  for (let i = 0; i < 40 && !duet; i++) {
    await w.clock.advance(250)
    s = await crew($)
    if (/duet dot->kit \(rework\)/.test(line(s, 'Pip'))) duet = line(s, 'Pip')
  }
  say('duet:', duet)
  expect(duet).toMatch(/duet dot->kit \(rework\)/)
  expect(line(s, 'Brix')).toMatch(/Receiving from Pip/)
})

test('5. a turn that ships (here a git commit) ends with the town hall demo, then the party', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Ship it'))
  await w.clock.advance(1000)
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'git -C /work commit -am "Ship it"' })
  await w.clock.advance(1000)
  expect(await crew($)).toMatch(/Brix shipped: Bash git commit -am/)
  await $.turn.complete(turnDone as never)
  // The briefing that the prompt started finishes first, then the crew heads out.
  let s = ''
  for (let i = 0; i < 60 && !/Phase: Off to the town hall/.test(s); i++) { await w.clock.advance(250); s = await crew($) }
  expect(s).toContain('Phase: Off to the town hall')
  for (let i = 0; i < 120 && !/Phase: Live demo/.test(s); i++) { await w.clock.advance(250); s = await crew($) }
  expect(s).toContain('Phase: Live demo at the town hall')
  expect(s).toContain('View: Town hall')
  expect(line(s, 'Zorya')).toMatch(/Demoing on stage/)
  for (let i = 0; i < 60 && !/Phase: Shipped · town hall party/.test(s); i++) { await w.clock.advance(250); s = await crew($) }
  expect(s).toContain('Phase: Shipped · town hall party')
  await w.clock.advance(3000)
  s = await crew($)
  expect(s.split('\n').filter(l => /Dancing/.test(l)).length).toBeGreaterThanOrEqual(4)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
  expect(svg).toMatch(/class="[^"]*\bfx\b/) // confetti + disco ride the reduced-motion layer
  await ui.unmount()
})

test('5b. 60 s without activity sends the crew idle (desks, coffee, lounge)', async ($, on) => {
  const w = world(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/a' })
  await w.clock.advance(30000)
  expect(await crew($)).not.toContain('Phase: Idle')
  await w.clock.advance(35000)
  expect(await crew($)).toContain('Phase: Idle')
})

test('6. hide and show work, and nothing breaks while the pane is closed', async ($, on) => {
  const w = world(on)
  await start($)
  const hide = await $.command.run({ command: 'workplace', args: 'hide', origin: { kind: 'composer' }, presentation: PRESENTATION } as never)
  expect(String((hide as { text?: unknown }).text)).toMatch(/hidden/)
  expect(w.panes.size).toBe(0)
  const before = w.counts.invalidate
  await w.clock.advance(2000)
  expect(w.counts.invalidate).toBe(before) // no redraws while hidden
  // Claude keeps working normally with the pane closed
  const r = await $.tool.call({ tool: 'Read', file_path: '/a' })
  expect(r.result).toEqual({ ok: true, tool: 'Read' })
  await $.prompt.submit(prompt('still works'))
  await $.turn.complete(turnDone as never)
  const show = await $.command.run({ command: 'workplace', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION } as never)
  expect(String((show as { text?: unknown }).text)).toMatch(/shown/)
  expect(w.panes.has('digital-workplace')).toBe(true)
  await w.clock.advance(1000)
  expect(w.counts.invalidate).toBeGreaterThan(before)
  // toggling with no argument closes it again
  await $.command.run({ command: 'workplace', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION } as never)
  expect(w.panes.size).toBe(0)
  const n = w.counts.invalidate
  await w.clock.advance(1000)
  expect(w.counts.invalidate).toBe(n)
})

test('terminals that show pictures get the pixel art as an image', async ($, on) => {
  mock.env(on, { TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1' })
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const img = await ui.find({ type: 'Image', key: 'view' })
  expect(String((img?.props.source as { png?: unknown })?.png ?? '').length).toBeGreaterThan(1000)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  await ui.unmount()
})

test('Windows Terminal gets coloured blocks; the setting can force pictures', { options: { terminalArt: 'image' } }, async ($, on) => {
  mock.env(on, { WT_SESSION: 'abc', TERM_PROGRAM: '' })
  world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Image', key: 'view' })).toBeDefined()
  await ui.unmount()
})

test('a bare /workplace brings forward a pane that is open but not on screen', async ($, on) => {
  const w = world(on, false) // open, but another tab is in front
  await start($)
  const r = await $.command.run({ command: 'workplace', args: '', origin: { kind: 'composer' }, presentation: PRESENTATION } as never)
  expect(String((r as { text?: unknown }).text)).toMatch(/shown/)
  expect(w.panes.has('digital-workplace')).toBe(true)
})

test('openOnStart false keeps the pane closed until /workplace', { options: { openOnStart: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  expect(w.panes.size).toBe(0)
  await $.command.run({ command: 'workplace', args: 'show', origin: { kind: 'composer' }, presentation: PRESENTATION } as never)
  expect(w.panes.size).toBe(1)
})

test('tool calls and prompts pass through unchanged, odd input included', async ($, on) => {
  world(on)
  await start($)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).result).toEqual({ ok: true, tool: 'Bash' })
  expect((await $.tool.call({ tool: 'TodoWrite', todos: 'not a list' } as never)).result).toEqual({ ok: true, tool: 'TodoWrite' })
  expect((await $.tool.call({ tool: 'mcp__x__y' } as never)).result).toEqual({ ok: true, tool: 'mcp__x__y' })
  expect((await $.tool.call({ tool: 'Agent' } as never)).result).toEqual({ ok: true, tool: 'Agent' })
  const p = await $.prompt.submit(prompt('hello'))
  expect((p as { text?: string }).text).toBe('hello')
  const t0 = performance.now()
  for (let i = 0; i < 200; i++) await $.tool.call({ tool: 'Read', file_path: `/f${i}` })
  say(`200 Read calls through the hook chain: ${((performance.now() - t0) / 200).toFixed(2)} ms each (test kit included)`)
})

test('an aborted tool call never leaves a crew member stuck at work', async ($, on) => {
  on('tool.call', { tool: 'Glob' }, () => { throw new Error('interrupted') })
  const w = world(on)
  await start($)
  let rejected = false
  try { await $.tool.call({ tool: 'Glob', pattern: '**/*.ts' } as never) } catch { rejected = true }
  await w.clock.advance(8000)
  const s = await crew($)
  say(`aborted Glob (call ${rejected ? 'rejected' : 'resolved'}): ${line(s, 'Qix')}`)
  expect(line(s, 'Qix')).not.toMatch(/Glob ·|Heading to/)
  expect(s).toContain('Status: ○ Qix (Research) · Glob')
})

test('plans become cards, shown as written and unassigned', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Build the pane'))
  await $.tool.call({ tool: 'TodoWrite', todos: [
    { content: 'Read the page script', status: 'completed', activeForm: 'Reading' },
    { content: 'Style the pane layout', status: 'in_progress', activeForm: 'Styling' },
    { content: 'Implement the hooks module', status: 'pending', activeForm: 'Implementing' },
    { content: 'Run the tests', status: 'pending', activeForm: 'Testing' },
    { content: 'Review the diff', status: 'pending', activeForm: 'Reviewing' },
  ] } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Write the release report', description: 'summary for the user' } as never)
  await w.clock.advance(125)
  const s = await crew($)
  expect(s).toContain('[done] Read the page script -> none')
  expect(s).toContain('[working] Style the pane layout -> none')
  expect(s).toContain('[queued] Implement the hooks module -> none')
  expect(s).toContain('[queued] Run the tests -> none')
  expect(s).toContain('[queued] Review the diff -> none')
  expect(s).toContain('[queued] Write the release report -> none')
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' } as never)
  expect(await crew($)).toContain('[done] Write the release report -> none')
})

test('sub-agent launch plays a hand-off duet from Zorya', async ($, on) => {
  const w = world(on)
  await start($)
  await $.tool.call({ tool: 'Agent', description: 'Explore hooks API', prompt: 'Find the hooks', subagent_type: 'Explore' } as never)
  let s = ''
  for (let i = 0; i < 80 && !/duet nova->pax \(handoff\)/.test(s); i++) { await w.clock.advance(250); s = await crew($) }
  expect(line(s, 'Zorya')).toMatch(/duet nova->pax \(handoff\)/)
})

test('room tabs, zoom, auto camera, follow and sound respond to presses', async ($, on) => {
  const w = world(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'room-7' })
  await w.clock.advance(1000)
  expect(await crew($)).toContain('View: Kitchen, 1 room(s), auto camera off')
  await ui.press({ key: 'zoom-3' })
  await ui.press({ key: 'cam' })
  expect(await crew($)).toContain('3 room(s), auto camera on')
  await ui.press({ key: 'sound' })
  expect(w.counts.audio).toBeGreaterThanOrEqual(1) // the music loop starts
  await ui.press({ key: 'crew-kit' })
  await w.clock.advance(1500)
  expect(await crew($)).toContain('View: Open office')
  await ui.unmount()
})

test('classifier', () => {
  expect(classifyBash('npm test').role).toBe('qa')
  expect(classifyBash('cd app && npx vitest run').isCheck).toBe(true)
  expect(classifyBash('pytest -q tests/').role).toBe('qa')
  expect(classifyBash('cargo build --release').role).toBe('qa')
  expect(classifyBash('npx eslint .').role).toBe('qa')
  expect(classifyBash('git diff HEAD~1').role).toBe('review')
  expect(classifyBash('git log --oneline -5').role).toBe('review')
  expect(classifyBash('cat jest.config.js').role).toBe('research')
  expect(classifyBash('ls -la').role).toBe('research')
  expect(classifyBash('mkdir -p out && cp a b').role).toBe('build')
  expect(classifyBash('git status && git diff').role).toBe('review')
  expect(classifyBash('npm run review').role).toBe('review')
  expect(classifyBash('ls src; git -C /home/user/board-room log -1').role).toBe('review')
  expect(classifyBash('git -c core.pager=cat --no-pager diff').role).toBe('review')
  expect(classifyBash('git -C repo status').role).toBe('research')
  expect(classifyBash('git -C repo commit -m x').role).toBe('build')
  // the target is the program that runs, not a variable set before it
  expect(bashLabel('S="C:/Users/x/AppData/Local/t"; cd "$S" && node run.js --sector 4')).toBe('node run.js --sector 4')
  expect(bashLabel('$root = "C:/x"; npm test')).toBe('npm test')
  expect(bashLabel('cd app && npx vitest run')).toBe('npx vitest run')
  expect(bashLabel('ls -la')).toBe('ls -la')
  // shipping: work that leaves the machine
  for (const c of ['git commit -m x', 'git -C repo push -u origin main', 'gh pr create --fill', 'gh pr merge 3', 'gh api -X PUT repos/o/r/pulls/3/merge', 'npm publish', 'npm run deploy', 'wrangler deploy', 'cd app && git push']) expect(isShipCommand(c)).toBe(true)
  for (const c of ['git status', 'git diff', 'git log', 'gh pr view 3', 'npm test', 'git commitish', 'echo git push']) expect(isShipCommand(c)).toBe(false)
  expect(routeTool('mcp__github__create_pull_request', {}, 'mcp__digital-workplace__')).toMatchObject({ kind: 'work', isShip: true })
  expect(routeTool('Edit', { file_path: '/a/b/Pane.tsx' }, 'mcp__digital-workplace__')).toEqual({ kind: 'work', role: 'design', label: 'Pane.tsx', isCheck: false })
  expect(routeTool('Write', { file_path: '/a/main.go' }, 'mcp__digital-workplace__')).toEqual({ kind: 'work', role: 'build', label: 'main.go', isCheck: false })
  expect(routeTool('WebFetch', { url: 'https://example.com/x' }, 'mcp__digital-workplace__')).toEqual({ kind: 'work', role: 'research', label: 'example.com', isCheck: false })
  expect(routeTool(STATUS, {}, 'mcp__digital-workplace__')).toEqual({ kind: 'ignore' })
  expect(routeTool('Agent', { description: 'Review the PR', subagent_type: 'general-purpose' }, 'mcp__digital-workplace__')).toEqual({ kind: 'launch', role: 'review', title: 'Review the PR' })
  expect(classifyText('Fix the failing tests')).toBe('qa')
  expect(classifyText('Design the pane layout')).toBe('design')
  expect(classifyText('Investigate the hooks API')).toBe('research')
  expect(classifyText('Implement the encoder')).toBe('build')
})

const usage = (model: string, input: number, output: number) => ({ model, input_tokens: input, output_tokens: output, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 })
/** Runs one model request up to its first chunk and returns a function that finishes it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function stepOpen($: any, w: ReturnType<typeof world>, agentId?: string): Promise<() => Promise<void>> {
  const it = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 3, ...(agentId ? { agentId } : {}) })[Symbol.asyncIterator]()
  await it.next()
  return async () => { w.step.release(); await it.next() }
}

test('the compute rack powers one machine per run and reports its tokens', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Find the hooks'))
  await $.turn.start({ text: 'Find the hooks', turnId: 't1' } as never)
  const done = await stepOpen($, w)
  await w.clock.advance(1500)
  let s = await crew($)
  expect(s).toMatch(/● main · opus 5\.5 · high · 1 req · 0:0[12]/)
  expect(s).toContain('Compute · ⚡1 on')
  expect(s).toMatch(/◌ Zorya thinking/)
  await done()
  const sub = await stepOpen($, w, 'a1')
  await w.clock.advance(250)
  s = await crew($)
  expect(s).toMatch(/  ● Explore · opus 5\.5 · high · 1 req/)
  expect(s).toContain('Compute · ⚡2 on')
  await sub()
  await $.turn.complete({ ...turnDone, agentId: 'a1', usage: usage('claude-opus-5-5', 1200, 300), durationMs: 4000 } as never)
  await $.turn.complete({ ...turnDone, usage: usage('claude-opus-5-5', 15000, 2100), durationMs: 9000 } as never)
  s = await crew($)
  expect(s).toContain('○ main · opus 5.5 · high · 24.0k in (9.0k cached) · 2.1k out · 0:09')
  expect(s).toContain('  ○ Explore · opus 5.5 · high · 10.2k in (9.0k cached) · 300 out · 0:04')
  expect(s).toContain('Compute · ⚡0 on')
  expect(s).toMatch(/✓ Done in 0:0\d/)
})

test('a call that went to the person for approval is marked "asked for your OK"', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Deploy it'))
  const call = $.tool.call({ tool: 'Bash', command: 'npm run hold-deploy' })
  await w.clock.advance(125)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm run hold-deploy' } } as never)
  await w.clock.advance(125)
  const s = await crew($)
  expect(s).toMatch(/\? Brix \(Build\) · Bash · npm run hold-deploy · 0:0\d · asked for your OK/)
  expect(line(s, 'Brix')).toMatch(/asked for your OK/)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /asked for your OK/ })).toBeDefined()
  await ui.unmount()
  w.hold.release()
  await call
  await w.clock.advance(125)
  const after = await crew($)
  expect(after).not.toMatch(/\? Brix \(Build\).*asked for your OK/)
  expect(line(after, 'Brix')).not.toMatch(/asked for your OK/)
})

test('failures stay in the strip until the same target passes', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Fix tests'))
  await $.tool.call({ tool: 'Bash', command: 'npm test -- fail' })
  await w.clock.advance(250)
  expect(await crew($)).toMatch(/✗ Pip \(QA\) · Bash · npm test -- fail failed/)
  await $.tool.call({ tool: 'Read', file_path: '/a/x.ts' })
  await w.clock.advance(250)
  expect(await crew($)).toMatch(/✗ Pip \(QA\)/) // an unrelated success does not clear it
  await $.turn.complete(turnDone as never)
  await w.clock.advance(250)
  expect(await crew($)).toMatch(/✗ Done in 0:0\d · 1 read, 1 test · 1 failed/)
})

const ROW = (id: string) => ({ plugin: PLUGIN, component: 'ToolUse', requestId: id, props: { tool_use_id: id, tool: 'Read', input: { file_path: '/a/notes.md' }, isRunning: false, isErrored: false, isInterrupted: false } }) as const

test('tool-row chips are off unless the setting turns them on', async ($, on) => {
  const w = world(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/a/notes.md', tool_use_id: 'req-1' } as never)
  await w.clock.advance(125)
  const ui = await $.ui.mount({ ...ROW('req-1'), surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: /Qix · Read/ })).toBeUndefined()
  await ui.unmount()
})

test('tool-row chips record each call when enabled', { options: { toolChips: true } }, async ($, on) => {
  const w = world(on)
  await start($)
  await $.tool.call({ tool: 'Read', file_path: '/a/notes.md', tool_use_id: 'req-1' } as never)
  await w.clock.advance(125)
  const ui = await $.ui.mount({ ...ROW('req-1'), surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: /^Qix · Read notes\.md ✓ 0:00$/ })).toBeDefined()
  await ui.unmount()
})

test('in a session with no drawing surface, /workplace says so in one line', async ($, on) => {
  world(on, true, 'no-surface: no surface is attached ($.session.surfaces() is empty)')
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true } as never)
  const r = await $.command.run({ command: 'workplace', args: '' } as never)
  const text = String((r as { text?: unknown }).text)
  expect(text).toMatch(/No drawing surface in this session/)
  expect(text.split('\n').length).toBe(1)
})

test('the desktop pane plays a film and redraws only when something changes', async ($, on) => {
  const w = world(on, true, undefined, ['desktop'])
  await start($)
  await $.prompt.submit(prompt('Read the hooks'))
  await $.tool.call({ tool: 'Read', file_path: '/a/register.tsx' })
  await w.clock.advance(1500)
  // A film that starts right at a camera cut holds one frame, so look at a few redraws.
  let src = ''
  for (let i = 0; i < 8 && !src.includes('class="p"'); i++) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    src = String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
    expect(src).toContain('.p{animation:none}') // reduced motion: the base frame only
    expect(src.length).toBeLessThan(131072)
    await ui.unmount()
    await w.clock.advance(250)
  }
  expect(src).toContain('class="p"') // frames after the first, revealed on time by CSS
  expect(src).toMatch(/animation-delay:-?\d+\.\d{3}s/)
  // Two quieter seconds: a terminal would redraw 16 times; here only a new film or new text redraws.
  const before = w.counts.invalidate
  await w.clock.advance(2000)
  expect(w.counts.invalidate - before).toBeLessThanOrEqual(8)
})

test('films keep working after a turn reports its usage (event data is frozen)', async ($, on) => {
  const w = world(on, true, undefined, ['desktop'])
  await start($)
  await $.prompt.submit(prompt('Read it'))
  await $.turn.start({ text: 'Read it', turnId: 't1' } as never)
  const done = await stepOpen($, w)
  await done()
  await $.tool.call({ tool: 'Read', file_path: '/a/x.ts' })
  await $.turn.complete({ ...turnDone, usage: usage('claude-opus-5-5', 500, 60) } as never)
  await w.clock.advance(3000)
  const s = await crew($)
  expect(s).toContain('Phase: Done · ready for a task') // a turn without a ship ends at the desks
  expect(s).not.toMatch(/Recent:[\s\S]*\d{2,}\.\ds ago/) // and nothing was pushed tens of seconds into the future
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(String((await ui.find({ type: 'Svg' }))?.props.source ?? '')).toContain('<svg')
  await ui.unmount()
})

test('a request a settings hook decides never reaches the person, so it is not marked', async ($, on) => {
  const w = world(on)
  w.perm.decision = { behavior: 'allow' }
  await start($)
  await $.prompt.submit(prompt('Deploy it'))
  const call = $.tool.call({ tool: 'Bash', command: 'npm run hold-deploy' })
  await w.clock.advance(125)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'npm run hold-deploy' } } as never)
  await w.clock.advance(125)
  expect(await crew($)).not.toMatch(/asked for your OK/)
  w.hold.release()
  await call
})

test('each model request adds its tokens to the KPIs and to the crew whose tools it asked for', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Fix it'))
  await $.turn.start({ text: 'Fix it', turnId: 't1' } as never)
  // request 1 asks for a Read and an Edit: Qix and Brix share its 10,001 tokens
  w.step.usage = { model: 'claude-opus-5-5', input_tokens: 1000, cache_read_input_tokens: 8000, cache_creation_input_tokens: 1, output_tokens: 1000 }
  w.step.toolUses = [{ id: 'u1', name: 'Read', input: { file_path: '/a/x.ts' } }, { id: 'u2', name: 'Edit', input: { file_path: '/a/x.ts' } }]
  await (await stepOpen($, w))()
  // request 2 only answers: Zorya
  w.step.usage = { model: 'claude-opus-5-5', input_tokens: 500, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, output_tokens: 300 }
  w.step.toolUses = []
  await (await stepOpen($, w))()
  await $.tool.call({ tool: 'Bash', command: 'npm test -- fail' })
  await w.clock.advance(250)
  const s = await crew($)
  expect(s).toContain('Tokens 18.5k in (92% cached) · 1.3k out · Calls 1 (1 failed) · 2 req')
  // per person: new tokens only (output, uncached input, cache writes); cache reads stay in the KPIs
  expect(line(s, 'Qix')).toContain('1.0k new tokens') // 2,001 split: the odd token goes to the first
  expect(line(s, 'Brix')).toContain('1.0k new tokens')
  expect(line(s, 'Zorya')).toContain('800 new tokens')
  expect(line(s, 'Pip')).not.toContain('tokens') // ran a test, but no request asked Pip for it here
  // a new turn starts the counts again
  await $.turn.complete(turnDone as never)
  await $.turn.start({ text: 'Again', turnId: 't2' } as never)
  expect(await crew($)).not.toMatch(/\d tokens/)
})

test('a turn that ships nothing ends at the desks: no town hall', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Look around'))
  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' })
  await $.tool.call({ tool: 'Bash', command: 'git push --dry-run -- fail' }) // a failed push ships nothing
  await w.clock.advance(500)
  await $.turn.complete(turnDone as never)
  await w.clock.advance(3000)
  const s = await crew($)
  expect(s).toContain('Nothing shipped, so the crew stays at their desks')
  expect(s).not.toMatch(/Phase: (Off to the town hall|Live demo|Shipped)/)
  expect(s.split('\n').filter(l => / · Town hall/.test(l)).length).toBe(0)
  expect(s).toMatch(/✗ Done in 0:0\d/)
})

test('a call from a subagent on another model shows that model in the strip', async ($, on) => {
  let release: () => void = () => {}
  on('tool.call', { tool: 'Grep' }, () => new Promise(r => { release = () => r({ result: { matches: 0 } }) }))
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Explore'))
  await $.turn.start({ text: 'Explore', turnId: 't1' } as never)
  const main = await stepOpen($, w)
  await main()
  const it = $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5-5', messageCount: 2, agentId: 'a1' })[Symbol.asyncIterator]()
  await it.next()
  const pending = $.tool.call({ tool: 'Grep', pattern: 'register', agentId: 'a1' } as never)
  const mainCall = $.tool.call({ tool: 'Bash', command: 'npm run hold-x' })
  await w.clock.advance(250)
  const s = await crew($)
  expect(s).toMatch(/● Qix \(Research\) · Grep · register · haiku 5\.5 · 0:00/)
  expect(s).toMatch(/● Brix \(Build\) · Bash · npm run hold-x · 0:00/) // the main loop's own model is left out
  release(); w.hold.release(); w.step.release()
  await pending; await mainCall; await it.next()
})

test('the boardroom context tank follows the main loop and drains during compaction', async ($, on) => {
  const w = world(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [], cost: { usd: 0 } } as never }))
  await start($)
  await $.prompt.submit(prompt('Work'))
  await $.turn.start({ text: 'Work', turnId: 't1' } as never)
  w.step.usage = { model: 'claude-opus-5-5', input_tokens: 2000, cache_read_input_tokens: 100000, cache_creation_input_tokens: 2000, output_tokens: 500 }
  await (await stepOpen($, w))()
  expect(await crew($)).toContain('context 52% (104.0k of 200.0k)')
  await $.classic.PreCompact({ trigger: 'auto', custom_instructions: null } as never)
  let s = await crew($)
  expect(s).toContain('context: compacting')
  expect(s).toContain('Claude is compacting the conversation (context full)')
  await $.classic.PostCompact({ trigger: 'auto', compact_summary: 'x' } as never)
  s = await crew($)
  expect(s).not.toContain('compacting…')
  expect(s).not.toMatch(/context \d+%/) // unknown until the next response
})

test('more subagents than boardroom seats stand, then are counted at the door', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Fan out'))
  await $.turn.start({ text: 'Fan out', turnId: 't1' } as never)
  for (let i = 1; i <= 10; i++) await (await stepOpen($, w, `a${i}`))()
  expect(await crew($)).toContain('Boardroom: 8 subagent(s) seated, 2 standing')
  for (let i = 11; i <= 17; i++) await (await stepOpen($, w, `a${i}`))()
  expect(await crew($)).toContain('Boardroom: 8 subagent(s) seated, 6 standing, +3 counted at the door')
  expect(await crew($)).toContain('+9 more machines') // the text rows count every run too
})

test('a subscription sees its plan windows, never dollars; an API key sees dollars', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Work'))
  await $.turn.start({ text: 'Work', turnId: 't1' } as never)
  w.step.usage = { model: 'claude-opus-5-5', input_tokens: 1000, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0, output_tokens: 500 }
  await (await stepOpen($, w))()
  await w.clock.advance(125)
  const now = w.clock.now() // the mod read the same clock on its last tick
  const limits = [{ kind: 'five_hour', percentUsed: 42, resetsAt: new Date(now + 3600_000).toISOString() }, { kind: 'seven_day', percentUsed: 18 }]
  await $.session.measure({ context: { window: 200000 }, rateLimits: limits, cost: { usd: 3.21 }, changed: ['rateLimits', 'cost'] } as never)
  let s = await crew($)
  expect(s).toContain('Plan · 5-hour 42% (resets in 1h 0m) · weekly 18% · 21.5k tokens since the office opened')
  expect(s).not.toContain('$3.21') // a plan is not billed per token
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], cost: { usd: 1.234 }, changed: ['rateLimits', 'cost'] } as never)
  s = await crew($)
  expect(s).toContain('API · $1.23 this session · 21.5k tokens since the office opened')
})

test('in a 2/3-room view, room tabs pin rooms side by side; Unpin goes back to the camera', async ($, on) => {
  const w = world(on)
  await start($)
  const svgOf = async (u: { find(q: object): Promise<{ props: { source?: unknown } } | undefined> }) => String((await u.find({ type: 'Svg' }))?.props.source ?? '')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'zoom-2' })
  await ui.press({ key: 'room-3' }) // Boardroom
  await ui.press({ key: 'room-5' }) // Open office: not a neighbour of the Boardroom
  await w.clock.advance(250)
  expect(await crew($)).toContain('2 room(s), pinned Boardroom, Open office')
  await ui.unmount()
  const ui2 = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await svgOf(ui2 as never)).toContain('viewBox="0 0 480 176"')
  expect(await ui2.find({ type: 'Button', key: 'unpin' })).toBeDefined()
  // a third pin in a 2-room view replaces the oldest
  await ui2.press({ key: 'room-1' }) // Town hall
  expect(await crew($)).toContain('pinned Open office, Town hall')
  // unpinning frees a slot for the camera; a 1-room view ignores pins
  await ui2.press({ key: 'room-1' })
  expect(await crew($)).toContain('pinned Open office,')
  await ui2.press({ key: 'zoom-1' })
  expect(await crew($)).not.toContain('pinned')
  await ui2.press({ key: 'zoom-3' })
  expect(await crew($)).toContain('pinned Open office')
  await ui2.press({ key: 'unpin' })
  expect(await crew($)).not.toContain('pinned')
  await ui2.unmount()
  const ui3 = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await svgOf(ui3 as never)).toContain('viewBox="0 0 720 176"')
  await ui3.unmount()
})
