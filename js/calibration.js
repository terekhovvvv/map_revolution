/**
 * ═══════════════════════════════════════════════════════════════
 * Calibration — геопривязка растровой карты к километровой сетке.
 *
 * Системы координат:
 *   • Пиксели изображения: (px, py), ось py направлена ВНИЗ.
 *   • Сетка карты: (X, Y) в «квадратах» (вещественные числа):
 *       X — ордината (северное направление, горизонтальные линии), растёт на север;
 *       Y — абсцисса (восточное направление, вертикальные линии), растёт на восток.
 *     Дробная часть — положение внутри квадрата: X = 35.45 → квадрат 35 + 450 м
 *     (при масштабе сетки 1000 м/квадрат).
 *
 * Преобразование сетка → пиксели — аффинное:
 *   px = a11·X + a12·Y + b1
 *   py = a21·X + a22·Y + b2
 *
 * Подбор коэффициентов:
 *   • 2 опорные точки  → преобразование подобия (сдвиг + поворот + единый масштаб),
 *     решается точно; подходит для ровного скана.
 *   • 3+ точки → аффинное преобразование по методу наименьших квадратов
 *     (нормальные уравнения 3×3, метод Гаусса); компенсирует неравномерные
 *     искажения скана по осям.
 *
 * Метры: 1 квадрат = metersPerSquare метров (по умолчанию 1000).
 * ═══════════════════════════════════════════════════════════════
 */
class Calibration {
  constructor() {
    /** @type {{px:number, py:number, X:number, Y:number}[]} опорные точки */
    this.points = [];
    this.metersPerSquare = 1000;
    this.matrix = null;   // {a11,a12,b1, a21,a22,b2} сетка → пиксели
    this.inverse = null;  // обратная матрица: пиксели → сетка
    this.bounds = null;   // {minX,maxX,minY,maxY} — охват сетки по опорным точкам
  }

  get isReady() { return !!this.matrix; }

  addPoint(px, py, X, Y) {
    this.points.push({ px, py, X, Y });
  }

  removePoint(index) {
    this.points.splice(index, 1);
    if (this.points.length < 2) { this.matrix = this.inverse = this.bounds = null; }
  }

  clear() {
    this.points = [];
    this.matrix = this.inverse = this.bounds = null;
  }

  /**
   * Рассчитать преобразование по текущему набору точек.
   * @returns {boolean} true, если удалось (нужно минимум 2 точки).
   */
  solve() {
    const n = this.points.length;
    if (n < 2) return false;

    if (n === 2) {
      // ── Преобразование подобия (без отражения):
      //   px =  α·X + β·Y + b1
      //   py = −β·X + α·Y + b2
      const [p, q] = this.points;
      const dX = q.X - p.X, dY = q.Y - p.Y;
      const du = q.px - p.px, dv = q.py - p.py;
      const den = dX * dX + dY * dY;
      if (den < 1e-12) return false; // точки совпадают в координатах сетки
      const alpha = (du * dX + dv * dY) / den;
      const beta  = (du * dY - dv * dX) / den;
      this.matrix = {
        a11: alpha, a12: beta,  b1: p.px - alpha * p.X - beta * p.Y,
        a21: -beta, a22: alpha, b2: p.py + beta * p.X - alpha * p.Y
      };
    } else {
      // ── Аффинное преобразование по МНК.
      // Для каждой строки дизайн-матрицы [X, Y, 1] решаем AᵀA·θ = Aᵀ·p.
      // Нормальные уравнения симметричны для px и py — собираем суммы один раз.
      let sXX = 0, sXY = 0, sX = 0, sYY = 0, sY = 0, sN = n;
      let sXu = 0, sYu = 0, sU = 0;   // для px (u)
      let sXv = 0, sYv = 0, sV = 0;   // для py (v)
      for (const t of this.points) {
        sXX += t.X * t.X; sXY += t.X * t.Y; sX += t.X;
        sYY += t.Y * t.Y; sY += t.Y;
        sXu += t.X * t.px; sYu += t.Y * t.px; sU += t.px;
        sXv += t.X * t.py; sYv += t.Y * t.py; sV += t.py;
      }
      const A = [[sXX, sXY, sX], [sXY, sYY, sY], [sX, sY, sN]];
      const thU = Calibration._gauss3(A, [sXu, sYu, sU]);
      const thV = Calibration._gauss3(A, [sXv, sYv, sV]);
      if (!thU || !thV) return false; // вырожденная конфигурация (точки на одной прямой)
      this.matrix = {
        a11: thU[0], a12: thU[1], b1: thU[2],
        a21: thV[0], a22: thV[1], b2: thV[2]
      };
    }

    // Обратная матрица 2×2: пиксели → сетка
    const m = this.matrix;
    const det = m.a11 * m.a22 - m.a12 * m.a21;
    if (Math.abs(det) < 1e-12) { this.matrix = null; return false; }
    this.inverse = {
      i11:  m.a22 / det, i12: -m.a12 / det,
      i21: -m.a21 / det, i22:  m.a11 / det
    };

    // Охват сетки (для индикации «Вне сетки»)
    const xs = this.points.map(t => t.X), ys = this.points.map(t => t.Y);
    this.bounds = {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys)
    };
    return true;
  }

  /** Решение СЛАУ 3×3 методом Гаусса с выбором главного элемента. */
  static _gauss3(A, b) {
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < 3; col++) {
      let piv = col;
      for (let r = col + 1; r < 3; r++)
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      [M[col], M[piv]] = [M[piv], M[col]];
      for (let r = 0; r < 3; r++) {
        if (r === col) continue;
        const f = M[r][col] / M[col][col];
        for (let c = col; c < 4; c++) M[r][c] -= f * M[col][c];
      }
    }
    return [0, 1, 2].map(i => M[i][3] / M[i][i]);
  }

  /** Сетка (X, Y) → пиксели изображения. */
  gridToPixel(X, Y) {
    const m = this.matrix;
    return { x: m.a11 * X + m.a12 * Y + m.b1, y: m.a21 * X + m.a22 * Y + m.b2 };
  }

  /** Пиксели изображения → сетка (X, Y). */
  pixelToGrid(px, py) {
    const m = this.matrix, i = this.inverse;
    const du = px - m.b1, dv = py - m.b2;
    return { X: i.i11 * du + i.i12 * dv, Y: i.i21 * du + i.i22 * dv };
  }

  /** Средний размер квадрата сетки в пикселях изображения (√|det|). */
  pixelsPerSquare() {
    if (!this.matrix) return 0;
    const m = this.matrix;
    return Math.sqrt(Math.abs(m.a11 * m.a22 - m.a12 * m.a21));
  }

  /** Проверка: координаты сетки внутри откалиброванного охвата? */
  insideGrid(X, Y) {
    if (!this.bounds) return false;
    const b = this.bounds, eps = 1e-9;
    return X >= b.minX - eps && X <= b.maxX + eps &&
           Y >= b.minY - eps && Y <= b.maxY + eps;
  }

  /* ─── Сериализация (localStorage / JSON) ─────────────────── */

  toJSON() {
    return {
      metersPerSquare: this.metersPerSquare,
      points: this.points
    };
  }

  fromJSON(data) {
    if (!data || !Array.isArray(data.points)) return false;
    this.metersPerSquare = data.metersPerSquare || 1000;
    this.points = data.points.filter(t =>
      Number.isFinite(t.px) && Number.isFinite(t.py) &&
      Number.isFinite(t.X) && Number.isFinite(t.Y));
    return this.points.length >= 2 ? this.solve() : false;
  }
}
