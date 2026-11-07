// ================= mission flow (driven by live activity) =================
// The page ran a scripted plan; here every move comes from a real event:
// a prompt starts the briefing, a tool call sends its role to work, a failing
// check or a sub-agent launch plays a hand-off duet, the end of the turn plays
// the town hall, and 60 seconds without events (and no open turn) lets the
// crew wander. Ceremony never outruns the truth: cross-room walks pop through
// the door, the first tool call ends the briefing, duets end with the turn.
// Walk speed: the page's own pace (80 px/s) times the walkSpeed setting.
const WALK = { slow: 0.6, normal: 1, fast: 1.6 }[opts.walkSpeed] || 1;
const LINGER = 2.5, MIN_WORK = 1.5, IDLE_AFTER = 60, MAX_MACHINES = 8;
let lastEventT = -Infinity, focus = null, focusT = -Infinity, lastEnded = null, lastAnnounce = '';
let turnOpen = false, turnT0 = 0, turnEndT = null, turnReason = null, mainStepOpen = 0, thinkT0 = null;
const acts = new Map(), logRing = [], turnCalls = [], machines = new Map();
// A turn with nothing in flight for a minute (no tool, no model request) has
// stalled or lost its end event: the crew may go idle then, but never while
// anything is actually running.
const idleMode = () => acts.size === 0 && mainStepOpen === 0 && simT - lastEventT > IDLE_AFTER && !hallEvent();
const isThinking = () => turnOpen && mainStepOpen > 0 && acts.size === 0;
// Panel S5/S7/S10: a thought bubble, plan cards without a role, model colours for the compute view.
ICONS.think = ['.......', '.......', '.......', '#.#.#..', '.......', '.......', '.......'];
ICON_COLOR.think = '#3a4670';
ROLES.none = { label: 'Plan', color: '#8f9ab0', dark: '#5b6788', icon: 'note', acc: null };
ROLES.none.light = mix(ROLES.none.color, '#ffffff', 0.45); ROLES.none.glow = mix(ROLES.none.color, '#ffffff', 0.75); ROLES.none.blush = ROLES.none.color;
function modelColor(model) {
  const m = String(model || '').toLowerCase();
  return m.includes('opus') ? '#f4b942' : m.includes('sonnet') ? '#5ec8e5' : m.includes('haiku') ? '#78d98e' : m.includes('fable') ? '#f27fb2' : '#b08cf5';
}
function sfx(kind) { if (!filming && opts.onSfx) { try { opts.onSfx(kind); } catch (_) {} } }
function announce(msg) { lastAnnounce = msg; }
function log(text, role) { logRing.push({ t: simT, text, role: role || null }); if (logRing.length > 40) logRing.shift(); }
function touch(a) { lastEventT = simT; if (a) { focus = a; focusT = simT; } }
function cleanTitle(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Untitled task';
  return t.length > 60 ? t.slice(0, 57).trimEnd() + '...' : t;
}
function newMission(title) {
  return { id: ++missionSeq, title, phase: 'execute', phaseT: simT, startT: simT, cardsShown: 0, finishedAt: null, duets: 0, pairCounts: new Map(), tasks: [], wrapPending: false, ships: [] };
}
function ensureMission() { if (!mission) mission = newMission('Current work'); return mission; }

// A crew member who must cross rooms pops through the destination's door
// (a puff at both ends) and walks only the last stretch, so ceremony never
// trails the truth by more than about a second.
function popTo(a, t, cb) {
  const from = roomOf(a.x), to = roomOf(t.x);
  if (from !== to) {
    const door = nearestFree(cellIdx(to * RW + 120, 132));
    if (!reduceMotion) puff(a.x, a.y - 8, ROLES[a.role].color);
    a.x = (door % GC) * CELL + 4; a.y = ((door / GC) | 0) * CELL + 4; a.path = [];
    if (!reduceMotion) puff(a.x, a.y - 8, ROLES[a.role].color);
  }
  goTo(a, t, cb);
}
function puff(x, y, color) { for (let i = 0; i < 8; i++) { const ang = i / 8 * Math.PI * 2; emit(x, y, Math.cos(ang) * 18, Math.sin(ang) * 12, 0.45, color, 'spark'); } }

function startMission(text) {
  const title = cleanTitle(text);
  if (mission && mission.phase !== 'done' && mission.phase !== 'execute') log(`Stopped "${mission.title}" to start a new task.`, 'lead');
  mission = newMission(title);
  turnStart();
  // A message alone is not a meeting: Zorya thinks it over in the boardroom and
  // the crew stays at their desks (anyone away comes back). The crew gathers
  // only when a plan goes up (see gatherBriefing), and a crew member gets up
  // only when one of their tools runs.
  for (const a of agents) {
    a.danceUntil = 0; a.partyPair = null; a.pairTask = null;
    if (a.duet || a.delivery || a.runCount > 0 || a.workUntil > simT) continue;
    a.breakDone = 0; a.breakSpot = null;
    const st = STATIONS[a.role];
    if (a.state === 'break' || a.state === 'meeting' || Math.hypot(a.x - st.x, a.y - st.y) > 6) { a.state = 'idle'; popTo(a, st); }
  }
  log(`Reception logged a new request: "${title}". ${agentByRole.lead.name} is thinking it over.`, 'lead');
  setBubble(receptionist, 'star', 2.5); receptionist.waveUntil = visT + 1.6;
  announce(`New task started: ${title}`);
  sfx('start');
  touch(null); focus = null; directorDwell = 99;
}
function turnStart() {
  if (!turnOpen) {
    turnCalls.length = 0; for (const [k, m] of machines) if (!m.on) machines.delete(k);
    for (const k in turnTok) turnTok[k] = 0;
    for (const k in roleTok) roleTok[k] = 0;
  }
  turnOpen = true; turnT0 = simT; turnEndT = null; turnReason = null; lastEventT = simT;
}
function joinHall(a) {
  a.state = 'meeting'; a.arrived = false; a.hallMission = mission.id; a.breakDone = 0; a.breakSpot = null; a.partyPair = null;
  popTo(a, DEMO_SPOTS[a.role], () => { a.arrived = true; });
}
function topPairsOf(list) {
  const m = mission, cand = [], out = [], used = new Set();
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) cand.push([list[i], list[j], m.pairCounts.get(pairKey(list[i], list[j])) || 0]);
  cand.sort((p, q) => q[2] - p[2]);
  for (const [a, b, n] of cand) if (!used.has(a) && !used.has(b)) { used.add(a); used.add(b); out.push([a, b, n]); }
  return out;
}
function setPhase(p) {
  const m = mission; m.phase = p; m.phaseT = simT;
  if (p === 'present') {
    setBubble(agentByRole.lead, 'star', 2.5);
    log(`Zorya is briefing the crew on "${m.title}".`, 'lead');
    announce('Zorya is briefing the crew.');
  } else if (p === 'execute') {
    for (const a of agents) if (a.state === 'meeting') { a.state = 'idle'; a.idleT = 0; }
  } else if (p === 'wrap') {
    m.finishedAt = simT - m.startT; m.wrapPending = false;
    log('The turn is done. The crew is heading to the town hall to demo it.', 'lead');
    const td = topDuet();
    if (td) log(`Duet of the mission: ${td.a.name} + ${td.b.name}, ${td.n} duet${td.n === 1 ? '' : 's'}.`, td.a.role);
    for (const a of agents) {
      a.pairTask = null; a.partyPair = null;
      if (a.duet || a.delivery || a.deliveries.length || a.runCount > 0) { a.arrived = true; continue; }
      a.workUntil = Math.min(a.workUntil, simT);
      joinHall(a);
    }
  } else if (p === 'demo') {
    setBubble(agentByRole.lead, 'star', 2.5); hall.applauseUntil = visT + 2;
    log(`Zorya demoed "${m.title}" at the town hall.`, 'lead');
    announce('Demo started at the town hall.');
    sfx('clap');
  } else if (p === 'party') {
    hall.shipped++; hall.applauseUntil = visT + 3;
    topPairsOf(agents.filter(a => a.state === 'meeting')).forEach(([pa, pb], i) => {
      const c = PAIR_CENTERS[i]; if (!c) return;
      [[pa, -9], [pb, 9]].forEach(([ag, dx]) => { ag.partyPair = { cx: c.x, cy: c.y }; goTo(ag, { x: c.x + dx, y: c.y, face: 'down' }, () => { ag.danceUntil = simBeat() + 12; }); });
    });
    log(`Shipped "${m.title}" in ${clockLong(m.finishedAt)}. The town hall cheers.`, 'lead');
    announce(`Task shipped in ${clockLong(m.finishedAt)}.`);
    sfx('ship'); sfx('clap');
  } else if (p === 'done') {
    for (const a of agents) if (a.state === 'meeting') { a.state = 'idle'; a.idleT = 0; a.danceUntil = 0; a.breakAt = 4 + rand() * 16; a.partyPair = null; }
  }
}
function phaseUpdate(dt) {
  const m = mission; if (!m) return;
  for (const t of m.tasks) { if (t.state === 'working') t.progress = Math.min(0.92, t.progress + dt / (BEAT * 24)); else if (t.state === 'done') t.progress = 1; }
  const tIn = simT - m.phaseT;
  switch (m.phase) {
    case 'huddle': if (agents.every(a => a.arrived) || tIn > 8) setPhase('present'); break;
    case 'present':
      m.cardsShown = Math.min(m.tasks.length, Math.floor(tIn / (BEAT * 0.75)));
      if (tIn > BEAT * Math.max(6, m.tasks.length * 0.75 + 3)) setPhase(m.wrapPending ? 'wrap' : 'execute');
      break;
    case 'execute': if (m.wrapPending) setPhase('wrap'); break;
    case 'wrap': if (agents.every(a => a.arrived) || tIn > 8) setPhase('demo'); break;
    case 'demo': if (tIn > BEAT * 6) setPhase('party'); break;
    case 'party': if (tIn > BEAT * 14) setPhase('done'); break;
  }
  if ((m.phase === 'huddle' || m.phase === 'present') && simT - lastEventT > IDLE_AFTER) setPhase('execute');
}
function thinkTick() {
  // Long thinking is work: Zorya keeps a thought bubble up and nobody wanders.
  if (!isThinking()) { thinkT0 = null; return; }
  if (thinkT0 === null) thinkT0 = simT;
  const nova = agentByRole.lead;
  if (!nova.duet && (!nova.bubble || visT > nova.bubble.until - 0.2)) setBubble(nova, 'think', 2.5);
}
function startWork(a) {
  a.state = 'toWork'; a.arrived = true; a.breakDone = 0; a.breakSpot = null; a.danceUntil = 0; a.partyPair = null;
  popTo(a, STATIONS[a.role], () => { if (a.state === 'toWork') { a.state = 'working'; a.workUntil = Math.max(a.workUntil, simT + MIN_WORK); } });
}
function finishWork(a) {
  a.state = 'idle'; a.idleT = 0; a.workProg = 0;
  if (a.lastOk !== false && !a.deliveries.length) { setBubble(a, 'check', 1.2); sfx('done'); }
}
function work(a, dt) {
  a.workProg = a.runCount > 0 ? 1 - Math.exp(-(simT - a.spellT0) / 4) : Math.min(1, a.workProg + dt * 2);
  // The dialog's answer is not observable: a question bubble for a few seconds, then normal work.
  if (a.act && a.act.waiting && a.runCount > 0 && simT - a.act.askedT < 4) { if (!a.bubble || visT > a.bubble.until - 0.2) setBubble(a, 'question', 2); return; }
  a.emitT -= dt; if (a.emitT <= 0) { a.emitT = 0.16; emitWork(a); }
}
function think(a, dt) {
  const m = mission;
  if (a.deliveries.length) { startDelivery(a, a.deliveries.shift()); return; }
  if (a.workUntil > simT) { startWork(a); return; }
  if (m && hallEvent() && a.hallMission !== m.id) { joinHall(a); return; }
  if (a.state === 'break') {
    if (!a.path.length && a.breakDone && simT >= a.breakDone) { a.breakDone = 0; a.breakSpot = null; a.state = 'idle'; goTo(a, STATIONS[a.role]); }
    return;
  }
  const st = STATIONS[a.role];
  if (!a.path.length && (Math.abs(a.x - st.x) > 1 || Math.abs(a.y - st.y) > 1)) { popTo(a, st); return; }
  if (a.path.length) return;
  if (!idleMode()) { a.idleT = 0; return; }
  a.idleT += dt;
  if (a.idleT > a.breakAt) {
    a.idleT = 0; a.breakAt = 10 + rand() * 22;
    const free = BREAK_SPOTS.filter(s => !agents.some(o => o !== a && o.breakSpot === s)).sort((p, q) => dist(a, p) - dist(a, q)).slice(0, 3);
    if (!free.length) return;
    const s = free[Math.floor(rand() * free.length)];
    a.state = 'break'; a.breakSpot = s;
    goTo(a, s, () => { setBubble(a, s.icon, 2.2); a.breakDone = simT + 2.6; });
  }
}
function updateAgent(a, dt) {
  a.moving = false;
  if (a.duet) { if (a.duet.giver === a && simT >= a.duet.end) endDuet(a); return; }
  if (isDancing(a)) return;
  // Live events should show soon: walks to work and hand-offs rush, meetings hurry.
  const pace = WALK;
  a.moving = stepMove(a, dt, SPEED * pace);
  const wants = a.workUntil > simT;
  switch (a.state) {
    case 'working':
      if (a.deliveries.length && a.runCount === 0) { startDelivery(a, a.deliveries.shift()); break; }
      if (wants) work(a, dt); else finishWork(a);
      break;
    case 'toWork':
      if (a.deliveries.length && a.runCount === 0) { startDelivery(a, a.deliveries.shift()); break; }
      if (!wants && !a.path.length) finishWork(a);
      break;
    case 'delivering': deliverTick(a); break;
    case 'meeting':
      if (a.deliveries.length) startDelivery(a, a.deliveries.shift());
      else if (wants) startWork(a);
      break;
    default: think(a, dt);
  }
}

// ---- events from the hooks ----
function toolStart(id, role, tool, label, extra) {
  const a = agentByRole[role] || agentByRole.lead;
  // The run that asked for the call (main loop or a subagent) and so its model.
  const run = extra && extra.run ? String(extra.run) : 'main', mm = machines.get(run);
  const act = { id, role: a.role, tool: String(tool || 'tool'), label: String(label || ''), startT: simT, endT: null, ok: null, waiting: false, run, model: mm ? mm.model : '', ship: !!(extra && extra.ship) };
  acts.set(id, act);
  if (!turnOpen) turnStart();
  // The first real work ends the briefing: the crew goes to its desks.
  if (mission && (mission.phase === 'huddle' || mission.phase === 'present') && !mission.wrapPending) setPhase('execute');
  if (a.runCount === 0 && !(a.workUntil > simT)) { a.spellT0 = simT; a.workProg = 0; setBubble(a, ROLES[a.role].icon); }
  a.runCount++; a.workUntil = Infinity; a.act = act; a.danceUntil = 0; a.partyPair = null;
  touch(a);
  if (!a.duet && a.state !== 'working' && a.state !== 'toWork' && a.state !== 'delivering') startWork(a);
  log(`${a.name} (${ROLES[a.role].label}) started ${act.tool}${act.label ? ': ' + act.label : ''}.`, a.role);
  return act;
}
function toolEnd(id, ok) {
  const act = acts.get(id); if (!act) return;
  acts.delete(id);
  act.endT = simT; act.ok = ok !== false; act.waiting = false;
  const a = agentByRole[act.role];
  a.runCount = Math.max(0, a.runCount - 1); a.done++; a.lastOk = act.ok;
  if (a.runCount === 0) a.workUntil = simT + LINGER;
  // A failure stays on the strip until the same work later succeeds or the turn ends.
  if (act.ok) for (const c of turnCalls) if (!c.ok && !c.fixed && c.role === act.role && c.tool === act.tool && c.label === act.label) c.fixed = true;
  turnCalls.push({ id: act.id, role: act.role, tool: act.tool, label: act.label, ok: act.ok, fixed: false, startT: act.startT, endT: act.endT, run: act.run, model: act.model });
  if (act.ship && act.ok) {
    ensureMission().ships.push(`${act.tool}${act.label ? ' ' + act.label : ''}`);
    setBubble(a, 'star', 2);
    log(`${a.name} shipped: ${act.tool}${act.label ? ' ' + act.label : ''}. The town hall gets ready.`, a.role);
  }
  if (turnCalls.length > 400) turnCalls.shift();
  lastEnded = act; touch(null);
}
function markWaiting(tool) {
  // The permission dialog is up for this tool: mark its newest running call.
  let best = null;
  for (const act of acts.values()) if (act.tool === tool && !act.waiting && (!best || act.startT > best.startT)) best = act;
  if (!best) return false;
  best.waiting = true; best.askedT = simT;
  const a = agentByRole[best.role];
  setBubble(a, 'question', 2);
  log(`${a.name} asked for your OK to run ${best.tool}${best.label ? ': ' + best.label : ''}.`, a.role);
  return true;
}
function handoff(fromRole, toRole, kind, title) {
  let a = agentByRole[fromRole], b = agentByRole[toRole];
  if (!b) return;
  if (!a || a === b) a = b.role === 'lead' ? agentByRole.research : agentByRole.lead;
  ensureMission();
  a.deliveries.push({ to: b, from: { title: title || 'work', pending: 1 }, tasks: [], kind: kind === 'rework' ? 'rework' : 'handoff' });
  a.danceUntil = 0;
  touch(a);
  log(kind === 'rework' ? `${a.name} is taking the ${title || 'issue'} to ${b.name}.` : `${a.name} is handing "${title || 'work'}" to ${b.name}.`, a.role);
}
function bug(fromRole, toRole, title) {
  const a = agentByRole[fromRole || 'qa'];
  setBubble(a, 'bug', 3.5);
  sfx('bug');
  handoff(a.role, toRole || 'build', 'rework', title || 'failing test');
}
function turnEnd(reason) {
  touch(null);
  turnOpen = false; turnEndT = simT; turnReason = reason || 'answer'; mainStepOpen = 0;
  const main = machines.get('main');
  if (main && main.on) { main.on = false; main.endT = simT; }
  // Hand-offs never outlive the turn: finish duets now, drop the queued ones.
  for (const a of agents) { if (a.duet && a.duet.giver === a) endDuet(a); a.deliveries = []; if (a.state === 'delivering') { a.delivery = null; a.carrying = false; a.state = 'idle'; a.path = []; } }
  if (reason && reason !== 'answer') {
    log('The turn stopped early. The crew is back at their desks.', 'lead');
    if (mission && (mission.phase === 'huddle' || mission.phase === 'present')) setPhase('execute');
    return;
  }
  const m = ensureMission();
  if (m.phase === 'wrap' || m.phase === 'demo' || m.phase === 'party') return;
  if (m.phase === 'huddle' || m.phase === 'present') setPhase('execute');
  // The town hall is for work that left the machine (a commit, a push, a pull
  // request, a release, a deploy). Any other turn ends at the desks.
  if (m.ships.length) { setPhase('wrap'); return; }
  m.finishedAt = simT - m.startT;
  const worked = new Set(turnCalls.map(c => c.role));
  for (const a of agents) if (worked.has(a.role) || a.role === 'lead') setBubble(a, 'check', 1.6);
  log('The turn is done. Nothing shipped, so the crew stays at their desks.', 'lead');
  announce('Turn done.');
  sfx('done');
  setPhase('done');
}
// A plan went up: the crew not busy with a tool gathers in the boardroom and
// Zorya briefs; the first real tool call ends it, as before. Once per task.
function gatherBriefing() {
  const m = mission;
  if (!m || m.briefed || m.phase !== 'execute' || m.wrapPending) return;
  m.briefed = true; setPhase('huddle');
  const seats = shuffle(SEATS.slice()); let si = 0;
  for (const a of agents) {
    if (a.duet || a.delivery || a.runCount > 0) { a.arrived = true; continue; }
    a.deliveries = []; a.state = 'meeting'; a.arrived = false; a.breakDone = 0; a.breakSpot = null;
    popTo(a, a.role === 'lead' ? PRESENT_SPOT : seats[si++], () => { a.arrived = true; });
  }
  log('The crew is heading to the boardroom for the briefing.', 'lead');
  directorDwell = 99;
}
function setCards(list) {
  // Plan items are shown verbatim and unassigned: a plan item has no role.
  const m = ensureMission(), old = new Map(m.tasks.map(t => [t.id, t])), had = m.tasks.length;
  m.tasks = list.slice(0, 24).map(c => {
    const prev = old.get(c.id), state = c.status === 'completed' ? 'done' : c.status === 'in_progress' ? 'working' : 'queued';
    return { id: c.id, role: 'none', title: String(c.title || ''), deps: [], delivered: new Set(), pending: 0, changes: false, isFix: false, pair: null, partner: null, hfBar: -1, state, progress: state === 'done' ? 1 : prev ? prev.progress : 0 };
  });
  if (m.phase === 'present') m.cardsShown = Math.min(m.cardsShown, m.tasks.length);
  if (!had && m.tasks.length) { setBubble(agentByRole.lead, 'star', 2.2); log(`Zorya put the plan on screen: ${m.tasks.length} card${m.tasks.length === 1 ? '' : 's'}.`, 'lead'); gatherBriefing(); }
  touch(null);
}

// ---- tokens: summed from each model request's usage as it finishes ----
// Never estimated mid-stream. roleTok splits each request's NEW tokens
// (output, uncached input, cache writes) evenly across the crew whose tools
// that request asked for (Read -> Qix, Edit -> Brix, ...); a request that asks
// for no work (an answer, a plan, a hand-off) counts for Zorya. Cache reads
// are the same context re-read by every request, so they show only in the
// turn totals (KPIs). Totals are exact; the split per person is an attribution.
const turnTok = { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, requests: 0 };
const roleTok = { lead: 0, research: 0, design: 0, build: 0, review: 0, qa: 0 };
// The whole session's tokens (never reset): what a subscription spends from its plan.
const sessTok = { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, requests: 0 };
function stepDone(key, usage, roles) {
  if (!usage) return;
  const n = v => (Number.isFinite(+v) && +v > 0 ? Math.round(+v) : 0);
  const u = { input: n(usage.input_tokens), cacheRead: n(usage.cache_read_input_tokens), cacheCreate: n(usage.cache_creation_input_tokens), output: n(usage.output_tokens) };
  for (const k of ['input', 'cacheRead', 'cacheCreate', 'output']) { turnTok[k] += u[k]; sessTok[k] += u[k]; }
  const total = u.input + u.cacheCreate + u.output;
  const list = (roles && roles.length ? roles : ['lead']).map(r => (r in roleTok ? r : 'lead'));
  const share = Math.floor(total / list.length);
  let rest = total - share * list.length;
  for (const r of list) { roleTok[r] += share + (rest > 0 ? 1 : 0); if (rest > 0) rest--; }
  if (key === 'main' && !ctxInfo.compacting) ctxInfo.tokens = u.input + u.cacheRead + u.cacheCreate;
  const m = machines.get(key);
  if (m) {
    const l = m.live || (m.live = { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 });
    l.input_tokens += u.input; l.cache_read_input_tokens += u.cacheRead; l.cache_creation_input_tokens += u.cacheCreate; l.output_tokens += u.output;
  }
  touch(null);
}

// ---- context: how full the main loop's window is ----
// tokens = the input side of the main loop's last request (uncached, cache
// written and cache read), the status line's own measure; window from the
// engine's session figures. Compaction empties it until the next response.
const ctxInfo = { tokens: null, window: null, compacting: false };
function setContext(c) {
  if (!c) return;
  if (Number.isFinite(+c.window) && +c.window > 0) ctxInfo.window = Math.round(+c.window);
  if (Number.isFinite(+c.tokens) && +c.tokens >= 0 && !ctxInfo.compacting) ctxInfo.tokens = Math.round(+c.tokens);
}
function compactStart(trigger) {
  ctxInfo.compacting = true;
  setBubble(agentByRole.lead, 'note', 3);
  log(`Claude is compacting the conversation (${trigger === 'manual' ? 'asked for' : 'context full'}).`, 'lead');
  touch(agentByRole.lead);
}
function compactEnd() {
  ctxInfo.compacting = false; ctxInfo.tokens = null;
  log('Compaction done: the conversation was summarized.', 'lead');
  touch(null);
}

// ---- compute: one machine per run (main loop or subagent) ----
function machineStep(key, model, effort) {
  let m = machines.get(key);
  if (!m) {
    if (key === 'main' && !turnOpen) turnStart();
    m = { key, model: String(model || ''), effort: effort == null ? '' : String(effort), t0: simT, endT: null, on: true, requests: 0, usage: null, live: null, stepOpen: 0, durationMs: null, type: key === 'main' ? 'main' : '', description: '', parentId: null, seq: machines.size,
      // a subagent sits at the boardroom table while it runs, in its model's colour
      look: key === 'main' ? null : makeLook(900 + machines.size, { color: modelColor(model), acc: null }) };
    machines.set(key, m);
    if (key !== 'main') log(`A ${m.model || 'model'} machine powered on for a subagent.`, 'lead');
    while (machines.size > 32) { const oldest = [...machines.values()].filter(x => !x.on).sort((p, q) => p.t0 - q.t0)[0]; if (!oldest) break; machines.delete(oldest.key); }
  }
  if (!m.on) { m.on = true; m.t0 = simT; m.endT = null; m.live = null; m.usage = null; }
  if (model) m.model = String(model);
  if (effort != null) m.effort = String(effort);
  m.requests++; m.stepOpen++; turnTok.requests++; sessTok.requests++;
  if (key === 'main') mainStepOpen++;
  touch(null);
}
function machineStepEnd(key) {
  const m = machines.get(key); if (m) m.stepOpen = Math.max(0, m.stepOpen - 1);
  if (key === 'main') mainStepOpen = Math.max(0, mainStepOpen - 1);
}
function machineDone(key, usage, durationMs) {
  const m = machines.get(key); if (!m) return;
  m.on = false; m.endT = simT; m.stepOpen = 0; m.usage = usage ? { ...usage } : m.live; m.durationMs = durationMs == null ? m.durationMs : durationMs;
  if (key === 'main') mainStepOpen = 0;
}
// A subagent the engine lists as running before the office has seen a request
// from it (the plugin started mid-run): on, model unknown until its next one.
function machineSeed(key, info) {
  if (!key || key === 'main' || machines.has(key)) return;
  const m = { key, model: '', effort: '', t0: simT, endT: null, on: true, requests: 0, usage: null, live: null, stepOpen: 0, durationMs: null, type: '', description: '', parentId: null, seq: machines.size,
    look: makeLook(900 + machines.size, { color: modelColor(''), acc: null }) };
  machines.set(key, m);
  machineInfo(key, info);
  touch(null);
}
function machineInfo(key, info) {
  const m = machines.get(key); if (!m || !info) return;
  if (info.type) m.type = String(info.type);
  if (info.description) m.description = String(info.description);
  if (info.parentId) m.parentId = String(info.parentId);
}
