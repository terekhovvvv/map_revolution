/**
 * ═══════════════════════════════════════════════════════════════
 * Инструменты: Линейка (Ruler) и условные обозначения (MarkerStore).
 *
 * Все точки хранятся в КООРДИНАТАХ СЕТКИ (X, Y в квадратах), а не в
 * пикселях — тогда замеры и маркеры переживают перекалибровку карты.
 * Отрисовка выполняется в экранных координатах (после сброса трансформа),
 * чтобы толщина линий и размер значков не зависели от масштаба.
 *
 * Цепочка преобразований:
 *   сетка (X,Y) ──calibration──► пиксели изображения ──viewport──► экран
 * ═══════════════════════════════════════════════════════════════
 */

/* ───────────────────────── Линейка ───────────────────────── */

class Ruler {
  /**
   * @param {Calibration} cal — откалиброванная сетка (для перевода в метры)
   * @param {Viewport} vp
   */
  constructor(cal, vp) {
    this.cal = cal;
    this.vp = vp;
    /** @type {{X:number, Y:number}[]} вершины ломаной в координатах сетки */
    this.points = [];
    this.finished = false; // замер завершён (2×клик / Esc / ПКМ)
  }

  clear() { this.points = []; this.finished = false; }

  addPoint(X, Y) {
    if (this.finished) this.clear(); // новый замер поверх старого
    this.points.push({ X, Y });
  }

  finish() { if (this.points.length > 0) this.finished = true; }

  /** Длина одного сегмента в метрах. */
  static segMeters(a, b, mps) {
    const dN = (b.X - a.X) * mps; // составляющая «на север»
    const dE = (b.Y - a.Y) * mps; // составляющая «на восток»
    return Math.hypot(dN, dE);
  }

  /**
   * Дирекционный угол (азимут) сегмента: отсчёт от северного направления
   * по часовой стрелке, 0…360°.
   */
  static segAzimuth(a, b) {
    const dN = b.X - a.X, dE = b.Y - a.Y;
    return (Math.atan2(dE, dN) * 180 / Math.PI + 360) % 360;
  }

  /** Суммарная длина завершённых сегментов в метрах. */
  totalMeters() {
    const mps = this.cal.metersPerSquare;
    let sum = 0;
    for (let i = 1; i < this.points.length; i++)
      sum += Ruler.segMeters(this.points[i - 1], this.points[i], mps);
    return sum;
  }

  /** Красивое форматирование: метры → «1234 м» / «12,34 км». */
  static fmtMeters(m) {
    return m >= 10000
      ? (m / 1000).toFixed(2).replace('.', ',') + ' км'
      : Math.round(m) + ' м';
  }

  /**
   * Отрисовка ломаной в экранных координатах.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{X:number,Y:number}|null} hover — «резиновый» сегмент к курсору
   */
  render(ctx, hover) {
    if (this.points.length === 0) return;
    const toScreen = g => {
      const p = this.cal.gridToPixel(g.X, g.Y);
      return this.vp.imageToScreen(p.x, p.y);
    };
    const pts = this.points.map(toScreen);
    if (hover && !this.finished) pts.push(toScreen(hover));

    // Линия: белая подложка + цветной пунктир поверх (читается на любом фоне)
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 4; ctx.stroke();
    ctx.setLineDash([9, 6]);
    ctx.strokeStyle = '#ffb020'; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);

    // Вершины
    for (const p of pts) {
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb020'; ctx.fill();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Подписи длин сегментов у середин
    const mps = this.cal.metersPerSquare;
    ctx.font = '12px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    const gridPts = hover && !this.finished ? [...this.points, hover] : this.points;
    for (let i = 1; i < gridPts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const label = Ruler.fmtMeters(Ruler.segMeters(gridPts[i - 1], gridPts[i], mps));
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(15,20,26,0.82)';
      ctx.beginPath(); ctx.roundRect(mx - w / 2, my - 19, w, 17, 4); ctx.fill();
      ctx.fillStyle = '#ffd479';
      ctx.fillText(label, mx, my - 6);
    }
  }
}

/* ───────────────────── Условные обозначения ───────────────────── */

const MARKER_COLORS = {
  red:   '#e5484d',
  blue:  '#3a86ff',
  green: '#2f9e44',
  black: '#222222'
};

const MARKER_TYPE_NAMES = {
  point: 'Точка', hq: 'Штаб', vehicle: 'Техника',
  obstacle: 'Препятствие', obs: 'НП', text: 'Текст'
};

class MarkerStore {
  constructor(cal, vp) {
    this.cal = cal;
    this.vp = vp;
    /** @type {{id:number,type:string,color:string,X:number,Y:number,label:string}[]} */
    this.markers = [];
    this._nextId = 1;
  }

  add(type, color, X, Y, label = '') {
    const m = { id: this._nextId++, type, color, X, Y, label };
    this.markers.push(m);
    return m;
  }

  remove(id) {
    this.markers = this.markers.filter(m => m.id !== id);
  }

  clear() { this.markers = []; }

  byId(id) { return this.markers.find(m => m.id === id); }

  /** Экранная позиция маркера. */
  screenPos(m) {
    const p = this.cal.gridToPixel(m.X, m.Y);
    return this.vp.imageToScreen(p.x, p.y);
  }

  /** Попадание курсора по маркеру (радиус 14 экранных px). */
  hitTest(sx, sy) {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const p = this.screenPos(this.markers[i]);
      if (Math.hypot(p.x - sx, p.y - sy) <= 14) return this.markers[i];
    }
    return null;
  }

  /* ─── Сериализация ─── */
  toJSON() {
    return this.markers.map(m => ({ ...m }));
  }
  fromJSON(arr) {
    this.markers = [];
    this._nextId = 1;
    for (const m of arr) {
      if (!Number.isFinite(m.X) || !Number.isFinite(m.Y)) continue;
      const id = Number.isFinite(m.id) ? m.id : this._nextId;
      this.markers.push({
        id,
        type: MARKER_TYPE_NAMES[m.type] ? m.type : 'point',
        color: MARKER_COLORS[m.color] ? m.color : 'red',
        X: m.X, Y: m.Y,
        label: typeof m.label === 'string' ? m.label : ''
      });
      this._nextId = Math.max(this._nextId, id + 1);
    }
  }

  /**
   * Отрисовка всех знаков в экранных координатах.
   * @param {number|null} selectedId — подсветка выбранного знака
   */
  render(ctx, selectedId) {
    for (const m of this.markers) {
      const p = this.screenPos(m);
      if (p.x < -60 || p.y < -60 || p.x > this.vp.w + 60 || p.y > this.vp.h + 60) continue;
      const c = MARKER_COLORS[m.color] || '#e5484d';
      ctx.save();
      ctx.translate(p.x, p.y);
      MarkerStore._drawGlyph(ctx, m.type, c);
      ctx.restore();

      // Подпись под значком
      if (m.label) {
        ctx.font = '12px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        const w = ctx.measureText(m.label).width + 8;
        ctx.fillStyle = 'rgba(15,20,26,0.78)';
        ctx.beginPath(); ctx.roundRect(p.x - w / 2, p.y + 15, w, 17, 4); ctx.fill();
        ctx.fillStyle = '#eaf1f8';
        ctx.fillText(m.label, p.x, p.y + 28);
      }

      // Рамка выбранного знака
      if (m.id === selectedId) {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, 18, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /** Геометрия значков (рисуется в локальных координатах, центр = (0,0)). */
  static _drawGlyph(ctx, type, color) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = color;
    switch (type) {
      case 'point': // точка / ориентир
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        break;
      case 'hq': // штаб: флажок на древке
        ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -12);
        ctx.lineTo(11, -8.5); ctx.lineTo(0, -5); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -12); ctx.stroke();
        break;
      case 'vehicle': // техника: корпус + гусеницы
        ctx.beginPath(); ctx.roundRect(-9, -6, 18, 11, 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(-5, 8, 2.4, 0, Math.PI * 2);
        ctx.arc(5, 8, 2.4, 0, Math.PI * 2); ctx.fill();
        break;
      case 'obstacle': // препятствие: треугольник
        ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(10, 8); ctx.lineTo(-10, 8);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      case 'obs': // наблюдательный пункт: кольцо с точкой
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, Math.PI * 2); ctx.fill();
        break;
      case 'text': // текстовая метка: небольшой ромб-указатель
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(6, 0); ctx.lineTo(0, 7); ctx.lineTo(-6, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
    }
  }
}
