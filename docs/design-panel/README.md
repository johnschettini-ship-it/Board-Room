# Design panel — Digital Workplace (2026-11-07)

An adversarial design panel audited the mod's concept: four seats with different lenses, two rounds,
moderator-verified facts. Start with the [verdict](verdict.md).

## Decisions (gate answered 2026-11-07; gate closed)

| # | Question | Answer |
|---|---|---|
| D1 | How much to build now | **Phase 1 + Phase 2**: truth strip, compute view, verified fixes, CPU throttling; then rebuild the office image as a CSS-animated scene for app surfaces. |
| D2 | Ceremony pacing | **Fast and truthful**: short walks (cross-room moves pop through the door), briefing cut by the first tool call, town hall right after the turn, skipped by a new prompt. |
| D3 | Compute view look | **Both**: text rows in the pane and racks lighting up in the IT lab. |
| D4 | Tool-row chips | **Off by default**, with a setting to turn them on. |

Locked by the moderator: L1 no early walks on streamed tool-call chunks; L2 the office image is
re-sent at most once per second, one room. Added after the gate (verified in the API types): a call
waiting on the permission dialog is marked from `classic.PermissionRequest`, which fires when the
dialog is about to show.

## What was built (branch `improve/design-panel`, version 0.3.0)

| Point | Where | How it was checked |
|---|---|---|
| S1 one ledger | `source/parts/flow.js` (acts, turnCalls, machines) | plugin tests; hooks never throw into Claude (try/catch on every hook) |
| S2, S3 truth strip | `hooks/register.tsx` `stripLines` | test 3b: `● Pax (Research) · Grep · register · 0:02` |
| S4 failures stay | `flow.js` `toolEnd` marks a failure fixed only when the same role, tool and target pass | test "failures stay in the strip" |
| S5 thinking, no wandering | `flow.js` `isThinking`, `idleMode` (idle only when nothing runs) | compute test (`◌ Nova thinking`); test 5b |
| S6 waiting for your OK | `classic.PermissionRequest` → `markWaiting` | test "a tool that waits for the person" |
| S7 compute view | `turn.step` / `turn.complete` → machines; text rows + IT-lab racks | compute test (tokens, cached, subagent row) |
| S8 cloud | one-line `/workplace` reply when the engine reports no surface | test "no drawing surface" |
| S9 terminals | strip above the block art; strip only below 40 columns or 14 rows | test 1 (terminal raster) |
| S10 plan cards unassigned | `register.tsx` plan cards use role `none` | test "plans become cards" |
| S11 CSS, not SMIL | `hooks/stage.ts`: CSS `animation-delay` rewritten per render | Chromium playback: every film frame equals the simulation's frame |
| S12 `git -C` | `hooks/classify.ts` `program()` | classifier test |
| L1 | walks start on `tool.call`, never on streamed chunks | by construction |
| L2 | `currentFilm`: a new film at most once a second (sooner after a press) | desktop film test: ≤3 redraws in a quiet second |
| D2 fast pacing | `popTo` door-pop walks; briefing ends at the first tool; town hall at once | scenario harness: briefing ≤1.5 s, walks ≤0.4 s, demo 1.25 s after the turn |
| D4 chips | `toolChips` setting, off by default | two chip tests |

Phase 2 design, as built: the office films itself up to 2 s ahead and rewinds (in-place snapshot of
every simulation object; a build-time check fails if a new top-level variable is not saved). A tape of
random draws makes the live run do what the film showed until the next outside event: the full
acceptance scenario with a film every second showed 0 differing frames of about 480 (auto and
reduced motion). A busy one-room film of 2 s is about 30 KB.

Open risks, not verified on a real surface: whether the desktop app re-sends an unchanged Svg (the
design assumes it may, so every redraw carries correct delays), how the mobile app plays CSS inside
an Svg image, and the CPU cost of filming (about 0.1 s per second while busy, measured in Node).
