# Adversarial design panel — Digital Workplace: making Claude's live work legible

You are one of 4 seats on an adversarial design panel (Seats A, B, C, D; a moderator runs the rounds).
Design from first principles. You are NOT shown the current implementation on purpose. Do not look
for it, and do not read any repository or file on disk. Reason from the problem, the constraints and
the incident history below.

## The problem

Digital Workplace is a Claude Code "mod" (a plugin of hooks that can draw UI). It turns what Claude
is doing into a pixel-art office beside the chat: six crew members (Nova lead, Pax research, Iris
design, Kit build, Vale review, Dot QA) in nine rooms (Reception, Town hall, Lead office, Boardroom,
Studio, Open office, IT lab, Kitchen, Lounge) with dozens of NPC "cousins". A prompt starts a
boardroom briefing; each tool call sends the matching crew member to work; a failing test makes Dot
carry a bug to Kit in a "hand-off duet"; the end of a turn plays a town-hall demo and a party;
60 s without events lets the crew wander to coffee. The person wants it to be (1) a truthful,
glanceable mirror of Claude's work and (2) delightful enough to show off. It must keep the existing
characters and art. "Unchanged elsewhere" means Claude Code itself must behave exactly as without
the mod.

## The environment (treat as hard facts; verified against the mod API of Claude Code 2.1.319)

- A mod is a JS hooks module in a sandbox: no DOM, no canvas, no Node, no WebAssembly, no eval; it
  reaches the world only through an engine object. It sees events: `prompt.submit` (the typed text,
  sometimes preceded by app-injected `<system-reminder>` blocks), `tool.call` (wraps the tool:
  input before, result/isError after; subagent calls carry an agentId; several can run in
  parallel), `turn.start`, `turn.step` (the streamed model response: text, thinking, tool-call
  chunks), `turn.complete` (reason answer/aborted/error), `session.start`, timers (`$.clock`).
- A "pane" is a framed region the surface places (beside the chat on desktop; docked or inline in a
  terminal). The mod draws it by returning a tree of the surface's own elements:
  - desktop app: Box, Text, Button, Input, Select, Svg, Link, Code, Markdown, Client
  - mobile app: same minus Client; VS Code: same minus Client
  - terminal: Box, Text, Button, Input, Select, Link, Code, Markdown, Client, Raster, Image
  There is NO html/iframe/canvas/video element.
- `Svg`: markup ≤131,072 chars, drawn as an image (or, with isInteractive, in a script-less
  sandboxed frame). SMIL and CSS animations run inside it; no script ever runs. Data-URI images
  inside it work. A `prefers-reduced-motion` media query inside it follows the OS setting.
- Redraws: the mod asks for a re-render; at most 10/s on remote/app surfaces, 30/s for a terminal
  pane. Every re-render re-sends the whole tree (an Svg's whole markup).
- Terminal `Image`: real pixels only in kitty, Ghostty and iTerm2 (fullscreen layout); elsewhere
  (Windows Terminal, VS Code terminal, tmux) it shows alt text. Terminal `Raster`: a grid of cells,
  each a width-1 BMP glyph + 24-bit fg/bg, ≤512×256 cells, repaintable in place up to ~60/s
  without a re-render.
- `Client`: a small "surface module" that runs ON the drawing side (terminal and desktop only), with
  its own frame clock, local state and pointer/keys; it can draw only Box/Text/Button/Input/Select/
  Link/Code/Markdown (no Svg, Raster or Image), and talks to the hooks module by small posts.
- Other primitives: a status-line entry, toasts, a band above the prompt, decorations drawn on/under
  each tool-call row in the transcript (mobile shows them as cards), native notifications, audio
  playback (works only where the host has a player: macOS; nothing on Windows/Linux/cloud).
- A cloud session viewed in the Claude desktop app has NO drawing surface attached for mods
  (verified: the engine reports zero surfaces). Whether transcript decorations or the band render
  there is UNVERIFIED.
- Hook code must be microseconds per event; a hook may never delay or alter a tool call. CPU in the
  hooks sandbox is V8-class (≈1 ms per 500 KB of simple array work).
- Panes are narrow: about 40–90 terminal columns, or ≈360–520 CSS px on desktop. The art is
  240×176 pixels per room (9 rooms side by side), 3×5-pixel font on in-world screens.

## What "good" means

1. The person sees the office within 2 s wherever they watch the session, or gets a clear, honest
   alternative where a pane cannot exist.
2. Truth: within 1 s of any tool call the person can tell which role works on what (tool + target),
   including parallel calls, long-running calls, subagents and failures.
3. Glanceable in a narrow pane: the state of the turn is clear without reading in-world pixel text.
4. Ceremony (briefing, walks, hand-offs, town hall) never delays, hides or contradicts the truth.
5. Zero effect on Claude: < 1 ms added per tool call, no blocking, failures invisible.
6. Cheap: ≤ 5 % of one core and ≤ 30 KB/s to a remote surface in steady state.
7. Reduced motion respected; a screen reader gets a meaningful description.
8. Keeps the original characters, rooms, NPCs and town hall.
9. After the fact: a person who looked away can tell what happened in the turn.

## Incident history (observed live or in tests, 2026-11-07)

1. Cloud session in the desktop app: the pane never appears (engine: no surface attached). The
   person tried three times ("where here?") before learning it only works in local sessions.
2. Project/threads sessions: no pane; the person looked for it there.
3. Windows Terminal (no picture support): the office as character blocks in a 45-column pane was
   "ugly but worked"; the status line and crew strip were pushed below the visible rows.
4. A bare `/workplace` toggled a pane that was open but not visible, so it was hidden instead of shown.
5. The mission title showed app-injected text: the person typed "hi", the title read
   "<system-reminder> The user started this session without c...".
6. Ceremony lag: the crew reacted within 125 ms, but walking to a desk took 2.3–4.6 s; the briefing
   took 7–11 s to start presenting; the town-hall demo began 11–18 s after the turn ended. A fast
   model finished Read, Edit and two test runs in about 13 s, so most crew motion trailed reality;
   a failing-test hand-off duet completed after the turn had already ended.
7. Camera: with one room in view (the default in a narrow pane) eight of nine rooms are off-screen;
   a camera rule that followed the latest worker for 4 s flipped back mid-walk until patched.
8. Cost of full-frame video: 8–13 ms CPU per frame at 8 fps (≈10 % of a core) and 16–26 KB per
   frame, about 130–200 KB/s to a remote surface.
9. In-world screens (boardroom plan cards, kanban, "LIVE DEMO") are unreadable at pane sizes and
   illegible in terminals.
10. Plan cards are assigned to roles by keyword guessing; many land on Build by default.
11. Sound toggle does nothing on Windows, Linux and cloud.
12. Install confusion: the person typed the in-app `/plugin install` command into PowerShell; the
    claude.ai Customize page does not list plugins installed from the CLI.
13. Long thinking with no tool calls: the crew sits idle and after 60 s wanders to coffee, so the
    office looks empty while Claude is working hard.

Not observed (yet): the mobile app, VS Code, kitty/Ghostty pictures, heavy parallel tool calls,
subagent-heavy sessions.
