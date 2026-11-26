/**
 * ═══════════════════════════════════════════════════════════════
 * Viewport — камера над растровым изображением.
 *
 * Математика экран ↔ изображение:
 *   Экранная точка  S = (sx, sy)  — в CSS-пикселях окна.
 *   Точка изображения I = (ix, iy) — в пикселях исходного PNG.
 *
 *   Прямое преобразование:   S = scale · I + T
 *     sx = ix · scale + tx
 *     sy = iy · scale + ty
 *   Обратное преобразование: I = (S − T) / scale
 *
 * Зум «от курсора»: точка изображения под курсором должна остаться
 * на месте. Если scale → scale·f, то новый сдвиг считается как
 *   T' = S − (S − T) · f
 * ═══════════════════════════════════════════════════════════════
 */
class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.scale = 1;      // экранных пикселей на 1 пиксель изображения
    this.tx = 0;         // сдвиг по X (экранные px)
    this.ty = 0;         // сдвиг по Y (экранные px)
    this.minScale = 0.005;
    this.maxScale = 400;
    this.dpr = window.devicePixelRatio || 1;
    this.w = 0;          // CSS-ширина канвы
    this.h = 0;          // CSS-высота канвы
    this.resize();
  }

  /** Подгонка канвы под размер окна с учётом devicePixelRatio (чёткость на Retina). */
  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(this.w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.h * this.dpr));
  }

  _clampScale(s) {
    return Math.min(this.maxScale, Math.max(this.minScale, s));
  }

  /** Вписать всё изображение (iw × ih) в окно с отступом pad. */
  fit(iw, ih, pad = 60) {
    const s = Math.min((this.w - 2 * pad) / iw, (this.h - 2 * pad) / ih);
    this.scale = this._clampScale(s);
    // Центрируем изображение в окне
    this.tx = (this.w - iw * this.scale) / 2;
    this.ty = (this.h - ih * this.scale) / 2;
  }

  /** Масштаб 100% с сохранением текущего центра вида. */
  zoom100() {
    const c = this.screenToImage(this.w / 2, this.h / 2);
    this.scale = 1;
    this.tx = this.w / 2 - c.x;
    this.ty = this.h / 2 - c.y;
  }

  /** Экран → пиксели изображения. */
  screenToImage(sx, sy) {
    return { x: (sx - this.tx) / this.scale, y: (sy - this.ty) / this.scale };
  }

  /** Пиксели изображения → экран. */
  imageToScreen(ix, iy) {
    return { x: ix * this.scale + this.tx, y: iy * this.scale + this.ty };
  }

  /**
   * Зум колесиком строго относительно курсора:
   * точка (sx, sy) экрана должна продолжать указывать на тот же пиксель карты.
   */
  zoomAt(sx, sy, factor) {
    const newScale = this._clampScale(this.scale * factor);
    const f = newScale / this.scale;          // реальный коэффициент после clamp
    this.tx = sx - (sx - this.tx) * f;
    this.ty = sy - (sy - this.ty) * f;
    this.scale = newScale;
  }

  /** Панорамирование: сдвиг вида на экранную дельту. */
  panBy(dx, dy) {
    this.tx += dx;
    this.ty += dy;
  }

  /** Центрирование вида на пикселе изображения (с опциональной сменой масштаба). */
  centerOnImage(ix, iy, scale) {
    if (scale) this.scale = this._clampScale(scale);
    this.tx = this.w / 2 - ix * this.scale;
    this.ty = this.h / 2 - iy * this.scale;
  }
}
