## Moderator-verified facts (2026-11-07, Claude Code 2.1.319, Chromium via Playwright)

- An Svg drawn as an image runs both SMIL and CSS animations client-side → **VERIFIED**. A 2-state
  SMIL `<animate calcMode="discrete">` and a CSS `@keyframes … steps(1)` animation each produced 2
  distinct frames over 1.4 s inside `<img src="data:image/svg+xml;base64,…">`.
- Under OS reduced motion, CSS animation in an Svg image stops via `@media (prefers-reduced-motion:
  reduce)`, **SMIL does not** → **VERIFIED**. With `--force-prefers-reduced-motion` the CSS row showed
  1 distinct frame, the SMIL row still 2. Page-level emulation (Playwright `reducedMotion`) does not
  reach Svg image documents; only the system setting does.
  Consequence: client-side motion that must honour reduced motion has to be CSS (or SMIL hidden by a
  CSS rule).
- Nested data-URI PNG images inside an Svg image render, with crisp pixel scaling via
  `image-rendering: pixelated` → **VERIFIED** (earlier session test, Chromium).
- A cloud session viewed in the Claude desktop app has no drawing surface for mods → **VERIFIED live**:
  `$.ui.open` answered `no-surface: no surface is attached ($.session.surfaces() is empty)`, twice.
- Text the mod returns from its own slash command (`command.run` → `{ text }`) IS shown in that cloud
  session's transcript in the desktop app → **VERIFIED** (person's screenshot shows the
  `digital-workplace: …` lines). So transcript text rows reach cloud viewers even with no surface.
- Usage data a mod can read → **VERIFIED from the API types**: `turn.complete` carries `durationMs`,
  `agentId` (absent on the main loop) and `usage` = `{ model, input_tokens, output_tokens,
  cache_read_input_tokens, cache_creation_input_tokens }`; `turn.step` input carries `model`,
  `effort` and `agentId` per model request; `$.agent.list()` lists subagents with `type`,
  `description`, `status`, `parentId`.
- Full-frame redraw cost on the current build → **VERIFIED by measurement**: 8–13 ms per frame at
  zoom 1 (render + PNG), 16–26 KB per frame as base64; ≈130–200 KB/s at 8 fps.
- A Windows Terminal pane works locally with block-character art → **VERIFIED live** (person's
  screenshot); a terminal pane docks beside the transcript.

- Any change to an Svg's markup restarts every animation in it (it is a new image), SMIL and CSS
  alike → **VERIFIED**. A 4 s slide at x=90 jumped back to x≈4 after a one-comment change. A CSS
  animation re-sent with `animation-delay: -<elapsed>s` resumes in phase (x=98, expected ≈99);
  SMIL does not (x=4). Consequence: animation that survives re-renders must be CSS with negative
  delays computed from the clock; an unchanged Svg keeps animating with zero re-sends.

- One room frame (240×176, lit, with sprites) as a truecolour PNG is **13–19.5 KB base64**, encoded in
  **4–7 ms** warm (24 ms cold) → **VERIFIED by measurement**. Seat A's "room PNG ≤5 KB" is false
  for lit rooms: night lighting dithers ≈410 distinct colours into a frame, so a palette PNG
  (≤256 colours) does not fit without dropping the lighting.
- All nine rooms as PNGs total **≈140 KB base64** → **VERIFIED**: over the 131,072-char Svg limit, so
  a single self-contained Svg cannot carry every room (Seat D's ≈70 KB room sheet is false).
- The six crew sprites (one pose each, 13×20) total **≈1.7 KB base64** → **VERIFIED**.
- Terminal `Image` takes PNG or RGBA bytes, or a file/shm name, never Svg → **VERIFIED from the API
  types** (Seat B's assumption is false).
- A mod's own slash command reply (`command.run` → `{ text }`) is a transcript row **the model also
  reads** → **VERIFIED from the API types** (Seat D's "does not enter the model's context" is
  false; a `context` field is model-only; a `$.session.append` system notice is never read by the
  model).
- `turn.step` streams tool-call chunks (name and arguments) before the tool runs → **VERIFIED from the
  API types** (Seat A's early-walk idea is possible).

- In a cloud session viewed in the desktop app, **no mod drawing of any kind is requested**: a probe
  hooked `ui.render` for `ToolUse` (tool-row chips) and `AbovePrompt` (the band) and counted
  **0 and 0** across real Bash and Read calls, with `$.session.surfaces()` = `[]` → **VERIFIED
  live**. The hooks themselves run (the crew state updated with each call). Only transcript text
  (a command's reply) reaches that viewer. Every seat's cloud plan that relied on chips or the band
  fails there.
- Classifier gap seen in the same probe: `ls …; git -C <dir> log -1` was filed as Build, because
  `git -C <dir>` hides the subcommand → **VERIFIED** (fix: skip git's `-C <dir>`/`-c k=v` options).

Still unverified:
- Whether plugin notices (`$.session.append` type system) or a `turn.complete` text show in a cloud
  session's transcript (likely, since command replies do).
- Whether the desktop app's **local** Code session places the pane (the person has not tried yet).
- The mobile app's handling of animated Svg (web view) and of tool-row cards.
