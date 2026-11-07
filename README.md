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
- `/workplace` shows or hides the pane. `/workplace show`, `/workplace hide` and `/workplace status` also work.
- In the pane: room tabs (‹ ›), rooms in view (1, 2, 3), Auto camera, the crew strip (press a name to follow that agent) and Sound.

## What drives the crew

| Event | In the office |
| --- | --- |
| You send a prompt | Reception logs it. The crew walks to the Boardroom and Nova briefs. The mission title is the first 60 characters of the prompt. |
| TodoWrite, TaskCreate, TaskUpdate, TaskList | Each item becomes a card on the Boardroom screen and the Open office kanban. Its role comes from its text. |
| Read, Grep, Glob, WebSearch, WebFetch | Pax (Research) works in the Studio. |
| Write or Edit on .css, .html, .tsx, .jsx, .svg | Iris (Design) works in the Studio. |
| Any other Write or Edit | Kit (Build) works in the Open office. |
| Bash with git diff, git log or a review command | Vale (Review) works in the Open office. |
| Bash with tests, builds or linters | Dot (QA) works in the IT lab. A failing exit code shows a bug bubble and a Dot-to-Kit duet. |
| Other Bash | Pax for read-only commands (ls, cat, grep), else Kit. |
| Agent or Workflow launch | Nova hands off to the matching role in a duet. |
| Other tools | Nova (Lead) works in the Lead office. |
| The turn ends | The crew walks to the Town hall, Nova demos, then the pairs party. |
| 60 seconds without events | The crew goes idle: desks, coffee, lounge. |

The status line under the room view shows the role at work, the tool and the elapsed time.

In the Claude desktop app the office is full pixel art. In a terminal it is pixel art where the terminal shows pictures and coloured blocks elsewhere. A terminal cannot read the system's reduced-motion setting, so set `motion` to `reduced` there if you want it.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `openOnStart` | true | Open the pane when a session starts. |
| `motion` | auto | `auto` hides confetti and disco when the system asks for reduced motion. `reduced` always calms the office. `full` always shows everything. |
| `theme` | auto | The world outside the windows: `night`, `sunset`, `day`, or `auto` from the host clock. |
| `frameRate` | 8 | Redraws per second, 2 to 10. |
| `terminalArt` | auto | In a terminal: pictures in kitty, Ghostty and iTerm2, coloured quarter blocks elsewhere (Windows Terminal, VS Code, tmux). `blocks` or `image` forces one. |

## How it works

The hooks module has no DOM or canvas. `hooks/world.ts` is the page's own simulation and art, generated from `source/agent-boardroom.html` by `source/build_world.py`. It paints into a small software canvas (`hooks/raster.ts`) and each frame goes to the pane as a PNG inside an SVG. Confetti and disco go in a separate layer that a `prefers-reduced-motion` media query hides. Hooks only observe: they never change or delay a tool call, and a fault in the mod is caught and ignored.

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
