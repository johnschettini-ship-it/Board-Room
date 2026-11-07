# Lenses (one per seat; a seat may drop hers once beaten)

Seat A (Opus): TRUTH FIRST. Treat this as a fidelity problem: the office must never lie, lag or hide
what Claude is doing. Find the minimum set of guarantees (latency, parallel calls, subagents,
long thinking, failures) and make ceremony strictly subordinate to them.

Seat B (Sonnet): FEWEST MOVING PARTS. The best design costs least to run, has least to break and
degrades gracefully on every surface. Prefer designing problems out (less animation, smaller
updates, fewer states) over building machinery.

Seat C (Fable): USE THE SUBSTRATE. Build on Claude Code's own UI primitives: Svg with SMIL/CSS
animation that runs client-side, Client surface modules, terminal Raster repaint, tool-row
decorations, the band above the prompt, the status line, notifications. No server-rendered video
stream unless the substrate provably cannot do the job.

Seat D (Opus): CONTRARIAN. Argue that an always-on, live-animated pane is the wrong primitive for
this product, and that most of its value should come from a different form (for example a turn
recap or replay, a glanceable summary, or something else you can defend), with live animation at
most a small, optional layer. Be contrarian against any design built on the live pane.
