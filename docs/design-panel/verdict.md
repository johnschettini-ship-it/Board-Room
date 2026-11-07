# Verdict — Digital Workplace design panel (2026-11-07)

Seats: A Opus (truth first), B Sonnet (fewest moving parts), C Sonnet (use the substrate; Fable hit
its usage limit), D Opus (contrarian). Two rounds (independent proposals, cross-attack); the
moderator verified every contested claim in [facts.md](facts.md). Deviations from the full method:
one model vendor only (Claude), no Round 3, incident history written by the moderator.

## The design: "Ledger first, office second"

The office stays the face of the mod, but it stops being the place where the truth lives. One
ledger of work in the hooks module feeds three things: a native-text truth strip, a compute rack,
and the pixel office. When ceremony and truth disagree, ceremony is cut.

## Settled (three or more seats, or a verified fact)

| # | Point | Basis |
|---|---|---|
| S1 | One ledger in the hooks module is the only source of truth; hooks do O(1) bookkeeping and never throw into Claude. | all seats |
| S2 | Truth is native text, outside the office image: a strip pinned at the top of the pane (role · tool · target · elapsed), a status-line entry, and a turn receipt. In-world pixel text is decoration. | all seats; incident 9 |
| S3 | The raw tool and target always sit beside the role label, because the role is a guess for ambiguous tools such as Bash. | B, C, D, A |
| S4 | Failures stay visible until the same target succeeds or the turn ends; overflow is counted ("+3 more"), never dropped. | A, B, C kill shots |
| S5 | A THINKING state while the model thinks; no wandering to coffee while a turn is open. | all seats; incident 13 |
| S6 | A tool waiting for the person's approval shows "waiting for your OK", not "working" (`tool.check` → `ask`). | verified (facts) |
| S7 | Compute view: one "machine" per run, keyed by agentId (main loop = mainframe). Powers on at its first model request, counts requests, powers off at turn end with model, tokens and run time. Tokens are never faked while running. Subagent details read once per new agent, never polled. At most 8 machines, then "+N". Shown as text rows and as racks lighting up in the IT lab. | all seats, criterion 10 |
| S8 | Cloud sessions get no drawing at all (verified), so the mod says so in one factual line, only when asked, and never puts a recap into Claude's context. | verified; A, B, C, D |
| S9 | Terminals keep the block-art office under the pinned strip; strip only below 40 columns or 14 rows. | A, C, D; B conceded |
| S10 | Plan cards show items verbatim, unassigned; no keyword guessing. | B, C, D (A: assign by observation) |
| S11 | Any animation that must survive a redraw is CSS with a negative `animation-delay` from the clock; never SMIL (it restarts and ignores reduced motion). | verified (facts) |
| S12 | Fix the classifier for `git -C <dir> …`. | verified (facts) |

## Locked by the moderator (technical, one right answer)

- **L1. No early walks on streamed tool-call chunks** (A and D for, B and C against). The tool's
  role is often unknown until its arguments finish (Bash), and a call can then wait on a permission
  prompt (S6), so an early walk shows work that is not happening.
- **L2. Re-send the office image at most once per second, one room only.** Two rooms (≈42 KB) or 2/s
  breaks the 30 KB/s budget (A, B, C, D all conceded or ruled this).

## The open choices (for the person)

1. **How much to build now.** Phase 1 (truth strip, compute view, fixes, CPU throttling of the
   current renderer) is about a day's work and fixes every truth incident. Phase 2 (rebuilding the
   office as a CSS-animated image so it costs ≈20 KB/s instead of 130–200 KB/s and stays smooth on
   phones) is a larger rewrite of the renderer.
2. **Ceremony pacing.** Capped ceremony (walks ≤1 s, town hall straight after the turn) keeps the
   office truthful; the page's original pacing is more charming but lags (incident 6). Seat D's
   alternative: fast live, plus an on-demand replay for showing off.
3. **Compute view look.** Text rows in the pane, IT-lab racks lighting up, or both.
4. **Tool-row chips.** A one-line chip under each tool call in the transcript ("Kit · Edit auth.ts ✓")
   gives an after-the-fact record but changes how Claude Code looks (local sessions only).

## Facts that decided cruxes

- Animation in an Svg image restarts on every markup change; CSS resumes with a negative delay, SMIL
  does not; SMIL ignores reduced motion.
- A lit room is 13–19.5 KB; nine rooms ≈140 KB (over the 131,072-char Svg limit).
- In a cloud session the app requests no mod drawing of any kind (probe: 0 tool-row, 0 band renders).
- A command's reply is read by the model; `tool.call` wraps the permission prompt.

Records: [problem.md](problem.md) · [lenses.md](lenses.md) · [r1/](r1) · [r2/](r2) ·
[facts.md](facts.md) · [convergence-r1.md](convergence-r1.md). Decisions: [README.md](README.md).
