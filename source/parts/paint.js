function paint(fx) {
  const slots = viewSlots();
  if (!slots) { paintSpan(fx, Math.round(camX), 0, VWc, 0); return; }
  const st = isStacked();
  slots.forEach((r, i) => paintSpan(fx, r * RW, st ? 0 : i * RW, RW, st ? i * H : 0));
}
/** Draws world x [vx, vx + sw) at canvas x [sx, sx + sw), canvas rows [sy, sy + H). */
function paintSpan(fx, vx, sx, sw, sy) {
  const T = THEMES[themeKey], cam = camX, vw = VWc;
  camX = vx; VWc = sw; // culling and label placement below read the view from these
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath(); ctx.rect(sx, sy, sw, H); ctx.clip();
  ctx.setTransform(1, 0, 0, 1, sx - vx, sy);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(bgCanvas, 0, 0);
  drawDynamic();
  drawCompute();
  if (fx && mission && mission.phase === 'party' && !reduceMotion) drawDisco();
  for (const a of agents) a._P = pose(a);
  for (const n of npcs) n._P = npcPose(n);
  const vis = o => o._P.x > vx - 24 && o._P.x < vx + VWc + 24;
  const items = agents.filter(vis).map(a => ({ y: a._P.y, a }));
  for (const n of npcs) if (vis(n)) items.push({ y: n._P.y, n });
  for (const r of runSeats()) if (r.x > vx - 24 && r.x < vx + VWc + 24) items.push({ y: r.y, run: r });
  items.push({ y: 90, img: tableCanvas }, { y: 119, img: chairCanvas }, { y: 146, img: frontCanvas }, { y: 175, img: hallCanvas });
  items.sort((p, q) => p.y - q.y);
  for (const it of items) if (it.img) ctx.drawImage(it.img, 0, 0); else if (it.n) drawNPC(it.n); else if (it.run) drawRun(it.run); else drawAgent(it.a);
  ctx.shade(lightA, W, vx - sx, T.shade[0], T.shade[1], T.shade[2], sx, sx + sw, sy, sy + H);
  drawParticles(fx);
  for (const n of npcs) if (n.bubble && visT < n.bubble.until && vis(n)) { const P = n._P; drawBubble(Math.round(P.x) - 5, P.oyL + P.bob + accTop(n.look) - 13, n.bubble.icon, n.bubble.color); }
  drawRunBubbles();
  for (const a of agents) if (vis(a)) drawOverlays(a);
  ctx.restore(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  camX = cam; VWc = vw;
}
function render() {
  // 'auto': the base frame carries no confetti or disco; those ride in an
  // overlay of exactly the pixels they change, which the pane hides with a
  // prefers-reduced-motion media query. 'full' bakes them in; 'reduced' drops them.
  const base = ctx;
  paint(motion === 'full');
  let fxLayer = null;
  if (motion === 'auto' && !reduceMotion && ((mission && mission.phase === 'party') || particles.some(p => p.kind === 'confetti'))) {
    ctx = fxCtx; paint(true); ctx = base;
    const a = base.u32, b = fxCtx.u32, o = fxOut.u32;
    let any = false;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { o[i] = b[i]; any = true; } else o[i] = 0; }
    if (any) fxLayer = fxOut;
  }
  return { width: base.width, height: base.height, base, fx: fxLayer };
}
function drawLiveLine(x, y) {
  const s = statusLine();
  const txt = mission && (mission.phase === 'huddle' || mission.phase === 'present') ? 'BRIEFING THE CREW' : s.state === 'running' ? fitText(`${s.name}: ${s.tool}`, 21) : s.state === 'finished' ? fitText(`${s.name}: ${s.tool} done`, 21) : 'STANDING BY';
  drawText(ctx, txt, x, y, '#f4b942');
}
function drawCompute() {
  // The IT lab's racks are the compute view: one rack unit per run (main loop
  // first, then subagents), lit in its model's colour while it runs, dim after.
  const all = [...machines.values()].filter(m => m.key !== 'main' || m.requests > 0).sort((p, q) => (p.key === 'main' ? -1 : q.key === 'main' ? 1 : p.seq - q.seq));
  // Past 24 runs the last unit counts the rest instead of showing one more.
  const list = all.length > 24 ? all.slice(0, 23) : all;
  if (all.length > 24) {
    const X = x => 6 * RW + x, y = 24 + 7 * 6, s = `+${all.length - 23}`;
    rect(ctx, X(198), y - 1, 28, 5, '#2b1d0e');
    drawText(ctx, s, X(212) - (textW(s) >> 1), y - 1, Math.floor(visT * 2) % 2 ? '#f4b942' : '#c48a12');
  }
  list.forEach((m, i) => {
    const rx = [124, 160, 196][Math.floor(i / 8)], y = 24 + (i % 8) * 6, X = x => 6 * RW + x, col = modelColor(m.model);
    rect(ctx, X(rx + 2), y - 1, 28, 5, m.on ? mix(col, '#1f2536', 0.72) : '#1f2536');
    for (let k = 0; k < 4; k++) {
      const lit = m.on ? hash(i * 7 + k, Math.floor(visT * 6)) > 0.3 : k === 0;
      rect(ctx, X(rx + 4 + k * 2), y + 1, 1, 1, lit ? col : mix(col, '#000000', 0.65));
    }
    rect(ctx, X(rx + 14), y + 1, 8, 1, m.on ? col : mix(col, '#000000', 0.7));
    rect(ctx, X(rx + 25), y + 1, 3, 1, m.on ? '#6fdc8c' : '#3a4152');
  });
}
