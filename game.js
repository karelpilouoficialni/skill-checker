// =============================================
//   SKILL CHECK — Game Logic
//   DBD-Style Skill Check Web Game
// =============================================

'use strict';

// ── CONFIG ──────────────────────────────────
const DIFFICULTY = {
  easy:   { speed: 0.8, interval: 5000, rounds: 5, zoneSize: 28, label: 'Easy' },
  medium: { speed: 1.4, interval: 3500, rounds: 7, zoneSize: 22, label: 'Medium' },
  hard:   { speed: 2.2, interval: 2200, rounds: 10, zoneSize: 16, label: 'Hard' },
  custom: null, // filled at runtime
};

const SCORE = {
  good:    100,
  great:   200,
  perfect: 400,
  miss:    0,
  streakBonus: 50,
};

// ── STATE ────────────────────────────────────
let state = {
  screen: 'menu',       // 'menu' | 'game' | 'result'
  difficulty: 'hard',
  config: null,
  angle: 0,             // degrees, needle angle (0 = top)
  animId: null,
  lastTime: null,
  active: false,        // is the needle spinning?
  waiting: false,       // waiting between checks
  countdownTimer: null,
  waitTimeout: null,
  round: 0,
  totalRounds: 5,
  score: 0,
  streak: 0,
  bestStreak: 0,
  roundData: [],        // [{result, scoreGained, precision}]
  zoneStart: 0,         // degrees
  zoneSize: 22,         // degrees (arc)
  perfectOffset: 0,     // center of perfect zone relative to zoneStart
};

// ── ELEMENTS ─────────────────────────────────
const screens = {
  menu:   document.getElementById('screen-menu'),
  game:   document.getElementById('screen-game'),
  result: document.getElementById('screen-result'),
};

const diffCards    = document.querySelectorAll('.diff-card');
const customPanel  = document.getElementById('custom-panel');
const btnStart     = document.getElementById('btn-start');
const btnRetry     = document.getElementById('btn-retry');
const btnMenu      = document.getElementById('btn-menu');

const svgEl        = document.getElementById('circle-svg');
const needleLine   = document.getElementById('needle');
const needleTip    = document.getElementById('needle-tip');
const successZone  = document.getElementById('success-zone');
const skillCircle  = document.getElementById('skill-circle');
const centerIcon   = document.getElementById('center-icon');
const centerStatus = document.getElementById('center-status');

const hudRound     = document.getElementById('hud-round');
const hudScore     = document.getElementById('hud-score');
const hudStreak    = document.getElementById('hud-streak');

const countdownWrap= document.getElementById('countdown-bar-wrap');
const countdownBar = document.getElementById('countdown-bar');
const countdownTime = document.getElementById('countdown-time');

// Result
const resultHeader   = document.getElementById('result-header');
const statScore      = document.getElementById('stat-score');
const statAccuracy   = document.getElementById('stat-accuracy');
const statBestStreak = document.getElementById('stat-best-streak');
const statAvgPrecision= document.getElementById('stat-avg-precision');
const statPerfect    = document.getElementById('stat-perfect');
const statDifficulty = document.getElementById('stat-difficulty');
const rankDisplay    = document.getElementById('rank-display');
const roundsList     = document.getElementById('rounds-list');

// Custom sliders
const sliderSpeed    = document.getElementById('custom-speed');
const sliderInterval = document.getElementById('custom-interval');
const sliderRounds   = document.getElementById('custom-rounds');
const valSpeed       = document.getElementById('speed-val');
const valInterval    = document.getElementById('interval-val');
const valRounds      = document.getElementById('rounds-val');

// ── PARTICLES ────────────────────────────────
function spawnParticles() {
  const container = document.getElementById('particles');
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + 'vw';
    p.style.bottom = '-4px';
    p.style.animationDuration = (6 + Math.random() * 12) + 's';
    p.style.animationDelay = (Math.random() * 12) + 's';
    p.style.setProperty('--drift', (Math.random() * 60 - 30) + 'px');
    p.style.opacity = '0';
    const size = 1 + Math.random() * 2;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    container.appendChild(p);
  }
}

// ── SCREEN MANAGEMENT ────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.remove('active', 'screen-slide-in');
    if (k === name) {
      el.classList.add('active');
      requestAnimationFrame(() => el.classList.add('screen-slide-in'));
    }
  });
  state.screen = name;
}

// ── MENU LOGIC ───────────────────────────────
diffCards.forEach(card => {
  card.addEventListener('click', () => {
    diffCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    state.difficulty = card.dataset.diff;
    customPanel.classList.toggle('hidden', state.difficulty !== 'custom');
  });
});

// Custom sliders
sliderSpeed.addEventListener('input', () => { valSpeed.textContent = sliderSpeed.value; });
sliderInterval.addEventListener('input', () => { valInterval.textContent = parseFloat(sliderInterval.value).toFixed(1); });
sliderRounds.addEventListener('input', () => { valRounds.textContent = sliderRounds.value; });

btnStart.addEventListener('click', startGame);
btnRetry.addEventListener('click', () => {
  showScreen('menu');
  setTimeout(startGame, 100);
});
btnMenu.addEventListener('click', () => showScreen('menu'));

// ── GAME START ───────────────────────────────
function startGame() {
  // Build config
  if (state.difficulty === 'custom') {
    DIFFICULTY.custom = {
      speed:    parseFloat(sliderSpeed.value) * 0.4,
      interval: parseFloat(sliderInterval.value) * 1000,
      rounds:   parseInt(sliderRounds.value),
      zoneSize: 22,
      label:    'Custom',
    };
  }
  state.config = DIFFICULTY[state.difficulty];

  // Reset state
  state.angle       = 0;
  state.round       = 0;
  state.totalRounds = state.config.rounds;
  state.score       = 0;
  state.streak      = 0;
  state.bestStreak  = 0;
  state.roundData   = [];
  state.active      = false;
  state.waiting     = false;

  showScreen('game');
  updateHUD();
  scheduleNextCheck(600);
}

// ── COUNTDOWN TIME DISPLAY ────────────────────
function updateCountdownTime(total, start) {
  const elapsed = Date.now() - start;
  const remaining = Math.max(0, total - elapsed);
  countdownTime.textContent = (remaining / 1000).toFixed(1) + 's';
  if (remaining <= 0 && state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
}

// ── SCHEDULE NEXT CHECK ──────────────────────
function scheduleNextCheck(delay = null) {
  const interval = delay !== null ? delay : state.config.interval;
  state.waiting = true;
  state.active  = false;
  stopNeedle();

  if (state.round >= state.totalRounds) {
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    state.countdownTimer = null;
    setTimeout(showResult, 600);
    return;
  }

  // Show countdown bar
  countdownWrap.classList.remove('hidden');
  countdownBar.style.transition = 'none';
  countdownBar.style.width = '100%';

  // Force reflow so the browser registers the 100% state before we animate
  void countdownBar.offsetWidth;
  countdownBar.style.transition = `width ${interval}ms linear`;
  countdownBar.style.width = '0%';

  // Numeric countdown
  const countdownStart = Date.now();
  updateCountdownTime(interval, countdownStart);
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.countdownTimer = setInterval(() => updateCountdownTime(interval, countdownStart), 100);

  state.waitTimeout = setTimeout(() => {
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    state.countdownTimer = null;
    countdownWrap.classList.add('hidden');
    beginCheck();
  }, interval);
}

// ── BEGIN CHECK ──────────────────────────────
function beginCheck() {
  state.round++;
  state.active  = true;
  state.waiting = false;
  updateHUD();

  // Randomize zone placement (angle in degrees, 0 = top, clockwise)
  state.zoneSize     = state.config.zoneSize;
  state.zoneStart    = Math.random() * 360;
  state.perfectOffset= state.zoneSize / 2; // center of zone

  drawSuccessZone();
  centerIcon.textContent = '⚙️';
  centerStatus.textContent = '';

  // Start needle spin
  state.angle   = 0;
  state.lastTime = null;
  state.animId  = requestAnimationFrame(spinNeedle);

  // Auto-fail if no input in time (2x the zone pass time)
  const zoneDuration = (state.zoneSize / 360) / state.config.speed * 1000;
  const autoFailTime = 360 / state.config.speed * 1000; // full rotation
  state.autoFailTimer = setTimeout(() => {
    if (state.active) handleInput(true); // force miss after one rotation
  }, autoFailTime + zoneDuration);
}

// ── NEEDLE ANIMATION ─────────────────────────
function spinNeedle(ts) {
  if (!state.active) return;
  if (!state.lastTime) state.lastTime = ts;
  const dt = (ts - state.lastTime) / 1000;
  state.lastTime = ts;

  state.angle = (state.angle + state.config.speed * 360 * dt) % 360;
  rotateNeedle(state.angle);
  state.animId = requestAnimationFrame(spinNeedle);
}

function stopNeedle() {
  if (state.animId) cancelAnimationFrame(state.animId);
  state.animId = null;
}

function rotateNeedle(deg) {
  const rad = (deg - 90) * Math.PI / 180; // 0deg = top
  const cx = 150, cy = 150, r = 120;
  const x2 = cx + r * Math.cos(rad);
  const y2 = cy + r * Math.sin(rad);
  needleLine.setAttribute('x2', x2.toFixed(2));
  needleLine.setAttribute('y2', y2.toFixed(2));
  needleTip.setAttribute('cx', x2.toFixed(2));
  needleTip.setAttribute('cy', y2.toFixed(2));
}

// ── SVG ARC ──────────────────────────────────
function describeArc(cx, cy, r, startDeg, endDeg) {
  const toRad = d => (d - 90) * Math.PI / 180;
  const s = toRad(startDeg);
  const e = toRad(endDeg);
  const x1 = cx + r * Math.cos(s);
  const y1 = cy + r * Math.sin(s);
  const x2 = cx + r * Math.cos(e);
  const y2 = cy + r * Math.sin(e);
  const large = (endDeg - startDeg) % 360 > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function drawSuccessZone() {
  const start = state.zoneStart;
  const end   = (start + state.zoneSize) % 360;
  successZone.setAttribute('d', describeArc(150, 150, 120, start, start + state.zoneSize));
  successZone.classList.remove('perfect-zone');
}

// ── INPUT HANDLING ───────────────────────────
function handleInput(autoFail = false) {
  if (!state.active) return;
  state.active = false;
  stopNeedle();
  clearTimeout(state.autoFailTimer);

  const angle     = state.angle;
  const zStart    = state.zoneStart;
  const zEnd      = (zStart + state.zoneSize) % 360;
  const zCenter   = (zStart + state.zoneSize / 2) % 360;

  // Check if angle is in zone
  let inZone = false;
  if (zStart < zEnd) {
    inZone = angle >= zStart && angle <= zEnd;
  } else {
    // wraps around 360
    inZone = angle >= zStart || angle <= zEnd;
  }

  // Distance from center of zone (for precision)
  let distFromCenter = Math.abs(angle - zCenter);
  if (distFromCenter > 180) distFromCenter = 360 - distFromCenter;

  let resultType, scoreGained, precision;

  if (autoFail || !inZone) {
    resultType  = 'miss';
    scoreGained = 0;
    precision   = null;
    state.streak = 0;
    onMiss();
  } else {
    const halfZone   = state.zoneSize / 2;
    const perfectThr = halfZone * 0.25; // inner 25% = perfect

    precision = 1 - distFromCenter / halfZone;

    if (distFromCenter <= perfectThr) {
      resultType  = 'perfect';
      scoreGained = SCORE.perfect;
      onPerfect();
    } else if (distFromCenter <= halfZone * 0.6) {
      resultType  = 'great';
      scoreGained = SCORE.great;
      onGreat();
    } else {
      resultType  = 'good';
      scoreGained = SCORE.good;
      onGood();
    }

    state.streak++;
    if (state.streak > state.bestStreak) state.bestStreak = state.streak;

    // Streak bonus
    if (state.streak > 1) {
      const bonus = (state.streak - 1) * SCORE.streakBonus;
      scoreGained += bonus;
      if (state.streak >= 3) {
        setTimeout(() => spawnFloatText(`🔥 ×${state.streak} STREAK!`, 'streak', skillCircle), 200);
      }
    }
  }

  state.score += scoreGained;
  state.roundData.push({ result: resultType, scoreGained, precision });
  updateHUD();

  setTimeout(() => {
    centerStatus.textContent = '';
    scheduleNextCheck();
  }, 900);
}

// ── FEEDBACK ─────────────────────────────────
function onMiss() {
  flashScreen('rgba(139,26,26,0.3)');
  addCssHit('hit-miss');
  centerIcon.textContent    = '💀';
  centerStatus.style.color  = 'var(--blood-bright)';
  centerStatus.textContent  = 'MISS';
  spawnFloatText('MISS', 'miss', skillCircle);
  playBeep(120, 0.3, 'sawtooth');
}

function onGood() {
  flashScreen('rgba(46,204,113,0.15)');
  addCssHit('hit-good');
  centerIcon.textContent    = '✅';
  centerStatus.style.color  = 'var(--green-zone)';
  centerStatus.textContent  = 'GOOD';
  spawnFloatText('+' + SCORE.good, 'good', skillCircle);
  playBeep(440, 0.15, 'sine');
}

function onGreat() {
  flashScreen('rgba(46,204,113,0.25)');
  addCssHit('hit-great');
  centerIcon.textContent    = '⭐';
  centerStatus.style.color  = '#aaffcc';
  centerStatus.textContent  = 'GREAT';
  spawnFloatText('GREAT!', 'great', skillCircle);
  playBeep(550, 0.18, 'sine');
}

function onPerfect() {
  flashScreen('rgba(240,230,140,0.3)');
  addCssHit('hit-great');
  successZone.classList.add('perfect-zone');
  centerIcon.textContent    = '✨';
  centerStatus.style.color  = 'var(--perfect)';
  centerStatus.textContent  = 'PERFECT!';
  spawnFloatText('PERFECT!', 'perfect', skillCircle);
  playBeep(660, 0.2, 'sine');
  setTimeout(() => playBeep(880, 0.15, 'sine'), 100);
}

function addCssHit(cls) {
  skillCircle.classList.remove('hit-good', 'hit-great', 'hit-miss');
  void skillCircle.offsetWidth; // reflow
  skillCircle.classList.add(cls);
  setTimeout(() => skillCircle.classList.remove(cls), 350);
}

// ── FLASH OVERLAY ────────────────────────────
let flashEl = null;
function flashScreen(color) {
  if (!flashEl) {
    flashEl = document.createElement('div');
    flashEl.id = 'flash';
    Object.assign(flashEl.style, {
      position: 'fixed', inset: 0,
      pointerEvents: 'none', zIndex: 50,
      opacity: 0,
    });
    document.body.appendChild(flashEl);
  }
  flashEl.style.background = color;
  flashEl.style.transition = 'none';
  flashEl.style.opacity    = '1';
  requestAnimationFrame(() => {
    flashEl.style.transition = 'opacity 0.5s ease';
    flashEl.style.opacity    = '0';
  });
}

// ── FLOATING TEXT ────────────────────────────
function spawnFloatText(text, type, relativeTo) {
  const el  = document.createElement('div');
  el.className = `float-text ${type}`;
  el.textContent = text;

  // Position at center of skill circle
  const rect = relativeTo.getBoundingClientRect();
  el.style.left = (rect.left + rect.width / 2 - 80) + 'px';
  el.style.top  = (rect.top + rect.height / 2 - 20) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// ── AUDIO ────────────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}
function playBeep(freq, gain, type) {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gainNode.gain.setValueAtTime(gain, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {}
}

// ── HUD UPDATE ───────────────────────────────
function updateHUD() {
  hudRound.textContent  = `${state.round} / ${state.totalRounds}`;
  hudScore.textContent  = state.score.toLocaleString();
  hudStreak.textContent = state.streak > 0 ? `${state.streak}🔥` : '0';
}

// ── INPUT EVENTS ─────────────────────────────
document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (state.screen === 'game' && state.active) handleInput();
  }
  if (e.code === 'Escape' && state.screen === 'game') {
    cleanupGame();
    showScreen('menu');
  }
});

skillCircle.addEventListener('click', () => {
  if (state.screen === 'game' && state.active) handleInput();
});

// ── RESULT SCREEN ────────────────────────────
function showResult() {
  showScreen('result');

  const totalRounds  = state.roundData.length;
  const hits         = state.roundData.filter(r => r.result !== 'miss');
  const perfects     = state.roundData.filter(r => r.result === 'perfect');
  const accuracy     = totalRounds > 0 ? Math.round(hits.length / totalRounds * 100) : 0;
  const precisions   = hits.filter(r => r.precision != null).map(r => r.precision);
  const avgPrecision = precisions.length > 0
    ? Math.round(precisions.reduce((a, b) => a + b, 0) / precisions.length * 100)
    : 0;

  // Header
  if (accuracy >= 60) {
    resultHeader.textContent = hits.length === totalRounds ? 'GENERATOR REPAIRED!' : 'YOU SURVIVED';
    resultHeader.className = 'result-header success';
  } else {
    resultHeader.textContent = 'KILLED BY THE KILLER';
    resultHeader.className = 'result-header failure';
  }

  // Stats
  statScore.textContent      = state.score.toLocaleString();
  statAccuracy.textContent   = accuracy + '%';
  statBestStreak.textContent = state.bestStreak + '🔥';
  statAvgPrecision.textContent = precisions.length > 0 ? avgPrecision + '%' : '—';
  statPerfect.textContent    = perfects.length;
  statDifficulty.textContent = state.config.label.toUpperCase();

  // Round breakdown
  roundsList.innerHTML = '';
  state.roundData.forEach((rd, i) => {
    const row = document.createElement('div');
    const hit = rd.result !== 'miss';
    row.className = `round-row ${hit ? 'success' : 'failure'}`;

    const icons = { miss: '💀', good: '✅', great: '⭐', perfect: '✨' };
    const labels = { miss: 'MISS', good: 'GOOD', great: 'GREAT', perfect: 'PERFECT' };

    row.innerHTML = `
      <span class="round-num">Round ${i + 1}</span>
      <span class="round-result">${icons[rd.result]} ${labels[rd.result]}</span>
      <span class="round-score">${rd.scoreGained > 0 ? '+' + rd.scoreGained : '—'}</span>
      <span class="round-precision">${rd.precision != null ? Math.round(rd.precision * 100) + '% prec.' : ''}</span>
    `;
    roundsList.appendChild(row);
  });

  // Rank
  const maxScore = state.totalRounds * SCORE.perfect + (state.totalRounds - 1) * SCORE.streakBonus * (state.totalRounds - 1) / 2;
  const ratio    = state.score / Math.max(maxScore, 1);

  let rank, rankName;
  if (ratio >= 0.90 && accuracy === 100)      { rank = 'S'; rankName = 'ENTITY PLEASED'; }
  else if (ratio >= 0.75 && accuracy >= 80)   { rank = 'A'; rankName = 'SURVIVOR'; }
  else if (ratio >= 0.55 && accuracy >= 60)   { rank = 'B'; rankName = 'SKILLED'; }
  else if (accuracy >= 50)                     { rank = 'C'; rankName = 'NOVICE'; }
  else                                         { rank = 'D'; rankName = 'SACRIFICE'; }

  rankDisplay.className = `rank-display rank-${rank.toLowerCase()}`;
  rankDisplay.innerHTML = `
    <span class="rank-letter">${rank}</span>
    <span class="rank-name">${rankName}</span>
  `;
}

// ── CLEANUP on screen change ─────────────────
function cleanupGame() {
  stopNeedle();
  clearTimeout(state.waitTimeout);
  clearTimeout(state.autoFailTimer);
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  state.active  = false;
  state.waiting = false;
  countdownWrap.classList.add('hidden');
  countdownTime.textContent = '';
}

// When going back to menu cleanup game
btnMenu.addEventListener('click', cleanupGame);
btnRetry.addEventListener('click', cleanupGame);

// ── INIT ─────────────────────────────────────
spawnParticles();
showScreen('menu');

// Pre-position needle at top
rotateNeedle(0);
