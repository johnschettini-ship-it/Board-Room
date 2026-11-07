<!-- Seat B (Sonnet), Round 1, verbatim. Lens: fewest moving parts. -->
# Seat B, Round 1: "Ledger First" (truth as a tiny text ledger, the office as optional garnish)

## 1. Thesis
The expensive, fragile part of today's design is the office-as-video: full-frame Svg re-sends (130-200 KB/s), 8-13 ms per frame, ceremony timelines that trail reality, and in-world pixel text nobody can read. I design that problem out. Truth lives in a **ledger**: a small text/Box structure of at most 6 rows, one per crew member, plus one turn-state header. It is cheap, readable at 40 columns, and identical on every surface. The office becomes a **static-per-state Svg scene** that is re-sent only on state change, with SMIL doing all motion inside the image. No frame loop runs anywhere. Ceremony is allowed only as short, non-blocking SMIL flourishes on top of the already-correct ledger, so it cannot contradict or delay it.

## 2. Primitives and where state lives
- **Hooks sandbox owns all state.** One reducer, `state = f(state, event)`, O(1) per event; per role `{status, tool, target(<=28 chars), startedAt, callIds}`, plus turn phase and counters. Hooks only mutate memory and set a dirty flag (well under 0.1 ms per tool call, assumption).
- **A coalescing render timer** (1/s, plus an immediate render on a state transition, 250 ms minimum gap) re-renders only when dirty: at most 4 renders/s, typically about 0.3/s.
- **Box/Text ledger** (every surface): header with phase and elapsed time; role rows with glyph, role, tool, target and a "running 42 s" counter computed from `startedAt` at render time. About 1-2 KB per render, 1-3 KB/s worst case.
- **Svg scene** (desktop, mobile, VS Code, kitty): one 240x176 room view plus a strip of 6 role chips (2-state sprites, idle/working). Re-sent only on a state change, ≤10 KB after trimming (assumption), rate-limited to 1/s (≈15 KB/s); the ledger still updates at 4/s.
- **No Client, no Raster, no Image** (deferred as optional upgrades).
- **Transcript decorations**: one line per tool-call row, "Dot / Bash: npm test". The after-the-fact record; possibly the only layer in cloud (unverified).
- **Status line**: `Nova briefing | 3 working | Kit: Edit app.ts 12s`. Toast on failure only.

## 3. Event model
Seven phases with a glyph that does not depend on colour: idle, listening, thinking (turn.step without tools), working, blocked/failed, wrapping, done/aborted/error.
- prompt.submit: strip `<system-reminder>` blocks; first 60 chars; "(session context)" when empty.
- tool.call: static table on tool name (Read/Grep/Glob/WebFetch→Pax; Write/Edit/NotebookEdit→Kit; Bash test-like→Dot; Bash otherwise→Kit; Task/subagent→named role, else Nova). Row opens immediately, no walk prerequisite. Parallel calls: per-role count, most recent call plus "+2", tracked by call id.
- Long-running: elapsed seconds; ">20 s still running" flag.
- Failures: row turns failed until that role's next success; toast; a failing test adds a "-> Kit" arrow (plain hand-off).
- Subagents: indented sub-rows under the parent role, 3 shown plus "+N more".
- Plans: drop keyword role-guessing; show the plan as a header checklist.
- Long thinking: phase `thinking`, Nova shows "thinking 73 s", crew stays put; wandering only when no turn is in flight.
- End of turn: header `done` at once with a one-line summary (N calls, M failures, wall time, files touched); demo is a ≤2 s SMIL flourish.

## 4. Surfaces
- Desktop local: ledger, scene, footer.
- Cloud in app: no surface; decorations/band if they render (unverified); otherwise a toast/status message "No pane here; open this session in a terminal or the desktop app".
- Windows Terminal / VS Code terminal / tmux: the ledger is primary (≤40 cols, ≤8 rows); block Raster only as a later add-on; Image alt = ledger text.
- kitty/Ghostty/iTerm2: Svg via Image (assumption) else ledger.
- VS Code / mobile: Svg plus ledger; mobile shows decorations as cards.
- Screen reader: Svg title/desc from the ledger. Reduced motion: media query turns off SMIL.

## 5. Ceremony vs truth
The ledger is written first; ceremony never gates a ledger write. SMIL flourishes ≤1.2 s, skipped (not queued) if a newer event arrives. Walks become a 400 ms fade/slide, or a chip lights up if off-screen. Briefing 1-2 s while the first tool call is already shown. Hand-off = one arrow animation. Town hall 2 s, interruptible. No timeline longer than 2 s.

## 6. Incident table
1 made cheap (honest message, unverified) · 2 not addressed · 3 prevented (ledger is the strip) · 4 prevented (show-and-focus) · 5 prevented · 6 prevented (2 s cap, ledger first) · 7 prevented (fixed active room + chips) · 8 prevented (state-driven, ≤1/s) · 9 prevented (text in ledger) · 10 prevented (dropped) · 11 made cheap (hide toggle) · 12 not addressed · 13 prevented (thinking phase, no wander in a turn).

## 7. Weakest points
1. Delight is thin: mostly static scene; sacrifices the walking crew; refuses Client-driven local animation.
2. Role mapping by static tool table is still a guess; Svg re-sends could exceed budget in parallel-heavy sessions unless the 1/s cap holds, and the cap delays scene truth by up to 1 s.

## 8. Build cost
≈600-900 lines (reducer 150, ledger 150, scene trimmer 200, SMIL 150, plumbing); 1 timer, 0 clients, 0 frame loops. Ship: (1) reducer + ledger + status line + title fix + thinking rule; (2) state-driven scene, ceremony cap, simpler camera; (3) decorations + zero-surface message.
