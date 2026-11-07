<!-- Seat A (Opus), Round 2, condensed faithfully. -->
# Seat A, Round 2

## Kill shots
- **B1 (serious, c6):** a VS Code panel (no Client) with 3 subagents: 4 renders/s × ≈21 KB (room + sprites + markup + ledger) ≈ 84 KB/s; a "running 42 s" counter alone forces a 21 KB/s floor.
- **B2 (serious, c7):** "media query turns off SMIL" is false; reduced-motion users still get every flourish.
- **B3 (tolerable):** 1/s re-sends restart every SMIL flourish; a 1.2 s flourish never completes.
- **C1 (serious, c4/c8):** SMIL walks restart on every re-send; at 2 events/s no walk completes; sprites jitter between door and desk.
- **C2 (serious, c6):** 2/s × ≈21 KB ≈ 42 KB/s on VS Code/mobile.
- **C3 (serious, c2):** LRU evicts Dot's 90 s test while subagents refill the lanes; its failure then has no row and no hand-off.
- **D1 (serious, c8/c9):** a fix turn touching 6 rooms = 78–117 KB + timeline + sprites ≈ 86–125 KB; a party room breaks 131,072 chars; dropping rooms or lighting changes the art.
- **D2 (serious, c6):** the live crew strip re-renders the pane and re-sends the 110 KB episode (≈116 KB/s); any markup change restarts it; negative SMIL begin is refuted.
- **D3 (serious, c1):** a 12-minute turn is dark for 12 minutes; 180 calls squeezed into ≤40 beats merge failures; the cloud recap is read by the model.

## Attack on the consensus
The cloud plans sit on the wrong channel: the only verified cloud channel (a command reply) is read by the model; the model-blind one (`$.session.append`) and chips are unverified. The reply must be one factual line, only when asked, never a recap; ship the append probe first. And native-text truth costs 5–7 of ≈20 terminal rows and ≈90 px — acceptable only if the office also carries truth on its own (role-coloured desk glow, 2× status icons ✗ ⟳ thought bubble).

## Rulings
(a) live office; episode as opt-in catch-up. (b) Client wherever it exists (a tick ≈120 B instead of ≈21 KB). (c) keep Raster as a 1:1 crop of the active desk (a 5× downscale shrinks sprites to 2–3 cells); ledger only below 40 cols or 14 rows. (d) start walks on tool-call chunks, row dim until tool.call. (e) Svg ≤1/s, walks CSS with `animation-delay: -(now − t0)`. (f) assign by observation, unassigned until seen, raw tool always beside the role.

## Criterion 10
A server room in the IT lab, one rack per run: the main loop is the mainframe; each agentId a rack under its parent; power on at its first turn.step; CSS LED loops (static under reduced motion); native Text labels `▣ main · <model> · <effort> · 0:42 · 7 req`, + `12.4k in / 1.1k out / 30k cache` at turn.complete; tokens only when usage arrives; `$.agent.list()` once per new agentId; ≈80 B per post; the Svg changes only on power on/off; cap 8 racks, then "+N".

## Steal / concessions
Steals: B's colour-independent glyphs and skipped-not-queued ceremony; C's receipt row, "town hall within 300 ms or not at all", drop ceremony queued >1 s, status line as the floor; D's raw tool beside role and an on-demand catch-up replay capped by room count.
Concedes: room PNG ≤5 KB was false (Svg ≈21 KB; two rooms dropped); walks must be CSS with clock-computed negative delays; kitty Image only as an idle poster in v2; the cloud notice shrinks to one line.
