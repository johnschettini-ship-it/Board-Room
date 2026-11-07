<!-- Seat C (Sonnet), Round 2, condensed faithfully. -->
# Seat C, Round 2

## Kill shots
- **A1 (serious, c6):** two rooms + atlas ≈30–42 KB per send; 10 sends in a parallel burst ≈36 KB/s; each send restarts CSS walks unless negative delays are computed, which A does not specify.
- **A2 (serious, c2):** walking on Write chunks while a permission prompt waits 20 s+: Kit "works" while nothing runs; a denied call means Kit walked for nothing; the 3 s drop timer does not cover a pending approval.
- **B1 (serious, c6):** B's ledger renders (≤4/s, elapsed computed at render time) re-send the 16 KB Svg: 64 KB/s. B's "Svg ≤1/s" caps scene changes, not bytes. Refusing Client forces this (unless the surface dedups identical markup — UNVERIFIED).
- **B2 (serious, c7):** SMIL-only motion ignores reduced motion; kitty via Image cannot take Svg.
- **D1 (fatal for "mirror"):** the episode plays after a 13 s turn, cancelled by the next prompt; during the turn there was no office.
- **D2 (serious, c6):** a 110 KB episode in a re-rendering tree restarts and re-sends on every strip change (110 KB/s); scrubbing impossible.
- **D3 (tolerable):** a `/workplace` recap enters model context.

## Attack on the consensus
Nobody priced the shared tree: every strip change re-sends and restarts the Svg unless the markup stays byte-identical; on Client-less surfaces (VS Code, mobile) every tick pays the full Svg. Truth must move out of the Svg's tree (status line, chips, Client strip). Roles are a costume over "tool X ran on target Y": show the raw tool beside the role.

## Rulings
(a) live office; replay only as an optional ≤8 s on-demand recap. (b) Client on desktop and terminal; no-Client strip as Text ≤1 render/s, elapsed in 5 s steps. (c) Raster office under a pinned strip; strip only below 40 cols or 14 rows. (d) no early walks; a dim "Kit preparing Write…" strip row is fine. (e) a byte budget: ≤1/s and ≤1 send per (size/20 KB) s. (f) unassigned, verbatim.

## Criterion 10
Native Box/Text "machine rack" rows (not Svg): main loop first, then subagents from `$.agent.list()` merged with agentIds seen in `turn.step`; `▮ main · opus · effort high · 0:42 · in 12.4k out 1.1k cache 8k`; LED on while a model request or tool is open, off at `turn.complete`; tokens only at finish ("…" while running, never faked); elapsed ticked in the Client; ≈100 B per change; receipt holds totals.

## Steal / concessions
Steals: A's G1–G7 trace tests, minimap, strip-rows-first layout; B's single reducer and colour-independent glyphs; D's raw tool beside role, reduced-motion storyboard, poster frame.
Concedes: SMIL → CSS with negative delays, Svg re-sent only on scene change; 2/s and 8–20 KB → byte budget; long `/workplace` text report → a `$.session.append` notice plus a short reply; teleport-on-event → short walks by design; Image for kitty cut from v1 (Raster there too).
