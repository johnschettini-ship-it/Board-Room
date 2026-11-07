"""Builds hooks/world.ts from the page script.

Art, crew, NPCs, town hall, path finding, sprites and rendering are copied
verbatim from the page; only DOM, autoplay, playbooks and the scripted plan
execution are replaced. Every patch must match exactly once, so a change in
the source fails loudly instead of silently drifting.
"""
import re, sys

SRC = sys.argv[1]  # path to agent-boardroom.html
OUT = sys.argv[2]
NEW = sys.argv[3]  # directory holding the hand-written parts

lines = open(SRC, encoding='utf-8').read().split('\n')


def block(a, b):
    """1-based inclusive line range of the saved page."""
    return '\n'.join(lines[a - 1:b])


def find(marker):
    for i, l in enumerate(lines):
        if l.startswith('// ================= ' + marker):
            return i + 1
    raise SystemExit('marker not found: ' + marker)


def section(marker, nxt):
    return block(find(marker), find(nxt) - 1)


def patch(text, old, new, count=1):
    n = text.count(old)
    if n != count:
        raise SystemExit(f'patch expected {count} match(es), found {n}: {old[:70]!r}')
    return text.replace(old, new)


def part(name):
    return open(f'{NEW}/{name}', encoding='utf-8').read().rstrip('\n')


consts = section('constants', 'helpers')
consts = patch(consts, "const AUTOPILOT_WAIT = 6;\n", '')
consts = patch(consts, "const reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);",
               "let motion = opts.motion || 'auto', reduceMotion = motion === 'reduced';")

helpers = section('helpers', '3x5 pixel font')
helpers = patch(helpers, 'const rand = Math.random;',
                'const rand0 = opts.random || Math.random;\n'
                '// Draws go through a tape: a look-ahead records them (replaying what an earlier\n'
                '// look-ahead already drew first), and the live run replays them (see snap.js).\n'
                'let tapeRec = null, tape = null, tapeI = 0, tapeAhead = null, tapeAheadI = 0;\n'
                'const rand = () => {\n'
                '  if (tapeRec) { const v = tapeAhead && tapeAheadI < tapeAhead.length ? tapeAhead[tapeAheadI++] : rand0(); tapeRec.push(v); return v; }\n'
                '  if (tape) { if (tapeI < tape.length) return tape[tapeI++]; tape = null; }\n'
                '  return rand0();\n'
                '};')
helpers = patch(helpers, "function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return [c, g]; }",
                'function makeCanvas(w, h) { const c = new Px(w, h); return [c, c]; }')

art = '\n\n'.join([
    section('3x5 pixel font', '7x7 icons'),
    section('7x7 icons', 'agents: one original alien'),
    section('agents: one original alien', 'rooms and places'),
    section('rooms and places', 'world variants'),
    section('world variants', 'task playbooks'),
    section('path grid', 'state'),
])

# Nova orchestrates from the boardroom; the crew works side by side at the
# open office's top desk (one monitor each); cousins take the old desks.
art = patch(art, "const STATIONS = { lead: at(2, 120, 70, 'down'), research: at(4, 180, 88, 'up'), design: at(4, 40, 104, 'up'), build: at(5, 94, 80, 'up'), review: at(5, 172, 122, 'up'), qa: at(6, 176, 86, 'up') };",
            "const STATIONS = { lead: at(3, 120, 54, 'down'), research: at(5, 42, 80, 'up'), build: at(5, 86, 80, 'up'), review: at(5, 104, 80, 'up'), design: at(5, 146, 80, 'up'), qa: at(5, 198, 80, 'up') };")
art = patch(art, "  [5, 42, 80, 'up', 'type'], [5, 146, 80, 'up', 'type'], [5, 198, 80, 'up', 'type'], [5, 40, 122, 'up', 'type'], [5, 86, 122, 'up', 'type'],",
            "  [5, 40, 122, 'up', 'type'], [5, 86, 122, 'up', 'type'], [5, 172, 122, 'up', 'type'],\n  [2, 120, 70, 'down', 'type'], [4, 180, 88, 'up', 'read'], [4, 40, 104, 'up', 'type'], [6, 176, 86, 'up', 'type'],")

# Alien crew names (display only; ids stay).
art = patch(art, "{ id: 'nova', name: 'Nova',", "{ id: 'nova', name: 'Zorya',")
art = patch(art, "{ id: 'pax', name: 'Pax',", "{ id: 'pax', name: 'Qix',")
art = patch(art, "{ id: 'iris', name: 'Iris',", "{ id: 'iris', name: 'Lumi',")
art = patch(art, "{ id: 'kit', name: 'Kit',", "{ id: 'kit', name: 'Brix',")
art = patch(art, "{ id: 'vale', name: 'Vale',", "{ id: 'vale', name: 'Vex',")
art = patch(art, "{ id: 'dot', name: 'Dot',", "{ id: 'dot', name: 'Pip',")

cousins = section('cousins:', 'scenery')

scenery = section('scenery', 'sprite painting')
# Lighting: same maths as the page (radial falloff, destination-out, 11-level
# Bayer dither), computed straight into an alpha map instead of a canvas.
scenery = patch(scenery, block(find('scenery') + 272, find('scenery') + 291), part('lights.js'))

sprites = section('sprite painting', 'movement')
movement = section('movement', 'mission flow')

movement = patch(movement, '  a.walkPhase += dt * 11;', '  a.walkPhase += dt * 7 * Math.min(1.6, spd / SPEED); // calmer legs that keep pace with the walk')
flow_src = section('mission flow', 'particles')


def fn(src, name, end_marker):
    """Cuts one top-level function (or const) out of the flow section."""
    i = src.index(name)
    j = src.index(end_marker, i)
    return src[i:j]


kept = []
kept.append(fn(flow_src, 'function besideSpot(b)', 'function startDelivery'))
kept.append(fn(flow_src, 'function startDelivery(a, d)', 'function deliverTick'))
dt = fn(flow_src, 'function deliverTick(a)', 'function startDuet')
dt = patch(dt, "if (!b.duet && b.state !== 'meeting') startDuet(a, b); else a.path = [];", 'if (!b.duet) startDuet(a, b); else a.path = [];')
dt = patch(dt, 'goTo(a, spot); }', 'popTo(a, spot); }')
kept.append(dt)
sd = fn(flow_src, 'function startDuet(a, b)', 'function endDuet')
sd = patch(sd, "Sound.sfx(kind === 'rework' ? 'bug' : 'duet');", "sfx(kind === 'rework' ? 'bug' : 'duet');")
kept.append(sd)
ed = fn(flow_src, 'function endDuet(a)', 'function think')
ed = patch(ed, 'log(del.kind === \'rework\' ? `${a.name} walked ${b.name} through the review notes.` : `${a.name} handed "${del.from.title}" to ${b.name}.`, a.role);',
           'log(del.kind === \'rework\' ? `${a.name} walked ${b.name} through the ${del.from.title}.` : `${a.name} handed "${del.from.title}" to ${b.name}.`, a.role);')
kept.append(ed)
kept.append(fn(flow_src, 'const pairKey', 'function pairSpot'))

particles = section('particles', 'simulation step')
particles = patch(particles, "  if (mission && mission.phase === 'party' && !reduceMotion) {",
                  "  if (mission && mission.phase === 'party' && !reduceMotion && motion !== 'reduced') {")

rendering = section('rendering', 'sound (optional chiptune)')
rendering = patch(rendering, "  const barTask = a.duet ? null : a.state === 'working' ? a.task : a.state === 'pairing' ? a.pairTask : null;\n  if (barTask) {\n    rect(ctx, cx - 7, top - 3, 14, 4, '#0b0f1a'); rect(ctx, cx - 6, top - 2, Math.max(1, Math.round(12 * barTask.progress)), 2, role.color); top -= 5;",
                  "  const barProg = a.duet ? null : a.state === 'working' ? a.workProg : null;\n  if (barProg !== null) {\n    rect(ctx, cx - 7, top - 3, 14, 4, '#0b0f1a'); rect(ctx, cx - 6, top - 2, Math.max(1, Math.round(12 * barProg)), 2, role.color); top -= 5;")
rendering = patch(rendering, "      const msg = autopilot ? 'NEXT TASK IN ' + Math.max(0, Math.ceil(AUTOPILOT_WAIT - tIn)) : 'READY FOR A TASK';\n      drawText(ctx, msg, x0 + 2, y0 + 22, fg);\n      if (!autopilot && Math.floor(visT * 2) % 2) rect(ctx, x0 + 3 + textW(msg) + 1, y0 + 22, 3, 5, fg);",
                  "      const msg = 'READY FOR A TASK'; void tIn;\n      drawText(ctx, msg, x0 + 2, y0 + 22, fg);\n      if (Math.floor(visT * 2) % 2) rect(ctx, x0 + 3 + textW(msg) + 1, y0 + 22, 3, 5, fg);")
rendering = patch(rendering, "      const shown = m.phase === 'present' ? m.cardsShown : m.tasks.length;\n      m.tasks.forEach((t, i) => { if (i < shown) drawChipPx(x0 + 4 + (i % 8) * 10, y0 + 10 + Math.floor(i / 8) * 7, t); });",
                  "      const shown = m.phase === 'present' ? m.cardsShown : m.tasks.length;\n      m.tasks.forEach((t, i) => { if (i < shown && i < 16) drawChipPx(x0 + 4 + (i % 8) * 10, y0 + 10 + Math.floor(i / 8) * 7, t); });\n      if (!m.tasks.length) drawLiveLine(x0 + 2, y0 + 12);")
rendering = patch(rendering, "  const done = m.tasks.filter(t => t.state === 'done').length, n = m.tasks.length;\n  if (m.phase === 'execute') {",
                  "  const done = m.tasks.filter(t => t.state === 'done').length, n = Math.max(1, m.tasks.length);\n  if (m.phase === 'execute') {")
rendering = patch(rendering, "  if (isWorking(iris)) { const w = Math.round(36 * iris.task.progress);",
                  "  if (isWorking(iris)) { const w = Math.round(36 * iris.workProg);")
# Orchestration rooms: the boardroom wall shows the turn's KPIs after the
# briefing; crew desk monitors show tokens (desks.js); the desks the crew left
# in the Studio, IT lab and Lead office go to working cousins.
rendering = patch(rendering, "    default: {\n      drawText(ctx, title, x0 + 2, y0 + 2, fg);",
                  "    default: {\n      if (m.phase !== 'present') { drawKpis(S); break; }\n      drawText(ctx, title, x0 + 2, y0 + 2, fg);")
d0 = rendering.index("    case 'done': {")
d1 = rendering.index("    default: {", d0)
rendering = rendering[:d0] + "    case 'done': drawKpis(S); break; // the finished turn's KPIs stay up until the next one\n" + rendering[d1:]
rendering = patch(rendering, "  const pw = isWorking(agentByRole.research);", "  const pw = true; // a cousin researches at this desk now")
k0 = rendering.index("  const kw = isWorking(agentByRole.build);")
k1 = rendering.index("  const vw = isWorking(agentByRole.review);", k0)
rendering = rendering[:k0] + "  drawDesks();\n" + rendering[k1:]
rendering = patch(rendering, "  const vw = isWorking(agentByRole.review);", "  const vw = true; // a cousin works at this desk now")
rendering = patch(rendering, "  const iris = agentByRole.design;\n  if (isWorking(iris)) { const w = Math.round(36 * iris.workProg);",
                  "  { /* a cousin's design in progress */ const w = Math.round(36 * ((t / 8) % 1));")
rendering = patch(rendering, "  const dw = isWorking(agentByRole.qa);", "  const dw = [...machines.values()].some(m => m.on); // the racks are the compute view")

# render(): split into paint(target, fx) so motion effects can ship as their own layer.
r0 = rendering.index('function render() {')
r1 = rendering.index('\n}', r0) + 2
rendering = rendering[:r0] + part('paint.js') + rendering[r1:]
rendering = patch(rendering, 'function drawParticles() {\n  for (const p of particles) {',
                  'function drawParticles(fx) {\n  for (const p of particles) {\n    if (p.kind === \'confetti\' && !fx) continue;')

cam_src = section('camera: 1 to 3 rooms in view', 'events')
cam = cam_src[:cam_src.index('const roomEls = [];')]
cam = patch(cam, 'let zoom = 1, VWc = RW;', 'let zoom = 1, VWc = RW, ctx = new Px(VWc, H), fxCtx = new Px(VWc, H), fxOut = new Px(VWc, H);')
d0 = cam.index('function directorTick(dt) {')
d1 = cam.index('function updateCamera(dt) {')
cam = cam[:d0] + part('director.js') + '\n' + cam[d1:]
cam = patch(cam, '  if (!paused) directorTick(dt);', '  directorTick(dt);')
cam = patch(cam, "function setAutoCam(on) { autoCam = on; if (on) directorDwell = 99; els.cam.setAttribute('aria-pressed', String(on)); }",
            'function setAutoCam(on) { autoCam = on; if (on) directorDwell = 99; }')
s0 = cam.index('function setZoom(z) {')
s1 = cam.index('\n}', s0) + 2
cam = cam[:s0] + 'function setZoom(z) {\n  zoom = clamp(z, 1, 3); VWc = RW * zoom;\n  ctx = new Px(VWc, H); fxCtx = new Px(VWc, H); fxOut = new Px(VWc, H);\n  camX = clamp(camX, 0, W - VWc);\n}\n' + cam[s1:]
cam = cam.replace(', drag = null, wheelAcc = 0, wheelLock = 0;', ', drag = null;')

dom = section('DOM', 'camera: 1 to 3 rooms in view')
pads = '\n'.join(l for l in dom.split('\n') if l.startswith('const pad =') or l.startswith('const clockLong') or l.startswith('const clockShort'))

body = '\n\n'.join([
    consts, helpers, art,
    part('state.js'),
    cousins, scenery, sprites, movement,
    part('flow.js'),
    '\n'.join(kept),
    particles,
    part('step.js'),
    rendering,
    pads,
    cam,
    part('desks.js'),
    part('snap.js'),
    part('api.js'),
])

# Every top-level `let` must either be saved by snap.js or be listed here as
# state a look-ahead never changes; a new one fails the build until decided.
NOT_SIM = {'motion', 'reduceMotion', 'themeKey', 'bgCanvas', 'lightA', 'tableCanvas', 'chairCanvas', 'frontCanvas', 'hallCanvas',
           'flickers', 'antennas', 'zoom', 'VWc', 'ctx', 'fxCtx', 'fxOut', 'drag', 'tapeRec', 'tape', 'tapeI', 'tapeAhead', 'tapeAheadI', 'filming', 'version'}
snap_src = part('snap.js')
for line in body.split('\n'):
    if not line.startswith('let '):
        continue
    for decl in re.split(r',(?![^(]*\))', line[4:].split(';')[0]):
        name = decl.split('=')[0].strip()
        if name and name not in NOT_SIM and not re.search(r'\b' + name + r'\b', snap_src[snap_src.index('function snapshotAll'):]):
            raise SystemExit(f'snap.js does not save top-level state `{name}`')

for bad in ['document.', 'window.', 'els.', 'Sound.', 'autopilot', 'presetIdx', 'requestAnimationFrame', 'PLAYBOOK', 'GENERIC']:
    hits = [l for l in body.split('\n') if bad in l]
    if hits:
        raise SystemExit(f'leftover {bad}: {hits[0][:120]}')

header = part('header.txt')
out = header + '\n' + '\n'.join('  ' + l if l else l for l in body.split('\n')) + '\n}\n'
open(OUT, 'w', encoding='utf-8').write(out)
print('wrote', OUT, len(out.split('\n')), 'lines')
