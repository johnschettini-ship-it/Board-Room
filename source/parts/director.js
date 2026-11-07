function directorTick(dt) {
  // Page director, plus: the briefing holds the camera for its first 3 s, and
  // the camera follows the crew member of the latest live event while they head
  // to work, hand off, or work a running tool (and for at least 4 s).
  directorDwell += dt; directorT -= dt; if (directorT > 0) return; directorT = 0.25;
  const m = mission;
  const want = r => { if (directorRoom !== r) { directorRoom = r; directorDwell = 0; } };
  if (hallEvent()) { want(TOWN); return; }
  const briefing = !!m && (m.phase === 'huddle' || m.phase === 'present');
  if (briefing && simT - m.startT < 3) { want(BOARD); return; }
  const busy = a => a.state === 'toWork' || a.state === 'delivering' || !!a.duet || (a.state === 'working' && a.runCount > 0);
  if (focus && (simT - focusT < 4 || busy(focus))) {
    const a = focus;
    // Heading to work: the desk's room. Carrying a hand-off or a bug: follow them.
    const r = a.state === 'toWork' || a.state === 'working' ? roomOf(STATIONS[a.role].x) : roomOf(a.x);
    const vs = startFor(directorRoom);
    if (r >= vs && r < vs + zoom) return;
    // Crew moves between rooms instantly (door-pop), so a fresh event cuts at once.
    if (simT - focusT < 1 || directorDwell > 1.2) want(r);
    return;
  }
  if (briefing) { want(BOARD); return; }
  const score = new Array(ROOMS).fill(0);
  for (const a of agents) score[roomOf(a.x)] += a.duet ? 4 : a.state === 'working' || a.state === 'toWork' ? 1.2 : a.path.length ? 0.4 : 0.15;
  let best = directorRoom; for (let r = 0; r < ROOMS; r++) if (score[r] > score[best]) best = r;
  if (best !== directorRoom && directorDwell > 3.5 && score[best] > score[directorRoom] + 0.9) { directorRoom = best; directorDwell = 0; }
}
