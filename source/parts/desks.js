// ================= orchestration rooms =================
// Boardroom: Zorya orchestrates by the wall screen, which shows the turn's
// KPIs once the briefing is over; each running subagent sits at the table in
// its model's colour, with a thought bubble while its request is open.
// Open office: the crew works here, and each desk monitor shows that crew
// member's tokens this turn (see stepDone for how they are attributed).
// ---- replay: the outside events of the latest task, with their times ----
// A replay feeds them, in order, to a second office (hooks module).
const replayLog = [];
function recordEvent(name, args) {
  if (name === 'startMission') replayLog.length = 0;
  let copy;
  try { copy = JSON.parse(JSON.stringify(args)); } catch (_) { return; }
  replayLog.push({ t: simT, name, args: copy });
  if (replayLog.length > 5000) replayLog.shift();
}

// ---- layout: rooms in view side by side (wide panes) or stacked (tall panes) ----
// Stacked, a 2- or 3-room view is one room wide and two or three rooms tall,
// each room at full width; the camera then cuts between sets of rooms. VWc
// stays the view's span in the world (camera and culling); the canvas is sized here.
const layout = { stacked: false };
const isStacked = () => layout.stacked && zoom > 1;
function sizeCanvas() {
  const w = isStacked() ? RW : VWc, h = isStacked() ? H * zoom : H;
  if (ctx.width === w && ctx.height === h) return;
  ctx = new Px(w, h); fxCtx = new Px(w, h); fxOut = new Px(w, h);
}
function setStacked(on) { layout.stacked = !!on; sizeCanvas(); }

// ---- pinned rooms ----
// In a 2- or 3-room view, pressed rooms are pinned and shown side by side even
// when they are not neighbours; free slots follow the camera (auto, manual or
// a followed crew member). With nothing pinned, the view is the usual run of
// neighbouring rooms.
const pinned = [];
// Split view: the free slot shows the work room (the town hall during a ship), not wherever the camera goes.
const viewLock = { work: false };
function togglePin(r) {
  r = clamp(r, 0, ROOMS - 1);
  const i = pinned.indexOf(r);
  if (i >= 0) pinned.splice(i, 1);
  else { pinned.push(r); while (pinned.length > zoom) pinned.shift(); }
}
function clearPins() { pinned.length = 0; }
function trimPins() { while (pinned.length > zoom) pinned.shift(); }
/** The rooms in view, left to right, or null for the usual run of neighbours. */
function viewSlots() {
  if (zoom < 2) return null;
  // Stacked with nothing pinned: the usual run of neighbours, one above another.
  if (!pinned.length) return isStacked() ? Array.from({ length: zoom }, (_, i) => viewStart() + i) : null;
  const slots = pinned.slice(-zoom), work = roomOf(STATIONS.build.x);
  // The camera wanting a room already pinned (Zorya in the pinned boardroom)
  // leaves the free slot on the work, not on the pinned room's neighbour.
  let t = camTarget();
  if (viewLock.work && !selectedId) t = hallEvent() ? TOWN : work;
  if (slots.includes(t) && !slots.includes(work)) t = work;
  for (let d = 0; slots.length < zoom && d < ROOMS; d++) {
    for (const r of d ? [t + d, t - d] : [t]) if (r >= 0 && r < ROOMS && !slots.includes(r) && slots.length < zoom) slots.push(r);
  }
  return slots.sort((p, q) => p - q);
}
/** What the view shows (a film ends when it changes) and where the town hall sits in it. */
function viewKey() {
  const slots = viewSlots();
  if (slots) {
    const h = slots.indexOf(TOWN), st = isStacked();
    return { key: 's' + slots.join(',') + (st ? 'v' : ''), hallX: h < 0 ? null : st ? 0 : h * RW, hallY: h >= 0 && st ? h * H : 0 };
  }
  const vx = Math.round(camX);
  return { key: String(vx), hallX: TOWN * RW - vx, hallY: 0 };
}

const tokShort = n => n < 1000 ? String(n) : n < 999500 ? Math.round(n / 1000) + 'K' : n < 9.95e6 ? (n / 1e6).toFixed(1) + 'M' : Math.round(n / 1e6) + 'M';
function drawDesks() {
  const t = visT;
  drawContextGauge();
  drawRunOverflow();
  for (const role of ['research', 'build', 'review', 'design', 'qa']) {
    const st = STATIONS[role], sx = st.x - 7, col = ROLES[role].color, a = agentByRole[role];
    rect(ctx, sx, 42, 14, 8, '#0f2236');
    const tok = roleTok[role] || 0, busy = isWorking(a);
    // The model of each run that asked for a call in progress, as a desk lamp
    // (one stripe per model, newest first); more than one call shows a count.
    if (busy) {
      const mine = [...acts.values()].filter(x => x.role === role).sort((p, q) => q.startT - p.startT);
      const palette = [...new Set(mine.map(x => x.model).filter(Boolean))].slice(0, 3);
      if (palette.length) {
        rect(ctx, st.x + 7, 55, 3, 3, '#1a1e2e');
        const w = Math.floor(3 / palette.length);
        palette.forEach((md, i) => { const mc = modelColor(md); rect(ctx, st.x + 7 + i * w, 55, i === palette.length - 1 ? 3 - i * w : w, 2, mc); });
      }
      if (mine.length > 1) {
        const s = mine.length > 9 ? '+' : String(mine.length);
        rect(ctx, sx + 9, 40, 6, 7, '#f4b942'); drawText(ctx, s, sx + 10, 41, '#0b0f1a');
      }
    }
    if (tok > 0) {
      const s = tokShort(tok);
      drawText(ctx, s, sx + Math.floor((14 - textW(s)) / 2), 43, busy ? col : mix(col, '#0f2236', 0.5));
    } else if (busy) {
      const off = Math.floor(t * 5);
      for (let r = 0; r < 4; r++) { const ind = Math.floor(hash(r + off, 1) * 3) * 2; rect(ctx, sx + 1 + ind, 43 + r * 2, 3 + Math.floor(hash(r + off, 2) * (7 - ind)), 1, col); }
    }
  }
}
/** The boardroom's context tank, right of the KPI screen: the main loop's window, filled. */
function drawContextGauge() {
  const c = ctxInfo, x = BOARD * RW + 171, y = 5;
  rect(ctx, x, y, 9, 30, '#06080f'); rect(ctx, x + 1, y + 1, 7, 22, '#0d2448');
  if (c.compacting) {
    // Being summarized: the tank drains, top to bottom, again and again.
    const h = 22 - Math.floor((visT * 14) % 22);
    rect(ctx, x + 1, y + 23 - h, 7, h, '#b08cf5');
    for (let k = 0; k < 3; k++) rect(ctx, x + 2 + k * 2, y + 23 - h + ((Math.floor(visT * 6) + k) % 3), 1, 1, '#e8dcff');
    drawText(ctx, '--', x + 1, y + 24, '#b08cf5');
    return;
  }
  if (c.tokens === null || !c.window) { drawText(ctx, '--', x + 1, y + 24, '#5a8ab8'); return; }
  const f = Math.min(1, c.tokens / c.window), h = Math.max(1, Math.round(22 * f));
  const col = f < 0.6 ? '#6fdc8c' : f < 0.85 ? '#f4b942' : '#ff6b6b';
  rect(ctx, x + 1, y + 23 - h, 7, h, col);
  const pct = String(Math.min(99, Math.round(f * 100)));
  drawText(ctx, pct, x + 1 + Math.floor((7 - textW(pct)) / 2), y + 24, col);
}
// The boardroom screen has three pages, flipped from the pane: this turn, the
// session so far, and the plan's usage (as Claude Code reports it).
const screen = { page: 'turn' };
const planUsage = { windows: [], usd: null };
function drawKpis(S) {
  const k = kpiInfo(), fg = '#a8e6ff', dim = '#5a8ab8';
  let x = S.x + 2, y = S.y + 2;
  const seg = (s, c) => { drawText(ctx, s, x, y, c); x += textW(s) + 4; };
  const row = () => { x = S.x + 2; y += 7; };
  const right = (str, c) => drawText(ctx, str, S.x + S.w - 2 - textW(str), y, c);
  if (screen.page === 'session') {
    const tin = sessTok.input + sessTok.cacheRead + sessTok.cacheCreate;
    seg('IN', dim); seg(tokShort(tin), fg); seg('OUT', dim); seg(tokShort(sessTok.output), fg); row();
    seg('CALLS', dim); seg(String(sessCount.calls), fg); if (sessCount.failed) { seg('FAIL', dim); seg(String(sessCount.failed), '#ff6b6b'); } row();
    seg('REQ', dim); seg(String(sessTok.requests), fg); right('SESSION', '#f4b942'); row();
    seg('OPEN', dim); seg(clockShort(simT), fg);
    return;
  }
  if (screen.page === 'plan') {
    seg('PLAN', '#f4b942'); if (planUsage.usd !== null) right('$' + planUsage.usd.toFixed(2), fg); row();
    if (!planUsage.windows.length) { seg(planUsage.usd === null ? 'NO DATA YET' : 'API KEY', dim); return; }
    for (const w of planUsage.windows.slice(0, 3)) {
      const pct = Math.max(0, Math.min(100, w.pct)), col = pct >= 95 ? '#ff6b6b' : pct >= 80 ? '#f4b942' : '#78d98e';
      seg(w.label, dim); seg(`${Math.round(pct)}%`, fg);
      const bw = S.x + S.w - 3 - x;
      if (bw > 6) { rect(ctx, x, y + 1, bw, 3, '#16365e'); rect(ctx, x, y + 1, Math.round(bw * pct / 100), 3, col); }
      row();
    }
    return;
  }
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
// The chair: the main loop's model sits at the head of the table (the left
// end) from its first request on, with its name on a tag. Awake while the main
// loop runs, dozing between turns. Subagents take the other seats.
const CHAIR_SEAT = 6;
function chairPlace() {
  const m = machines.get('main');
  if (!m || !m.model) return null;
  const s = SEATS[CHAIR_SEAT];
  return { m, look: modelLook(m.model), x: s.x, y: s.y, face: s.face, chair: true };
}
// The middle top seat is in front of Zorya at the screen: it fills last.
const RUN_SEATS = [0, 2, 3, 4, 5, 7, 1];
// More subagents than seats stand along the walls; past that a sign at the
// door counts the rest. Overflow is counted, never dropped.
const STANDING = [at(3, 30, 56, 'down'), at(3, 46, 56, 'down'), at(3, 152, 52, 'down'), at(3, 168, 52, 'down'), at(3, 214, 82, 'left'), at(3, 26, 104, 'right')];
/** Running subagents: their boardroom seats or standing spots, and how many are left over. */
function runPlaces() {
  const list = [...machines.values()].filter(m => m.on && m.key !== 'main' && m.look).sort((p, q) => p.seq - q.seq);
  const out = [];
  for (const m of list) {
    const i = out.length;
    const s = i < RUN_SEATS.length ? SEATS[RUN_SEATS[i]] : STANDING[i - RUN_SEATS.length];
    if (!s) break;
    out.push({ m, x: s.x, y: s.y, face: s.face, standing: i >= RUN_SEATS.length });
  }
  return { places: out, seated: Math.min(out.length, RUN_SEATS.length), standing: Math.max(0, out.length - RUN_SEATS.length), more: list.length - out.length };
}
const runSeats = () => { const c = chairPlace(), list = runPlaces().places; return c ? [c, ...list] : list; };
function drawRunOverflow() {
  const more = runPlaces().more;
  if (!more) return;
  const s = `+${more}`, x = BOARD * RW + 132, w = textW(s) + 4;
  rect(ctx, x, 131, w, 8, '#06080f'); rect(ctx, x + 1, 132, w - 2, 6, '#2b1d0e');
  drawText(ctx, s, x + 2, 132, Math.floor(visT * 2) % 2 ? '#f4b942' : '#c48a12');
}
function drawRun(r) {
  const fx = Math.round(r.x), fy = Math.round(r.y), vb = visBeat() + r.m.seq * 0.37, bp = vb - Math.floor(vb);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(fx - 4, fy - 1, 9, 2);
  if (r.chair) {
    // the chair: at work while the main loop runs, eyes shut between turns
    const on = r.m.on;
    paintSprite(ctx, fx - 5, fy - 16, on && bp < 0.2 ? 1 : 0, r.face, on && Math.floor(vb) % 2 ? 'type' : 'down', 0, r.look, !on || ((visT + 0.3) % 4.4) < 0.13, false);
    return;
  }
  const arms = r.m.stepOpen > 0 ? 'down' : Math.floor(vb) % 2 ? 'type' : 'down';
  paintSprite(ctx, fx - 5, fy - 16, bp < 0.2 ? 1 : 0, r.face, arms, 0, r.m.look, ((visT + r.m.seq * 0.61) % 4.4) < 0.13, false);
}
/** The chair's name tag: the main loop's model, in its colour (dim between turns). */
function drawChairTag(r) {
  const s = fitText(shortModel(r.m.model).toUpperCase(), 14), w = textW(s), col = modelColor(r.m.model);
  const x0 = Math.max(BOARD * RW + 2, Math.round(r.x) - (w >> 1) - 2), y0 = Math.round(r.y) - 16 + accTop(r.look) - 10;
  rect(ctx, x0, y0, w + 4, 9, 'rgba(8,11,22,0.88)'); drawText(ctx, s, x0 + 2, y0 + 2, r.m.on ? col : mix(col, '#0b0f1a', 0.45));
}
function drawRunBubbles() {
  for (const r of runSeats()) if (r.chair) drawChairTag(r); else if (r.m.stepOpen > 0) drawBubble(Math.round(r.x) - 5, Math.round(r.y) - 16 + accTop(r.m.look) - 13, 'think', ICON_COLOR.think);
}
