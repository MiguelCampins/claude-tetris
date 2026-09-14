'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#2979ff', // J - blue
  '#ffb74d', // L - orange
  '#f5f5f5', // Bomb - white
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8]],                                       // Bomb (1x1)
];

const BOMB = 8;           // piece type of the bomb
const BOMB_EVERY = 10;    // a bomb spawns every N cleared lines
const BOMB_CELL_SCORE = 10;

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');

const THEME_KEY = 'tetris-theme';
const GRID_LINE_COLORS = { dark: '#22222e', light: '#e2e4ee' };
let gridLineColor = GRID_LINE_COLORS.dark;
let currentTheme = 'dark';

// ---- Skins: state (see the "Skins" section below for SKINS / applySkin) ----
const SKIN_KEY = 'tetris-skin';
const DEFAULT_SKIN = 'retro';
const skinSelect = document.getElementById('skin-select');
let currentSkinName = DEFAULT_SKIN; // persisted, NOT reset by init()

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, bombPending, nextBombAt;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function bombPiece() {
  return { type: BOMB, shape: [[BOMB]], x: Math.floor(COLS / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    if (lines >= nextBombAt) {
      bombPending = true;
      nextBombAt += BOMB_EVERY;
    }
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

// Clears the 3x3 area centred on (cx, cy), then drops the cells above the
// area down by its height so the hole is filled. Rows below are untouched.
function explode(cx, cy) {
  const r0 = Math.max(0, cy - 1), r1 = Math.min(ROWS - 1, cy + 1);
  const c0 = Math.max(0, cx - 1), c1 = Math.min(COLS - 1, cx + 1);
  const h = r1 - r0 + 1;
  let destroyed = 0;
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      if (board[r][c]) destroyed++;
      board[r][c] = 0;
    }
  for (let c = c0; c <= c1; c++)
    for (let r = r1; r >= 0; r--)
      board[r][c] = r - h >= 0 ? board[r - h][c] : 0;
  score += destroyed * BOMB_CELL_SCORE * level;
  updateHUD();
}

function lockPiece() {
  if (current.type === BOMB) {
    explode(current.x, current.y);
  } else {
    merge();
  }
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = bombPending ? bombPiece() : randomPiece();
  bombPending = false;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

// Single drawing entry point: delegates to the active skin. Ghost (alpha 0.2)
// and the NEXT preview go through here too.
function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  context.globalAlpha = alpha ?? 1;
  SKINS[currentSkinName].drawBlock(context, x, y, colorIndex, size);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridLineColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  bombPending = false;
  nextBombAt = BOMB_EVERY;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

// =============================== Skins ======================================
// A skin owns everything drawn on the canvases: block colours, board/NEXT
// background, grid line colour and the block drawing routine. The light/dark
// theme toggle keeps controlling the rest of the page. `boardBg` and
// `gridLine` are either a fixed string or `{ dark, light }` resolved against
// `currentTheme` in applySkin(). Index 1-8 of `colors` stays the only source
// of colour; BOMB (8) is always drawn as a circle.

// Multiplies the RGB channels of a '#rrggbb' colour by `factor` (clamped).
function shadeColor(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const ch = shift => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * factor)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

// Traces a rounded rectangle path, with a fallback for browsers without roundRect.
function roundRectPath(context, x, y, w, h, r) {
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, w, h, r);
    return;
  }
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function drawBombCircle(context, x, y, size, inset) {
  context.beginPath();
  context.arc(x * size + size / 2, y * size + size / 2, size / 2 - inset, 0, Math.PI * 2);
  context.fill();
}

const NEON_COLORS = [null, '#00f5ff', '#ffee00', '#ff2bff', '#39ff14', '#ff073a', '#2b6bff', '#ff8c00', '#ffffff'];
const PASTEL_COLORS = [null, '#a5e3e8', '#fff1a8', '#d9b8e6', '#bfe6c0', '#f4b6b6', '#a9c4f5', '#fcd2a3', '#f7f7f7'];
const PIXEL_COLORS = [null, '#3fb8c9', '#e6c229', '#9c5bb0', '#5aa864', '#c94a4a', '#3557c7', '#e08a2e', '#eeeeee'];

const SKINS = {
  retro: {
    label: 'Retro',
    colors: COLORS,
    boardBg: { dark: '#1a1a25', light: '#ffffff' },
    gridLine: GRID_LINE_COLORS,
    drawBlock(context, x, y, colorIndex, size) {
      context.fillStyle = this.colors[colorIndex];
      if (colorIndex === BOMB) { drawBombCircle(context, x, y, size, 3); return; }
      context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
      // highlight
      context.fillStyle = 'rgba(255,255,255,0.12)';
      context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
    },
  },
  neon: {
    label: 'Neon',
    colors: NEON_COLORS,
    boardBg: '#000000',   // always black, even in the light theme
    gridLine: '#141414',
    drawBlock(context, x, y, colorIndex, size) {
      const color = this.colors[colorIndex];
      context.shadowBlur = 10;
      context.shadowColor = color;
      context.strokeStyle = color;
      context.lineWidth = 2;
      if (colorIndex === BOMB) {
        context.fillStyle = color;
        drawBombCircle(context, x, y, size, 4);
        context.stroke();
      } else {
        context.fillStyle = shadeColor(color, 0.25);
        context.fillRect(x * size + 2, y * size + 2, size - 4, size - 4);
        context.strokeRect(x * size + 2, y * size + 2, size - 4, size - 4);
      }
      // reset so the glow does not leak into the grid or other blocks
      context.shadowBlur = 0;
      context.shadowColor = 'transparent';
    },
  },
  pastel: {
    label: 'Pastel',
    colors: PASTEL_COLORS,
    boardBg: { dark: '#3a3546', light: '#fdf7f2' },
    gridLine: { dark: '#48425a', light: '#efe6df' },
    drawBlock(context, x, y, colorIndex, size) {
      const color = this.colors[colorIndex];
      context.fillStyle = color;
      if (colorIndex === BOMB) { drawBombCircle(context, x, y, size, 3); return; }
      roundRectPath(context, x * size + 1.5, y * size + 1.5, size - 3, size - 3, 6);
      context.fill();
      context.strokeStyle = shadeColor(color, 0.85);
      context.lineWidth = 1;
      context.stroke();
    },
  },
  pixel: {
    label: 'Pixel art',
    colors: PIXEL_COLORS,
    boardBg: { dark: '#101820', light: '#dfe6d0' },
    gridLine: { dark: '#1c2530', light: '#cbd3bd' },
    drawBlock(context, x, y, colorIndex, size) {
      const color = this.colors[colorIndex];
      const px = x * size, py = y * size;
      const light = shadeColor(color, 1.35), dark = shadeColor(color, 0.55);
      if (colorIndex === BOMB) {
        // blocky circle: a plus-shaped stack of rects
        context.fillStyle = dark;
        context.fillRect(px + 8, py + 4, size - 16, size - 8);
        context.fillRect(px + 4, py + 8, size - 8, size - 16);
        context.fillStyle = color;
        context.fillRect(px + 8, py + 6, size - 16, size - 12);
        context.fillRect(px + 6, py + 8, size - 12, size - 16);
        context.fillStyle = light;
        context.fillRect(px + 10, py + 8, 4, 4);
        return;
      }
      context.fillStyle = color;
      context.fillRect(px, py, size, size);
      // light top/left edge, dark bottom/right edge (2px)
      context.fillStyle = light;
      context.fillRect(px, py, size, 2);
      context.fillRect(px, py, 2, size);
      context.fillStyle = dark;
      context.fillRect(px, py + size - 2, size, 2);
      context.fillRect(px + size - 2, py, 2, size);
      // texture dots
      context.fillStyle = light;
      context.fillRect(px + 6, py + 6, 4, 4);
      context.fillStyle = dark;
      context.fillRect(px + size - 10, py + size - 10, 4, 4);
      context.fillRect(px + 14, py + 14, 2, 2);
    },
  },
};

function resolveSkinColor(value) {
  return typeof value === 'string' ? value : value[currentTheme];
}

// Analogous to applyTheme: sets the canvas backgrounds and grid colour from
// the skin (resolving dark/light against currentTheme), syncs the selector
// and optionally redraws board + NEXT without reloading.
function applySkin(name, redraw) {
  if (!Object.hasOwn(SKINS, name)) name = DEFAULT_SKIN;
  currentSkinName = name;
  const skin = SKINS[name];
  const bg = resolveSkinColor(skin.boardBg);
  canvas.style.background = bg;
  nextCanvas.style.background = bg;
  gridLineColor = resolveSkinColor(skin.gridLine);
  skinSelect.value = name;
  if (redraw) {
    draw();
    drawNext();
  }
}

skinSelect.addEventListener('change', () => {
  localStorage.setItem(SKIN_KEY, skinSelect.value);
  applySkin(skinSelect.value, true);
  skinSelect.blur(); // give the keyboard back to the game
});
// While the selector has focus, arrows/space belong to it, not to the game.
skinSelect.addEventListener('keydown', e => e.stopPropagation());
// ============================= end Skins ====================================

function applyTheme(theme, redraw) {
  currentTheme = theme;
  document.body.classList.toggle('light', theme === 'light');
  themeToggle.checked = theme === 'light';
  applySkin(currentSkinName, false); // skin resolves board bg / grid for the theme
  if (redraw) draw();
}

themeToggle.addEventListener('change', () => {
  const theme = themeToggle.checked ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme, true);
});

applySkin(localStorage.getItem(SKIN_KEY) || DEFAULT_SKIN, false);
applyTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark', false);

init();
