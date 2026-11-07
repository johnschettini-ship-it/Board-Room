<!-- Seat D (Opus), Round 1, verbatim in substance (lists condensed). Lens: contrarian. -->
# Seat D: "Dailies, not CCTV"

## 1. Thesis
A live animated office works like CCTV: it costs a lot, it lags, and it has to lie (a walk takes seconds while a tool call takes milliseconds), and nobody watches CCTV. Every surface already renders a place for the truth: the transcript's tool rows, the status line and the band. So the crew goes there as small, exact, text-first **chips**. The delight goes where timing doesn't matter: after each turn the mod compiles that turn's real event log into an **Episode**, one self-contained SMIL SVG cutscene of 15–30 s with the original crew, rooms, briefing, hand-off duet and town hall, choreographed with full hindsight so it can never trail or contradict reality. The pane becomes an episode viewer, not a fish tank. Live animation survives only as six portrait loops in an optional crew strip.

## 2. Primitives and where state lives
- Hooks sandbox: append-only event log per turn (ring of 2,000 `{t, kind, callId, agentId, tool, target≤60ch, role, isError, durMs}`), role mapper, prompt sanitizer. A hook pushes a record and sets a dirty flag (<20 µs); rendering only on a timer.
- Transcript decorations per tool row: `▣ Kit · Edit · auth.ts · 0:04 ▶/✓/✗` (text; mobile cards); desktop adds a 16×16 sprite Svg (≈1 KB).
- Status line: `Kit▶Edit auth.ts · Dot✗ · 5✓ · 0:13`.
- Band: six crew glyphs with states, the turn phase, and "▶ Episode" after the turn.
- Pane (optional): Episode viewer (Svg + chapter list in real Text) and a ≈6 KB live crew-strip Svg with CSS idle/typing/alarm loops.
- Client (desktop, terminal): ticks elapsed timers and handles scrubbing locally.
- Raster/Image (terminal): episode playback on request.

## 3. Event model
Deterministic role map, raw tool + target always shown beside the role. States: Briefing, Thinking (`Nova thinking 0:42`, never idle), Writing answer, Working (running / long >10 s / ✓ / ✗), Subagent (grouped `sub·a3f`), Done ✓ / Stopped ⏹ / Error ⚠. Wandering only ≥60 s after turn.complete. Parallel calls: a chip each, counts in the status line (`Pax×3`). Failing test: Dot red, band `Dot→Kit: 2 failing`; a later pass shows `fixed`. Plans: items unassigned until a real call ticks them off. Renders coalesced every 250 ms (≤4/s); status ≈120 B, band ≈500 B, decoration ≈250 B, crew strip ≈6 KB ≤1/s; peak ≈10 KB/s, typical <2 KB/s; CPU <0.5 %.

Episode compile (timer after turn.complete): beat = clamp(0.8 + 0.4·log2(1 + real s), 0.8, 3) s; same role+tool within 2 s merge; ≤40 beats; parallel calls as up to 3 stacked room crops; briefing 2.5 s with the roles that actually worked; duet 2 s at the failure's real position; ending: town hall 3 s (answer), lights-out 1 s (aborted), Vale + warning 1.5 s (error); party only if the last test run passed; ≤30 s total; scripted camera with lookahead; every beat captioned with real time; ≤110 KB; 2–5 ms compile once per turn.

## 4. Surfaces
Desktop local: chips, status, band; the pane plays the episode at turn end then rests on its poster. Cloud (zero surfaces): decorations/band still emitted (unverified); `/workplace` replies with honest text plus a text recap of the last turn; threads sessions take the same path. Windows Terminal: text-first pane (chapter list fits 40 columns); "▶ Play" draws the episode as half-block Raster at 8 fps only while playing. kitty/Ghostty/iTerm2: a poster Image per turn; playback at 6 fps ≤30 s. VS Code: desktop without Client. Mobile: cards + episode Svg (assumption: panes exist). Reduced motion: the Svg hides the animated group and shows a 6-frame storyboard; no autoplay. Screen reader: generated `<title>/<desc>` summary; chapter list is real Text.

## 5. Ceremony vs truth
They never share a timeline. Live = chips only (≤250 ms, no walks, no camera). Ceremony only in the Episode, labelled REPLAY, built from the finished log. "Catch up" compiles the episode so far and plays it at 2×.

## 6. Incident table
1 made cheap · 2 made cheap · 3 prevented · 4 prevented (`/workplace` always shows; `/workplace off` hides) · 5 prevented (strip tag blocks, ≤40 chars, "Untitled task") · 6 prevented · 7 prevented · 8 prevented (one ≤110 KB SVG per turn) · 9 prevented · 10 prevented · 11 made cheap · 12 partly · 13 prevented.

## 7. Weakest points
1. The ambient office is gone; cutscenes get skipped; compression distorts duration.
2. Bets on unverified chrome (decorations/band, cloud); long turns hit the 131 KB limit; scrubbing assumes negative SMIL begin offsets work.

## 8. Build cost
≈2,000 lines (log/mapper/sanitizer 300, chips/status/band 300, episode compiler 800, terminal player 300, crew strip + command 250). Ship: (1) truth layer; (2) episode compiler for Svg surfaces; (3) text-first terminal pane + honest zero-surface reply.
