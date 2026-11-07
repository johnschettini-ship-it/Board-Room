# Round 2 — cross-attack

All 4 Round 1 proposals are below (A, B, C, D). Attack the OTHER 3. You defend nothing yet.

## New requirement from the person (added after Round 1; every seat must account for it)

10. **Compute view.** The person wants to see the compute behind every run, "like the machines you
    are actually turning on": the main turn and every subagent as a machine that powers on while it
    runs, labelled with its model, tokens and run time. Facts: `turn.step` carries `model`, `effort`
    and `agentId` per model request; `turn.complete` carries `durationMs`, `agentId` and `usage`
    `{ model, input/output/cache tokens }`; `$.agent.list()` lists subagents with type, description,
    status and parent.

## Moderator facts (from facts.md)
<FACTS>

## Convergence and live disagreements
<CONVERGENCE>

## Your job (≤1200 words, markdown)
1. **Kill shots.** For EACH other proposal, its 1–3 most damaging concrete failure scenarios: a
   step-by-step timeline (surface, events, times, bytes, what the person sees) ending in a breach of a
   numbered criterion (1–10). Rate each fatal / serious / tolerable. No vague "this might be
   complex"; show the sequence.
2. **Attack the consensus.** Give the strongest argument that the converged choice is wrong. If you
   can't break it, say what it costs that nobody priced.
3. **Rule on each disagreement** with a one-line reason.
4. **Criterion 10.** How the compute view fits into the design you now favour (primitive, data,
   update rate, bytes/s), in ≤150 words.
5. **Steal list.** The best idea from each other proposal that you would adopt.
6. **Concessions.** Which of your own Round 1 choices you now think were wrong.

Do not read any repository or other file on disk. Precision over volume.
