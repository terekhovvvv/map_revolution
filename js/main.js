/**
 * ═══════════════════════════════════════════════════════════════
 * main.js — сборка приложения: загрузка карты, цикл отрисовки,
 * события мыши/клавиатуры, режимы инструментов, поиск, статусбар,
 * импорт/экспорт обстановки.
 *
 * Режимы работы (App.mode):
 *   'pan'        — обзор (панорамирование ЛКМ/СКМ, зум колесом)
 *   'ruler'      — измерение расстояний ломаной
 *   'marker'     — установка условных знаков
 *   'dragMarker' — перетаскивание выбранного знака
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

/* ─────────── Глобальное состояние приложения ─────────── */
const App = {
  canvas: null, ctx: null,
  vp: null,          // Viewport
  cal: null,         // Calibration
  ruler: null,       // Ruler
  markers: null,     // MarkerStore

  bitmap: null,      // ImageBitmap | HTMLCanvasElement текущей карты
  imgW: 0, imgH: 0,
  imageKey: 'demo',  // ключ текущей карты (встроенная / фолбэк-демо)

  mode: 'pan',
  _returnMode: 'pan',          // куда вернуться после перетаскивания маркера
  mouse: { sx: 0, sy: 0, inside: false },

  selectedMarker: null,        // id маркера, открытого в поповере
  dragMarkerId: null,
  markerType: 'point',
  markerColor: 'red',

  highlight: null,             // {kind:'square'|'point', X, Y, until} | {kind:'points', pts:[{X,Y}], until}
  showGrid: false,             // поверх скана: расчётная сетка для визуальной проверки
  hasMeshEdits: false          // есть ли незафиксированные правки линий (localStorage)
};

/* ─────────── Утилиты ─────────── */

const $ = id => document.getElementById(id);
const pad2 = n => String(n).padStart(2, '0');

let toastTimer = null;
function toast(msg, ms = 2800) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

/**
 * Формат координаты сетки: 35.45 → "35 450" (квадрат + метры внутри).
 * mps — метров в квадрате.
 */
function fmtCoord(v, mps) {
  let km = Math.floor(v);
  let m = Math.round((v - km) * mps);
  if (m >= mps) { km += 1; m -= mps; }          // округление на границе квадрата
  return `${pad2(km)} ${String(m).padStart(3, '0')}`;
}

/** Номер квадрата: (35.45, 14.2) → "35-14". */
function fmtSquare(X, Y) {
  return `${pad2(Math.floor(X))}-${pad2(Math.floor(Y))}`;
}

/* ── «Улитка»: деление квадрата на 9 секторов ──
   Нумерация по часовой спирали от северо-западного угла, центр — 9:
        1 2 3      (северная строка, запад → восток)
        8 9 4
        7 6 5      (южная строка)
   Координата точки: «квадрат-сектор», напр. 41-01-6. */
const SNAIL = [[1, 2, 3], [8, 9, 4], [7, 6, 5]];

/** Сектор «улитки» (1–9) для точки сетки (gX, gY). */
function snailSector(gX, gY) {
  const u = gY - Math.floor(gY);      // доля квадрата запад→восток
  const v = gX - Math.floor(gX);      // доля квадрата юг→север
  const col = Math.min(2, Math.floor(u * 3));
  const row = Math.min(2, Math.floor((1 - v) * 3));
  return SNAIL[row][col];
}

/** Границы сектора S квадрата (X, Y) в координатах сетки + центр сектора. */
function snailSectorBounds(X, Y, S) {
  let row = 1, col = 1;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (SNAIL[r][c] === S) { row = r; col = c; }
  const x0 = X + (2 - row) / 3, x1 = x0 + 1 / 3;
  const y0 = Y + col / 3, y1 = y0 + 1 / 3;
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** Квадрат с сектором «улитки», слитно: (41.4, 27.2) → "41276". */
function fmtSquareSnail(X, Y) {
  return `${pad2(Math.floor(X))}${pad2(Math.floor(Y))}${snailSector(X, Y)}`;
}

/* ─────────── Цикл отрисовки ─────────── */

let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function render() {
  const { ctx, vp, cal } = App;
  const dpr = vp.dpr;

  // Фон «рабочего стола»
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 0, vp.w, vp.h);

  // ── Карта: рисуем ТОЛЬКО видимый фрагмент исходного битмапа.
  //    drawImage с source-rect — аппаратно ускоряется и не трогает
  //    невидимые мегапиксели, что критично для PNG ~15000×15000.
  if (App.bitmap) {
    const tl = vp.screenToImage(0, 0);
    const br = vp.screenToImage(vp.w, vp.h);
    const sx = Math.max(0, Math.min(App.imgW, tl.x));
    const sy = Math.max(0, Math.min(App.imgH, tl.y));
    const ex = Math.max(0, Math.min(App.imgW, br.x));
    const ey = Math.max(0, Math.min(App.imgH, br.y));
    if (ex > sx && ey > sy) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.setTransform(vp.scale * dpr, 0, 0, vp.scale * dpr, vp.tx * dpr, vp.ty * dpr);
      // источник и приёмник совпадают в пиксельных координатах — масштаб делает трансформ
      ctx.drawImage(App.bitmap, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
    }
  }

  // ── Оверлеи в экранных координатах (постоянная толщина линий) ──
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (cal.isReady) {
    drawGridOverlay(ctx);
    drawHighlight(ctx);
    const hover = rulerHoverGrid();
    App.ruler.render(ctx, hover);
    App.markers.render(ctx, App.selectedMarker);
    drawRulerTooltip(ctx, hover);
  }
}

/**
 * Расчётная сетка поверх скана (кнопка «▦ Сетка»):
 * рисует вычисленные линии и номера квадратов полупрозрачным цветом,
 * чтобы визуально сверить привязку с линиями и подписями на карте.
 */
function drawGridOverlay(ctx) {
  if (!App.showGrid) return;
  const { vp, cal } = App;
  const b = cal.bounds;
  ctx.save();
  drawSnailOverlay(ctx);          // «улитка» — под основными линиями сетки
  ctx.strokeStyle = 'rgba(255, 70, 90, 0.55)';
  ctx.lineWidth = 1;
  ctx.font = 'bold 11px "Segoe UI", sans-serif';

  // Вертикальные линии (целые Y): полилиния через узлы — сетка может
  // быть изогнута правками, поэтому сэмплируем каждые 0,25 квадрата.
  ctx.textAlign = 'center';
  for (let Y = Math.ceil(b.minY); Y <= Math.floor(b.maxY); Y++) {
    ctx.beginPath();
    for (let X = b.minX; X <= b.maxX + 1e-9; X += 0.25) {
      const p = cal.gridToPixel(Math.min(X, b.maxX), Y);
      const s = vp.imageToScreen(p.x, p.y);
      X === b.minX ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
    // подпись номера у северного (верхнего) конца линии
    const n = cal.gridToPixel(b.maxX, Y);
    const sn = vp.imageToScreen(n.x, n.y);
    if (sn.y > -20 && sn.y < vp.h + 20) {
      ctx.fillStyle = 'rgba(15,20,26,0.8)';
      ctx.fillRect(sn.x - 10, sn.y - 15, 20, 13);
      ctx.fillStyle = '#ff5a6e';
      ctx.fillText(pad2(Y), sn.x, sn.y - 4);
    }
  }

  // Горизонтальные линии (целые X) + подписи номеров у западного конца
  ctx.textAlign = 'left';
  for (let X = Math.ceil(b.minX); X <= Math.floor(b.maxX); X++) {
    ctx.beginPath();
    for (let Y = b.minY; Y <= b.maxY + 1e-9; Y += 0.25) {
      const p = cal.gridToPixel(X, Math.min(Y, b.maxY));
      const s = vp.imageToScreen(p.x, p.y);
      Y === b.minY ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
    const w = cal.gridToPixel(X, b.minY);   // западный (левый) конец линии
    const sw = vp.imageToScreen(w.x, w.y);
    if (sw.x > -30 && sw.x < vp.w + 30 && sw.y > -10 && sw.y < vp.h + 20) {
      ctx.fillStyle = 'rgba(15,20,26,0.8)';
      ctx.fillRect(sw.x - 24, sw.y - 10, 20, 13);
      ctx.fillStyle = '#ff5a6e';
      ctx.fillText(pad2(X), sw.x - 22, sw.y + 1);
    }
  }
  ctx.restore();
}

/**
 * «Улитка» поверх сетки: каждый квадрат делится на 3×3 сектора
 * со спиральной нумерацией (см. SNAIL). Рисуется только в режиме «▦ Сетка».
 * На мелком масштабе пропускается (иначе каша), на среднем — только
 * линии третей, на крупном — ещё и номера секторов.
 */
function drawSnailOverlay(ctx) {
  const { vp, cal } = App;
  const b = cal.bounds;

  // Экранный размер квадрата (по стороне центрального квадрата сетки)
  const cX = (b.minX + b.maxX) / 2, cY = (b.minY + b.maxY) / 2;
  const pa = cal.gridToPixel(cX, cY), pb = cal.gridToPixel(cX + 1, cY + 1);
  const sa = vp.imageToScreen(pa.x, pa.y), sb = vp.imageToScreen(pb.x, pb.y);
  const sqSize = Math.hypot(sb.x - sa.x, sb.y - sa.y) / Math.SQRT2;
  if (sqSize < 42) return;                    // слишком мелко — только километровая сетка
  const drawNums = sqSize >= 95;

  ctx.save();
  ctx.strokeStyle = 'rgba(139, 0, 0, 0.6)';   // тёмно-красные линии третей
  ctx.lineWidth = 1;
  ctx.font = 'bold 10px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(139, 0, 0, 0.95)';    // тёмно-красные номера секторов

  const toScr = (X, Y) => {
    const p = cal.gridToPixel(X, Y);
    return vp.imageToScreen(p.x, p.y);
  };

  for (let X = Math.ceil(b.minX); X < b.maxX; X++) {
    for (let Y = Math.ceil(b.minY); Y < b.maxY; Y++) {
      // отсечь квадраты вне экрана (по диагонали с запасом)
      const c00 = toScr(X, Y), c11 = toScr(X + 1, Y + 1);
      if (Math.max(c00.x, c11.x) < -60 || Math.min(c00.x, c11.x) > vp.w + 60 ||
          Math.max(c00.y, c11.y) < -60 || Math.min(c00.y, c11.y) > vp.h + 60) continue;

      // линии третей: две «вертикальные» (по Y) и две «горизонтальные» (по X)
      for (const k of [1, 2]) {
        let a = toScr(X, Y + k / 3), e = toScr(X + 1, Y + k / 3);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(e.x, e.y); ctx.stroke();
        a = toScr(X + k / 3, Y); e = toScr(X + k / 3, Y + 1);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      }

      if (drawNums) {
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 3; col++) {
            const s = toScr(X + (2 - row) / 3 + 1 / 6, Y + col / 3 + 1 / 6);
            ctx.fillText(String(SNAIL[row][col]), s.x, s.y + 3);
          }
        }
      }
    }
  }
  ctx.restore();
}

/** Подсветка найденного квадрата / точки (несколько секунд). */
function drawHighlight(ctx) {
  const h = App.highlight;
  if (!h) return;
  if (performance.now() > h.until) { App.highlight = null; return; }
  const toScr = (X, Y) => {
    const p = App.cal.gridToPixel(X, Y);
    return App.vp.imageToScreen(p.x, p.y);
  };
  if (h.kind === 'snail') {
    // подсветка сектора «улитки» (девятая части квадрата)
    const sb = snailSectorBounds(h.X, h.Y, h.S);
    const c = [toScr(sb.x0, sb.y0), toScr(sb.x0, sb.y1), toScr(sb.x1, sb.y1), toScr(sb.x1, sb.y0)];
    ctx.beginPath();
    c.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 208, 80, 0.3)';
    ctx.fill();
    ctx.strokeStyle = '#ffd050'; ctx.lineWidth = 2.5;
    ctx.stroke();
  } else if (h.kind === 'square') {
    const c = [toScr(h.X, h.Y), toScr(h.X, h.Y + 1), toScr(h.X + 1, h.Y + 1), toScr(h.X + 1, h.Y)];
    ctx.beginPath();
    c.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 208, 80, 0.28)';
    ctx.fill();
    ctx.strokeStyle = '#ffd050'; ctx.lineWidth = 2.5;
    ctx.stroke();
  } else if (h.kind === 'points') {
    // Несколько одноимённых точек разом: кольцо + пронумерованный значок.
    // Номера совпадают с нумерацией в выпадающем списке результатов.
    h.pts.forEach((pt, i) => {
      const s = toScr(pt.X, pt.Y);
      ctx.strokeStyle = '#ffd050'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, 15, 0, Math.PI * 2); ctx.stroke();
      // значок с номером (правый верхний угол кольца)
      ctx.beginPath(); ctx.arc(s.x + 15, s.y - 15, 9, 0, Math.PI * 2);
      ctx.fillStyle = '#101418'; ctx.fill();
      ctx.strokeStyle = '#ffd050'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#ffd050';
      ctx.font = 'bold 11px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), s.x + 15, s.y - 11);
    });
  } else {
    const s = toScr(h.X, h.Y);
    ctx.strokeStyle = '#ffd050'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x - 26, s.y); ctx.lineTo(s.x - 8, s.y);
    ctx.moveTo(s.x + 8, s.y);  ctx.lineTo(s.x + 26, s.y);
    ctx.moveTo(s.x, s.y - 26); ctx.lineTo(s.x, s.y - 8);
    ctx.moveTo(s.x, s.y + 8);  ctx.lineTo(s.x, s.y + 26);
    ctx.stroke();
  }
}

/** «Резиновый» конец линейки: координаты сетки под курсором (или null). */
function rulerHoverGrid() {
  if (App.mode !== 'ruler' || !App.mouse.inside || !App.cal.isReady) return null;
  const img = App.vp.screenToImage(App.mouse.sx, App.mouse.sy);
  if (img.x < 0 || img.y < 0 || img.x > App.imgW || img.y > App.imgH) return null;
  return App.cal.pixelToGrid(img.x, img.y);
}

/** Подсказка у курсора в режиме линейки: длина текущего сегмента + азимут. */
function drawRulerTooltip(ctx, hover) {
  if (!hover || App.ruler.points.length === 0 || App.ruler.finished) return;
  const last = App.ruler.points[App.ruler.points.length - 1];
  const seg = Ruler.segMeters(last, hover, App.cal.metersPerSquare);
  const az = Ruler.segAzimuth(last, hover);
  const text = `${Ruler.fmtMeters(seg)} · ${az.toFixed(1)}°`;
  const x = App.mouse.sx + 18, y = App.mouse.sy + 22;
  ctx.font = '12px "Segoe UI", sans-serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(15,20,26,0.88)';
  ctx.beginPath(); ctx.roundRect(x, y, w, 20, 5); ctx.fill();
  ctx.fillStyle = '#7fd4ff'; ctx.textAlign = 'left';
  ctx.fillText(text, x + 6, y + 14);
}

/* ─────────── Статусбар ─────────── */

function updateStatus() {
  const { vp, cal, mouse } = App;
  $('stZoom').textContent = `Масштаб: ${(vp.scale * 100).toFixed(vp.scale < 1 ? 1 : 0)}%`;

  if (!mouse.inside) {
    $('stCoords').textContent = 'X: — — —  |  Y: — — —';
    $('stSquare').textContent = 'Квадрат: —';
    return;
  }
  const img = vp.screenToImage(mouse.sx, mouse.sy);
  if (img.x < 0 || img.y < 0 || img.x > App.imgW || img.y > App.imgH) {
    $('stCoords').textContent = 'Вне карты';
    $('stSquare').textContent = 'Квадрат: —';
    return;
  }
  if (!cal.isReady) {
    $('stCoords').textContent = `px: ${Math.round(img.x)}, ${Math.round(img.y)}`;
    $('stSquare').textContent = 'Квадрат: —';
    return;
  }
  const g = cal.pixelToGrid(img.x, img.y);
  if (!cal.insideGrid(g.X, g.Y)) {
    $('stCoords').textContent = 'Вне сетки';
    $('stSquare').textContent = 'Квадрат: —';
    return;
  }
  const mps = cal.metersPerSquare;
  $('stCoords').textContent = `X: ${fmtCoord(g.X, mps)}  |  Y: ${fmtCoord(g.Y, mps)}`;
  $('stSquare').textContent = `Квадрат: ${fmtSquareSnail(g.X, g.Y)}`;
}

function updateCalibStatus() {
  const el = $('stCalib');
  if (App.cal.isReady) {
    el.textContent = `Сетка: ${App.cal.metersPerSquare} м/кв` +
      ((typeof GRID_MESH !== 'undefined' && GRID_MESH && App.cal.mesh) ? ' · база зафиксирована' : '') +
      (App.hasMeshEdits ? ' · есть правки' : '');
    el.classList.add('ok');
  } else {
    el.textContent = 'Сетка не привязана';
    el.classList.remove('ok');
  }
}

/* ─────────── Режимы ─────────── */

const MODE_NAMES = {
  pan: 'Обзор', ruler: 'Линейка',
  marker: 'Маркеры', dragMarker: 'Перетаскивание знака',
  gridEdit: 'Правка линий сетки'
};

function setMode(mode) {
  App.mode = mode;
  $('btnPan').classList.toggle('active', mode === 'pan');
  $('btnRuler').classList.toggle('active', mode === 'ruler');
  $('btnMarker').classList.toggle('active', mode === 'marker' || mode === 'dragMarker');
  $('btnGridEdit').classList.toggle('active', mode === 'gridEdit');
  $('stMode').textContent = `Режим: ${MODE_NAMES[mode]}`;
  App.canvas.classList.toggle('crosshair', ['ruler', 'marker', 'gridEdit'].includes(mode));
  $('markerPanel').classList.toggle('hidden', !(mode === 'marker' || mode === 'dragMarker'));
  $('gridEditPanel').classList.toggle('hidden', mode !== 'gridEdit');
  updateRulerPanel();
  hideMarkerPop();
  requestRender();
}

function updateRulerPanel() {
  const show = App.mode === 'ruler' || App.ruler.points.length > 0;
  $('rulerPanel').classList.toggle('hidden', !show);
}

function updateRulerInfo(hover) {
  const r = App.ruler, mps = App.cal.metersPerSquare;
  let seg = null, az = null;
  if (hover && r.points.length > 0 && !r.finished) {
    const last = r.points[r.points.length - 1];
    seg = Ruler.segMeters(last, hover, mps);
    az = Ruler.segAzimuth(last, hover);
  }
  let total = r.totalMeters() + (seg || 0);
  $('rSeg').textContent = seg !== null ? Ruler.fmtMeters(seg) : '—';
  $('rAz').textContent = az !== null ? az.toFixed(1) + '°' : '—';
  $('rTotal').textContent = r.points.length > 0 ? Ruler.fmtMeters(total) : '—';
}

/* ─────────── События мыши / клавиатуры ─────────── */

let drag = null; // {button, startX, startY, lastX, lastY, moved}

function bindEvents() {
  const cv = App.canvas;

  // Зум колесиком относительно курсора
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = Math.pow(1.0015, -e.deltaY);
    App.vp.zoomAt(e.clientX, e.clientY, factor);
    updateStatus();
    requestRender();
  }, { passive: false });

  cv.addEventListener('mousedown', e => {
    hideSearchResults();
    // Правка сетки: ЛКМ по километровой линии начинает её изгиб (не панорамирование)
    if (e.button === 0 && App.mode === 'gridEdit') {
      if (tryStartLineEdit(e)) {
        cv.setPointerCapture(e.pointerId);
        return;
      }
    }
    // Панорамирование: ЛКМ в режиме обзора или СКМ в любом режиме
    if (e.button === 1 || (e.button === 0 && App.mode === 'pan')) {
      drag = { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
      cv.classList.add('dragging');
      cv.setPointerCapture(e.pointerId);
    }
  });

  cv.addEventListener('mousemove', e => {
    App.mouse = { sx: e.clientX, sy: e.clientY, inside: true };

    if (lineEdit) {
      // Изгиб линии: дельта в пикселях изображения от точки захвата
      const img = App.vp.screenToImage(e.clientX, e.clientY);
      const dx = img.x - lineEdit.startImg.x, dy = img.y - lineEdit.startImg.y;
      restoreMesh(App.cal.mesh, lineEdit.snap);
      App.cal.deformLine(lineEdit.axis, lineEdit.index, lineEdit.at, dx, dy, GE.radius);
    } else if (drag) {
      const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
      if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 4) drag.moved = true;
      App.vp.panBy(dx, dy);
      drag.lastX = e.clientX; drag.lastY = e.clientY;
    } else if (App.mode === 'dragMarker' && App.dragMarkerId !== null) {
      // Перетаскивание знака: экран → пиксели → сетка
      const m = App.markers.byId(App.dragMarkerId);
      if (m) {
        const img = App.vp.screenToImage(e.clientX, e.clientY);
        const g = App.cal.pixelToGrid(img.x, img.y);
        m.X = g.X; m.Y = g.Y;
      }
    }

    updateStatus();
    if (App.mode === 'ruler') updateRulerInfo(rulerHoverGrid());
    requestRender();
  });

  cv.addEventListener('mouseup', e => {
    if (lineEdit) {
      // Отпустили кнопку — правка линии завершена: сохранить меш
      lineEdit = null;
      saveMeshEdits();
      updateCalibStatus();
      requestRender();
      return;
    }
    if (drag) {
      cv.classList.remove('dragging');
      const wasClick = !drag.moved && e.button === 0;
      drag = null;
      if (wasClick) handleClick(e);   // короткий клик без сдвига
      return;
    }
    if (e.button === 0 && App.mode !== 'pan') handleClick(e);
  });

  cv.addEventListener('mouseleave', () => {
    App.mouse.inside = false;
    updateStatus();
    requestRender();
  });

  // Двойной клик — завершить линейку
  cv.addEventListener('dblclick', e => {
    if (App.mode === 'ruler') {
      e.preventDefault();
      // клики, породившие dblclick, продублировали последнюю точку — убираем
      const p = App.ruler.points;
      if (p.length >= 2) {
        const a = p[p.length - 2], b = p[p.length - 1];
        if (Math.hypot(a.X - b.X, a.Y - b.Y) < 1e-9) p.pop();
      }
      finishRuler();
    }
  });

  // ПКМ — завершить линейку / закрыть поповер
  cv.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (App.mode === 'ruler') finishRuler();
    else hideMarkerPop();
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      hideSearchResults();
      if (lineEdit) {                 // отменить текущий изгиб линии
        restoreMesh(App.cal.mesh, lineEdit.snap);
        meshUndoStack.pop();          // снимок этой правки не нужен
        lineEdit = null;
        requestRender();
        return;
      }
      if (App.mode === 'ruler') finishRuler();
      else if (App.mode === 'dragMarker') setMode(App._returnMode);
      else hideMarkerPop();
    }
    if (e.key === 'Enter' && document.activeElement === $('searchInput')) doSearch();
  });

  window.addEventListener('resize', () => {
    App.vp.resize();
    requestRender();
  });
}

function finishRuler() {
  App.ruler.finish();
  updateRulerInfo(null);
  updateRulerPanel();
  requestRender();
}

/** Центральная обработка кликов по карте в зависимости от режима. */
function handleClick(e) {
  const { vp, cal } = App;
  const img = vp.screenToImage(e.clientX, e.clientY);
  const onImage = img.x >= 0 && img.y >= 0 && img.x <= App.imgW && img.y <= App.imgH;

  switch (App.mode) {
    case 'ruler': {
      if (!cal.isReady) { toast('Сетка не привязана'); return; }
      if (!onImage) return;
      const g = cal.pixelToGrid(img.x, img.y);
      App.ruler.addPoint(g.X, g.Y);
      updateRulerInfo(null);
      updateRulerPanel();
      requestRender();
      break;
    }

    case 'marker': {
      if (!cal.isReady) { toast('Сетка не привязана'); return; }
      const hit = App.markers.hitTest(e.clientX, e.clientY);
      if (hit) { showMarkerPop(hit); return; }
      if (!onImage) return;
      const g = cal.pixelToGrid(img.x, img.y);
      if (!cal.insideGrid(g.X, g.Y)) { toast('Точка вне привязанной сетки'); return; }
      const m = App.markers.add(App.markerType, App.markerColor, g.X, g.Y);
      if (App.markerType === 'text') showMarkerPop(m); // сразу предлагаем подпись
      requestRender();
      break;
    }

    case 'dragMarker':
      // Клик — «положить» знак на новое место
      App.dragMarkerId = null;
      setMode(App._returnMode);
      toast('Знак перемещён');
      break;

    case 'pan': {
      // В обзоре клик по знаку открывает его карточку
      const hit = App.markers.hitTest(e.clientX, e.clientY);
      if (hit) showMarkerPop(hit);
      else hideMarkerPop();
      break;
    }
  }
}

/* ─────────── Правка линий сетки: изгиб, хранение, отмена ─────────── */

let lineEdit = null;        // {axis:'X'|'Y', index, at, startImg, snap} — активный изгиб
let meshUndoStack = [];     // снимки меша до каждой правки (макс. 20)
const GE = { radius: 2 };   // радиус изгиба, в квадратах (гауссово затухание)

function cloneMesh(m) {
  return { nodeX: m.nodeX.map(r => r.slice()), nodeY: m.nodeY.map(r => r.slice()) };
}
function restoreMesh(mesh, snap) {
  mesh.nodeX = snap.nodeX.map(r => r.slice());
  mesh.nodeY = snap.nodeY.map(r => r.slice());
}

/**
 * Попытка захватить километровую линию под курсором:
 * ближайшая целая линия сетки в радиусе 0,12 квадрата (~14 px на скане).
 */
function tryStartLineEdit(e) {
  const cal = App.cal;
  if (!cal.mesh) { toast('Правка доступна после привязки сетки'); return false; }
  const img = App.vp.screenToImage(e.clientX, e.clientY);
  if (img.x < 0 || img.y < 0 || img.x > App.imgW || img.y > App.imgH) return false;
  const g = cal.pixelToGrid(img.x, img.y);
  if (!cal.insideGrid(g.X, g.Y)) return false;
  const dX = Math.abs(g.X - Math.round(g.X));   // до горизонтальной линии
  const dY = Math.abs(g.Y - Math.round(g.Y));   // до вертикальной линии
  if (Math.min(dX, dY) > 0.12) return false;
  const axis = dX <= dY ? 'X' : 'Y';
  const index = Math.round(axis === 'X' ? g.X : g.Y);
  lineEdit = {
    axis, index,
    at: axis === 'X' ? g.Y : g.X,
    startImg: img,
    snap: cloneMesh(cal.mesh)
  };
  meshUndoStack.push(lineEdit.snap);
  if (meshUndoStack.length > 20) meshUndoStack.shift();
  return true;
}

const MESH_KEY = () => `topomap.meshedit:${App.imageKey}`;

function saveMeshEdits() {
  try {
    const { mesh, meshX0, meshY0 } = App.cal;
    localStorage.setItem(MESH_KEY(), JSON.stringify({
      originX: meshX0, originY: meshY0, nodeX: mesh.nodeX, nodeY: mesh.nodeY
    }));
    App.hasMeshEdits = true;
  } catch (err) { console.warn('Не удалось сохранить правки сетки:', err); }
}

/** Загрузить правки меша; возвращает true, если были сохранённые правки. */
function loadMeshEdits() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(MESH_KEY()) || 'null'); } catch { /* игнор */ }
  if (!data) return false;
  const okDims = App.cal.mesh && Array.isArray(data.nodeX) && Array.isArray(data.nodeY) &&
    data.nodeX.length === App.cal.mesh.nodeX.length &&
    data.nodeX[0] && data.nodeX[0].length === App.cal.mesh.nodeX[0].length;
  if (!okDims) return false;
  return App.cal.setMesh(data);
}

/**
 * Инициализация базового меша: зафиксированное положение из js/gridmesh.js,
 * если файл есть, иначе — ровная аффинная сетка.
 */
function initBaseMesh() {
  if (typeof GRID_MESH !== 'undefined' && GRID_MESH && Array.isArray(GRID_MESH.nodeX)) {
    App.cal.setMesh(GRID_MESH);
  } else {
    App.cal.initMeshFromAffine(25, 44, 0, 27);
  }
}

function bindGridEditUI() {
  const updRadius = () => { $('geRadius').textContent = `${GE.radius} кв.`; };
  $('geRadMinus').addEventListener('click', () => { GE.radius = Math.max(0.5, GE.radius - 0.5); updRadius(); });
  $('geRadPlus').addEventListener('click', () => { GE.radius = Math.min(6, GE.radius + 0.5); updRadius(); });

  $('geUndo').addEventListener('click', () => {
    const snap = meshUndoStack.pop();
    if (!snap) { toast('Нечего отменять'); return; }
    restoreMesh(App.cal.mesh, snap);
    saveMeshEdits();
    updateCalibStatus();
    requestRender();
  });

  $('geReset').addEventListener('click', () => {
    if (!App.hasMeshEdits) { toast('Правок нет — сетка в базовом положении'); return; }
    if (confirm('Сбросить все незафиксированные правки и вернуть базовую сетку?')) {
      meshUndoStack.push(cloneMesh(App.cal.mesh));
      initBaseMesh();
      try { localStorage.removeItem(MESH_KEY()); } catch { /* игнор */ }
      App.hasMeshEdits = false;
      updateCalibStatus();
      requestRender();
      toast('Правки сброшены — сетка в базовом положении');
    }
  });

  // «Зафиксировать как базовую»: текущий меш → js/gridmesh.js через сервер
  $('geBake').addEventListener('click', async () => {
    if (!confirm('Сделать текущее положение сетки новым БАЗОВЫМ?\n\n' +
                 'Оно запишется в js/gridmesh.js, а правки из localStorage очистятся.')) return;
    try {
      const { mesh, meshX0, meshY0 } = App.cal;
      const resp = await fetch('/api/save-mesh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originX: meshX0, originY: meshY0, nodeX: mesh.nodeX, nodeY: mesh.nodeY })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));
      try { localStorage.removeItem(MESH_KEY()); } catch { /* игнор */ }
      App.hasMeshEdits = false;
      meshUndoStack = [];
      updateCalibStatus();
      toast(`Сетка зафиксирована как базовая (${data.nodes} узлов → js/gridmesh.js). Перезагрузите страницу`, 5200);
    } catch (err) {
      toast('Не удалось записать gridmesh.js: ' + err.message +
            '. Страница открыта через «npm run dev»?', 5200);
    }
  });
}

/* ─────────── Маркеры: UI ─────────── */

function showMarkerPop(m) {
  App.selectedMarker = m.id;
  const s = App.markers.screenPos(m);
  const el = $('markerPop');
  el.classList.remove('hidden');
  el.style.left = Math.min(window.innerWidth - 260, s.x + 16) + 'px';
  el.style.top = Math.min(window.innerHeight - 200, s.y - 10) + 'px';
  $('mpTitle').textContent = `${MARKER_TYPE_NAMES[m.type]} #${m.id}`;
  const mps = App.cal.metersPerSquare;
  $('mpCoords').textContent =
    `X: ${fmtCoord(m.X, mps)}  |  Y: ${fmtCoord(m.Y, mps)}   (кв. ${fmtSquareSnail(m.X, m.Y)})`;
  $('mpLabel').value = m.label;
  requestRender();
}

function hideMarkerPop() {
  $('markerPop').classList.add('hidden');
  if (App.selectedMarker !== null) {
    App.selectedMarker = null;
    requestRender();
  }
}

function bindMarkerUI() {
  $('markerTypes').querySelectorAll('.mtype').forEach(btn =>
    btn.addEventListener('click', () => {
      $('markerTypes').querySelectorAll('.mtype').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      App.markerType = btn.dataset.type;
    }));

  $('markerColors').querySelectorAll('.mcolor').forEach(btn =>
    btn.addEventListener('click', () => {
      $('markerColors').querySelectorAll('.mcolor').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      App.markerColor = btn.dataset.color;
    }));

  $('mpLabel').addEventListener('input', () => {
    const m = App.markers.byId(App.selectedMarker);
    if (m) { m.label = $('mpLabel').value; requestRender(); }
  });

  $('mpDelete').addEventListener('click', () => {
    App.markers.remove(App.selectedMarker);
    hideMarkerPop();
    requestRender();
  });

  $('mpClose').addEventListener('click', hideMarkerPop);

  $('mpDrag').addEventListener('click', () => {
    App.dragMarkerId = App.selectedMarker;
    App._returnMode = 'marker';
    hideMarkerPop();
    setMode('dragMarker');
    toast('Ведите курсор и кликните, чтобы поставить знак на новое место');
  });

  $('btnClearMarkers').addEventListener('click', () => {
    if (App.markers.markers.length === 0) return;
    if (confirm(`Удалить все знаки (${App.markers.markers.length} шт.)?`)) {
      App.markers.clear();
      hideMarkerPop();
      requestRender();
    }
  });

  // Экспорт в JSON-файл
  $('btnExportMarkers').addEventListener('click', () => {
    const payload = {
      app: 'topo-map-viewer', version: 1,
      savedAt: new Date().toISOString(),
      metersPerSquare: App.cal.metersPerSquare,
      markers: App.markers.toJSON()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    a.href = URL.createObjectURL(blob);
    a.download = `markers_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Экспортировано знаков: ${payload.markers.length}`);
  });

  // Импорт из JSON-файла
  $('btnImportMarkers').addEventListener('click', () => $('importInput').click());
  $('importInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const arr = Array.isArray(data) ? data : data.markers;
      if (!Array.isArray(arr)) throw new Error('в файле нет массива markers');
      App.markers.fromJSON(arr);
      requestRender();
      toast(`Импортировано знаков: ${App.markers.markers.length}`);
    } catch (err) {
      toast('Ошибка импорта: ' + err.message);
    }
  });
}

/* ─────────── Поиск: координаты и названия объектов ─────────── */

/**
 * Разбор строки поиска. Поддерживаемые форматы:
 *   «36-12» / «36 12» / «3612» — номер квадрата (X-Y)
 *   «41-01-6» / «41016»        — сектор «улитки» внутри квадрата (X-Y-S)
 *   «36400 12800»              — точные координаты: км·метры (X=36.400, Y=12.800)
 *   «3640012800»               — то же одним числом
 *   «X: 36.4 Y: 12.8»          — явная запись в квадратах (доля — доли квадрата)
 */
function parseSearch(str) {
  str = str.trim();
  let m;
  if (m = str.match(/x\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)\D{0,8}y\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)/i)) {
    return { type: 'point', X: parseFloat(m[1].replace(',', '.')), Y: parseFloat(m[2].replace(',', '.')) };
  }
  if (m = str.match(/(\d{4,5})\D+(\d{4,5})/)) {
    return { type: 'point', X: parseInt(m[1], 10) / 1000, Y: parseInt(m[2], 10) / 1000 };
  }
  if (m = str.match(/^(\d{10})$/)) {
    return { type: 'point', X: parseInt(m[1].slice(0, 5), 10) / 1000, Y: parseInt(m[1].slice(5), 10) / 1000 };
  }
  if (m = str.match(/^(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*[-–—]\s*([1-9])$/)) {
    return { type: 'snail', X: +m[1], Y: +m[2], S: +m[3] };
  }
  if (m = str.match(/^(\d{2})(\d{2})([1-9])$/)) {
    return { type: 'snail', X: +m[1], Y: +m[2], S: +m[3] };
  }
  if (m = str.match(/^(\d{2})(\d{2})$/)) {
    return { type: 'square', X: +m[1], Y: +m[2] };
  }
  if (m = str.match(/(\d{1,2})\s*[-–—\/\\.,\s]\s*(\d{1,2})/)) {
    return { type: 'square', X: +m[1], Y: +m[2] };
  }
  return null;
}

/** Нормализация строки для сравнения названий (ё→е, регистр, лишние пробелы). */
function normName(s) {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * Поиск объектов по названию (подстрока, без учёта регистра).
 * Ранжирование: точное совпадение → начинается с запроса → содержит запрос.
 * Внутри одного ранга — более «крупные» типы (нас. пункты, озёра, реки) выше высот.
 */
function findPlaces(query) {
  const q = normName(query);
  if (q.length < 2) return [];
  const TYPE_RANK = { 'нас. пункт': 0, 'озеро': 1, 'река': 2, 'дорога': 3, 'лес': 4, 'урочище': 5, 'высота': 6 };
  const scored = [];
  for (const p of PLACES) {
    const n = normName(p.name);
    let rank = -1;
    if (n === q) rank = 0;
    else if (n.startsWith(q)) rank = 1;
    else if (n.includes(q)) rank = 2;
    else continue;
    scored.push({ p, rank, trank: TYPE_RANK[p.type] ?? 9 });
  }
  scored.sort((a, b) => a.rank - b.rank || a.trank - b.trank || a.p.name.localeCompare(b.p.name, 'ru'));
  return scored.map(s => s.p);
}

/**
 * Центрировать вид на точке сетки и подсветить её.
 * viewSquares — сколько квадратов примерно помещается в кадр (зум).
 */
function gotoGridPoint(X, Y, highlight, viewSquares = 3) {
  const cal = App.cal;
  const px = cal.gridToPixel(X, Y);
  const pps = cal.pixelsPerSquare();
  let scale = App.vp.scale;
  if (pps > 0) scale = (Math.min(App.vp.w, App.vp.h) * 0.7) / (viewSquares * pps);
  App.vp.centerOnImage(px.x, px.y, scale);
  App.highlight = { ...highlight, until: performance.now() + 4000 };
  updateStatus();
  requestRender();
}

/** Переход к именованному объекту с сообщением о квадрате и секторе «улитки». */
function gotoPlace(place) {
  gotoGridPoint(place.X, place.Y, { kind: 'point', X: place.X, Y: place.Y });
  toast(`${place.name} · ${place.type} · квадрат ${fmtSquareSnail(place.X, place.Y)}`, 4000);
}

/* ── Дубликаты названий: группировка, «якоря», уточнение квадратом ── */

/** Русская плюрализация: plural(5, 'точка', 'точки', 'точек') → 'точек'. */
function plural(n, one, few, many) {
  const m = Math.abs(n) % 100, d = m % 10;
  if (m > 10 && m < 20) return many;
  if (d > 1 && d < 5) return few;
  if (d === 1) return one;
  return many;
}

/**
 * Группировка результатов по имени+типу: 13 высот «166» превращаются
 * в одну группу { name, type, places[13] }. Порядок групп — по первому
 * вхождению (сохраняет ранжирование findPlaces). Внутри группы точки
 * сортируются «как читают карту»: с севера на юг (X ↓), затем с запада
 * на восток (Y ↑) — номера в списке совпадают с номерами колец на карте.
 */
function groupMatches(matches) {
  const groups = [], byKey = new Map();
  for (const p of matches) {
    const key = normName(p.name) + '|' + p.type;
    let g = byKey.get(key);
    if (!g) { g = { name: p.name, type: p.type, places: [] }; byKey.set(key, g); groups.push(g); }
    g.places.push(p);
  }
  for (const g of groups) g.places.sort((a, b) => b.X - a.X || a.Y - b.Y);
  return groups;
}

/** Кэш именованных объектов (всё, кроме безымянных высот) для «якорей». */
let _namedPlaces = null;
function namedPlaces() {
  if (!_namedPlaces) _namedPlaces = PLACES.filter(p => p.type !== 'высота');
  return _namedPlaces;
}

/**
 * Ближайший именованный объект в радиусе maxD квадратов (= км).
 * Служит человекочитаемым «якорем» в списке: «166 — кв. 38-02 · рядом: Келли».
 */
function nearestAnchor(p, maxD = 2.5) {
  let best = null, bd = maxD;
  for (const n of namedPlaces()) {
    const d = Math.hypot(n.X - p.X, n.Y - p.Y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

/**
 * Разбор уточняющего запроса «название + квадрат»:
 *   «166 38-02» → { name:'166', sqX:38, sqY:2 }
 *   «166 38»    → { name:'166', sqX:38, sqY:null }  (вся колонка квадратов X=38)
 * Чистый квадрат («36-12», «36 12») сюда не попадает — нет имени.
 */
function parsePlaceSquareQuery(q) {
  const m = q.trim().match(/^(.+?)\s+(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?$/);
  if (!m) return null;
  return { name: m[1], sqX: +m[2], sqY: m[3] !== undefined ? +m[3] : null };
}

/** Попадает ли объект в уточнённый квадрат/колонку. */
function squareMatch(p, psq) {
  return Math.floor(p.X) === psq.sqX && (psq.sqY === null || Math.floor(p.Y) === psq.sqY);
}

/**
 * Показать все точки группы разом: вписываем их bounding-box в окно
 * и подсвечиваем пронумерованными кольцами (нумерация = порядок в списке).
 */
function gotoPlaceGroup(group) {
  const cal = App.cal;
  const pts = group.places.map(p => cal.gridToPixel(p.X, p.Y));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const pps = cal.pixelsPerSquare();
  const pad = pps * 1.2 || 120;                        // поля вокруг крайних точек
  const w = Math.max(maxX - minX, 1) + 2 * pad;
  const h = Math.max(maxY - minY, 1) + 2 * pad;
  let scale = Math.min(App.vp.w / w, App.vp.h / h) * 0.92;
  if (pps > 0) {                                        // не ближе, чем вид одиночной точки
    scale = Math.min(scale, (Math.min(App.vp.w, App.vp.h) * 0.7) / (3 * pps));
  }
  App.vp.centerOnImage((minX + maxX) / 2, (minY + maxY) / 2, scale);
  App.highlight = {
    kind: 'points',
    pts: group.places.map(p => ({ X: p.X, Y: p.Y })),
    until: performance.now() + 6500
  };
  updateStatus();
  requestRender();
  const n = group.places.length;
  const example = `${group.name} ${fmtSquare(group.places[0].X, group.places[0].Y)}`;
  toast(`${group.name} · ${group.type} · ${n} ${plural(n, 'точка', 'точки', 'точек')} на карте — ` +
        `выберите в списке или уточните квадратом, напр. «${example}»`, 5200);
}

/* ── Выпадающий список результатов поиска по названиям ── */

let expandedGroupKey = null;   // ключ раскрытой группы дубликатов (или null)

function hideSearchResults() {
  $('searchResults').classList.add('hidden');
}

/** Одна строка-результат (одиночный объект). */
function buildPlaceRow(p) {
  const item = document.createElement('div');
  item.className = 'sr-item';
  const name = document.createElement('span');
  name.className = 'sr-name';
  name.textContent = p.name;
  const meta = document.createElement('span');
  meta.className = 'sr-meta';
  meta.textContent = `${p.type} · ${fmtSquareSnail(p.X, p.Y)}`;
  item.append(name, meta);
  item.addEventListener('mousedown', e => {
    e.preventDefault();
    hideSearchResults();
    $('searchInput').value = p.name;
    gotoPlace(p);
  });
  return item;
}

function renderSearchResults(matches) {
  const box = $('searchResults');
  if (matches.length === 0) { hideSearchResults(); return; }
  box.innerHTML = '';
  const groups = groupMatches(matches);
  const MAX_ROWS = 9;
  let rows = 0, shown = 0;

  for (const g of groups) {
    if (rows >= MAX_ROWS) break;
    if (g.places.length === 1) {
      box.appendChild(buildPlaceRow(g.places[0]));
    } else {
      const key = normName(g.name) + '|' + g.type;
      const expanded = expandedGroupKey === key;

      // Заголовок группы: «166 … высота · 13 точек ▸»
      const head = document.createElement('div');
      head.className = 'sr-item sr-group';
      const name = document.createElement('span');
      name.className = 'sr-name';
      name.textContent = g.name;
      const meta = document.createElement('span');
      meta.className = 'sr-meta';
      meta.textContent = `${g.type} · ${g.places.length} ` +
        `${plural(g.places.length, 'точка', 'точки', 'точек')} ${expanded ? '▾' : '▸'}`;
      head.append(name, meta);
      head.addEventListener('mousedown', e => {
        e.preventDefault();
        expandedGroupKey = expanded ? null : key;
        $('searchInput').value = g.name;
        gotoPlaceGroup(g);                 // все точки на карте разом
        renderSearchResults(matches);      // раскрыть/свернуть подсписок, список не прячем
      });
      box.appendChild(head);

      // Подсписок: «1. квадрат 38-02 · рядом: Келли»
      if (expanded) {
        g.places.forEach((p, i) => {
          const sub = document.createElement('div');
          sub.className = 'sr-item sr-sub';
          const nm = document.createElement('span');
          nm.className = 'sr-name';
          nm.textContent = `${i + 1}. квадрат ${fmtSquareSnail(p.X, p.Y)}`;
          const meta2 = document.createElement('span');
          meta2.className = 'sr-meta';
          const anchor = nearestAnchor(p);
          meta2.textContent = anchor ? `рядом: ${anchor.name}` : '';
          sub.append(nm, meta2);
          sub.addEventListener('mousedown', e => {
            e.preventDefault();
            hideSearchResults();
            $('searchInput').value = `${g.name} ${fmtSquare(p.X, p.Y)}`;
            gotoPlace(p);
          });
          box.appendChild(sub);
        });
      }
    }
    rows++;
    shown += g.places.length;
  }

  if (shown < matches.length) {
    const more = document.createElement('div');
    more.className = 'sr-more';
    more.textContent = `…ещё ${matches.length - shown}, уточните запрос (напр. «название 38-02»)`;
    box.appendChild(more);
  }
  box.classList.remove('hidden');
}

function doSearch() {
  const q = $('searchInput').value;

  // 0) «Название + квадрат»: «166 38-02», «166 38» — снимает неоднозначность дубликатов
  const psq = parsePlaceSquareQuery(q);
  if (psq) {
    const filtered = findPlaces(psq.name).filter(p => squareMatch(p, psq));
    if (filtered.length > 0) {
      expandedGroupKey = null;
      if (filtered.length === 1) {
        hideSearchResults();
        gotoPlace(filtered[0]);
      } else {
        renderSearchResults(filtered);
        gotoPlace(filtered[0]);
      }
      return;
    }
    // пусто — возможно, это обычные координаты («36 12»): проваливаемся дальше
  }

  // 1) Форматы координат / квадратов / секторов «улитки»
  const res = parseSearch(q);
  if (res) {
    hideSearchResults();
    const cal = App.cal;
    if (!cal.isReady) { toast('Сетка не привязана'); return; }
    if (!cal.insideGrid(res.X, res.Y)) { toast('Координаты вне привязанной сетки'); return; }
    if (res.type === 'snail') {
      const sb = snailSectorBounds(res.X, res.Y, res.S);
      gotoGridPoint(sb.cx, sb.cy, { kind: 'snail', X: res.X, Y: res.Y, S: res.S }, 1.6);
      return;
    }
    const tX = res.type === 'square' ? res.X + 0.5 : res.X;
    const tY = res.type === 'square' ? res.Y + 0.5 : res.Y;
    gotoGridPoint(tX, tY, { kind: res.type === 'square' ? 'square' : 'point', X: res.X, Y: res.Y });
    return;
  }

  // 2) Названия объектов карты
  const matches = findPlaces(q);
  if (matches.length === 0) {
    hideSearchResults();
    toast('Не найдено. Примеры: 36-12 · 36400 12800 · Келли · оз. Киш · 166 38-02');
    return;
  }
  expandedGroupKey = null;
  const groups = groupMatches(matches);
  // Точное совпадение имени с группой дубликатов → показываем все точки разом
  const qn = normName(q);
  const exact = groups.find(g => normName(g.name) === qn && g.places.length > 1);
  if (exact) {
    expandedGroupKey = normName(exact.name) + '|' + exact.type;
    renderSearchResults(matches);
    gotoPlaceGroup(exact);
    return;
  }
  if (matches.length > 1) renderSearchResults(matches); // покажем варианты, а к первому уже переходим
  else hideSearchResults();
  gotoPlace(matches[0]);
}

/* ─────────── Инициализация ─────────── */

/**
 * Встроенная карта листа У-57 (лежит рядом с index.html).
 * Фиксированная геопривязка, измеренная по линиям сетки скана
 * (нумерация сверена с подписями на полях карты):
 *   • вертикальные линии (абсциссы Y): номера 00…27, шаг 114.25 px,
 *     линия «00» проходит по px = 53.5, «27» — по px = 3138.25;
 *   • горизонтальные линии (ординаты X): номера 44…25 (убывают к югу/вниз),
 *     шаг 114.06 px, линия «44» проходит по py = 62, «25» — по py = 2229;
 *   • масштаб сетки: 1 квадрат = 1000 м (карта 1:25 000).
 * Ручная калибровка не требуется — сетка привязана жёстко.
 */
const BUILTIN_MAP_URL = 'Component 1.png';
const FIXED_GRID = {
  Y_FIRST: 0,  PX_FIRST: 53.5, STEP_X: 114.25, // px = PX_FIRST + (Y − Y_FIRST)·STEP_X
  X_FIRST: 44, PY_FIRST: 62,   STEP_Y: 114.06  // py = PY_FIRST + (X_FIRST − X)·STEP_Y
};

/** Применить жёсткую привязку: 4 угловые точки → аффинное преобразование. */
function applyFixedGrid() {
  const g = FIXED_GRID;
  const px = Y => g.PX_FIRST + (Y - g.Y_FIRST) * g.STEP_X;
  const py = X => g.PY_FIRST + (g.X_FIRST - X) * g.STEP_Y;
  App.cal.clear();
  for (const [X, Y] of [[25, 0], [25, 27], [44, 0], [44, 27]]) {
    App.cal.addPoint(px(Y), py(X), X, Y);
  }
  App.cal.metersPerSquare = 1000;
  App.cal.solve();
}

/** Загрузка встроенной карты из папки проекта (работает через dev-сервер). */
async function loadBuiltinMap() {
  const resp = await fetch(encodeURI(BUILTIN_MAP_URL));
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const blob = await resp.blob();
  const bmp = await createImageBitmap(blob);
  App.bitmap = bmp;
  App.imgW = bmp.width;
  App.imgH = bmp.height;
  App.imageKey = 'builtin:' + BUILTIN_MAP_URL;
  applyFixedGrid();
}

function init() {
  App.canvas = $('map');
  App.ctx = App.canvas.getContext('2d');
  App.vp = new Viewport(App.canvas);
  App.cal = new Calibration();
  App.ruler = new Ruler(App.cal, App.vp);
  App.markers = new MarkerStore(App.cal, App.vp);

  // Кнопки панели инструментов
  $('btnPan').addEventListener('click', () => setMode('pan'));
  $('btnRuler').addEventListener('click', () => {
    if (!App.cal.isReady) { toast('Сетка не привязана'); return; }
    setMode('ruler');
  });
  $('btnMarker').addEventListener('click', () => {
    if (!App.cal.isReady) { toast('Сетка не привязана'); return; }
    setMode(App.mode === 'marker' ? 'pan' : 'marker');
  });
  $('btnFit').addEventListener('click', () => { App.vp.fit(App.imgW, App.imgH); requestRender(); });
  $('btnGrid').addEventListener('click', () => {
    App.showGrid = !App.showGrid;
    $('btnGrid').classList.toggle('active', App.showGrid);
    requestRender();
  });
  $('btnGridEdit').addEventListener('click', () => {
    if (!App.cal.isReady) { toast('Сетка не привязана'); return; }
    const on = App.mode !== 'gridEdit';
    setMode(on ? 'gridEdit' : 'pan');
    if (on) {
      // В правке сетка нужна на виду — включаем оверлей принудительно
      if (!App.showGrid) {
        App.showGrid = true;
        $('btnGrid').classList.add('active');
      }
      toast('Потяните красную километровую линию — она изогнётся под скан. Радиус изгиба — в панели слева', 4600);
      requestRender();
    }
  });
  $('btnRulerClear').addEventListener('click', () => {
    App.ruler.clear();
    updateRulerInfo(null);
    updateRulerPanel();
    requestRender();
  });
  $('btnSearch').addEventListener('click', doSearch);
  // Живые подсказки названий по мере ввода (включая «название + квадрат»)
  $('searchInput').addEventListener('input', () => {
    const v = $('searchInput').value;
    expandedGroupKey = null;
    const psq = parsePlaceSquareQuery(v);
    if (psq) {
      const filtered = findPlaces(psq.name).filter(p => squareMatch(p, psq));
      if (filtered.length) { renderSearchResults(filtered); return; }
    }
    if (parseSearch(v)) { hideSearchResults(); return; }
    renderSearchResults(findPlaces(v));
  });
  $('searchInput').addEventListener('blur', () => {
    // задержка, чтобы успел сработать mousedown по пункту списка
    setTimeout(hideSearchResults, 150);
  });

  bindEvents();
  bindMarkerUI();
  bindGridEditUI();

  setMode('pan');
  updateStatus();

  // Основная карта: загружаем «Component 1.png» из папки проекта
  // и применяем жёсткую привязку сетки — никакой ручной калибровки.
  loadBuiltinMap()
    .then(() => {
      App.vp.fit(App.imgW, App.imgH);
      // Деформируемый меш для правки линий: база из js/gridmesh.js
      // (зафиксированное положение) или ровная аффинная сетка,
      // затем подхват незафиксированных правок (localStorage)
      initBaseMesh();
      App.hasMeshEdits = loadMeshEdits();
      updateCalibStatus();
      requestRender();
      toast('Карта загружена, сетка привязана (квадрат ≈114 px = 1000 м)' +
            (App.hasMeshEdits ? ' · применены ваши правки линий ✔' : ' ✔'), 4200);
    })
    .catch(err => {
      // Фолбэк: файл недоступен (например, открыли index.html без сервера)
      console.warn('Встроенная карта не загрузилась:', err);
      App.bitmap = generateDemoMap();
      App.imgW = App.bitmap.width;
      App.imgH = App.bitmap.height;
      App.imageKey = 'demo';
      for (const p of demoCalibrationPoints()) App.cal.addPoint(p.px, p.py, p.X, p.Y);
      App.cal.metersPerSquare = 1000;
      App.cal.solve();
      App.vp.fit(App.imgW, App.imgH);
      updateCalibStatus();
      requestRender();
      toast('Не удалось открыть «Component 1.png» (' + err.message + '). ' +
            'Запустите приложение через «npm run dev» или загрузите карту кнопкой «🗺 Карта»', 6000);
    });
}

init();
