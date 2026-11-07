// ================= boot and public API =================
function select(id) { if (!id && selectedId) manualRoom = viewRoom(); selectedId = id; }
function agentStatus(a) {
  if (a.duet) return a.duet.giver === a ? `Handing off to ${a.duet.taker.name}` : `Receiving from ${a.duet.giver.name}`;
  if (isDancing(a)) return 'Dancing';
  if (a.runCount > 0 && a.act && a.act.waiting) return `Waiting for your OK · ${a.act.tool}`;
  const m = mission;
  switch (a.state) {
    case 'working':
      return a.runCount > 0 && a.act ? `${a.act.tool}${a.act.label ? ' · ' + a.act.label : ''}` : `Finishing ${a.act ? a.act.tool : 'up'}`;
    case 'toWork': { const r = ROOM_NAMES[roomOf(STATIONS[a.role].x)]; return `Heading to the ${r === 'IT lab' ? r : r.toLowerCase()}`; }
    case 'delivering': return a.delivery.kind === 'rework' ? `Taking the ${a.delivery.from.title} to ${a.delivery.to.name}` : `Bringing work to ${a.delivery.to.name}`;
    case 'break': return a.breakSpot ? a.breakSpot.where : 'On a break';
    case 'meeting': return !m ? 'In the boardroom' : m.phase === 'huddle' ? 'Walking to the briefing' : m.phase === 'present' ? (a.role === 'lead' ? 'Presenting the plan' : 'In the briefing') : m.phase === 'wrap' ? 'Heading to the town hall' : m.phase === 'demo' ? (a.role === 'lead' ? 'Demoing on stage' : 'On stage at the town hall') : 'At the town hall';
    default:
      if (a.role === 'lead' && isThinking()) return `Thinking ${fmt(simT - (thinkT0 ?? simT))}`;
      return !idleMode() && m && m.phase === 'execute' ? 'Ready at their desk' : 'At their desk';
  }
}
function phaseText() {
  const m = mission;
  if ([...acts.values()].some(x => x.waiting)) return 'Waiting for your OK';
  if (isThinking() && (!m || m.phase === 'execute')) return 'Thinking';
  if (!m) return idleMode() ? 'Idle' : 'Working';
  if (idleMode() && (m.phase === 'execute' || m.phase === 'done')) return 'Idle';
  const done = m.tasks.filter(t => t.state === 'done').length;
  return { huddle: 'Briefing', present: 'Nova is briefing', execute: m.tasks.length ? `Working · ${done}/${m.tasks.length} done` : 'Working', wrap: 'Off to the town hall', demo: 'Live demo at the town hall', party: 'Shipped · town hall party', done: 'Shipped · ready for a task' }[m.phase];
}
function rooms() {
  const vr = viewRoom(), vs = viewStart();
  return ROOM_NAMES.map((name, i) => ({ index: i, name, current: i === vr, inView: i >= vs && i < vs + zoom, agents: agents.filter(a => roomOf(a.x) === i).map(a => ({ id: a.id, name: a.name, color: ROLES[a.role].color })) }));
}
function crew() {
  return agents.map(a => ({ id: a.id, name: a.name, role: a.role, roleLabel: ROLES[a.role].label, color: ROLES[a.role].color, status: agentStatus(a), done: a.done, selected: a.id === selectedId, working: isWorking(a) }));
}
function ticker() {
  const m = mission, beat = Math.floor(visBeat()) % 4;
  if (!m) return { phase: phaseText(), beat, done: 0, total: 0, duets: 0, clock: 'T+00:00', title: '' };
  const done = m.tasks.filter(t => t.state === 'done').length;
  return { phase: phaseText(), beat, done, total: m.tasks.length, duets: m.duets, clock: clockLong(m.finishedAt !== null && m.phase !== 'execute' ? m.finishedAt : simT - m.startT), title: m.title };
}
function statusLine() {
  let run = null;
  for (const act of acts.values()) if (!run || act.startT > run.startT) run = act;
  const who = act => { const a = agentByRole[act.role]; return { name: a.name, role: ROLES[a.role].label, color: ROLES[a.role].color, tool: act.tool, label: act.label }; };
  if (run) return { state: 'running', ...who(run), seconds: simT - run.startT, running: acts.size };
  if (lastEnded && !idleMode()) return { state: 'finished', ...who(lastEnded), seconds: lastEnded.endT - lastEnded.startT, ok: lastEnded.ok, running: 0 };
  return { state: 'idle', seconds: Number.isFinite(lastEventT) ? simT - lastEventT : 0, running: 0 };
}
const fmt = s => { const t = Math.max(0, Math.floor(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
function shortModel(model) {
  return String(model || '?').replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-/g, ' ');
}
const who = act => { const a = agentByRole[act.role]; return { name: a.name, role: ROLES[act.role].label, color: ROLES[act.role].color, tool: act.tool, label: act.label }; };
function receiptText() {
  if (turnEndT === null) return null;
  const c = { read: 0, edit: 0, test: 0, command: 0, other: 0 };
  for (const x of turnCalls) {
    if (x.role === 'research') c.read++;
    else if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(x.tool)) c.edit++;
    else if (x.role === 'qa') c.test++;
    else if (x.tool === 'Bash' || x.tool === 'PowerShell') c.command++;
    else c.other++;
  }
  const parts = Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`);
  const failed = turnCalls.filter(x => !x.ok).length, fixed = turnCalls.filter(x => !x.ok && x.fixed).length;
  const head = turnReason === 'answer' ? 'Done' : turnReason === 'aborted' ? 'Stopped' : 'Ended with an error';
  return `${head} in ${fmt(turnEndT - turnT0)} · ${parts.length ? parts.join(', ') : 'no tools'}${failed ? ` · ${failed} failed${fixed ? `, ${fixed} fixed` : ''}` : ''}`;
}
function stripInfo() {
  const running = [...acts.values()].sort((p, q) => p.startT - q.startT).map(x => ({ id: x.id, ...who(x), seconds: simT - x.startT, waiting: !!x.waiting }));
  const failures = turnCalls.filter(x => !x.ok && !x.fixed).map(x => ({ id: x.id, ...who(x) }));
  const recent = turnCalls.slice(-3).reverse().map(x => ({ id: x.id, ...who(x), ok: x.ok, seconds: x.endT - x.startT }));
  return {
    open: turnOpen,
    thinking: isThinking() ? simT - (thinkT0 ?? simT) : null,
    turnSeconds: turnOpen ? simT - turnT0 : turnEndT !== null ? turnEndT - turnT0 : 0,
    running, failures, recent, receipt: turnOpen ? null : receiptText(),
  };
}
function machinesInfo() {
  const all = [...machines.values()].sort((p, q) => (p.key === 'main' ? -1 : q.key === 'main' ? 1 : p.seq - q.seq));
  const list = all.slice(0, MAX_MACHINES).map(m => ({
    key: m.key, name: m.key === 'main' ? 'main' : m.type || 'agent', description: m.description, model: shortModel(m.model), effort: m.effort,
    color: modelColor(m.model), on: m.on, requests: m.requests, parentId: m.parentId,
    seconds: m.on ? simT - m.t0 : m.durationMs != null ? m.durationMs / 1000 : (m.endT ?? simT) - m.t0, usage: m.usage,
  }));
  return { list, more: Math.max(0, all.length - MAX_MACHINES), on: all.filter(m => m.on).length };
}
function toolRole(id) {
  const x = acts.get(id) || turnCalls.find(c => c.id === id);
  return x ? { ...who(x), ok: x.ok == null ? null : x.ok, seconds: (x.endT ?? simT) - x.startT } : null;
}
function snapshot() {
  const m = mission;
  return {
    simT, phase: m ? m.phase : null, title: m ? m.title : null, idle: idleMode(), duets: m ? m.duets : 0,
    cards: m ? m.tasks.map(t => ({ id: t.id, title: t.title, role: t.role, state: t.state })) : [],
    agents: agents.map(a => ({ id: a.id, name: a.name, role: a.role, state: a.state, room: ROOM_NAMES[roomOf(a.x)], x: Math.round(a.x), y: Math.round(a.y), working: isWorking(a), dancing: isDancing(a), tool: a.act ? a.act.tool : null, running: a.runCount, bubble: a.bubble && visT < a.bubble.until ? a.bubble.icon : null, duet: a.duet ? { giver: a.duet.giver.id, taker: a.duet.taker.id, kind: a.duet.kind } : null, delivering: a.delivery ? { to: a.delivery.to.id, kind: a.delivery.kind } : null, done: a.done })),
    receptionist: receptionist.bubble && visT < receptionist.bubble.until ? receptionist.bubble.icon : null,
    view: { zoom, start: viewStart(), room: ROOM_NAMES[viewRoom()], autoCam, director: directorRoom, dwell: +directorDwell.toFixed(2), focus: focus ? focus.id : null, focusAge: +(simT - focusT).toFixed(2) },
    particles: { total: particles.length, confetti: particles.filter(p => p.kind === 'confetti').length },
    status: statusLine(), ticker: ticker(), log: logRing.slice(-12), announce: lastAnnounce,
    strip: stripInfo(), machines: machinesInfo(),
  };
}

setZoom(opts.zoom || 1);
applyTheme(themeKey);
tableCanvas = buildTable().freeze(); chairCanvas = buildChairs().freeze(); frontCanvas = buildFront().freeze(); hallCanvas = buildHall().freeze();
const crewSprites = {};
for (const a of agents) { const [c, g] = makeCanvas(13, 20); paintSprite(g, 1, 3, 0, 'down', 'down', 0, a, false, false); crewSprites[a.id] = c; }

const E = external;
return {
  advance, render, film,
  get version() { return version; },
  get zoom() { return zoom; }, setZoom: E(setZoom),
  get autoCam() { return autoCam; }, setAutoCam: E(setAutoCam),
  goRoom: E(goRoom), prevRoom: E(() => goRoom(camTarget() - 1)), nextRoom: E(() => goRoom(camTarget() + 1)),
  canPrev: () => viewStart() > 0, canNext: () => viewStart() < ROOMS - zoom,
  toggleFollow: E(id => select(selectedId === id ? null : id)), get selectedId() { return selectedId; },
  setTheme: E(k => { if (THEMES[k] && k !== themeKey) applyTheme(k); }),
  setMotion: E(v => { motion = v; reduceMotion = v === 'reduced'; }),
  rooms, crew, ticker, statusLine, snapshot, crewSprite: id => crewSprites[id],
  startMission: E(startMission), toolStart: E(toolStart), toolEnd: E(toolEnd), handoff: E(handoff), bug: E(bug), turnEnd: E(turnEnd), setCards: E(setCards),
  turnStart: E(turnStart), markWaiting: E(markWaiting), machineStep: E(machineStep), machineStepEnd: E(machineStepEnd), machineDone: E(machineDone), machineInfo: E(machineInfo),
  strip: stripInfo, machines: machinesInfo, toolRole,
  get simT() { return simT; },
};