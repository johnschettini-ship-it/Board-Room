// ================= state =================
let themeKey = opts.theme || 'night';
let bgCanvas, lightA, tableCanvas, chairCanvas, frontCanvas, hallCanvas;
let flickers = [], antennas = [];
let simT = 0, visT = 0;
let mission = null, missionSeq = 0, selectedId = null;
const particles = []; let confettiAcc = 0;
const simBeat = () => simT / BEAT, visBeat = () => visT / BEAT;

const agents = AGENT_DEFS.map(d => {
  const st = STATIONS[d.role];
  return { ...d, x: st.x, y: st.y, face: st.face, path: [], onArrive: null, arriveFace: null, pathGoal: null, state: 'idle', task: null, deliveries: [], delivery: null, carrying: false, duet: null,
    danceUntil: 0, done: 0, walkPhase: 0, moving: false, bubble: null, idleT: 0, breakAt: 8 + rand() * 18, breakDone: 0, breakSpot: null, emitT: 0, arrived: false, blinkSeed: rand() * 5, retargetT: -1, _P: null,
    runCount: 0, workUntil: -1, workProg: 0, spellT0: 0, act: null, lastOk: null, hallMission: 0, pairTask: null, partyPair: null };
});
const agentByRole = Object.fromEntries(agents.map(a => [a.role, a]));
const taskById = id => mission && mission.tasks.find(t => t.id === id);
