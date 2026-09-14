# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla-JS Tetris on HTML5 Canvas. No dependencies, no `package.json`, no build step, no tests, no linter.

## Running

Open `index.html` directly, or serve statically (`python3 -m http.server 8000`, `npx serve .`). Verifying a change means loading the page in a browser — there is no test command.

## Architecture

Three files: `index.html` (DOM + two canvases), `style.css` (dark arcade theme), `game.js` (all logic, ~300 lines, IIFE-less top-level script in `'use strict'`).

`game.js` is a single module-less script with **module-level mutable state** (`board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, startLevel`) declared in one `let`. `init()` resets all of it and is also the restart handler. Every function reads/writes these globals rather than taking state as arguments — keep that style when extending.

Key invariants:

- `board` is `ROWS × COLS` of ints: `0` = empty, `1–7` = piece type, which indexes both `COLORS` and `PIECES`. Piece matrices embed their own type number as the filled value, so a merged cell keeps its color for free.
- Rotation is `rotateCW` (transpose + reverse) on a copy; `tryRotate` applies wall kicks `[0,-1,1,-2,2]` and silently no-ops if none fit. No SRS kick table, no O-piece special case.
- `collide(shape, ox, oy)` allows `ny < 0` (piece partly above the board) but rejects any `nx` out of bounds or `ny >= ROWS`.
- Game loop is `requestAnimationFrame(loop)` accumulating `dropAccum`; pause cancels the frame and `togglePause` restarts it after resetting `lastTime` (otherwise `dt` would spike). `animId` is cancelled in `init` and `endGame` to avoid duplicate loops.
- `lockPiece()` = `merge()` → `clearLines()` → `spawn()`. Game over is detected in `spawn()` when the new piece already collides.
- `clearLines` splices in place and does `r++` after a clear so the re-checked row isn't skipped.

Pause menu:

- `Escape` and `P` both call `togglePause()`. The single `#overlay` is shared: `endGame()` shows `#overlay-score` + `#restart-btn` and hides `#pause-menu`; `togglePause()` does the opposite via `showPauseMenu()` / `hidePauseMenu()`. Never show both at once. Resume keeps the existing `lastTime = performance.now(); loop(lastTime)` reset.
- `#pause-menu` holds Reanudar (`togglePause`), Reiniciar (`init`), Ver controles (toggles `#pause-controls` in place, syncing `aria-expanded`) and the `#start-level` `<select>` (1–10).
- Start level is persisted in `localStorage` under `START_LEVEL_KEY = 'tetris-start-level'` and read by `loadStartLevel()` (clamped to `MIN_START_LEVEL..MAX_START_LEVEL`). It is applied only on the **next** game: `init()` sets `startLevel = loadStartLevel(); level = startLevel; dropInterval = dropIntervalFor(level)`, and `clearLines` uses `level = Math.max(startLevel, Math.floor(lines / 10) + 1)` so the level never drops below the chosen start. Changing the select mid-game does not touch `level`.
- While `paused`, the keydown handler `preventDefault`s `MENU_BLOCKED_KEYS` (Space/arrows) and a keyup handler blocks Space, so focused buttons are not re-triggered and the page does not scroll — except when `e.target` is the `<select>`, which must stay keyboard-usable. `hidePauseMenu()` blurs any focused element inside the overlay for the same reason. `showPauseMenu()` focuses Reanudar so Enter resumes.

Canvas size is hardcoded in `index.html` (`300×600`, `120×120`). Changing `COLS`/`ROWS`/`BLOCK` in `game.js` requires updating those attributes to `COLS*BLOCK × ROWS*BLOCK`.

## Language

UI strings and the README are Spanish; code identifiers and comments are English. Match that split.
