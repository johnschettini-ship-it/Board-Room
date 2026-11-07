<!-- Seat A (Opus), Round 1, verbatim in substance (tables condensed). Lens: truth first. -->
# Seat A: "Ledger first, stage second"

## 1. Thesis
Everything the office shows comes from one append-only work ledger in the hooks module; the pixel office is drawn from it and is never a source of truth. Truth is native Text: a crew strip pinned at the top of the pane, plus chips on tool-call rows, the band and the status line, with hard latency guarantees. Ceremony runs under a fixed budget and can always be interrupted; when ceremony and truth disagree, ceremony is cut.

Guarantees (tested by replaying recorded traces): G1 a call shows in the strip within 250 ms with a Client, 1 s elsewhere (role, tool, target ≤32 chars). G2 every call visible ≥1.5 s; finished shows "done". G3 a row per in-flight call incl. parallel and subagent; overflow counted, never dropped. G4 elapsed time after 3 s; failure ✗ in the same update, kept until turn end. G5 a running turn never looks idle. G6 outcome shown within 250 ms of turn.complete, before any town hall. G7 sprite at its station within 1 s.

## 2. Primitives
- Hooks: ledger (ring of 200 {id, role, tool, target, agentId, start, end, status}), classifier, ceremony director, scene composer; 10–30 µs per hook; try/catch; never awaits; reads only isError from results.
- Client (desktop local, terminal): owns the strip, timers, expand/collapse, minimap; ≈120 B post per ledger change; ticks elapsed time locally.
- Svg (desktop, VS Code, mobile): one room (two if ≥480 px); room as palette-PNG data-URI, sprite atlas data-URI, sprites via `<use>`; loops and walks as CSS animations; re-sent only on scene change, coalesced ≤1/s; target ≤14 KB (assumption: room PNG ≤5 KB).
- Raster (all terminals): half-block office, changed cells only, 8 fps.
- Image (kitty/Ghostty/iTerm2): on scene change ≤2/s; PNG encode ≈3 ms (assumption).
- Outside the pane: tool-row chip ("Kit · Edit auth.ts", ✗), a one-line "now" in the band, a status-line entry ("Kit, Dot ×2 · 0:42").

## 3. Event model
States: IDLE, THINKING, WORKING, ATTENTION (failure, still running), DONE, STOPPED, ERROR.
- prompt.submit: strip reminder blocks and leading tags; title ≤48 chars or "New task"; crew walk to the boardroom (≤600 ms).
- turn.step thinking/text: "Nova thinking 0:23" / "Nova writing answer".
- turn.step tool-call chunk: dim provisional entry; the role starts walking before the tool runs; dropped after 3 s without a call.
- tool.call: row `[Kit] Edit auth.ts`; sprite at its station.
- Parallel same role: an "apprentice" cousin takes the next desk.
- Subagent: one cousin NPC per agentId badged with its role; strip groups "▸ 3 helpers · 5 running".
- Long call: elapsed from 3 s, amber "long" at 60 s, spinner.
- isError: red ✗ kept; bug icon on the desk until the same target later succeeds.
- TodoWrite: cards unassigned on Nova's clipboard; a card takes the role whose tool runs while it is in_progress.
- turn.complete: "DONE 0:13 · 4 tools · 1 ✗" first; ceremony after.
Role table: Read/Grep/Glob/Web*→Pax; Edit/Write on css/svg/html/design→Iris, else Kit; test-runner Bash→Dot; git diff/log, lint→Vale; other Bash→Kit; TodoWrite, Task→Nova; MCP→Pax.

## 4. Surfaces
Desktop local: Client strip, Svg office, minimap. Cloud/projects: chips, band, status line; one-time band notice "No office pane in cloud sessions…"; `/workplace` gives the same message (unverified that chips/band render). Windows Terminal/VS Code terminal/tmux: Client strip on top, Raster office below; <40 cols or <14 rows: strip only. kitty/Ghostty/iTerm2: strip + Image office. VS Code panel/mobile: Box/Text strip + Svg re-rendered ≤1/s (≤16 KB/s); elapsed in steps; the band carries sub-second truth. Terminal layout: reserve header, min(in-flight, 4) rows and the minimap first; the office gets the rest.

## 5. Ceremony vs truth
Director with per-phase budgets and cancel tokens. Walks ≤600 ms; cross-room door-pop (150 ms out, 150 ms in). Briefing starts ≤300 ms after submit, loops only while no tool is in flight. Duet ≤1.2 s, cut to its end state by a new Dot/Kit call or turn.complete; never after the turn. Town hall ≤500 ms after DONE; demo ≤6 s, party ≤8 s; cancelled by a new prompt; only for answered turns with ≥1 tool; aborted freezes, error gathers in the Lead office. Wander only with no turn running and 60 s quiet. Camera: room with most in-flight calls, ties to newest, hold ≥2 s, cut at walk start; a 9-cell minimap row. Reduced motion: CSS media query hides animated groups (loops are CSS, not SMIL); terminals: `/workplace motion off`. Screen reader: aria-label sentence from the ledger. After the fact: strip collapses to a summary + "▸ timeline" of the last 5 turns; chips stay in the transcript. Cost: <1 % CPU; ≈0.6 KB/s Client posts; Svg ≤14 KB/s busy, 0 idle.

## 6. Incidents
1 made cheap · 2 made cheap · 3 prevented (truth rows reserved first) · 4 prevented · 5 prevented · 6 prevented · 7 prevented (hold-and-cut + minimap) · 8 prevented · 9 prevented · 10 prevented (assign by observation) · 11 prevented (hide toggle) · 12 not addressed (platform) · 13 prevented.

## 7. Weakest points
1. Costs delight: twitchier office, shorter duet and town hall, apprentice cousins under heavy parallel work.
2. Cloud barely served and rests on unverified primitives; walking on tool-call chunks can false-start (dimmed, 3 s timeout). The ≤14 KB Svg and PNG encode speed are assumptions.

## 8. Build cost
≈2.5k lines (ledger 400, Client strip 400, scene composer 600, Raster 300, director 400, no-surface 200, trace-replay tests 300). Ship: (1) ledger, strip, chips, reminder stripping, /workplace; (2) director budgets, THINKING, no wander in a turn; (3) Svg on scene change with camera rule and minimap.
