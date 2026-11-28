/**
 * ═══════════════════════════════════════════════════════════════
 * Демо-карта: процедурно генерируемая «топосхема», чтобы приложение
 * работало сразу, без загрузки PNG.
 *
 * Параметры сетки демо-карты:
 *   • вертикальные линии (абсциссы Y): номера 01…09
 *   • горизонтальные линии (ординаты X): номера 25…34
 *   • шаг сетки на изображении: 350 px, отступ рамки: 250 px
 *   • масштаб: 1 квадрат = 1000 м
 *
 * Формулы генерации (должны совпадать с авто-калибровкой):
 *   px(Y) = 250 + (Y − 1) · 350        — X-координата вертикальной линии
 *   py(X) = 250 + (34 − X) · 350       — Y-координата горизонтальной линии
 *                                        (X растёт на север = вверх = py уменьшается)
 * ═══════════════════════════════════════════════════════════════
 */

/** Детерминированный ГПСЧ (mulberry32), чтобы «рельеф» был стабильным. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEMO = {
  WIDTH: 3300,
  HEIGHT: 3650,
  MARGIN: 250,
  SQ: 350,
  X_MIN: 25, X_MAX: 34,   // горизонтальные линии (ординаты)
  Y_MIN: 1,  Y_MAX: 9     // вертикальные линии (абсциссы)
};

/** Те же формулы, что и при отрисовке сетки — используются для авто-калибровки. */
function demoGridToPixel(X, Y) {
  return {
    x: DEMO.MARGIN + (Y - DEMO.Y_MIN) * DEMO.SQ,
    y: DEMO.MARGIN + (DEMO.X_MAX - X) * DEMO.SQ
  };
}

/** Опорные точки по углам сетки для автоматической калибровки демо-карты. */
function demoCalibrationPoints() {
  const corners = [
    { X: DEMO.X_MIN, Y: DEMO.Y_MIN },
    { X: DEMO.X_MIN, Y: DEMO.Y_MAX },
    { X: DEMO.X_MAX, Y: DEMO.Y_MIN },
    { X: DEMO.X_MAX, Y: DEMO.Y_MAX }
  ];
  return corners.map(c => {
    const p = demoGridToPixel(c.X, c.Y);
    return { px: p.x, py: p.y, X: c.X, Y: c.Y };
  });
}

function generateDemoMap() {
  const cv = document.createElement('canvas');
  cv.width = DEMO.WIDTH;
  cv.height = DEMO.HEIGHT;
  const ctx = cv.getContext('2d');
  const rnd = mulberry32(20261126);

  // ── Фон (песочная «бумага») + лёгкий шум ──────────────────
  ctx.fillStyle = '#e9dfc5';
  ctx.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(120,100,60,${0.02 + rnd() * 0.04})`;
    ctx.fillRect(rnd() * cv.width, rnd() * cv.height, 2, 2);
  }

  // ── Лесные массивы (зелёные пятна) ─────────────────────────
  for (let i = 0; i < 26; i++) {
    const cx = 350 + rnd() * (cv.width - 700);
    const cy = 350 + rnd() * (cv.height - 700);
    const r = 60 + rnd() * 170;
    ctx.fillStyle = `rgba(96,140,78,${0.28 + rnd() * 0.22})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.55 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Горизонтали (коричневые кольца вокруг «высот») ─────────
  const hills = [
    { x: 950, y: 1100, n: 7 }, { x: 2300, y: 2500, n: 9 }, { x: 1650, y: 3100, n: 5 }
  ];
  ctx.strokeStyle = '#a0653a';
  ctx.lineWidth = 1.4;
  for (const h of hills) {
    for (let k = 1; k <= h.n; k++) {
      const base = k * 42;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.12) {
        const rr = base * (1 + 0.16 * Math.sin(a * 3 + k) + 0.1 * rnd());
        const x = h.x + Math.cos(a) * rr;
        const y = h.y + Math.sin(a) * rr * 0.8;
        a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // ── Река (синяя извилистая линия) ──────────────────────────
  ctx.strokeStyle = '#5b8fc9';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let rx = 300, ry = 600;
  ctx.moveTo(rx, ry);
  for (let i = 0; i < 9; i++) {
    rx += 300 + rnd() * 160;
    ry += (rnd() - 0.42) * 480;
    ry = Math.max(350, Math.min(DEMO.HEIGHT - 350, ry));
    ctx.quadraticCurveTo(rx - 160, ry + (rnd() - 0.5) * 220, rx, ry);
  }
  ctx.stroke();
  ctx.fillStyle = '#3a6ea8';
  ctx.font = 'italic 26px Georgia';
  ctx.fillText('р. Сухая', 1150, 1750);

  // ── Грунтовые дороги ───────────────────────────────────────
  ctx.strokeStyle = '#9a5a32';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(250, 2700); ctx.lineTo(3050, 950); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(900, 3400); ctx.lineTo(1400, 250); ctx.stroke();

  // ── Населённый пункт ───────────────────────────────────────
  ctx.fillStyle = '#3a3a3a';
  for (let i = 0; i < 22; i++) {
    ctx.fillRect(1480 + rnd() * 260, 1930 + rnd() * 190, 10 + rnd() * 10, 8 + rnd() * 8);
  }
  ctx.font = 'bold 30px Georgia';
  ctx.fillText('Васильево', 1500, 2190);

  // ── Километровая сетка ─────────────────────────────────────
  ctx.strokeStyle = 'rgba(60,60,60,0.75)';
  ctx.lineWidth = 1;
  ctx.font = 'bold 24px "Courier New", monospace';
  ctx.fillStyle = '#1c1c1c';
  ctx.textAlign = 'center';

  // Вертикальные линии (абсциссы Y), подписи сверху и снизу
  for (let Y = DEMO.Y_MIN; Y <= DEMO.Y_MAX; Y++) {
    const px = DEMO.MARGIN + (Y - DEMO.Y_MIN) * DEMO.SQ;
    ctx.beginPath(); ctx.moveTo(px, DEMO.MARGIN); ctx.lineTo(px, DEMO.HEIGHT - DEMO.MARGIN); ctx.stroke();
    const label = String(Y).padStart(2, '0');
    ctx.fillText(label, px, DEMO.MARGIN - 12);
    ctx.fillText(label, px, DEMO.HEIGHT - DEMO.MARGIN + 30);
  }
  // Горизонтальные линии (ординаты X), подписи слева и справа
  ctx.textAlign = 'right';
  for (let X = DEMO.X_MIN; X <= DEMO.X_MAX; X++) {
    const py = DEMO.MARGIN + (DEMO.X_MAX - X) * DEMO.SQ;
    ctx.beginPath(); ctx.moveTo(DEMO.MARGIN, py); ctx.lineTo(DEMO.WIDTH - DEMO.MARGIN, py); ctx.stroke();
    const label = String(X);
    ctx.fillText(label, DEMO.MARGIN - 10, py + 8);
    ctx.textAlign = 'left';
    ctx.fillText(label, DEMO.WIDTH - DEMO.MARGIN + 10, py + 8);
    ctx.textAlign = 'right';
  }

  // ── Рамка карты и «поля» ───────────────────────────────────
  ctx.strokeStyle = '#2c2c2c';
  ctx.lineWidth = 10;
  ctx.strokeRect(DEMO.MARGIN - 40, DEMO.MARGIN - 40,
                 DEMO.WIDTH - 2 * DEMO.MARGIN + 80, DEMO.HEIGHT - 2 * DEMO.MARGIN + 80);
  ctx.fillStyle = '#555';
  ctx.font = '20px Georgia';
  ctx.textAlign = 'center';
  ctx.fillText('ДЕМОНСТРАЦИОННАЯ СХЕМА · МАСШТАБ СЕТКИ 1:1000 м/квадрат', DEMO.WIDTH / 2, 90);

  return cv;
}
