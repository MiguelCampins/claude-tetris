# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla-JS Tetris on HTML5 Canvas. No dependencies, no `package.json`, no build step, no tests, no linter.

## Running

Open `index.html` directly, or serve statically (`python3 -m http.server 8000`, `npx serve .`). Verifying a change means loading the page in a browser — there is no test command.

## Architecture

Three files: `index.html` (DOM + two canvases), `style.css` (dark arcade theme), `game.js` (all logic, ~300 lines, IIFE-less top-level script in `'use strict'`).

`game.js` is a single module-less script with **module-level mutable state** (`board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId`) declared in one `let`. `init()` resets all of it and is also the restart handler. Every function reads/writes these globals rather than taking state as arguments — keep that style when extending.

Key invariants:

- `board` is `ROWS × COLS` of ints: `0` = empty, `1–7` = piece type, which indexes both `COLORS` and `PIECES`. Piece matrices embed their own type number as the filled value, so a merged cell keeps its color for free.
- Rotation is `rotateCW` (transpose + reverse) on a copy; `tryRotate` applies wall kicks `[0,-1,1,-2,2]` and silently no-ops if none fit. No SRS kick table, no O-piece special case.
- `collide(shape, ox, oy)` allows `ny < 0` (piece partly above the board) but rejects any `nx` out of bounds or `ny >= ROWS`.
- Game loop is `requestAnimationFrame(loop)` accumulating `dropAccum`; pause cancels the frame and `togglePause` restarts it after resetting `lastTime` (otherwise `dt` would spike). `animId` is cancelled in `init` and `endGame` to avoid duplicate loops.
- `lockPiece()` = `merge()` → `clearLines()` → `spawn()`. Game over is detected in `spawn()` when the new piece already collides.
- `clearLines` splices in place and does `r++` after a clear so the re-checked row isn't skipped.

Records & start screen:

- Extra state lives in a second `let` right after the main one: `started` (false until "Jugar"; the keydown handler ignores everything while it is false, and the rAF loop is not started on page load), `combo` (consecutive `lockPiece` calls that cleared ≥1 line — `clearLines` returns the count for this), `bestCombo` (session max) and `pendingRecord` (game-over entry waiting for a name). `init()` resets them and is only called from the "Jugar"/"Reiniciar" button (`#restart-btn`), never at load; load draws the empty grid and calls `showStartScreen()`.
- `localStorage['tetris-records']` = `{ top: [{name, score, lines, level, date}], bestCombo, maxLines }`; `top` is max `MAX_RECORDS` (5), sorted desc by `score`. `loadRecords()` is tolerant (missing/corrupt JSON → `emptyRecords()`), always go through it and `saveRecords()`. Last used name is in `localStorage['tetris-player-name']`.
- `endGame()` → `showGameOverRecords()`: persists `bestCombo`/`maxLines` immediately (even when the score doesn't qualify), then shows `#name-form` only if `qualifiesForTop()`. `savePendingRecord()` (button or Enter inside the input) inserts the entry and re-renders with the row highlighted (`tr.record-current`).
- The single `#overlay` is reused: the records UI (`#records-panel`, `#reset-records-btn`) is only displayed while the overlay has the `show-records` class, which `showStartScreen`/`showGameOverRecords` add and `init` removes, so the PAUSA overlay never shows it. `togglePause` is untouched.
- The global keydown handler returns early when `e.target.tagName === 'INPUT'` so typing a name never moves pieces.

Canvas size is hardcoded in `index.html` (`300×600`, `120×120`). Changing `COLS`/`ROWS`/`BLOCK` in `game.js` requires updating those attributes to `COLS*BLOCK × ROWS*BLOCK`.

## Language

UI strings and the README are Spanish; code identifiers and comments are English. Match that split.
