# After Round 1: convergence and live disagreements

All four seats independently chose:
1. One ledger of work in the hooks sandbox as the only source of truth; hooks do O(1) bookkeeping
   and set a dirty flag; drawing happens on a timer.
2. Truth in native text (a crew strip or ledger in the pane, the status line, tool-row chips); the
   in-world pixel text becomes decoration only.
3. No full-frame video: either a change-driven Svg with client-side animation (A, B, C) or a
   post-turn replay (D).
4. A THINKING state, and no wandering while a turn is open.
5. Tool-row chips as the record after the fact.
6. No keyword guessing for plan cards.
7. Ceremony capped (walks ≤600 ms, briefing ≤1.5–2.5 s, duet ≤1.2–2.5 s) and interruptible.
8. Honest zero-surface message; `/workplace` means show and focus; reminder blocks stripped
   (already shipped in the current build).

Live disagreements:
(a) A, B, C keep a live office (change-driven); D replaces it with a post-turn Episode replay and
    keeps only chips and a portrait strip live.
(b) A and C put the strip and timers in a Client (desktop and terminal); B refuses Client; D uses it
    only for timers and scrubbing.
(c) Terminals: A and C keep a Raster office under a pinned strip (A adds Image for kitty); B shows
    the ledger only; D is text-first and draws Raster only while an episode plays.
(d) A starts walks on `turn.step` tool-call chunks, before the tool runs; the others on `tool.call`.
(e) Svg re-send cap: A and B 1/s, C 2/s, D once per turn.
(f) Plan cards: A assigns a card to the role observed working while the item is in_progress; B, C
    and D show items unassigned.
