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

Skins:

- `SKINS = { retro, neon, pastel, pixel }` (contiguous "Skins" block in `game.js`, before `applyTheme`). Each skin is `{ label, colors: [null, ...8], boardBg, gridLine, drawBlock(context, x, y, colorIndex, size) }`. `boardBg`/`gridLine` are either a fixed string or `{ dark, light }`, resolved against `currentTheme` by `applySkin`. Neon uses a fixed `#000000` board/NEXT background even in the light theme; Retro reuses `COLORS` and `GRID_LINE_COLORS`.
- The global `drawBlock` is the **only** drawing entry point: it sets `globalAlpha`, delegates to `SKINS[currentSkinName].drawBlock` and resets alpha. Board, ghost (alpha 0.2) and NEXT preview all go through it, so a skin never needs to know about them. Index `1–8` of `colors` remains the single source of colour; `BOMB` (8) is always drawn as a circle. Skins that touch `shadowBlur`/`shadowColor` (Neon) must reset them before returning.
- `applySkin(name, redraw)` mirrors `applyTheme`: sets `canvas.style.background` and `nextCanvas.style.background`, `gridLineColor`, syncs `#skin-select`, and redraws board + NEXT when `redraw` is true. Unknown names fall back to `DEFAULT_SKIN` (`'retro'`). Persisted in `localStorage` under `SKIN_KEY = 'tetris-skin'`; `currentSkinName` is module state that is **not** reset by `init()`.
- `applyTheme` stores `currentTheme` and calls `applySkin(currentSkinName, false)` so a theme change re-resolves the skin's `dark`/`light` values. `gridLineColor` is therefore owned by the skin, not by `GRID_LINE_COLORS` directly. Load order at startup: `applySkin(saved)` → `applyTheme(saved)` → `init()`.

Canvas size is hardcoded in `index.html` (`300×600`, `120×120`). Changing `COLS`/`ROWS`/`BLOCK` in `game.js` requires updating those attributes to `COLS*BLOCK × ROWS*BLOCK`.

## Language

UI strings and the README are Spanish; code identifiers and comments are English. Match that split.
