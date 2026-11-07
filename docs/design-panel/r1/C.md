<!-- Seat C (Sonnet; Fable hit its usage limit), Round 1, verbatim. Lens: use the substrate. -->
# Seat C, Round 1: "Ledger First, Stage Second"

## 1. Thesis
The office is a costume on a ledger. The hooks module keeps one tiny truth structure, the **Ledger**: per-lane records of role, tool, target, start time, state. Everything the person must read comes from it, through primitives that are cheap and exist on every surface: status line, band, tool-row decorations, and native Box/Text strips. The pixel office is a *garnish* drawn by an Svg whose animation runs client-side (SMIL/CSS) and is re-sent only on state change, never per frame. Where a Client or Raster exists, it animates locally from a small state snapshot. Ceremony is a *skin over already-true state*: it may only play things that have already happened, and is skipped or collapsed whenever the Ledger is ahead of it. No server video.

## 2. Primitives and where state lives
- **Hooks sandbox (state of record)**: Ledger = array of at most 8 lanes {laneId, agentId|main, role, tool, target(≤40 chars), t0, state: run|ok|fail|wait}, plus turn state {idle, briefing, working, thinking, done}, a ring of the last 30 finished calls, and counters. O(1) per event, no I/O. Role from a static tool-to-role table; target from the tool input. Deterministic, no keyword guessing.
- **Pane root = Box column**: (1) **Truth strip** (native Text/Box, always on top, never clipped): one row per active lane, max 4 then "+N more", e.g. `[Kit] Edit src/a.ts 3s`; failed rows stay red 10 s. (2) **Stage**: Svg of the current room. (3) **Receipt row**: last 3 finished calls.
- **Svg stage**: ≈240×176 room; characters as `<g>` with SMIL `animateTransform` along pre-baked walk paths plus a CSS idle bob. Re-sent only when the scene description changes; 8–20 KB with sprites as `<defs>`+`<use>` and a data-URI backdrop; capped at 2 re-renders/s (≈40 KB/s ceiling). Walks ≤600 ms; a new event mid-walk teleports. Assumption: a re-render does not restart unrelated SMIL timelines; otherwise use the Client path on desktop.
- **Client (desktop and terminal)**: holds a ≈300-byte snapshot {lanes, turn state, room}, animates locally on its frame clock, draws the truth strip and a Box-cell mini-office; posts back only a lane click.
- **Terminal Raster**: 45×20 cells, repainted locally up to 60/s from a sprite table; truth strip pinned on top.
- **Status line**: `Kit▸Edit a.ts · Dot▸test(12s) · 2 done`, ≈60 bytes per change; the floor on every local surface.
- **Band above the prompt**: exceptional states only (failure → Kit, subagent spawn, "thinking 45 s"); auto-clears.
- **Tool-row decorations**: a chip per call row, `Kit · 1.2s ✓` / `Dot · FAIL`: the after-the-fact record.
- **Notifications**: on turn.complete only if unfocused or the turn took >30 s.

## 3. Event model
States: Briefing, Thinking, Working, Waiting (>10 s), Failed, Done, Aborted/Error (no party).
- prompt.submit: strip `<system-reminder>` blocks, collapse whitespace, ≤60 chars; "(continuing)" if empty. Briefing ≤1.5 s, never blocking.
- tool.call: a lane opens in the same event; parallel calls get separate lanes; long-running elapsed ticks locally; failure → red lane, band message, hand-off queued only after the truth is shown.
- Subagents: `Nova▸agent#2 · Read x.ts`, one row per agent with latest tool and call count; no own room; cap 8 lanes with LRU.
- Plans: verbatim TodoWrite items as a native checklist; roles belong to calls, not plan items; boardroom screen shows only count and progress.
- Long thinking: Nova at the whiteboard with `Thinking… 47s`; no coffee wander while a turn is open (only turn end + 60 s).
- turn.complete: strip freezes into a receipt ("Done in 13 s: 4 reads, 2 edits, 2 tests (1 fail → fixed)"); town hall within 300 ms or not at all.

## 4. Surfaces
- Desktop local: Client + Svg stage + strip, status line, decorations.
- Cloud in app: decorations and band if they render (unverified); `/workplace` replies with a plain-text crew report from the Ledger; a one-time toast/band line when the first prompt arrives with zero surfaces.
- Windows Terminal: Raster stage below the truth strip (first 4 rows).
- kitty/Ghostty/iTerm2: optional Image ≤2/s; v1 uses Raster everywhere in terminals.
- VS Code / mobile: Svg stage with SMIL + native strip; decorations as cards on mobile; reduced-motion media query freezes SMIL and CSS.
- Screen reader: Svg `<title>/<desc>` plus native strip.

## 5. Ceremony vs truth
1. Strip, status line and decorations update before and independently of animation.
2. Walks ≤600 ms; label appears at the desk instantly; snap on new events.
3. Hand-off duet only if the turn is open and no new lane in the last 2 s; else a 400 ms bug icon; cap 2.5 s.
4. Briefing ≤1.5 s, cut by the first tool.call.
5. Town hall: a recap built from the receipt, ≤4 s, starts ≤300 ms after turn.complete, cancelled by a new prompt; queues older than 1 s are dropped.
6. Ceremony only displays ledger facts.

## 6. Incident table
1 made cheap (text report + decorations if rendered) · 2 not addressed · 3 prevented (strip on top) · 4 prevented (idempotent show) · 5 prevented · 6 prevented (≤600 ms walks, drop-stale) · 7 prevented (no camera; room of the latest running lane) · 8 prevented (local animation, ≤2 re-renders/s) · 9 prevented (native text) · 10 prevented (verbatim plans) · 11 made cheap · 12 not addressed (`/workplace help`) · 13 prevented.

## 7. Weakest points
1. Svg re-render semantics are an assumption: if a markup replacement restarts SMIL or flickers, the stage jerks on every change.
2. The cloud case is only a text fallback; and Raster-only terminals give up real pixels in kitty/Ghostty.

## 8. Build cost
≈2.5k lines (ledger 300, strip/status/band/decorations 500, Svg scene 700, Client 500, Raster 400, ceremony scheduler 200). Ship: (1) Ledger + truth strip, status line, decorations, prompt sanitiser, idempotent `/workplace`, cloud text report; (2) ceremony clamp; (3) Svg stage with change-only re-render ≤2/s.
