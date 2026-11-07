// ================= simulation step =================
function step(dt) {
  visT += dt; simT += dt;
  phaseUpdate(dt);
  thinkTick();
  for (const a of agents) updateAgent(a, dt);
  if (mission && mission.phase === 'party' && Math.floor(visBeat()) % 2 === 0 && rand() < 0.02) { const a = agents[Math.floor(rand() * agents.length)]; if (!a.bubble || visT > a.bubble.until) setBubble(a, 'note', 1.2); }
  hallTick(dt);
  for (const n of npcs) npcTick(n, dt);
  updateParticles(dt);
  updateCamera(dt);
}
// Fixed 25 ms steps on a whole-microsecond grid: however the caller slices
// time, the same steps run in the same order, so a look-ahead (film) and the
// live run after it stay in step. At most 5 s is caught up.
const STEP_US = 25000;
let stepAccUs = 0;
function advance(seconds) {
  stepAccUs = Math.min(stepAccUs + Math.round(Math.max(0, seconds) * 1e6), 5e6);
  while (stepAccUs >= STEP_US) { step(STEP_US / 1e6); stepAccUs -= STEP_US; }
}
