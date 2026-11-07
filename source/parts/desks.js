// ================= orchestration rooms =================
// Boardroom: Nova orchestrates by the wall screen, which shows the turn's
// KPIs once the briefing is over; each running subagent sits at the table in
// its model's colour, with a thought bubble while its request is open.
// Open office: the crew works here, and each desk monitor shows that crew
// member's tokens this turn (see stepDone for how they are attributed).
const tokShort = n => n < 1000 ? String(n) : n < 999500 ? Math.round(n / 1000) + 'K' : n < 9.95e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1e6) + 'M';
function drawDesks() {
  const t = visT;
  for (const role of ['research', 'build', 'review', 'design', 'qa']) {
    const st = STATIONS[role], sx = st.x - 7, col = ROLES[role].color, a = agentByRole[role];
    rect(ctx, sx, 42, 14, 8, '#0f2236');
    const tok = roleTok[role] || 0, busy = isWorking(a);
    if (tok > 0) {
      const s = tokShort(tok);
      drawText(ctx, s, sx + Math.floor((14 - textW(s)) / 2), 43, busy ? col : mix(col, '#0f2236', 0.5));
    } else if (busy) {
      const off = Math.floor(t * 5);
      for (let r = 0; r < 4; r++) { const ind = Math.floor(hash(r + off, 1) * 3) * 2; rect(ctx, sx + 1 + ind, 43 + r * 2, 3 + Math.floor(hash(r + off, 2) * (7 - ind)), 1, col); }
    }
  }
}
function drawKpis(S) {
  const k = kpiInfo(), fg = '#a8e6ff', dim = '#5a8ab8';
  let x = S.x + 2, y = S.y + 2;
  const seg = (s, c) => { drawText(ctx, s, x, y, c); x += textW(s) + 4; };
  const row = () => { x = S.x + 2; y += 7; };
  seg('IN', dim); seg(tokShort(k.tokensIn), fg); seg('OUT', dim); seg(tokShort(k.tokensOut), fg); row();
  seg('CALLS', dim); seg(String(k.calls), fg);
  if (k.failed) { seg('FAIL', dim); seg(String(k.failed), '#ff6b6b'); }
  if (k.running) { seg('RUN', dim); seg(String(k.running), '#f4b942'); }
  row();
  seg('PLAN', dim);
  if (k.planTotal) {
    seg(`${k.planDone}/${k.planTotal}`, fg);
    const bw = S.x + S.w - 3 - x;
    if (bw > 6) { rect(ctx, x, y + 1, bw, 3, '#16365e'); rect(ctx, x, y + 1, Math.round(bw * k.planDone / k.planTotal), 3, '#78d98e'); }
  } else seg('-', fg);
  row();
  seg('TIME', dim); seg(clockShort(k.seconds), fg);
  const req = `${k.requests} REQ`; drawText(ctx, req, S.x + S.w - 2 - textW(req), y, fg);
}
// The middle top seat is in front of Nova at the screen: it fills last.
const RUN_SEATS = [0, 2, 3, 4, 5, 6, 7, 1];
/** Running subagents and their boardroom seats. */
function runSeats() {
  const out = [];
  for (const m of machines.values()) {
    if (!m.on || m.key === 'main' || !m.look) continue;
    if (out.length >= RUN_SEATS.length) break;
    const s = SEATS[RUN_SEATS[out.length]];
    out.push({ m, x: s.x, y: s.y, face: s.face });
  }
  return out;
}
function drawRun(r) {
  const fx = Math.round(r.x), fy = Math.round(r.y), vb = visBeat() + r.m.seq * 0.37, bp = vb - Math.floor(vb);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(fx - 4, fy - 1, 9, 2);
  const arms = r.m.stepOpen > 0 ? 'down' : Math.floor(vb) % 2 ? 'type' : 'down';
  paintSprite(ctx, fx - 5, fy - 16, bp < 0.2 ? 1 : 0, r.face, arms, 0, r.m.look, ((visT + r.m.seq * 0.61) % 4.4) < 0.13, false);
}
function drawRunBubbles() {
  for (const r of runSeats()) if (r.m.stepOpen > 0) drawBubble(Math.round(r.x) - 5, Math.round(r.y) - 16 + accTop(r.m.look) - 13, 'think', ICON_COLOR.think);
}
