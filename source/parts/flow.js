// ================= mission flow (driven by live activity) =================
// The page ran a scripted plan; here every move comes from a real event:
// a prompt starts the briefing, a tool call sends its role to work, a failing
// check or a sub-agent launch plays a hand-off duet, the end of the turn plays
// the town hall, and 60 seconds without events lets the crew wander.
const RUSH = 1.8, LINGER = 2.5, MIN_WORK = 2, IDLE_AFTER = 60;
let lastEventT = -Infinity, focus = null, focusT = -Infinity, lastEnded = null, lastAnnounce = '';
const acts = new Map(), logRing = [];
const idleMode = () => simT - lastEventT > IDLE_AFTER && !hallEvent();
function sfx(kind) { if (opts.onSfx) { try { opts.onSfx(kind); } catch (_) {} } }
function announce(msg) { lastAnnounce = msg; }
function log(text, role) { logRing.push({ t: simT, text, role: role || null }); if (logRing.length > 40) logRing.shift(); }
function touch(a) { lastEventT = simT; if (a) { focus = a; focusT = simT; } }
function cleanTitle(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Untitled task';
  return t.length > 60 ? t.slice(0, 57).trimEnd() + '...' : t;
}
function newMission(title) {
  return { id: ++missionSeq, title, phase: 'execute', phaseT: simT, startT: simT, cardsShown: 0, finishedAt: null, duets: 0, pairCounts: new Map(), tasks: [], wrapPending: false };
}
function ensureMission() { if (!mission) mission = newMission('Current work'); return mission; }
function startMission(text) {
  const title = cleanTitle(text);
  if (mission && mission.phase !== 'done' && mission.phase !== 'execute') log(`Stopped "${mission.title}" to start a new task.`, 'lead');
  mission = newMission(title); mission.phase = 'huddle';
  const seats = shuffle(SEATS.slice()); let si = 0;
  for (const a of agents) {
    a.danceUntil = 0; a.partyPair = null; a.pairTask = null;
    if (a.duet || a.delivery || a.runCount > 0 || a.workUntil > simT) { a.arrived = true; continue; }
    a.deliveries = []; a.state = 'meeting'; a.arrived = false; a.breakDone = 0; a.breakSpot = null;
    goTo(a, a.role === 'lead' ? PRESENT_SPOT : seats[si++], () => { a.arrived = true; });
  }
  log(`Reception logged a new request: "${title}". The crew is heading to the boardroom.`, 'lead');
  setBubble(receptionist, 'star', 2.5); receptionist.waveUntil = visT + 1.6;
  announce(`New task started: ${title}`);
  sfx('start');
  touch(null); focus = null; directorDwell = 99;
}
function joinHall(a) {
  a.state = 'meeting'; a.arrived = false; a.hallMission = mission.id; a.breakDone = 0; a.breakSpot = null; a.partyPair = null;
  goTo(a, DEMO_SPOTS[a.role], () => { a.arrived = true; });
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
    log(`Nova is briefing the crew on "${m.title}".`, 'lead');
    announce('Nova is briefing the crew.');
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
    log(`Nova demoed "${m.title}" at the town hall.`, 'lead');
    announce('Demo started at the town hall.');
    sfx('clap');
  } else if (p === 'party') {
    hall.shipped++; hall.applauseUntil = visT + 3;
    topPairsOf(agents.filter(a => a.state === 'meeting')).forEach(([pa, pb], i) => {
      const c = PAIR_CENTERS[i]; if (!c) return;
      [[pa, -9], [pb, 9]].forEach(([ag, dx]) => { ag.partyPair = { cx: c.x, cy: c.y }; goTo(ag, { x: c.x + dx, y: c.y, face: 'down' }, () => { ag.danceUntil = simBeat() + 14; }); });
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
    case 'huddle': if (agents.every(a => a.arrived) || tIn > 20) setPhase('present'); break;
    case 'present':
      m.cardsShown = Math.min(m.tasks.length, Math.floor(tIn / (BEAT * 0.75)));
      if (tIn > BEAT * Math.max(6, m.tasks.length * 0.75 + 3)) setPhase(m.wrapPending ? 'wrap' : 'execute');
      break;
    case 'execute': if (m.wrapPending) setPhase('wrap'); break;
    case 'wrap': if (agents.every(a => a.arrived) || tIn > 25) setPhase('demo'); break;
    case 'demo': if (tIn > BEAT * 10) setPhase('party'); break;
    case 'party': if (tIn > BEAT * 18) setPhase('done'); break;
  }
  if ((m.phase === 'huddle' || m.phase === 'present') && simT - lastEventT > IDLE_AFTER) setPhase('execute');
}
function startWork(a) {
  a.state = 'toWork'; a.arrived = true; a.breakDone = 0; a.breakSpot = null; a.danceUntil = 0; a.partyPair = null;
  goTo(a, STATIONS[a.role], () => { if (a.state === 'toWork') { a.state = 'working'; a.workUntil = Math.max(a.workUntil, simT + MIN_WORK); } });
}
function finishWork(a) {
  a.state = 'idle'; a.idleT = 0; a.workProg = 0;
  if (a.lastOk !== false && !a.deliveries.length) { setBubble(a, 'check', 1.2); sfx('done'); }
}
function work(a, dt) {
  a.workProg = a.runCount > 0 ? 1 - Math.exp(-(simT - a.spellT0) / 4) : Math.min(1, a.workProg + dt * 2);
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
  if (!a.path.length && (Math.abs(a.x - st.x) > 1 || Math.abs(a.y - st.y) > 1)) { goTo(a, st); return; }
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
  const pace = a.state === 'toWork' || a.state === 'delivering' ? RUSH : a.state === 'meeting' ? 1.6 : 1;
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
function toolStart(id, role, tool, label) {
  const a = agentByRole[role] || agentByRole.lead;
  const act = { id, role: a.role, tool: String(tool || 'tool'), label: String(label || ''), startT: simT, endT: null, ok: null };
  acts.set(id, act);
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
  act.endT = simT; act.ok = ok !== false;
  const a = agentByRole[act.role];
  a.runCount = Math.max(0, a.runCount - 1); a.done++; a.lastOk = act.ok;
  if (a.runCount === 0) a.workUntil = simT + LINGER;
  lastEnded = act; touch(null);
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
  if (reason && reason !== 'answer') {
    log('The turn stopped early. The crew is back at their desks.', 'lead');
    if (mission && (mission.phase === 'huddle' || mission.phase === 'present')) setPhase('execute');
    return;
  }
  const m = ensureMission();
  if (m.phase === 'wrap' || m.phase === 'demo' || m.phase === 'party') return;
  if (m.phase === 'huddle' || m.phase === 'present') m.wrapPending = true; else setPhase('wrap');
}
function setCards(list) {
  const m = ensureMission(), old = new Map(m.tasks.map(t => [t.id, t])), had = m.tasks.length;
  m.tasks = list.slice(0, 24).map(c => {
    const prev = old.get(c.id), state = c.status === 'completed' ? 'done' : c.status === 'in_progress' ? 'working' : 'queued';
    return { id: c.id, role: ROLES[c.role] ? c.role : 'build', title: String(c.title || ''), deps: [], delivered: new Set(), pending: 0, changes: false, isFix: false, pair: null, partner: null, hfBar: -1, state, progress: state === 'done' ? 1 : prev ? prev.progress : 0 };
  });
  if (m.phase === 'present') m.cardsShown = Math.min(m.cardsShown, m.tasks.length);
  if (!had && m.tasks.length) { setBubble(agentByRole.lead, 'star', 2.2); log(`Nova put the plan on screen: ${m.tasks.length} card${m.tasks.length === 1 ? '' : 's'}.`, 'lead'); }
  touch(null);
}
