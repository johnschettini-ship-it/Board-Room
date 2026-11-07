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
function advance(seconds) {
  // Same 50 ms ceiling per step as the page's frame loop; at most 5 s caught up.
  let left = Math.min(Math.max(0, seconds), 5);
  while (left > 1e-9) { const s = Math.min(0.05, left); step(s); left -= s; }
}
