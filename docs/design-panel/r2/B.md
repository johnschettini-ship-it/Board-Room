<!-- Seat B (Sonnet), Round 2, condensed faithfully. -->
# Seat B, Round 2

## Kill shots
- **A1 (serious, c6/c3):** two-room Svg at 520 px ≈ 36 KB per send (lit rooms are 13–19.5 KB each); a parallel burst coalesced to 1/s ≈ 36 KB/s > 30 KB/s; dropping lighting to fit a palette breaks c8.
- **A2 (serious, c2):** walking on `turn.step` chunks: the chunk names `Bash` before the arguments say `npm test`, so the sprite walks to Kit then reverses to Dot — the earliest visible fact is retracted; the gain is milliseconds.
- **A3 (serious, c5 risk):** four renderers (Client strip, Svg, Raster, Image), ≈2.5k lines: each extra path is a place for an exception.
- **C1 (fatal for the stage):** at a 2/s cap, every send restarts all animation (verified): no walk finishes, the crew snaps back twice a second; 16–40 KB/s.
- **C2 (serious, c2):** LRU lane eviction drops running long-lived agents from the strip.
- **C3 (serious, c2):** failed rows expiring after 10 s make a broken turn look healthy.
- **D1 (fatal, c1/c2/c10):** nothing to watch while the work happens; the compute view is inherently live and D has no live surface.
- **D2 (serious, c6):** a multi-room episode hits the 131 KB limit (nine rooms ≈140 KB).
- **D3 (serious, c4):** a 30 s cutscene of a turn already finished; often cancelled by the next prompt.

## Attack on the consensus
Every re-render re-sends the whole tree: a 1 Hz elapsed tick in a ledger sharing the tree with the Svg costs 15–20 KB/s — unpriced, and it breaks B's own Round 1 numbers. Only a Client strip fixes it (desktop, terminal); elsewhere strip and Svg share a 1 Hz tree. The role label is a guess (Bash is ambiguous): the honest truth is tool + target. Chips and band are unverified in cloud; the only verified cloud primitive is a command reply, which the model reads.

## Rulings
(a) live change-driven office; replay out of v1. (b) Client yes for strip, timers and compute rows. (c) ledger/strip first; Raster office only with ≥14 rows, repainted on change; Image only with PNG, after v1. (d) no early walks. (e) 1/s. (f) unassigned, verbatim.

## Criterion 10
A "machines" block of Client rows (Box/Text in the 1 Hz tree elsewhere): one machine for the main loop plus one per agentId; `turn.step` (model, effort, agentId) powers it on; `turn.complete` (usage, durationMs) powers it off and fills tokens; `$.agent.list()` polled every 2 s while agents run. Honesty: tokens unknown while running — show "…" and live run time. Row: `[lit] main · opus · high · 0:42` → `12.4k in / 3.1k out · 0:42`. ≈100 B per post, <1 KB/s.

## Steal / concessions
Steals: A's G1–G7 trace tests, strip rows reserved before art, overflow counted; C's receipt row, drop stale ceremony; D's sanitiser, short `/workplace` recap, size discipline, optional replay later.
Concedes: SMIL (restarts, ignores reduced motion) → CSS with negative delays; ledger at 4/s in the Svg's tree; refusing Client; Svg through Image; 600–900 lines (really 1.5–2k); dropping Raster; role guess for Bash (always show tool + target).
