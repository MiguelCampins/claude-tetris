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

Canvas size is hardcoded in `index.html` (`300×600`, `120×120`). Changing `COLS`/`ROWS`/`BLOCK` in `game.js` requires updating those attributes to `COLS*BLOCK × ROWS*BLOCK`.

## Language

UI strings and the README are Spanish; code identifiers and comments are English. Match that split.
