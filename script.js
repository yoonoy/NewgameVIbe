"use strict";

/* ---------- Настройки ---------- */
const CONFIG = {
  goal: 10,           // фруктов для победы
  time: 40,           // секунд на игру
  lives: 3,           // жизней
  switchEvery: 7,     // как часто меняется нужный фрукт (сек)
  targetChance: 0.45  // шанс, что упадёт нужный фрукт
};

const FRUITS = [
  { emoji: "🍎", name: "яблоки" },
  { emoji: "🍊", name: "апельсины" },
  { emoji: "🍇", name: "виноград" }
];

/* ---------- Элементы ---------- */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id);
const el = {
  time: $("time"), score: $("score"), goal: $("goal"), lives: $("lives"),
  overlay: $("overlay"), title: $("overlay-title"), text: $("overlay-text"),
  start: $("start"), mute: $("mute"), targetBox: $("target-box"),
  targetEmoji: $("target-emoji"), targetName: $("target-name")
};

const W = canvas.width, H = canvas.height;
const BASKET = { w: 96, h: 38, y: H - 62, speed: 430 };
const CATCH_LINE = BASKET.y + 6; // фрукт «в корзине», когда пересёк эту линию
const EMOJI_FONT = '30px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';

/* ---------- Состояние ---------- */
let state = "idle";           // idle | playing | won | lost
let score, lives, timeLeft, targetIdx, switchTimer, spawnTimer, fruits, basketX;
let rafId = null, lastTs = null, best = 0;
const keys = { left: false, right: false };

try { best = Number(localStorage.getItem("basket-best")) || 0; } catch (e) { /* ignore */ }

/* ---------- Интерфейс ---------- */
function updateHud() {
  const secs = Math.max(0, Math.ceil(timeLeft));
  el.time.textContent = secs;
  el.time.classList.toggle("low", secs <= 10);
  el.score.textContent = score;
  el.goal.textContent = CONFIG.goal;
  const l = Math.max(0, lives);
  el.lives.textContent = "♥".repeat(l) + "♡".repeat(CONFIG.lives - l);
}

function showTarget(flash) {
  const f = FRUITS[targetIdx];
  el.targetEmoji.textContent = f.emoji;
  el.targetName.textContent = f.name;
  if (flash) {
    el.targetBox.classList.remove("flash");
    void el.targetBox.offsetWidth; // перезапуск анимации
    el.targetBox.classList.add("flash");
  }
}

function showOverlay(kind, title, text, buttonLabel) {
  el.overlay.className = "overlay " + kind;
  el.title.textContent = title;
  el.text.innerHTML = text;
  el.start.textContent = buttonLabel;
  el.overlay.classList.remove("hidden");
  el.start.focus();
}

/* ---------- Музыка и звуки (Web Audio, без файлов) ---------- */
const music = (() => {
  const STEP = 0.25; // длина шага, сек (≈120 уд/мин, восьмые)
  const MELODY = [
    659.25, 0, 783.99, 659.25, 523.25, 659.25, 783.99, 0,   // C
    659.25, 0, 880.00, 659.25, 523.25, 659.25, 880.00, 0,   // Am
    698.46, 0, 880.00, 698.46, 523.25, 698.46, 880.00, 0,   // F
    587.33, 0, 783.99, 587.33, 493.88, 587.33, 783.99, 0    // G
  ];
  const BASS = [130.81, 110.00, 87.31, 98.00]; // C, A, F, G — по одной ноте на такт
  let ac = null, master = null, timer = null, nextTime = 0, step = 0;
  let muted = false, playing = false;

  function tone(freq, when, dur, type, vol) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(master);
    o.start(when); o.stop(when + dur + 0.05);
  }

  function schedule() {
    while (nextTime < ac.currentTime + 0.3) {
      const n = MELODY[step % MELODY.length];
      if (n) tone(n, nextTime, STEP * 0.9, "triangle", 0.5);
      const inBar = step % 8;
      if (inBar === 0 || inBar === 4) {
        tone(BASS[Math.floor(step / 8) % BASS.length], nextTime, STEP * 3.5, "sine", 0.7);
      }
      step++;
      nextTime += STEP;
    }
  }

  function ensure() {
    if (ac) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ac = new Ctx();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.12;
    master.connect(ac.destination);
  }

  return {
    start() {
      ensure();
      if (!ac || playing) return;
      if (ac.state === "suspended") ac.resume();
      playing = true;
      step = 0;
      nextTime = ac.currentTime + 0.1;
      schedule();
      timer = setInterval(schedule, 100);
    },
    stop() {
      if (!playing) return;
      playing = false;
      clearInterval(timer);
      timer = null;
    },
    toggle() {
      muted = !muted;
      ensure();
      if (master) master.gain.value = muted ? 0 : 0.12;
      return muted;
    },
    blip(good) { // короткий звук: поймал нужный / не тот фрукт
      ensure();
      if (!ac || muted) return;
      const t = ac.currentTime;
      if (good) { tone(880, t, 0.09, "square", 0.25); tone(1318.5, t + 0.07, 0.12, "square", 0.25); }
      else      { tone(200, t, 0.22, "sawtooth", 0.3); }
    },
    pause(p) { if (!ac) return; if (p) ac.suspend(); else if (playing) ac.resume(); }
  };
})();

el.mute.addEventListener("click", () => {
  const off = music.toggle();
  el.mute.textContent = off ? "🔇" : "🔊";
  el.mute.setAttribute("aria-label", off ? "Включить музыку" : "Выключить музыку");
});
document.addEventListener("visibilitychange", () => music.pause(document.hidden));

/* ---------- Управление игрой ---------- */
function startGame() {
  if (rafId !== null) cancelAnimationFrame(rafId); // защита от двойного цикла
  score = 0;
  lives = CONFIG.lives;
  timeLeft = CONFIG.time;
  switchTimer = CONFIG.switchEvery;
  spawnTimer = 0.4;
  fruits = [];
  basketX = W / 2;
  targetIdx = Math.floor(Math.random() * FRUITS.length);
  state = "playing";
  lastTs = null;
  el.overlay.classList.add("hidden");
  music.start();
  showTarget(true);
  updateHud();
  rafId = requestAnimationFrame(loop);
}

function endGame(won, reason) {
  if (state !== "playing") return; // конец наступает только один раз
  state = won ? "won" : "lost";
  cancelAnimationFrame(rafId);
  rafId = null;
  music.stop();
  updateHud();
  render();

  if (won && score > best) {
    best = score;
    try { localStorage.setItem("basket-best", String(best)); } catch (e) { /* ignore */ }
  }
  const bestNote = best > 0 ? `<br>Рекорд: ${best}` : "";
  const summary = score === 0
    ? "В корзине пусто — ни одного нужного фрукта."
    : `В корзине: <b>${score}</b> из ${CONFIG.goal}.`;
  showOverlay(
    won ? "win" : "lose",
    won ? "Корзина полна! 🧺" : "Не вышло",
    `${reason}<br>${summary}${bestNote}`,
    "Сыграть ещё"
  );
}

/* ---------- Логика кадра ---------- */
function spawnFruit() {
  const idx = Math.random() < CONFIG.targetChance
    ? targetIdx
    : Math.floor(Math.random() * FRUITS.length);
  const progress = 1 - timeLeft / CONFIG.time; // 0 → 1
  fruits.push({
    x: 22 + Math.random() * (W - 44),
    y: -20,
    idx,
    vy: 120 + progress * 110 + Math.random() * 40
  });
}

function update(dt) {
  // корзина
  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  basketX += dir * BASKET.speed * dt;
  basketX = Math.min(W - BASKET.w / 2, Math.max(BASKET.w / 2, basketX));

  // смена нужного фрукта
  switchTimer -= dt;
  if (switchTimer <= 0) {
    let next;
    do { next = Math.floor(Math.random() * FRUITS.length); } while (next === targetIdx);
    targetIdx = next;
    switchTimer += CONFIG.switchEvery;
    showTarget(true);
  }

  // появление фруктов
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnFruit();
    spawnTimer += 0.85 - (1 - timeLeft / CONFIG.time) * 0.3;
  }

  // движение и ловля
  for (let i = fruits.length - 1; i >= 0; i--) {
    const f = fruits[i];
    const prevY = f.y;
    f.y += f.vy * dt;
    const crossed = prevY < CATCH_LINE && f.y >= CATCH_LINE; // не «пролетит» сквозь корзину
    const inX = Math.abs(f.x - basketX) <= BASKET.w / 2 - 2;
    if (crossed && inX) {
      fruits.splice(i, 1);
      if (f.idx === targetIdx) score++; else lives--;
      music.blip(f.idx === targetIdx);
      updateHud();
      // победа проверяется раньше поражения
      if (score >= CONFIG.goal) { endGame(true, "Вы собрали всё, что нужно."); return; }
      if (lives <= 0) { endGame(false, "Жизни закончились."); return; }
    } else if (f.y > H + 20) {
      fruits.splice(i, 1); // упал мимо — без штрафа
    }
  }

  // таймер: все ловли этого кадра уже учтены выше
  timeLeft -= dt;
  if (timeLeft <= 0) {
    timeLeft = 0;
    endGame(score >= CONFIG.goal, "Время вышло.");
    return;
  }
  updateHud();
}

/* ---------- Рисование ---------- */
function drawBasketBack() {
  ctx.strokeStyle = "#a86a2f";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(basketX - BASKET.w / 2 + 10, BASKET.y + 4);
  ctx.bezierCurveTo(basketX - 40, BASKET.y - 38, basketX + 40, BASKET.y - 38, basketX + BASKET.w / 2 - 10, BASKET.y + 4);
  ctx.stroke();
}

function drawBasketFront() {
  const x0 = basketX - BASKET.w / 2, x1 = basketX + BASKET.w / 2, y = BASKET.y, h = BASKET.h;
  ctx.fillStyle = "#d9a15c";
  ctx.beginPath();
  ctx.moveTo(x0 + 2, y + 6); ctx.lineTo(x1 - 2, y + 6);
  ctx.lineTo(x1 - 12, y + h); ctx.lineTo(x0 + 12, y + h);
  ctx.closePath();
  ctx.fill();
  // плетение
  ctx.strokeStyle = "#a86a2f";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let k = 1; k <= 2; k++) {
    const yy = y + 6 + k * ((h - 6) / 3);
    ctx.moveTo(x0 + 4 + k * 3, yy); ctx.lineTo(x1 - 4 - k * 3, yy);
  }
  for (let k = 1; k < 6; k++) {
    const xx = x0 + (BASKET.w * k) / 6;
    ctx.moveTo(xx, y + 6); ctx.lineTo(x0 + 12 + ((BASKET.w - 24) * k) / 6, y + h);
  }
  ctx.stroke();
  // ободок
  ctx.fillStyle = "#b8742f";
  ctx.beginPath();
  ctx.roundRect(x0 - 3, y, BASKET.w + 6, 9, 4);
  ctx.fill();
}

function render() {
  ctx.clearRect(0, 0, W, H);
  drawBasketBack();
  ctx.font = EMOJI_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const f of fruits) ctx.fillText(FRUITS[f.idx].emoji, f.x, f.y);
  drawBasketFront();
}

function loop(ts) {
  if (state !== "playing") return;
  if (lastTs === null) lastTs = ts;
  const dt = Math.min(0.05, (ts - lastTs) / 1000); // защита от «прыжка» после сворачивания вкладки
  lastTs = ts;
  update(dt);
  if (state === "playing") {
    render();
    rafId = requestAnimationFrame(loop);
  }
}

/* ---------- Ввод ---------- */
function setKey(e, down) {
  const k = e.key.toLowerCase();
  if (k === "arrowleft" || k === "a" || k === "ф") keys.left = down;
  if (k === "arrowright" || k === "d" || k === "в") keys.right = down;
}
window.addEventListener("keydown", (e) => {
  setKey(e, true);
  if (e.key.startsWith("Arrow")) e.preventDefault();
});
window.addEventListener("keyup", (e) => setKey(e, false));
window.addEventListener("blur", () => { keys.left = keys.right = false; });

function pointerMove(e) {
  if (state !== "playing") return;
  const rect = canvas.getBoundingClientRect();
  basketX = ((e.clientX - rect.left) / rect.width) * W;
  basketX = Math.min(W - BASKET.w / 2, Math.max(BASKET.w / 2, basketX));
}
canvas.addEventListener("pointermove", pointerMove);
canvas.addEventListener("pointerdown", pointerMove);

el.start.addEventListener("click", startGame);

/* ---------- Первый экран ---------- */
score = 0; lives = CONFIG.lives; timeLeft = CONFIG.time; targetIdx = 0; fruits = []; basketX = W / 2;
updateHud();
showTarget(false);
render();


