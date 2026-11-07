import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { classifyBash, classifyText, routeTool } from '../hooks/classify.ts'

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
function world(on: On, shown = true) {
  const clock = mock.clock(on)
  const panes = new Set<string>()
  const counts = { invalidate: 0, audio: 0 }
  on('command.register', () => ({ value: { command: 'workplace' } }))
  on('tool.register', () => ({ value: { tool: STATUS } }))
  on('ui.open', (_, e) => { panes.add(e.id); return { value: { isPlaced: true } } })
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: 'Digital Workplace', isShown: shown, isFocused: false, isPlaced: true })) }))
  on('ui.close', (_, e) => { panes.delete(e.id); return { value: undefined } })
  on('ui.invalidate', () => { counts.invalidate++; return { value: undefined } })
  on('audio.play', () => { counts.audio++; return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', (_, e) => {
    const cmd = String((e as { command?: unknown }).command ?? '')
    if (e.tool === 'Bash' && /fail/.test(cmd)) return { isError: true as const, result: 'Exit code 1', text: 'Exit code 1\n1 failing' }
    if (e.tool === 'TaskCreate') return { result: { task: { id: '7', subject: String((e as { subject?: unknown }).subject) } } }
    return { result: { ok: true, tool: e.tool } }
  })
  return { clock, panes, counts }
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
  // and it keeps redrawing on the timer
  const before = w.counts.invalidate
  await w.clock.advance(1000)
  expect(w.counts.invalidate - before).toBeGreaterThanOrEqual(7)
})

test('2. a prompt starts the boardroom briefing', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Build a Claude Code mod called "Digital Workplace" that docks my pixel-art office page as a side pane next to the chat.'))
  await w.clock.advance(250)
  let s = await crew($)
  expect(s).toContain('Phase: Briefing · "Build a Claude Code mod called "Digital Workplace" that d..."')
  expect(line(s, 'Nova')).toMatch(/briefing|Presenting/i)
  await w.clock.advance(9000)
  s = await crew($)
  expect(s).toContain('Phase: Nova is briefing')
  expect(s.split('\n').filter(l => / · Boardroom/.test(l)).length).toBeGreaterThanOrEqual(5)
  expect(s).toContain('View: Boardroom')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^Nova is briefing/ })).toBeDefined()
  await ui.unmount()
})

test('3. Read, Edit and a test run put Pax, Kit and Dot to work within 1 s', async ($, on) => {
  const w = world(on)
  await start($)
  const cases = [
    { call: { tool: 'Read', file_path: '/work/agent-boardroom.html' }, name: 'Pax', role: 'Research', room: 'Studio' },
    { call: { tool: 'Edit', file_path: '/work/hooks/raster.ts', old_string: 'a', new_string: 'b' }, name: 'Kit', role: 'Build', room: 'Open office' },
    { call: { tool: 'Bash', command: 'npm test' }, name: 'Dot', role: 'QA', room: 'IT lab' },
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
  // Iris takes UI files
  await $.tool.call({ tool: 'Write', file_path: '/work/pane.css', content: 'a{}' })
  await w.clock.advance(125)
  expect(line(await crew($), 'Iris')).toMatch(/Heading to the studio|Write/)
  // Vale takes git diff
  await $.tool.call({ tool: 'Bash', command: 'git diff --stat' })
  await w.clock.advance(125)
  expect(line(await crew($), 'Vale')).toMatch(/Heading to the open office|Bash/)
})

test('3b. a long tool call shows its role, tool and a ticking elapsed time', async ($, on) => {
  let release: () => void = () => {}
  on('tool.call', { tool: 'Grep' }, () => new Promise(r => { release = () => r({ result: { matches: 1 } }) }))
  const w = world(on)
  await start($)
  const pending = $.tool.call({ tool: 'Grep', pattern: 'register' } as never)
  await w.clock.advance(3000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^● Pax \(Research\) · Grep · register · 0:0[23]$/ })).toBeDefined()
  await ui.unmount()
  release()
  await pending
})

test('4. a failing test shows the bug bubble and the Dot-to-Kit duet', async ($, on) => {
  const w = world(on)
  await start($)
  const r = await $.tool.call({ tool: 'Bash', command: 'npm test -- --fail' } as never)
  expect(r.isError).toBe(true) // the failure reaches Claude unchanged
  await w.clock.advance(125)
  let s = await crew($)
  expect(line(s, 'Dot')).toContain('bubble bug')
  let duet = ''
  for (let i = 0; i < 40 && !duet; i++) {
    await w.clock.advance(250)
    s = await crew($)
    if (/duet dot->kit \(rework\)/.test(line(s, 'Dot'))) duet = line(s, 'Dot')
  }
  say('duet:', duet)
  expect(duet).toMatch(/duet dot->kit \(rework\)/)
  expect(line(s, 'Kit')).toMatch(/Receiving from Dot/)
})

test('5. the end of the turn plays the town hall demo, then the party', async ($, on) => {
  const w = world(on)
  await start($)
  await $.prompt.submit(prompt('Ship it'))
  await w.clock.advance(1000)
  await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' })
  await w.clock.advance(1000)
  await $.turn.complete(turnDone as never)
  // The briefing that the prompt started finishes first, then the crew heads out.
  let s = ''
  for (let i = 0; i < 60 && !/Phase: Off to the town hall/.test(s); i++) { await w.clock.advance(250); s = await crew($) }
  expect(s).toContain('Phase: Off to the town hall')
  for (let i = 0; i < 120 && !/Phase: Live demo/.test(s); i++) { await w.clock.advance(250); s = await crew($) }
  expect(s).toContain('Phase: Live demo at the town hall')
  expect(s).toContain('View: Town hall')
  expect(line(s, 'Nova')).toMatch(/Demoing on stage/)
  for (let i = 0; i < 60 && !/Phase: Shipped · town hall party/.test(s); i++) { await w.clock.advance(250); s = await crew($) }
  expect(s).toContain('Phase: Shipped · town hall party')
  await w.clock.advance(3000)
  s = await crew($)
  expect(s.split('\n').filter(l => /Dancing/.test(l)).length).toBeGreaterThanOrEqual(4)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const svg = String((await ui.find({ type: 'Svg' }))?.props.source ?? '')
  expect(svg).toContain('class="fx"') // confetti + disco ride the reduced-motion layer
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
  say(`aborted Glob (call ${rejected ? 'rejected' : 'resolved'}): ${line(s, 'Pax')}`)
  expect(line(s, 'Pax')).not.toMatch(/Glob ·|Heading to/)
  expect(s).toContain('Status: ○ Pax (Research) · Glob')
})

test('plans become cards, assigned to roles by their text', async ($, on) => {
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
  expect(s).toContain('[done] Read the page script -> research')
  expect(s).toContain('[working] Style the pane layout -> design')
  expect(s).toContain('[queued] Implement the hooks module -> build')
  expect(s).toContain('[queued] Run the tests -> qa')
  expect(s).toContain('[queued] Review the diff -> review')
  expect(s).toContain('[queued] Write the release report -> lead')
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'completed' } as never)
  expect(await crew($)).toContain('[done] Write the release report -> lead')
})

test('sub-agent launch plays a hand-off duet from Nova', async ($, on) => {
  const w = world(on)
  await start($)
  await $.tool.call({ tool: 'Agent', description: 'Explore hooks API', prompt: 'Find the hooks', subagent_type: 'Explore' } as never)
  let s = ''
  for (let i = 0; i < 80 && !/duet nova->pax \(handoff\)/.test(s); i++) { await w.clock.advance(250); s = await crew($) }
  expect(line(s, 'Nova')).toMatch(/duet nova->pax \(handoff\)/)
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
