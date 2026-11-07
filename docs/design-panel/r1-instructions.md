# Round 1 — your independent proposal

Write ONE concrete design for the significant improvements this product needs. Other seats are
designing independently and will attack yours in Round 2, so make it specific enough to attack.
Name the UI primitives you use, what runs where (hooks sandbox vs drawing side), what is sent per
update and how often (bytes/s, CPU), and the exact rules (with numbers).

Required sections (≤1300 words total, markdown):
1. **Name + one-paragraph thesis.**
2. **Primitives and where state lives**, and why there, given the environment facts.
3. **Event model**: how prompts, tool calls (parallel, long-running, failing), subagents, plans,
   long thinking and the end of a turn map to what the person sees; the states to tell apart.
4. **Surfaces**: what the person gets on desktop (local), a cloud session in the app (no surface),
   Windows Terminal, kitty/Ghostty, VS Code and mobile; what degrades and how.
5. **Ceremony vs truth**: how briefing, walks, hand-offs and the town hall coexist with
   criterion 2 (truth within 1 s).
6. **Incident table**: for each incident 1–13, "prevented / made cheap / not addressed" + one line.
7. **What your design gets wrong**: the two weakest points, honestly.
8. **Build cost**: rough size and moving parts, and which 3 changes you would ship first.

Do not read any repository or file on disk. If you assert how a platform behaves, be precise, and
mark anything not given in the brief as an assumption.
