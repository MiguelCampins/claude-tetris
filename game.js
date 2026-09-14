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

// ---- Records: DOM refs & constants ----
const recordsTable = document.getElementById('records-table');
const recordsStats = document.getElementById('records-stats');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');
const saveNameBtn = document.getElementById('save-name-btn');
const resetRecordsBtn = document.getElementById('reset-records-btn');

const RECORDS_KEY = 'tetris-records';
const PLAYER_NAME_KEY = 'tetris-player-name';
const MAX_RECORDS = 5;
const MAX_NAME_LENGTH = 12;

const THEME_KEY = 'tetris-theme';
const GRID_LINE_COLORS = { dark: '#22222e', light: '#e2e4ee' };
let gridLineColor = GRID_LINE_COLORS.dark;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, bombPending, nextBombAt;

// ---- Records: state ----
// started: false until the player presses "Jugar" (start screen). combo: consecutive
// locks that cleared >= 1 line; bestCombo: session max. pendingRecord: the game-over
// entry waiting for a name, null once saved or if it didn't qualify.
let started = false, combo, bestCombo, pendingRecord = null;

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
  return cleared;
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
  const cleared = clearLines();
  combo = cleared ? combo + 1 : 0;
  if (combo > bestCombo) bestCombo = combo;
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

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  if (colorIndex === BOMB) {
    context.beginPath();
    context.arc(x * size + size / 2, y * size + size / 2, size / 2 - 3, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    return;
  }
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
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
  restartBtn.textContent = 'Reiniciar';
  showGameOverRecords();
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
      if (gameOver) { draw(); return; } // endGame already cancelled the frame
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
  combo = 0;
  bestCombo = 0;
  pendingRecord = null;
  started = true;
  overlay.classList.remove('show-records');
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.target === nameInput) return; // typing a record name
  if (!started) return;
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

function applyTheme(theme, redraw) {
  document.body.classList.toggle('light', theme === 'light');
  themeToggle.checked = theme === 'light';
  gridLineColor = GRID_LINE_COLORS[theme];
  if (redraw) drawScene();
}

themeToggle.addEventListener('change', () => {
  const theme = themeToggle.checked ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme, true);
});

applyTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark', false);

// ---- Records: persistence ----
function emptyRecords() {
  return { top: [], bestCombo: 0, maxLines: 0 };
}

// Tolerant read: missing or corrupt JSON yields empty records.
function loadRecords() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECORDS_KEY));
    if (!raw || typeof raw !== 'object') return emptyRecords();
    const top = Array.isArray(raw.top)
      ? raw.top
          .filter(e => e && typeof e === 'object' && Number.isFinite(e.score))
          .map(e => ({
            name: String(e.name ?? '').slice(0, MAX_NAME_LENGTH),
            score: e.score,
            lines: Number.isFinite(e.lines) ? e.lines : 0,
            level: Number.isFinite(e.level) ? e.level : 1,
            date: typeof e.date === 'string' ? e.date : '',
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_RECORDS)
      : [];
    return {
      top,
      bestCombo: Number.isFinite(raw.bestCombo) ? raw.bestCombo : 0,
      maxLines: Number.isFinite(raw.maxLines) ? raw.maxLines : 0,
    };
  } catch {
    return emptyRecords();
  }
}

function saveRecords(records) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // storage unavailable (private mode / quota): records simply don't persist
  }
}

function qualifiesForTop(records, value) {
  return records.top.length < MAX_RECORDS || value > records.top[records.top.length - 1].score;
}

function getSavedName() {
  try {
    return (localStorage.getItem(PLAYER_NAME_KEY) || '').slice(0, MAX_NAME_LENGTH);
  } catch {
    return '';
  }
}

// ---- Records: rendering ----
function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-ES');
}

function renderRecords(records, highlightIndex) {
  recordsTable.innerHTML = '';
  if (records.top.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'records-empty';
    empty.textContent = 'Sin records todavía';
    recordsTable.appendChild(empty);
  } else {
    const table = document.createElement('table');
    const headRow = table.createTHead().insertRow();
    for (const h of ['#', 'Nombre', 'Puntos', 'Líneas', 'Nivel', 'Fecha']) {
      const th = document.createElement('th');
      th.textContent = h;
      headRow.appendChild(th);
    }
    const tbody = table.createTBody();
    records.top.forEach((entry, i) => {
      const row = tbody.insertRow();
      if (i === highlightIndex) row.className = 'record-current';
      const cells = [i + 1, entry.name || '—', entry.score.toLocaleString(), entry.lines, entry.level, formatDate(entry.date)];
      for (const value of cells) row.insertCell().textContent = value;
    });
    recordsTable.appendChild(table);
  }
  recordsStats.textContent = `Mejor combo: ${records.bestCombo} · Líneas máx: ${records.maxLines}`;
}

function showStartScreen() {
  overlayTitle.textContent = 'TETRIS';
  overlayScore.textContent = '';
  restartBtn.textContent = 'Jugar';
  nameForm.classList.add('hidden');
  renderRecords(loadRecords(), -1);
  overlay.classList.add('show-records');
  overlay.classList.remove('hidden');
}

// Called from endGame: persists bestCombo / maxLines right away and, if the
// score qualifies, asks for a name before inserting the entry into the top.
function showGameOverRecords() {
  const records = loadRecords();
  records.bestCombo = Math.max(records.bestCombo, bestCombo);
  records.maxLines = Math.max(records.maxLines, lines);
  saveRecords(records);
  if (qualifiesForTop(records, score)) {
    pendingRecord = { name: '', score, lines, level, date: new Date().toISOString() };
    nameInput.value = getSavedName();
    nameForm.classList.remove('hidden');
    setTimeout(() => nameInput.focus(), 0);
  } else {
    pendingRecord = null;
    nameForm.classList.add('hidden');
  }
  renderRecords(records, -1);
  overlay.classList.add('show-records');
}

function savePendingRecord() {
  if (!pendingRecord) return;
  const name = nameInput.value.trim().slice(0, MAX_NAME_LENGTH) || 'Anónimo';
  try { localStorage.setItem(PLAYER_NAME_KEY, name); } catch { /* ignore */ }
  const records = loadRecords();
  const entry = { ...pendingRecord, name };
  pendingRecord = null;
  records.top.push(entry);
  records.top.sort((a, b) => b.score - a.score);
  records.top = records.top.slice(0, MAX_RECORDS);
  saveRecords(records);
  nameForm.classList.add('hidden');
  renderRecords(records, records.top.indexOf(entry));
  nameInput.blur();
}

function resetRecords() {
  if (!confirm('¿Borrar todos los records?')) return;
  try { localStorage.removeItem(RECORDS_KEY); } catch { /* ignore */ }
  pendingRecord = null;
  nameForm.classList.add('hidden');
  renderRecords(emptyRecords(), -1);
}

saveNameBtn.addEventListener('click', savePendingRecord);
nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); savePendingRecord(); }
});
resetRecordsBtn.addEventListener('click', resetRecords);

// draw() needs `current`, which doesn't exist until the first "Jugar"; before
// that (start screen) only the empty grid is drawn. Used by applyTheme too.
function drawScene() {
  if (current) {
    draw();
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
  }
}

// Start screen: draw the empty grid and wait for "Jugar" (init runs on click).
board = createBoard();
drawScene();
showStartScreen();
