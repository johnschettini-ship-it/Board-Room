// ================= look-ahead (film) =================
// The office can run ahead for a few seconds, film each frame, and then put
// every bit of state back. Values are restored in place, so object identity
// (and the callbacks that captured an agent) survives. The random draws made
// while filming are kept on a tape that the live run then replays, so the
// live office does exactly what the film showed until a new event arrives.
let filming = false;
function saveGraph(roots) {
  // Iterative, and each object is marked before its fields are visited:
  // the graph has cycles (an agent and its duet point at each other).
  const saved = new Map(), stack = [...roots];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object' || saved.has(v)) continue;
    // A frozen object cannot change, and could not be restored: hook event data
    // (a turn's usage, for one) is frozen to every depth.
    if ((Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype) && Object.isFrozen(v)) continue;
    if (Array.isArray(v)) { saved.set(v, v.slice()); for (const x of v) stack.push(x); continue; }
    if (v instanceof Map) { saved.set(v, [...v.entries()]); for (const [k, x] of v) stack.push(k, x); continue; }
    if (v instanceof Set) { saved.set(v, [...v]); for (const x of v) stack.push(x); continue; }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) continue; // canvases and typed arrays are not simulation state
    const copy = {};
    saved.set(v, copy);
    for (const k of Object.keys(v)) { copy[k] = v[k]; stack.push(v[k]); }
  }
  return saved;
}
function restoreGraph(saved) {
  for (const [o, s] of saved) try {
    if (Array.isArray(o)) { o.length = s.length; for (let i = 0; i < s.length; i++) o[i] = s[i]; }
    else if (o instanceof Map) { o.clear(); for (const [k, x] of s) o.set(k, x); }
    else if (o instanceof Set) { o.clear(); for (const x of s) o.add(x); }
    else { for (const k of Object.keys(o)) if (!(k in s)) delete o[k]; Object.assign(o, s); }
  } catch (_) { /* one object that refuses must not leave the rest in the future */ }
}
function snapshotAll() {
  return {
    graph: saveGraph([agents, npcs, particles, hall, acts, logRing, turnCalls, machines, turnTok, roleTok, mission, focus, lastEnded, flickers, antennas]),
    v: { simT, visT, mission, missionSeq, selectedId, confettiAcc, lastEventT, focus, focusT, lastEnded, lastAnnounce, turnOpen, turnT0, turnEndT, turnReason, mainStepOpen, thinkT0, camX, manualRoom, autoCam, directorRoom, directorT, directorDwell, stepAccUs },
  };
}
function restoreAll(s) {
  try { restoreGraph(s.graph); } finally {
  ({ simT, visT, mission, missionSeq, selectedId, confettiAcc, lastEventT, focus, focusT, lastEnded, lastAnnounce, turnOpen, turnT0, turnEndT, turnReason, mainStepOpen, thinkT0, camX, manualRoom, autoCam, directorRoom, directorT, directorDwell, stepAccUs } = s.v);
  }
}
/**
 * Films up to `count` frames, `dt` seconds apart, starting with the frame of
 * now. onFrame(k, frame, camX) may return false to stop early. The office is
 * left exactly as it was; returns the number of frames filmed. With `cut`,
 * each frame is drawn with the camera already at the room it is heading for
 * (the camera only affects drawing, so the run itself is the same): a pan
 * becomes one cut, which a film can carry cheaply.
 */
function film(count, dt, onFrame, cut) {
  const saved = snapshotAll(), motionWas = motion;
  // Confetti and disco always go in their own layer while filming: the film
  // draws them as CSS, so they must not be baked into the frames ('full').
  if (motion === 'full') motion = 'auto';
  tapeAhead = tape ? tape.slice(tapeI) : null; tapeAheadI = 0;
  filming = true; tapeRec = []; tape = null;
  let n = 0;
  try {
    for (let k = 0; k < count; k++) {
      if (k) advance(dt);
      const live = camX;
      if (cut) camX = clamp(startFor(camTarget()) * RW, 0, W - VWc);
      const shown = Math.round(camX), f = render();
      camX = live;
      n++;
      if (onFrame(k, f, shown) === false) break;
    }
  } finally {
    const rec = tapeAhead ? tapeRec.concat(tapeAhead.slice(tapeAheadI)) : tapeRec;
    tapeRec = null; tapeAhead = null; filming = false; motion = motionWas;
    restoreAll(saved);
    tape = rec; tapeI = 0;
  }
  return n;
}
let version = 0;
// Anything from outside (a hook event, a press, a setting) can change what
// happens next: the film and the tape no longer hold.
const external = f => (...args) => { version++; tape = null; tapeAhead = null; return f(...args); };