# Digital Workplace

A Claude Code mod that docks the pixel-art Digital Workplace office as a pane beside the chat. The crew acts out what Claude really does: prompts, plans, tool calls, failures and the end of each turn.

Created by **John Schettini** ([GitHub](https://github.com/johnschettini-ship-it)): the office art, the crew and the mod design.

![The Digital Workplace crew at work: briefing, research, build, QA, a bug hand-off, the town hall demo and the party](docs/preview.png)

## Install

At the prompt of a Claude Code terminal session (not in cmd or PowerShell):

```
/plugin install digital-workplace --marketplace johnschettini-ship-it/Board-Room
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell (cmd, PowerShell, bash) instead:

```
claude plugin install digital-workplace --marketplace johnschettini-ship-it/Board-Room
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `johnschettini-ship-it/Board-Room`, then **Add plugin**.

## Use

- The pane opens when a session starts. Turn this off with the `openOnStart` setting.
- **Standard view:** two rooms, the Boardroom pinned (◆) beside the room where the work is: the Open office while the crew works, the Town hall when work ships. Set `view` to `single` for one room with a camera that follows the work.
- **Stacked or side by side:** with 2 or 3 rooms in view, a tall pane stacks them one above another and a wide pane puts them side by side, whichever draws the rooms larger. The picture grows with the pane (wider than before in a wide pane) and stops where the text and buttons below it need room. Set `layout` to `stacked` or `side` to keep one. `/workplace status` shows the pane's size in cells, the layout and the picture's width.
- **Plan mode:** while Claude Code is in plan mode, the whole crew meets in the Boardroom and does its research at the table. When the plan is approved (or the mode changes) everyone goes to their desks.
- The split view's second slot stays on the Open office (the Town hall during a ship), even when the crew takes a break elsewhere.
- The camera shows the Boardroom for planning (briefings) only: Zorya's own tool calls and thinking stay off camera, though the strip and the pinned Boardroom still show them.
- `/workplace` shows or hides the pane. `/workplace show`, `/workplace hide` and `/workplace status` also work.
- In the pane: room tabs (‹ ›), rooms in view (1, 2, 3), Auto camera, the crew strip (press a name to follow that agent) and Sound.
- **When Claude needs you:** when a permission dialog or a question waits for you, the office plays a short chime, shows a toast, and puts `▲ Claude needs you · …` at the top of the pane and in the status line. A question's banner stays until you answer. An approval's banner leaves after a minute, because no event says when you answer one; the call's own line still says `asked for your OK`. The chime plays once per request and does not need the Sound button. Set `needsYou` to `banner` (no sound or toast), `notify` (adds a native notification) or `off`.
- **Text only:** the **Picture** button turns the office picture off. The strip, ticker, compute rows and crew stay, nothing is filmed or sent, and the pane redraws only when its text changes, so it costs almost no CPU. Set `picture` to `false` to open the pane this way.
- **Room tabs:** the tab row shows the three work rooms (Town hall, Boardroom, Open office) and any room in view. **+N rooms** shows the rest; the coloured squares on it are crew members in those rooms.
- **Details stay closed until you press them:**
  - **Crew row:** one chip per crew member: name, role and a dot (●) while they work. This leaves the office picture about 20% more height than the older cards (set `crew` to `cards` for those: portrait, status and counts under every name).
  - **Crew history:** following a crew member (press their chip) shows their status and counts, and lists their last 12 calls, newest first: tool, target, pass or fail, time, model and how long ago (`✓ Read a.ts · 0:02 · opus 5.5 · 1m ago`). The history outlives the turn.
  - **Agent detail:** press a compute row (`main` or a subagent) for its task, type, model and effort, requests, tokens and latest tool call.
  - **Plan cards:** **Cards ▸** beside the ticker lists the plan's cards; press one for its state, how long it was in progress, and which crew members had calls meanwhile (plan items name no crew member, so this is a time overlap).
  - **Screen:** flips the Boardroom screen between this turn's KPIs, the session so far (tokens, calls, requests, time open) and the plan's usage windows (or an API key's dollars).
  - **▶ Replay task:** plays the latest task again in a second office, in order, with pauses over 2 s shortened. **⏸ Pause**, **↺ Again**, and **■ Live** to go back. The live office keeps running meanwhile, and the status bar stays live.
  - **Quick actions** (off by default, see `quickActions`): Run tests, Review, Commit, Status.
- **Pinned rooms:** with 2 or 3 rooms in view, pressing a room tab pins it (◆). Pinned rooms show side by side even when they are not neighbours, for example Town hall + Boardroom + Open office for the whole plan → work → ship flow. A free slot follows the camera. Pinning a room past the view's size replaces the oldest pin; **Unpin** clears them. With 1 room in view, tabs go to the room as before.
- In a cloud session the app gives mods no drawing surface. `/workplace` then says so in one line.

## The rooms

| Room | What happens there |
| --- | --- |
| Boardroom | Orchestration. Zorya thinks over each message here; the crew gathers for a briefing only when a plan goes up. Zorya then stays at the wall screen, which shows the turn's KPIs: tokens in and out, tool calls (failed, running), plan progress, turn time and model requests. Each running subagent sits at the table as its model's alien, with a thought bubble while its request is open. **Model aliens:** every model family has its own colour, eyes and hat, the same for every run on it: Fable is pink with a purple wizard hat and three eyes; Opus is gold with a red top hat; Sonnet is blue with one eye and a quill in a headband; Haiku is green with a leaf sprout; any other model is purple with antennae. **The chair:** the main loop's model sits at the head of the table (the left end) with its name on a tag (`FABLE 5.2`): at work while Claude runs, eyes shut and the tag dim between turns. The mod reads the session's model at start, takes a switch (`/model`, the picker, a fallback) at once from the `PostModelSwitch` event, and checks again every 5 seconds; while a turn runs, each request's own model names the chair. The agent detail (press a compute row) says how to tell that run's alien apart. The tank right of the screen is the main loop's context window: the input of its last request against the window the engine reports (green, amber over 60%, red over 85%); it drains in purple while Claude compacts the conversation. |
| Open office | Execution. Qix, Brix, Vex, Lumi and Pip work side by side at the top desk and stay there through a plain chat. Each monitor shows that crew member's new tokens this turn, and a desk lamp shows the model of the run that asked for the call in progress (gold Opus, blue Sonnet, green Haiku, pink Fable). |
| Town hall | Shipping. Only a turn that ships goes here: a successful `git commit` or `git push`, a pull request created or merged, a release, a publish or a deploy. The crew demos the work and the pairs party. Any other turn ends at the desks with check marks. |
| Reception, Lead office, Studio, IT lab, Kitchen, Lounge | Supporting rooms with working cousins (NPCs). The crew takes breaks in the kitchen and lounge when idle; the IT lab racks light up with the compute. |

**More agents than places.** Overflow is counted, never dropped. The boardroom seats 7 subagents (the eighth seat is the chair's); the next 6 stand along the walls; any more are counted on a `+N` sign at the door (and in `crew_status`). A crew member with several calls at once shows the count on their monitor, and their desk lamp splits into one stripe per model. The IT lab racks light 23 runs and count the rest on the last unit. In text, the strip lists 4 running calls and the compute rows 8 runs, then `+N more`.

Tokens come from the usage Claude Code reports when each model request finishes; they are never estimated mid-stream. Per person, the office counts **new tokens**: output, uncached input and cache writes. Cache reads (the same context, re-read by every request) appear only in the Boardroom KPIs, as `412K in (96% cached)`. Each request's new tokens are split evenly across the crew whose tools it asked for (a Read and an Edit: half to Qix, half to Brix). A request that asks for no work (an answer, a plan, a hand-off) counts for Zorya. Totals are exact; the split per person is this attribution. Counts start again with each turn.

## What you see

The pane has three parts. The office is the show. The two text parts are the record.

- **Truth strip** (top of the pane): what runs now, as `● Brix (Build) · Edit · auth.ts · 0:04`. The raw tool and target stay next to the role, because a role is a guess for tools such as Bash. A call that needed your approval shows `? … · asked for your OK`. Claude Code reports when the dialog opens but not when you answer, so the mark records the ask and stays until the call ends. A failure stays as `✗ …` until the same target passes or the turn ends. More than four calls show as `+N more`. At the end of a turn the strip shows a receipt: `✓ Done in 1:12 · 4 reads, 2 edits, 1 test`.
- **Model in the strip:** a running call shows its model when a subagent on another model asked for it: `● Qix (Research) · Grep · register · haiku 5.5 · 0:03`.
- **KPI row** (under the strip's first line): `Tokens 18.5k in (92% cached) · 1.3k out · Calls 14 (1 failed) · Plan 2/5 · 9 req · 1:42`.
- **Compute rack** (under the room view): one machine per run. `main` is the main loop; each subagent gets its own row. A machine powers on at its first model request and shows model, effort, requests, tokens so far and time: `● main · opus 5.5 · high · 3 req · 52.1k in · 1.2k out · 0:41`. When the run ends it powers off and shows its tokens: `○ Explore the hooks API · sonnet 5.5 · 18.2k in (12.0k cached) · 1.1k out · 0:22`. A subagent's row is named by its task. Subagents already running when the office opens (after a restart) are listed at once, as `running, model not seen yet`, until their next request. The header adds the context window: `Compute · ⚡2 on · context 52% (104.0k of 200.0k)`. The next row is what the account spends, from Claude Code's own session figures: on a subscription, the plan windows and the session's tokens (`Plan · 5-hour 42% (resets in 1h 0m) · weekly 18% · 1.2M tokens since the office opened`), never dollars, because a plan is not billed per token; with an API key, the session's cost (`API · $1.23 this session · 1.2M tokens since the office opened`). At most 8 rows, then `+N more`. The same machines light up as server racks in the IT lab, in the model's colour.
- **Status line**: Claude Code's own status bar shows the current call or `Zorya thinking` while a turn runs.

## What drives the crew

| Event | In the office |
| --- | --- |
| You send a prompt | Reception logs it and Zorya thinks it over in the Boardroom; the crew stays at their desks. The mission title is the first 60 characters of the prompt. |
| TodoWrite, TaskCreate, TaskUpdate, TaskList | The first plan of a task gathers the crew in the Boardroom and Zorya briefs until the first tool runs. Each item becomes a card on the Boardroom screen and the Open office kanban, as written. Cards are not assigned to a role: a guess from the text was often wrong. |
| Read, Grep, Glob, WebSearch, WebFetch | Qix (Research) works in the Open office. |
| Write or Edit on .css, .html, .tsx, .jsx, .svg | Lumi (Design) works in the Open office. |
| Any other Write or Edit | Brix (Build) works in the Open office. |
| Bash with git diff, git log or a review command | Vex (Review) works in the Open office. |
| Bash with tests, builds or linters | Pip (QA) works in the Open office. A failing exit code shows a bug bubble and a Pip-to-Brix duet. |
| Other Bash | Qix for read-only commands (ls, cat, grep), else Brix. |
| Agent or Workflow launch | Zorya hands off to the matching role in a duet. |
| Other tools | Zorya (Lead) works at the boardroom screen. |
| A subagent's model request | The subagent sits at the boardroom table, thinking; its tokens join the KPIs. |
| The model thinks (no tool runs) | Zorya stands at the board with a thought bubble. Nobody wanders off while a turn is open. |
| A permission dialog shows | The crew member shows a `?` bubble, and the strip marks the call `asked for your OK`. Not when a settings hook answers the request itself. |
| The turn ends after a ship (commit, push, pull request, release, publish, deploy) | The crew goes straight to the Town hall, Zorya demos, then the pairs party. |
| The turn ends without a ship | The crew stays at the desks with check marks; the boardroom keeps the turn's KPIs. |
| Claude compacts the conversation | Zorya holds her notes and the context tank drains. |
| 60 seconds with nothing running | The crew goes idle: desks, coffee, lounge. The pane redraws at a quarter of the frame rate. |

Walks are short (the crew pops through the nearest door) so the office never lags behind the work.

In the Claude desktop app the office is full pixel art. In a terminal it is pixel art where the terminal shows pictures and coloured blocks elsewhere. A terminal cannot read the system's reduced-motion setting, so set `motion` to `reduced` there if you want it.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `openOnStart` | true | Open the pane when a session starts. |
| `picture` | true | Show the office picture. `false` opens the pane as text only; the Picture button switches at any time. |
| `needsYou` | chime | When a permission dialog or a question waits for you: `chime` (sound, toast, banner), `banner`, `notify` (chime plus a native notification) or `off`. |
| `motion` | auto | `auto` hides confetti and disco when the system asks for reduced motion. `reduced` always calms the office. `full` always shows everything. |
| `theme` | auto | The world outside the windows: `night`, `sunset`, `day`, or `auto` from the host clock. |
| `frameRate` | 8 | How often a terminal redraws the office, 2 to 10 times a second. In the app the office plays as films; their rate is `smoothness`. |
| `crew` | compact | `compact`: one chip per crew member, more room for the picture; press a chip for status, counts and recent calls. `cards`: the larger cards. |
| `smoothness` | balanced | Frames a second of the office in the app, by rooms in view (1 / 2 / 3): `balanced` 10 / 8 / 5, `smooth` 20 / 10 / 8, `light` 5 / 5 / 4. An idle office films one step lower. |
| `terminalArt` | auto | In a terminal: pictures in kitty, Ghostty and iTerm2, coloured quarter blocks elsewhere (Windows Terminal, VS Code, tmux). `blocks` or `image` forces one. |
| `walkSpeed` | normal | How fast the crew walks: `normal` is the office page's own pace, `slow` is calmer, `fast` hurries. |
| `view` | split | `split`: two rooms, the Boardroom pinned beside the work. `single`: one room; the camera follows the work and visits the Boardroom only for briefings. |
| `layout` | auto | With 2 or 3 rooms in view: `auto` stacks them in a tall pane and puts them side by side in a wide one; `stacked` or `side` always. A terminal keeps side by side unless this says `stacked`. |
| `quickActions` | off | Buttons for common requests: Run tests, Review, Commit, Status. `fill` puts the request in the prompt box after your draft (you press Enter); `send` sends it to Claude at once. |
| `toolChips` | false | Adds one line under each tool call in the transcript, such as `Brix · Edit auth.ts ✓ 0:03`. Local sessions only. Read at session start. |

## How it works

The hooks module has no DOM or canvas. `hooks/world.ts` is the page's own simulation and art, generated from `source/agent-boardroom.html` by `source/build_world.py`. It paints into a small software canvas (`hooks/raster.ts`).

- **Desktop, mobile and VS Code** get the office as a short film (`hooks/stage.ts`). The office runs ahead (up to 2 seconds, about as far as recent films were used), films each frame and rewinds. A new film is shot 0.25 s after an outside event, and as soon as a film runs out or is cut short, so the picture neither freezes nor lags. The Svg holds the first frame plus one layer per later frame with only the pixels that changed, all in one atlas PNG; CSS shows each layer at its time. The client plays it with no further messages, and the pane redraws only for a new film (at most once a second, sooner after a button press) or new text. A tape of the office's random draws makes the live office do exactly what the film showed until the next outside event. When the camera moves to a room nearby (up to two rooms away with one in view, one with two), the film covers every room it passes and CSS slides the view across them, so the camera glides at the screen's own refresh rate; longer jumps and pinned views cut. Films play at 20 frames a second with one room in view, 10 with two, 8 with three (the office steps every 25 ms, so the rate must divide 40), and drop a step in very busy scenes. Confetti and disco lights are a small CSS overlay that a `prefers-reduced-motion` media query hides; with reduced motion the film also holds still between redraws, unless `motion` is `full`.
- **Terminals** get a fresh picture or block-art frame at the frame rate, as before.

Measured on a busy, seeded minute (`tools/fluid-harness.ts` for the mod, `tools/app-bench.cjs` for the app's side in Chromium): events reach the picture in about 0.12 s (p90 0.3 s), with no stale frames and freezes under 0.1 s a minute. The frame rate is what the app pays for (each frame repaints its changes at the size drawn); how often films are shot hardly matters to it. Stacked two-room view, mod + app, in % of one CPU core: `balanced` 9 + 9, `smooth` 11 + 11, `light` 7 + 6. One room drawn 893 px wide: `balanced` 7 + 11, `smooth` 11 + 18. About 100 KB a second to the app while busy. A pane the app has not drawn for 3 seconds (a session in the background) is not filmed; the office asks for a draw every 2 seconds and films again once drawn. `/workplace status` shows the film rate and whether the pane is drawn. A hook that arrives while a film is being shot waits for it (a few tens of milliseconds). When a terminal and an app view the same session at once, the terminal's full-rate redraws also re-send the film to the app. Hooks only observe: they never change or delay a tool call or a model request, and a fault in the mod is caught and ignored.

One ledger in the hooks module is the source of truth. `tool.call` records each call; `classic.PermissionRequest` marks a call as waiting; `turn.step` powers a machine on for each model request (the stream passes through untouched); `turn.complete` powers it off with the usage the engine reports. Subagent names come from one `$.agent.list()` per new agent, never polled. The design record is in [docs/design-panel](docs/design-panel/verdict.md).

To rebuild from a changed page:

```bash
python3 source/build_world.py source/agent-boardroom.html hooks/world.ts source/parts
```

Sound files come from `source/make_sounds.py` (the page's own chiptune). Sound plays only where Claude Code has an audio player (macOS).

## Tests

```bash
claude plugin test .
```

## License

MIT © 2026 John Schettini. See [LICENSE](LICENSE).
