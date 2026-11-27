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

    /**
     * Деформируемый меш узлов сетки (интерактивная правка линий):
     *   nodeX[i][j] — px узла (X = meshX0 + i, Y = meshY0 + j),
     *   nodeY[i][j] — py того же узла.
     * Если задан, преобразование — билинейная интерполяция по мешу,
     * аффинная матрица остаётся базой инициализации и «якобианом»
     * обратной итерации. null — жёсткая аффинная привязка.
     */
    this.mesh = null;
    this.meshX0 = 0;
    this.meshY0 = 0;
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

  /** Сетка (X, Y) → пиксели изображения (меш, если задан, иначе аффинная). */
  gridToPixel(X, Y) {
    if (this.mesh) return this._gridToPixelMesh(X, Y);
    return this._gridToPixelAffine(X, Y);
  }

  /** Аффинное преобразование сетка → пиксели. */
  _gridToPixelAffine(X, Y) {
    const m = this.matrix;
    return { x: m.a11 * X + m.a12 * Y + m.b1, y: m.a21 * X + m.a22 * Y + m.b2 };
  }

  /** Пиксели изображения → сетка (X, Y). С мешем — итерации Ньютона. */
  pixelToGrid(px, py) {
    if (!this.mesh) return this._pixelToGridAffine(px, py);
    let g = this._pixelToGridAffine(px, py);
    for (let k = 0; k < 6; k++) {
      const c = this._gridToPixelMesh(g.X, g.Y);
      const ex = px - c.x, ey = py - c.y;
      if (Math.abs(ex) < 0.01 && Math.abs(ey) < 0.01) break;
      const a = this._gridToPixelAffine(g.X, g.Y);
      g = this._pixelToGridAffine(px - (c.x - a.x), py - (c.y - a.y));
    }
    return g;
  }

  /** Аффинное преобразование пиксели → сетка. */
  _pixelToGridAffine(px, py) {
    const m = this.matrix, i = this.inverse;
    const du = px - m.b1, dv = py - m.b2;
    return { X: i.i11 * du + i.i12 * dv, Y: i.i21 * du + i.i22 * dv };
  }

  /* ─── Деформируемый меш узлов (правка линий сетки) ─── */

  /** Билинейная интерполяция по мешу узлов. */
  _gridToPixelMesh(X, Y) {
    const m = this.mesh;
    const nx = m.nodeX.length, ny = m.nodeX[0].length;
    const fx = X - this.meshX0, fy = Y - this.meshY0;
    let i = Math.floor(fx), j = Math.floor(fy);
    i = Math.min(Math.max(i, 0), nx - 2);
    j = Math.min(Math.max(j, 0), ny - 2);
    const v = Math.min(Math.max(fx - i, 0), 1);   // доля ячейки по X
    const u = Math.min(Math.max(fy - j, 0), 1);   // доля ячейки по Y
    const x00 = m.nodeX[i][j], x10 = m.nodeX[i + 1][j], x01 = m.nodeX[i][j + 1], x11 = m.nodeX[i + 1][j + 1];
    const y00 = m.nodeY[i][j], y10 = m.nodeY[i + 1][j], y01 = m.nodeY[i][j + 1], y11 = m.nodeY[i + 1][j + 1];
    return {
      x: (x00 * (1 - v) + x10 * v) * (1 - u) + (x01 * (1 - v) + x11 * v) * u,
      y: (y00 * (1 - v) + y10 * v) * (1 - u) + (y01 * (1 - v) + y11 * v) * u
    };
  }

  /** Инициализировать меш из аффинной базы (ровная сетка X=x0..x1, Y=y0..y1). */
  initMeshFromAffine(x0, x1, y0, y1) {
    const nodeX = [], nodeY = [];
    for (let i = 0; i <= x1 - x0; i++) {
      nodeX.push([]); nodeY.push([]);
      for (let j = 0; j <= y1 - y0; j++) {
        const p = this._gridToPixelAffine(x0 + i, y0 + j);
        nodeX[i].push(p.x);
        nodeY[i].push(p.y);
      }
    }
    return this.setMesh({ originX: x0, originY: y0, nodeX, nodeY });
  }

  /** Подключить меш (из localStorage/инициализации). */
  setMesh(mesh) {
    if (!mesh || !Array.isArray(mesh.nodeX) || !Array.isArray(mesh.nodeY) ||
        !mesh.nodeX.length || !Array.isArray(mesh.nodeX[0])) return false;
    this.mesh = mesh;
    this.meshX0 = mesh.originX ?? 0;
    this.meshY0 = mesh.originY ?? 0;
    return true;
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
