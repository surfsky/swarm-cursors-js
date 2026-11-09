/*!
 * Swarm Cursors — 把页面快照成蓝图，再让一群多人协作光标把它重建出来。
 *
 * https://github.com/surfsky/swarm-cursors-js
 * https://surfsky.github.io/swarm-cursors-js
 * 零依赖 ESM。灵感与动效语言来自 Joel Califa 的 Swarm（https://califa.github.io/swarm-site/）
 * 与 DhvanilPatel 的 swarm-cursors 扩展；本实现为独立编写，只借用「光标群重建页面」这一构思。
 *
 *   const swarm = new SwarmCursors({ target: '#site' });
 *   swarm.play();                        // 快照 → 擦空 → 重建
 *   swarm.replay();                      // 再建一遍
 *   swarm.stop();                        // 还原真实页面
 *
 * 事件：ready / start / progress / done
 */

/* ============================================================ 常量与工具 */

const DEFAULT_PALETTE = [
  '#0D99FF', '#FF5A5F', '#14AE5C', '#9747FF',
  '#FFA629', '#0FB5BA', '#E8453C', '#6E56CF',
];

const DEFAULT_NAMES = ['Ava', 'Ben', 'Cora', 'Dev', 'Elio', 'Finn', 'Gia', 'Hugo', 'Iris', 'Jae', 'Kai', 'Lia'];

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'TITLE', 'BASE', 'BR', 'WBR',
]);

const ROW_HEIGHT = 96;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function px(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function isTransparent(color) {
  return !color || color === 'transparent' || /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(color);
}

function hasPaint(st) {
  return (
    !isTransparent(st.backgroundColor) ||
    st.backgroundImage !== 'none' ||
    st.boxShadow !== 'none' ||
    px(st.borderTopWidth) + px(st.borderRightWidth) + px(st.borderBottomWidth) + px(st.borderLeftWidth) > 0
  );
}

const INLINE_DISPLAY = /^(inline|contents|ruby)/;

/* ============================================================ 光标 */

class Cursor {
  constructor(index, color, name, layer, scale) {
    this.index = index;
    this.color = color;
    this.name = name;
    this.x = 0;
    this.y = 0;
    this.tx = 0;
    this.ty = 0;
    this.task = null;
    this.wobble = Math.random() * Math.PI * 2;

    const el = document.createElement('div');
    el.className = 'sw-cursor';
    el.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3.6 1.9 3.6 20.1 8.9 15.2 11.9 22.2 14.6 21 11.7 14.2 18.9 13.9Z"/>' +
      '</svg><span class="sw-name"></span>';
    el.querySelector('path').setAttribute('fill', color);
    el.querySelector('.sw-name').textContent = name;
    el.querySelector('.sw-name').style.background = color;
    el.style.transform = `translate3d(${0}px,${0}px,0) scale(${scale})`;
    this.el = el;
    layer.appendChild(el);
  }

  seek(x, y) {
    this.tx = x;
    this.ty = y;
  }

  update(dt, others, mouse) {
    // 分离力：避免几个光标叠在同一个点
    let pushX = 0;
    let pushY = 0;
    for (const o of others) {
      if (o === this) continue;
      const dx = this.x - o.x;
      const dy = this.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d < 120 && d > 0.001) {
        const f = (120 - d) / 120;
        pushX += (dx / d) * f * 46;
        pushY += (dy / d) * f * 46;
      }
    }

    // 鼠标附近轻微避让，像真实协作者
    if (mouse && mouse.inside) {
      const dx = this.x - mouse.x;
      const dy = this.y - mouse.y;
      const d = Math.hypot(dx, dy);
      if (d < 90 && d > 0.001) {
        pushX += (dx / d) * (90 - d) * 0.8;
        pushY += (dy / d) * (90 - d) * 0.8;
      }
    }

    this.wobble += dt * (this.task ? 1.4 : 2.2);
    const wx = Math.cos(this.wobble) * (this.task ? 0.6 : 2.4);
    const wy = Math.sin(this.wobble * 1.3) * (this.task ? 0.6 : 2.2);

    const goalX = this.tx + pushX + wx;
    const goalY = this.ty + pushY + wy;

    // 指数趋近，天然带一点缓动尾巴
    const k = 1 - Math.exp(-dt * (this.task ? 9 : 5));
    this.x += (goalX - this.x) * k;
    this.y += (goalY - this.y) * k;

    this.el.style.transform = `translate3d(${this.x.toFixed(2)}px,${this.y.toFixed(2)}px,0)`;
  }

  press() {
    const r = document.createElement('span');
    r.className = 'sw-ring';
    r.style.left = `${this.x}px`;
    r.style.top = `${this.y}px`;
    r.style.borderColor = this.color;
    this.el.parentNode.appendChild(r);
    setTimeout(() => r.remove(), 520);
  }
}

/* ============================================================ 声音（可关） */

class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this._ensure();
  }

  _ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) {
      this.ctx = null;
    }
  }

  blip({ freq = 1400, dur = 0.02, gain = 0.08, type = 'square', pan = 0 }) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    let node = osc;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(clamp(pan, -1, 1), now);
      node.connect(p);
      node = p;
    }
    node.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  key(pan) {
    this.blip({ freq: 2400, dur: 0.012, gain: 0.05, type: 'square', pan });
    this.blip({ freq: 420, dur: 0.02, gain: 0.04, type: 'triangle', pan });
  }

  click(pan) {
    this.blip({ freq: 900, dur: 0.028, gain: 0.09, type: 'triangle', pan });
  }

  snap(pan) {
    this.blip({ freq: 1700, dur: 0.02, gain: 0.06, type: 'square', pan });
    this.blip({ freq: 900, dur: 0.03, gain: 0.05, type: 'triangle', pan });
  }
}

/* ============================================================ 快照 */

/**
 * 把 root 快照成一份可重建的蓝图。
 * 坐标系：root 的 padding box 左上角为原点。
 */
function snapshot(root) {
  const items = [];
  const consumed = new Set(); // 已被上层文本吃掉的 inline 元素
  const rootRect = root.getBoundingClientRect();
  const rootStyle = getComputedStyle(root);
  const ox = rootRect.left + px(rootStyle.borderLeftWidth);
  const oy = rootRect.top + px(rootStyle.borderTopWidth);

  let maxRight = rootRect.width;
  let maxBottom = rootRect.height;

  let activeEl = null; // 当前正在遍历的元素，push 时记下来用于副本分组
  const push = (item) => {
    item.elSrc = activeEl;
    item.id = items.length;
    item.status = 'todo';
    items.push(item);
    maxRight = Math.max(maxRight, item.x + item.w);
    maxBottom = Math.max(maxBottom, item.y + item.h);
    return item.id;
  };

  /* ---- 文本收集：支持同一段里多种内联样式（颜色/字重） ---- */
  function harvestText(el, style, depth = 0) {
    const runs = [];
    let touched = false;

    const add = (text, st) => {
      if (!text) return;
      if (text.trim()) touched = true;
      const last = runs[runs.length - 1];
      if (last && last.color === st.color && last.weight === st.fontWeight && last.italic === st.fontStyle) {
        last.text += text;
      } else {
        runs.push({ text, color: st.color, weight: st.fontWeight, italic: st.fontStyle });
      }
    };

    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        add(node.textContent, style);
      } else if (node.nodeType === 1) {
        const tag = node.tagName;
        if (tag === 'BR') {
          add('\n', style);
          continue;
        }
        if (SKIP_TAGS.has(tag) || depth > 6) continue;
        const st = getComputedStyle(node);
        const inlineLike = INLINE_DISPLAY.test(st.display) && !hasPaint(st);
        if (inlineLike) {
          consumed.add(node);
          const sub = harvestText(node, st, depth + 1);
          sub.runs.forEach((r) => add(r.text, { ...st, color: r.color, fontWeight: r.weight, fontStyle: r.italic }));
        }
      }
    }

    return { runs, touched };
  }

  function normalizeRuns(runs, preserve) {
    if (preserve) {
      return { text: runs.map((r) => r.text).join(''), runs };
    }
    const cleaned = runs.map((r) => ({
      ...r,
      text: r.text
        .replace(/[\t\r]+/g, ' ')
        .replace(/ {2,}/g, ' ')
        .replace(/ *\n */g, '\n'),
    }));
    // 去掉整体首尾空白（保留手动换行）
    if (cleaned.length) {
      cleaned[0] = { ...cleaned[0], text: cleaned[0].text.replace(/^[ \n]+/, '') };
      const last = cleaned.length - 1;
      cleaned[last] = { ...cleaned[last], text: cleaned[last].text.replace(/[ \n]+$/, '') };
    }
    const kept = cleaned.filter((r) => r.text.length > 0);
    const text = kept.map((r) => r.text).join('');
    // 合并同款式的相邻片段
    const merged = [];
    for (const r of kept) {
      const prev = merged[merged.length - 1];
      if (prev && prev.color === r.color && prev.weight === r.weight && prev.italic === r.italic) {
        prev.text += r.text;
      } else {
        merged.push({ ...r });
      }
    }
    return { text, runs: merged };
  }

  function measureStyle(st) {
    const lh = st.lineHeight === 'normal' ? px(st.fontSize) * 1.35 : px(st.lineHeight);
    return {
      fontFamily: st.fontFamily,
      fontSize: px(st.fontSize),
      fontWeight: st.fontWeight,
      fontStyle: st.fontStyle,
      lineHeight: lh,
      letterSpacing: st.letterSpacing === 'normal' ? '0px' : st.letterSpacing,
      color: st.color,
      textAlign: st.textAlign === 'start' ? 'left' : st.textAlign,
      whiteSpace: st.whiteSpace,
      decoration: st.textDecorationLine === 'none' ? '' : st.textDecorationLine,
      textTransform: st.textTransform,
    };
  }

  function walk(el, depth) {
    if (depth > 40) return;
    const prevActive = activeEl;
    activeEl = el;
    const tag = el.tagName;
    if (SKIP_TAGS.has(tag)) return;
    if (consumed.has(el)) return;
    if (el.nodeType !== 1) return;

    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || px(st.opacity) === 0) return;

    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    if (rect.bottom < rootRect.top - 40 || rect.top > rootRect.top + rootRect.height * 4) return;

    const x = Math.round(rect.left - ox);
    const y = Math.round(rect.top - oy);
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);

    /* ---- 媒体 ---- */
    if (tag === 'IMG') {
      const src = el.currentSrc || el.src;
      push({
        type: 'media',
        kind: 'img',
        x, y, w, h,
        src,
        fit: st.objectFit || 'fill',
        radius: st.borderRadius,
        elTag: tag,
      });
      return;
    }
    if (tag === 'SVG' || tag === 'svg') {
      push({ type: 'media', kind: 'svg', x, y, w, h, markup: el.outerHTML, elTag: tag });
      return;
    }
    if (tag === 'VIDEO') {
      push({ type: 'media', kind: 'video', x, y, w, h, poster: el.poster || '', src: el.currentSrc || '', elTag: tag });
      return;
    }
    if (tag === 'CANVAS') {
      let data = '';
      try { data = el.toDataURL('image/png'); } catch (e) { data = ''; }
      push({ type: data ? 'media' : 'rect', kind: 'canvas', x, y, w, h, src: data, fill: '#D9DBDE', radius: '0px', elTag: tag });
      return;
    }
    if (tag === 'IFRAME') {
      push({ type: 'rect', x, y, w, h, fill: '#E3E5E8', radius: '2px', elTag: tag, label: 'iframe' });
      return;
    }

    /* ---- 盒子 ---- */
    const bwTop = px(st.borderTopWidth);
    const bwRight = px(st.borderRightWidth);
    const bwBottom = px(st.borderBottomWidth);
    const bwLeft = px(st.borderLeftWidth);
    const borders = [bwTop, bwRight, bwBottom, bwLeft];
    const bMax = Math.max(...borders);
    const bMin = Math.min(...borders);
    const uniform = bMax > 0 && bMax === bMin;
    const painted = hasPaint(st) && !tag.startsWith('SVG');

    if (painted) {
      push({
        type: 'rect',
        x, y, w, h,
        fill: isTransparent(st.backgroundColor) ? '' : st.backgroundColor,
        bgImage: st.backgroundImage === 'none' ? '' : st.backgroundImage,
        bgSize: st.backgroundSize,
        bgPosition: st.backgroundPosition,
        bgRepeat: st.backgroundRepeat,
        border: uniform ? `${bMax}px ${st.borderTopStyle} ${st.borderTopColor}` : '',
        radius: st.borderRadius === '0px' ? '' : st.borderRadius,
        shadow: st.boxShadow === 'none' ? '' : st.boxShadow,
        opacity: px(st.opacity),
        elTag: tag,
      });

      // 单边 / 部分边框 → 用钢笔线
      if (bMax > 0 && !uniform) {
        if (bwTop > 0) push({ type: 'line', x, y: y + 0, w, h: bwTop, color: st.borderTopColor, elTag: tag });
        if (bwBottom > 0) push({ type: 'line', x, y: y + h - bwBottom, w, h: bwBottom, color: st.borderBottomColor, elTag: tag });
        if (bwLeft > 0) push({ type: 'line', x, y, w: bwLeft, h, color: st.borderLeftColor, elTag: tag });
        if (bwRight > 0) push({ type: 'line', x: x + w - bwRight, y, w: bwRight, h, color: st.borderRightColor, elTag: tag });
      }
    }

    /* ---- 文字 ---- */
    if (!tag.startsWith('SVG')) {
      const preserve = tag === 'PRE' || /mono/i.test(st.fontFamily);
      const harvested = harvestText(el, st, 0);
      if (harvested.touched) {
        const normalized = normalizeRuns(harvested.runs, preserve);
        if (normalized.text.trim() || normalized.text === ' ') {
          const base = measureStyle(st);
          const contentW = w - px(st.paddingLeft) - px(st.paddingRight);
          let fitsOneLine = false;
          if (normalized.text.indexOf('\n') === -1) {
            if (!snapshot._mctx) snapshot._mctx = document.createElement('canvas').getContext('2d');
            const mctx = snapshot._mctx;
            mctx.font = `${base.fontStyle} ${base.fontWeight} ${base.fontSize}px ${base.fontFamily}`;
            fitsOneLine = mctx.measureText(normalized.text).width <= Math.max(8, contentW) + 12;
          }
          push({
            type: 'text',
            x, y, w, h,
            runs: normalized.runs,
            flat: normalized.text,
            base,
            singleLine: fitsOneLine || h <= base.lineHeight * 1.45,
            pl: px(st.paddingLeft),
            pt: px(st.paddingTop),
            pr: px(st.paddingRight),
            pb: px(st.paddingBottom),
            elTag: tag,
          });
        }
      }
    }

    /* ---- 递归 ---- */
    for (const child of Array.from(el.children)) walk(child, depth + 1);
    activeEl = prevActive;
  }

  for (const child of Array.from(root.children)) walk(child, 1);

  /* ---- 重复元素识别（卡片 / 导航项 / 列表行） ---- */
  const groups = new Map();
  // 同一父元素下的同尺寸同类兄弟才算一组，避免跨区域误判成副本
  const parentIds = new WeakMap();
  let parentSeq = 0;
  const pidOf = (el) => {
    const p = el && el.parentElement;
    if (!p) return -1;
    if (!parentIds.has(p)) parentIds.set(p, parentSeq++);
    return parentIds.get(p);
  };
  for (const it of items) {
    if (it.type === 'text' || !it.elTag) continue;
    const key = [pidOf(it.elSrc), it.type, it.elTag, Math.round(it.w / 4), Math.round(it.h / 4)].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    for (let i = 1; i < list.length; i += 1) {
      list[i].dupOf = list[0].id;
      list[i].status = 'todo';
    }
  }

  return { width: Math.max(rootRect.width, maxRight), height: Math.max(rootRect.height, maxBottom), items };
}

/* ============================================================ 主类 */

const SHADOW_CSS = `
  .sw-layer { position: absolute; left: 0; top: 0; }
  .sw-item { position: absolute; box-sizing: border-box; pointer-events: none; }
  .sw-text { position: absolute; box-sizing: border-box; margin: 0; padding: 0; overflow: visible;
             white-space: pre-wrap; word-break: break-word; pointer-events: none; }
  .sw-ghost { position: absolute; box-sizing: border-box; pointer-events: none;
              border: 1px solid rgba(13,153,255,.9); background: rgba(13,153,255,.07); }
  .sw-badge { position: absolute; pointer-events: none; white-space: nowrap;
              font: 500 10px/1.5 "SF Mono", ui-monospace, Menlo, monospace;
              color: #fff; background: #0D99FF; padding: 1px 5px 2px; border-radius: 2px;
              transform: translate(-50%, -130%); letter-spacing: .02em; }
  .sw-badge.is-dup { background: #E8453C; }
  .sw-caret { position: absolute; width: 1.5px; border-radius: 1px; pointer-events: none;
              animation: sw-blink 1s steps(1, end) infinite; }
  .sw-cursor { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; }
  .sw-cursor svg { width: 17px; height: 17px; display: block; filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.22)); }
  .sw-cursor .sw-name { position: absolute; left: 13px; top: 13px; padding: 2px 6px 3px; border-radius: 3px;
                        font: 600 10px/1 "PingFang SC", system-ui, sans-serif; color: #fff; white-space: nowrap;
                        letter-spacing: .02em; }
  .sw-ring { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%;
             border: 1.5px solid #0D99FF; opacity: .8; pointer-events: none;
             animation: sw-ripple .5s ease-out forwards; }
  .sw-measure { position: absolute; background: #E8453C; pointer-events: none; }
  @keyframes sw-blink { 0%,50% { opacity: 1 } 50.01%,100% { opacity: 0 } }
  @keyframes sw-ripple { from { transform: scale(.3); opacity: .9 } to { transform: scale(2.6); opacity: 0 } }
`;

export class SwarmCursors {
  constructor(options = {}) {
    const opts = {
      target: null,
      background: '#F1F2F3',
      cursors: 8,
      speed: 1,
      sound: false,
      palette: DEFAULT_PALETTE,
      names: DEFAULT_NAMES,
      scale: 1,
      force: false,
      restoreOnFinish: false,
      restoreDelay: 900,
      startOnLoad: false,
      showControlPanel: false,
      ...options,
    };
    this.opts = opts;
    this.root = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target || document.body;

    this.state = 'idle';
    this.speed = opts.speed;
    this.cursors = [];
    this.tasks = [];
    this.rowList = [];
    this.rowIndex = 0;
    this.mouse = { x: -9999, y: -9999, inside: false };
    this._listeners = new Map();
    this.sound = new Sound();

    this._tickBound = this._tick.bind(this);
    this._onPointer = this._onPointer.bind(this);

    // 创建即开演：等 DOM 就绪后自动 play()
    if (opts.startOnLoad) {
      const kick = () => setTimeout(() => {
        if (this.state === 'idle') this.play();
      }, 0);
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', kick, { once: true });
      } else {
        kick();
      }
    }
  }

  /* ---------------------------------------------------------- 公共 API */

  on(name, fn) {
    if (!this._listeners.has(name)) this._listeners.set(name, []);
    this._listeners.get(name).push(fn);
    return this;
  }

  emit(name, payload) {
    const list = this._listeners.get(name);
    if (list) list.forEach((fn) => fn(payload));
    if (this.opts[`on${name[0].toUpperCase()}${name.slice(1)}`]) {
      this.opts[`on${name[0].toUpperCase()}${name.slice(1)}`](payload);
    }
  }

  setSpeed(v) {
    this.speed = clamp(Number(v) || 1, 0.25, 4);
    return this;
  }

  setSound(on) {
    this.sound.setEnabled(!!on);
    return this;
  }

  async play() {
    if (this.state === 'playing') return;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced && !this.opts.force) {
      this.state = 'done';
      this.emit('done');
      return;
    }

    this._runId = (this._runId || 0) + 1;
    if (this._restoreTimer) {
      clearTimeout(this._restoreTimer);
      this._restoreTimer = null;
    }
    this.blueprint = snapshot(this.root);
    this._mount();
    this._elapsed = 0;
    this._lastProgress = 0;
    this._lastFinish = 0;
    this.state = 'playing';
    if (this.opts.showControlPanel) this._ensurePanel();
    this.emit('start', this.blueprint.items.length);
    this._last = 0;
    this._raf = requestAnimationFrame(this._tickBound);
  }

  replay() {
    this.stop();
    setTimeout(() => this.play(), 60);
  }

  /* ---------------------------------------------------------- 内置控制面板 */

  _ensurePanel() {
    if (this.panel || typeof document === 'undefined') return;

    const host = document.createElement('div');
    host.setAttribute('data-swarm', 'panel');
    host.style.cssText = 'position:fixed;z-index:2147483000;right:20px;bottom:20px;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .box {
          width: 264px; background: #fff; color: #101014;
          border: 1px solid #E8E2D5; border-top: 3px solid #E0402A;
          box-shadow: 0 12px 34px rgba(16,16,20,.12);
          font: 12px/1.45 -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
        }
        .top { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: #E0402A; flex: none; }
        .dot.live { animation: pulse 1s ease-in-out infinite; }
        .status { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #101014; }
        .pct { color: #E0402A; font-variant-numeric: tabular-nums; }
        .track { height: 2px; background: #EEEAE0; margin: 0 12px 2px; }
        .fill { height: 2px; width: 0%; background: #E0402A; transition: width .2s linear; }
        .btns { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: #E8E2D5; border-top: 1px solid #E8E2D5; }
        button {
          border: 0; background: #fff; height: 36px; font: inherit; color: #101014; cursor: pointer;
        }
        button:hover:not(:disabled) { background: #FBEDE9; color: #E0402A; }
        button:disabled { color: #B6B9BE; cursor: default; background: #FCFCFB; }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
      </style>
      <div class="box">
        <div class="top"><span class="dot"></span><span class="status">就绪</span><span class="pct">0%</span></div>
        <div class="track"><div class="fill"></div></div>
        <div class="btns">
          <button data-a="play">重建</button>
          <button data-a="stop" disabled>还原</button>
          <button data-a="speed">速度 1×</button>
          <button data-a="sound">声音 关</button>
        </div>
      </div>`;

    document.body.appendChild(host);
    this.panel = host;
    const q = (sel) => root.querySelector(sel);
    this._panelUI = {
      status: q('.status'),
      pct: q('.pct'),
      fill: q('.fill'),
      dot: q('.dot'),
      play: q('[data-a="play"]'),
      stop: q('[data-a="stop"]'),
      speed: q('[data-a="speed"]'),
      sound: q('[data-a="sound"]'),
    };

    let speed = this.speed;
    this._panelUI.play.addEventListener('click', () => {
      if (this.state === 'playing') this.stop();
      else this.play();
    });
    this._panelUI.stop.addEventListener('click', () => this.stop());
    this._panelUI.speed.addEventListener('click', () => {
      speed = speed === 1 ? 2 : speed === 2 ? 3 : 1;
      this.setSpeed(speed);
      this._panelUI.speed.textContent = `速度 ${speed}×`;
    });
    this._panelUI.sound.addEventListener('click', () => {
      const on = !this.sound.enabled;
      this.setSound(on);
      this._panelUI.sound.textContent = `声音 ${on ? '开' : '关'}`;
    });

    this.on('ready', (n) => {
      this._panelUI.status.textContent = `蓝图 ${n} 项`;
      this._panelUI.dot.classList.add('live');
    });
    this.on('progress', ({ done, total }) => {
      const pct = Math.round((done / Math.max(1, total)) * 100);
      this._panelUI.pct.textContent = `${pct}%`;
      this._panelUI.fill.style.width = `${pct}%`;
      this._panelUI.status.textContent = '构建中';
    });
    this.on('done', () => {
      this._panelUI.pct.textContent = '100%';
      this._panelUI.fill.style.width = '100%';
      this._panelUI.status.textContent = '交付完成';
      this._panelUI.dot.classList.remove('live');
      this._panelUI.stop.disabled = false;
      this._panelUI.play.textContent = '再建一次';
    });
    this.on('restored', () => {
      this._panelUI.status.textContent = '已还原真实页面';
      this._panelUI.dot.classList.remove('live');
      this._panelUI.stop.disabled = true;
      this._panelUI.play.textContent = '重建';
      this._panelUI.play.disabled = false;
    });
    this._panelUI.play.disabled = false;
  }

  /** 卸掉画布与面板，彻底收尾 */
  destroy() {
    this.stop();
    if (this.panel) {
      this.panel.remove();
      this.panel = null;
      this._panelUI = null;
    }
  }

  stop() {
    const wasMounted = !!this.overlay;
    if (this._restoreTimer) {
      clearTimeout(this._restoreTimer);
      this._restoreTimer = null;
    }
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    if (this._finishRaf) cancelAnimationFrame(this._finishRaf);
    this._finishRaf = null;
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
    if (this.elMap) {
      this.elMap.forEach((node) => node.remove());
      this.elMap.clear();
    }
    if (this._hidden) {
      this._hidden.forEach(([node, value]) => { node.style.visibility = value; });
      this._hidden = null;
    }
    if (this.root && this._prevPosition !== undefined) {
      this.root.style.position = this._prevPosition;
      this._prevPosition = undefined;
    }
    window.removeEventListener('pointermove', this._onPointer);
    this.cursors.forEach((c) => c.el.remove());
    this.cursors = [];
    this.tasks = [];
    this.state = 'idle';
    if (wasMounted) this.emit('restored');
  }

  /* ---------------------------------------------------------- 挂载 */

  _mount() {
    const { root, blueprint } = this;
    const style = getComputedStyle(root);
    this._prevPosition = root.style.position;
    if (style.position === 'static') root.style.position = 'relative';

    // 先藏起真实内容，但保留布局（保证滚动高度不变）
    this._hidden = [];
    for (const child of Array.from(root.children)) {
      this._hidden.push([child, child.style.visibility]);
      child.style.visibility = 'hidden';
    }

    const overlay = document.createElement('div');
    overlay.setAttribute('data-swarm', 'layer');
    overlay.style.cssText =
      `position:absolute;left:0;top:0;width:${blueprint.width}px;height:${blueprint.height}px;` +
      `z-index:2147482000;pointer-events:none;overflow:hidden;background:${this.opts.background};`;
    const shadow = overlay.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${SHADOW_CSS}</style><div class="sw-layer" part="layer"></div>`;
    this.overlay = overlay;
    this.layer = shadow.querySelector('.sw-layer');
    this.layer.style.width = `${blueprint.width}px`;
    this.layer.style.height = `${blueprint.height}px`;
    root.appendChild(overlay);

    // 素材层
    this.itemsLayer = document.createElement('div');
    this.itemsLayer.className = 'sw-layer';
    this.layer.appendChild(this.itemsLayer);

    // 光标层
    this.cursorLayer = document.createElement('div');
    this.cursorLayer.className = 'sw-layer';
    this.layer.appendChild(this.cursorLayer);

    // 尺子刻度：极轻，只在顶部提示这是「画布」
    const ruler = document.createElement('div');
    ruler.style.cssText =
      'position:absolute;left:0;top:0;right:0;height:14px;pointer-events:none;opacity:.55;' +
      'background:repeating-linear-gradient(90deg, rgba(0,0,0,.35) 0 1px, transparent 1px 10px);';
    this.layer.appendChild(ruler);

    // 元素
    this.elMap = new Map();
    this.tasks = [];
    this.blueprint.items.forEach((it) => {
      const node = this._buildNode(it);
      this.itemsLayer.appendChild(node);
      this.elMap.set(it.id, node);
      this.tasks.push({
        item: it,
        el: node,
        t: 0,
        dur: this._duration(it),
        arrived: false,
        travel: 0,
        cursor: null,
        ghost: null,
        badge: null,
        pointer: null,
      });
    });

    // 行分组
    const rows = new Map();
    this.blueprint.items.forEach((it) => {
      const r = Math.floor(it.y / ROW_HEIGHT);
      if (!rows.has(r)) rows.set(r, []);
      rows.get(r).push(it);
    });
    this.rowList = Array.from(rows.keys()).sort((a, b) => a - b).map((k) => rows.get(k));
    this.rowIndex = 0;

    // 光标
    const n = clamp(this.opts.cursors, 2, 12);
    for (let i = 0; i < n; i += 1) {
      const color = this.opts.palette[i % this.opts.palette.length];
      const name = this.opts.names[i % this.opts.names.length];
      const c = new Cursor(i, color, name, this.cursorLayer, this.opts.scale);
      const startX = 60 + Math.random() * (blueprint.width * 0.6);
      const startY = 26 + Math.random() * 44;
      c.x = startX;
      c.y = startY;
      c.seek(startX, startY);
      this.cursors.push(c);
    }

    window.addEventListener('pointermove', this._onPointer, { passive: true });
    this.emit('ready', this.blueprint.items.length);
  }

  _buildNode(it) {
    let node;
    if (it.type === 'text') {
      node = document.createElement('div');
      node.className = 'sw-text sw-item';
      const b = it.base;
      node.style.cssText =
        `left:${it.x}px;top:${it.y}px;width:${it.w}px;min-height:${it.h}px;` +
        `font-family:${b.fontFamily};font-size:${b.fontSize}px;font-weight:${b.fontWeight};` +
        `font-style:${b.fontStyle};line-height:${b.lineHeight}px;letter-spacing:${b.letterSpacing};` +
        `color:${b.color};text-align:${b.textAlign};padding:${it.pt}px ${it.pr}px ${it.pb}px ${it.pl}px;` +
        `${b.decoration ? `text-decoration:${b.decoration};` : ''}` +
        `${b.textTransform && b.textTransform !== 'none' ? `text-transform:${b.textTransform};` : ''}` +
        `${it.singleLine ? 'white-space:pre;' : ''}`;
      node.innerHTML = '';
      node.style.visibility = 'hidden';
      node.style.opacity = '0';
      return node;
    }

    if (it.type === 'media') {
      if (it.kind === 'svg') {
        node = document.createElement('div');
        node.className = 'sw-item';
        node.style.cssText = `left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;`;
        node.innerHTML = it.markup;
        const svg = node.querySelector('svg');
        if (svg) {
          svg.setAttribute('width', String(it.w));
          svg.setAttribute('height', String(it.h));
          svg.style.display = 'block';
        }
      } else if (it.kind === 'video' && it.src) {
        node = document.createElement('video');
        node.className = 'sw-item';
        node.src = it.src;
        node.muted = true;
        node.playsInline = true;
        node.style.cssText = `left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;object-fit:cover;`;
      } else {
        node = document.createElement('img');
        node.className = 'sw-item';
        node.src = it.src || it.poster || '';
        node.alt = '';
        node.style.cssText = `left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;object-fit:${it.fit || 'fill'};border-radius:${it.radius || '0'};`;
      }
      node.style.visibility = 'hidden';
      node.style.opacity = '0';
      return node;
    }

    if (it.type === 'line') {
      node = document.createElement('div');
      node.className = 'sw-item';
      node.style.cssText = `left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;background:${it.color};`;
      node.style.visibility = 'hidden';
      node.style.opacity = '0';
      return node;
    }

    // rect
    node = document.createElement('div');
    node.className = 'sw-item';
    let bg = '';
    if (it.bgImage) {
      bg = `background-image:${it.bgImage};background-size:${it.bgSize};background-position:${it.bgPosition};background-repeat:${it.bgRepeat};`;
    } else if (it.fill) {
      bg = `background:${it.fill};`;
    }
    node.style.cssText =
      `left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;` +
      bg +
      `border:${it.border || '0'} ;border-radius:${it.radius || '0'};box-shadow:${it.shadow || 'none'};` +
      `opacity:0;visibility:hidden;`;
    return node;
  }

  _duration(it) {
    if (it.type === 'text') {
      return 0.44 + Math.min(1.25, it.flat.length * 0.0085);
    }
    if (it.type === 'media') return 0.62;
    if (it.type === 'line') return 0.3;
    if (it.dupOf !== undefined) return 0.5;
    return 0.4;
  }

  /* ---------------------------------------------------------- 调度 */

  _pickTask() {
    const last = Math.min(this.rowIndex + 2, this.rowList.length - 1);
    for (let r = this.rowIndex; r <= last; r += 1) {
      for (const it of this.rowList[r] || []) {
        if (it.status !== 'todo') continue;
        if (it.dupOf !== undefined && this.blueprint.items[it.dupOf].status !== 'done') continue;
        it.status = 'doing';
        return it;
      }
    }
    return null;
  }

  _advanceRow() {
    while (this.rowIndex < this.rowList.length) {
      const row = this.rowList[this.rowIndex];
      const busy = row.some((it) => it.status !== 'done');
      if (busy) return;
      this.rowIndex += 1;
    }
  }

  _startTask(cursor, item) {
    const task = this.tasks[item.id];
    task.cursor = cursor;
    task.t = 0;
    task.arrived = false;
    task.travel = 0;
    task._count = -1;
    cursor.task = task;
    const anchor = this._anchor(task);
    cursor.x = cursor.x || anchor.x;
    cursor.y = cursor.y || anchor.y;
    cursor.tx = anchor.x;
    cursor.ty = anchor.y;
  }

  _anchor(task) {
    const it = task.item;
    return { x: it.x + Math.min(24, it.w * 0.3), y: it.y + Math.min(18, it.h * 0.4) };
  }

  _pan(x) {
    const w = this.blueprint.width || 1;
    return clamp((x / w) * 2 - 1, -1, 1) * 0.6;
  }

  /* ---------------------------------------------------------- 主循环 */

  _tick(now) {
    if (this.state !== 'playing') return;
    if (!this._last) this._last = now;
    const dt = Math.min(0.033, (now - this._last) / 1000 || 0.016);
    this._last = now;
    this._update(dt);
    if (this.state === 'playing') this._raf = requestAnimationFrame(this._tickBound);
  }

  /**
   * 同步推进若干毫秒（不依赖 rAF），用于录制、截图与调试。
   * swarm.advance(1200) —— 快进 1.2 秒
   */
  advance(ms) {
    if (!this.blueprint || this.state === 'idle') return this;
    const step = 1 / 60;
    const frames = Math.max(1, Math.round(ms / 1000 / step));
    for (let i = 0; i < frames; i += 1) {
      if (this.state === 'playing') this._update(step);
      // 已交付：继续推进光标群，让收尾聚拢也走完
      else if (this.state === 'done') this.cursors.forEach((c) => c.update(step, this.cursors, this.mouse));
      else break;
    }
    return this;
  }

  _update(dt) {
    this._elapsed = (this._elapsed || 0) + dt;

    for (const c of this.cursors) {
      if (c.task) this._stepTask(c.task, dt);
    }

    this._advanceRow();

    for (const c of this.cursors) {
      if (!c.task) {
        const it = this._pickTask();
        if (it) this._startTask(c, it);
        else this._idleSeek(c);
      }
    }

    for (const c of this.cursors) c.update(dt, this.cursors, this.mouse);

    if (this._elapsed > 0.2 && this._elapsed - (this._lastProgress || 0) > 0.35) {
      this._lastProgress = this._elapsed;
      const total = this.blueprint.items.length;
      const done = this.blueprint.items.filter((i) => i.status === 'done').length;
      this.emit('progress', { done, total, row: this.rowIndex, rows: this.rowList.length });
    }

    if (this.rowIndex >= this.rowList.length) this._finish();
  }

  _idleSeek(cursor) {
    const row = this.rowList[this.rowIndex] || [];
    const band = row.length ? row[0].y : 0;
    cursor.seek(60 + Math.random() * (this.blueprint.width - 120), band + 40 + Math.random() * 60);
  }

  _stepTask(task, dt) {
    const c = task.cursor;
    if (!c) return;
    const it = task.item;

    if (!task.arrived) {
      const a = this._anchor(task);
      c.tx = a.x;
      c.ty = a.y;
      task.travel += dt;
      if (Math.hypot(c.x - a.x, c.y - a.y) < 16 || task.travel > 0.9) {
        task.arrived = true;
        c.press();
        this.sound.click(this._pan(c.x));
      }
      return;
    }

    task.t = Math.min(1, task.t + (dt * this.speed) / task.dur);
    this._apply(task, it);
    const p = this._pointer(task, it);
    if (p) {
      c.seek(p.x, p.y);
    }
    if (task.t >= 1) this._complete(task);
  }

  _pointer(task, it) {
    const p = task.t;
    if (it.dupOf !== undefined) {
      const m = this.blueprint.items[it.dupOf];
      const k = easeInOut(clamp((p - 0.2) / 0.65, 0, 1));
      return { x: lerp(m.x + m.w, it.x + it.w, k), y: lerp(m.y + m.h * 0.5, it.y + it.h * 0.5, k) };
    }
    if (it.type === 'text') {
      if (p < 0.26) {
        const k = easeOut(p / 0.26);
        return { x: it.x + it.pl + it.w * 0.5 * k, y: it.y + it.pt + it.h * 0.5 * k };
      }
      const caret = this._caretPos(task, it);
      return { x: it.x + it.pl + caret.x, y: it.y + it.pt + caret.y };
    }
    if (it.type === 'line') {
      return { x: it.x + it.w * easeOut(clamp(p / 0.55, 0, 1)), y: it.y + it.h };
    }
    const k = easeOut(clamp(p / 0.42, 0, 1));
    return { x: it.x + it.w * k, y: it.y + it.h * k };
  }

  /* ---------------------------------------------------------- 逐帧绘制 */

  _ghost(task, color) {
    if (!task.ghost) {
      const g = document.createElement('div');
      g.className = 'sw-ghost';
      if (color) g.style.borderColor = color;
      this.itemsLayer.appendChild(g);
      task.ghost = g;

      const b = document.createElement('div');
      b.className = 'sw-badge';
      if (color) b.style.background = color;
      this.itemsLayer.appendChild(b);
      task.badge = b;
    }
    return task.ghost;
  }

  _apply(task, it) {
    const p = task.t;

    /* 重复项：选中母版 → ⌥ 拖出副本 */
    if (it.dupOf !== undefined) {
      return this._applyDup(task, it, p);
    }

    const ghost = this._ghost(task, it.type === 'line' ? '#0D99FF' : null);
    const badge = task.badge;

    if (it.type === 'text') {
      return this._applyText(task, it, p, ghost, badge);
    }
    if (it.type === 'media') {
      return this._applyBlock(task, it, p, ghost, badge, 0.4, true);
    }
    if (it.type === 'line') {
      const k = easeOut(clamp(p / 0.55, 0, 1));
      ghost.style.border = '0';
      ghost.style.left = `${it.x}px`;
      ghost.style.top = `${it.y + it.h / 2}px`;
      ghost.style.width = `${it.w * k}px`;
      ghost.style.height = `1px`;
      ghost.style.background = 'rgba(13,153,255,.9)';
      badge.style.visibility = 'hidden';
      if (p > 0.45) {
        task.el.style.visibility = 'visible';
        task.el.style.opacity = String(easeOut(clamp((p - 0.45) / 0.4, 0, 1)));
      }
      return;
    }
    return this._applyBlock(task, it, p, ghost, badge, 0.42, false);
  }

  _applyBlock(task, it, p, ghost, badge, dragEnd, sweep) {
    const drag = easeOut(clamp(p / dragEnd, 0, 1));
    if (drag < 1) {
      ghost.style.visibility = 'visible';
      ghost.style.left = `${it.x}px`;
      ghost.style.top = `${it.y}px`;
      ghost.style.width = `${Math.max(1, it.w * drag)}px`;
      ghost.style.height = `${Math.max(1, it.h * drag)}px`;
      ghost.style.background = sweep ? 'rgba(0,0,0,.045)' : 'rgba(13,153,255,.07)';
      badge.style.visibility = 'visible';
      badge.textContent = `${Math.round(it.w * drag)} × ${Math.round(it.h * drag)}`;
      badge.style.left = `${it.x + it.w * drag}px`;
      badge.style.top = `${it.y + it.h * drag}px`;
    }

    if (p > dragEnd * 0.98) {
      ghost.style.opacity = String(clamp(1 - (p - dragEnd) / 0.22, 0, 1));
      badge.style.visibility = 'hidden';
      task.el.style.visibility = 'visible';
      const k = easeOut(clamp((p - dragEnd) / (1 - dragEnd), 0, 1));
      if (sweep) {
        task.el.style.clipPath = `inset(0 0 ${(1 - k) * 100}% 0)`;
        task.el.style.opacity = '1';
      } else {
        task.el.style.opacity = String(it.opacity && it.opacity < 1 ? k * it.opacity : k);
        task.el.style.clipPath = '';
      }
    }
  }

  _applyText(task, it, p, ghost, badge) {
    const dragEnd = 0.26;
    const drag = easeOut(clamp(p / dragEnd, 0, 1));
    if (drag < 1) {
      ghost.style.visibility = 'visible';
      ghost.style.left = `${it.x}px`;
      ghost.style.top = `${it.y}px`;
      ghost.style.width = `${Math.max(24, it.w * drag)}px`;
      ghost.style.height = `${Math.max(12, it.h * drag)}px`;
      badge.style.visibility = 'visible';
      badge.textContent = '文字';
      badge.style.left = `${it.x + it.w * drag}px`;
      badge.style.top = `${it.y + it.h * drag}px`;
      return;
    }

    ghost.style.opacity = '0';
    badge.style.visibility = 'hidden';
    task.el.style.visibility = 'visible';
    task.el.style.opacity = '1';

    const total = it.flat.length;
    const k = clamp((p - dragEnd) / (1 - dragEnd), 0, 1);
    const count = Math.round(total * k);
    if (count !== task._count) {
      task._count = count;
      this._renderText(task.el, it, count);
      if (k < 1 && Math.random() < 0.55) {
        const c = task.cursor;
        this.sound.key(c ? this._pan(c.x) : 0);
      }
    }

    // 光标（I-beam）
    const caret = this._caretPos(task, it);
    if (!task.caretEl) {
      const caretEl = document.createElement('div');
      caretEl.className = 'sw-caret';
      this.itemsLayer.appendChild(caretEl);
      task.caretEl = caretEl;
    }
    const ce = task.caretEl;
    ce.style.left = `${it.x + it.pl + caret.x}px`;
    ce.style.top = `${it.y + it.pt + caret.y}px`;
    ce.style.height = `${Math.round(it.base.lineHeight * 0.92)}px`;
    ce.style.background = it.base.color;
    ce.style.visibility = k < 1 ? 'visible' : 'hidden';
  }

  _applyDup(task, it, p) {
    const master = this.blueprint.items[it.dupOf];
    const ghost = this._ghost(task, '#E8453C');
    const badge = task.badge;

    // 1) 选中母版
    if (p < 0.22) {
      ghost.style.visibility = 'visible';
      ghost.style.left = `${master.x}px`;
      ghost.style.top = `${master.y}px`;
      ghost.style.width = `${master.w}px`;
      ghost.style.height = `${master.h}px`;
      ghost.style.background = 'rgba(232,69,60,.06)';
      ghost.style.borderColor = 'rgba(232,69,60,.85)';
      badge.style.visibility = 'hidden';
      return;
    }

    const k = easeInOut(clamp((p - 0.22) / 0.66, 0, 1));
    task.el.style.visibility = 'visible';
    task.el.style.opacity = '1';
    if (task.el.style.clipPath) task.el.style.clipPath = '';
    task.el.style.left = `${lerp(master.x, it.x, k)}px`;
    task.el.style.top = `${lerp(master.y, it.y, k)}px`;

    // 2) 红色间距标注
    if (p > 0.3 && p < 0.95) {
      if (!task.measureEl) {
        const m = document.createElement('div');
        m.className = 'sw-measure';
        this.itemsLayer.appendChild(m);
        task.measureEl = m;
      }
      const m = task.measureEl;
      const x1 = master.x + master.w;
      const y1 = master.y + master.h / 2;
      const x2 = lerp(master.x + master.w, it.x + it.w, k);
      const y2 = lerp(master.y + master.h / 2, it.y + it.h / 2, k);
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);
      const flat = dx >= dy; // 只沿主方向画一条细线，避免退化成大红块
      m.style.left = `${flat ? Math.min(x1, x2) + it.w : Math.min(x1, x2)}px`;
      m.style.top = `${flat ? y1 : Math.min(y1, y2) + it.h}px`;
      m.style.width = `${flat ? Math.max(2, dx) : 2}px`;
      m.style.height = `${flat ? 2 : Math.max(2, dy)}px`;
      m.style.opacity = String(clamp((p - 0.3) / 0.15, 0, 1));

      badge.style.visibility = 'visible';
      badge.classList.add('is-dup');
      const dy0 = Math.abs(it.y - master.y);
      const dx0 = Math.abs(it.x - master.x);
      badge.textContent = `${Math.round(dy0 >= dx0 ? dy0 : dx0)} px`;
      badge.style.left = `${(x1 + x2) / 2}px`;
      badge.style.top = `${(y1 + y2) / 2}px`;
    }

    ghost.style.opacity = String(clamp(1 - (p - 0.22) / 0.2, 0, 1));
  }

  _renderText(el, it, count) {
    el.textContent = '';
    let left = count;
    const frag = document.createDocumentFragment();
    for (const r of it.runs) {
      if (left <= 0) break;
      const t = r.text.slice(0, left);
      left -= t.length;
      if (!t) continue;
      const span = document.createElement('span');
      span.textContent = t;
      if (r.color) span.style.color = r.color;
      if (r.weight) span.style.fontWeight = r.weight;
      if (r.italic && r.italic !== 'normal') span.style.fontStyle = r.italic;
      frag.appendChild(span);
    }
    el.appendChild(frag);
  }

  _caretPos(task, it) {
    if (!this._mctx) {
      this._mctx = document.createElement('canvas').getContext('2d');
    }
    const ctx = this._mctx;
    const b = it.base;
    ctx.font = `${b.fontStyle} ${b.fontWeight} ${b.fontSize}px ${b.fontFamily}`;
    const maxW = it.singleLine ? 1e6 : Math.max(8, it.w - it.pl - it.pr);
    const chars = Math.round(it.flat.length * clamp((task.t - 0.26) / 0.74, 0, 1));
    let x = 0;
    let y = 0;
    const text = it.flat.slice(0, chars);
    for (const ch of text) {
      if (ch === '\n') {
        x = 0;
        y += b.lineHeight;
        continue;
      }
      const w = ctx.measureText(ch).width;
      if (x + w > maxW && x > 0) {
        x = 0;
        y += b.lineHeight;
      }
      x += w;
    }
    return { x: Math.min(x, maxW), y };
  }

  /* ---------------------------------------------------------- 收尾 */

  _complete(task) {
    const it = task.item;
    const el = task.el;

    if (it.type === 'text') {
      this._renderText(el, it, it.flat.length);
      if (task.caretEl) task.caretEl.style.visibility = 'hidden';
    } else if (it.type === 'media') {
      el.style.clipPath = '';
      el.style.opacity = '1';
    } else {
      el.style.opacity = String(it.opacity && it.opacity < 1 ? it.opacity : 1);
    }
    el.style.visibility = 'visible';

    if (task.ghost) {
      task.ghost.remove();
      task.ghost = null;
    }
    if (task.badge) {
      task.badge.remove();
      task.badge = null;
    }
    if (task.measureEl) {
      task.measureEl.remove();
      task.measureEl = null;
    }

    it.status = 'done';
    if (task.cursor) {
      task.cursor.task = null;
      task.cursor.seek(it.x + it.w * 0.5, it.y - 8);
    }
    task.cursor = null;
  }

  _finish() {
    this.state = 'done';
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;

    // 收尾：光标依次从画面上沿离场，把页面留给观众
    const w = this.blueprint.width;
    const n = this.cursors.length;
    this.cursors.forEach((c, i) => {
      c.seek(((i + 0.5) / n) * w, -90 - (i % 3) * 40);
    });

    const tick = (now) => {
      if (this.state !== 'done') return;
      const dt = Math.min(0.033, ((now - (this._lastFinish || now)) / 1000) || 0.016);
      this._lastFinish = now;
      this.cursors.forEach((c) => c.update(dt, this.cursors, this.mouse));
      if (this.cursors.every((c) => c.y < -30)) {
        this._finishRaf = null;
        return;
      }
      this._finishRaf = requestAnimationFrame(tick);
    };
    this._finishRaf = requestAnimationFrame(tick);

    this.emit('done', { items: this.blueprint.items.length });

    // 自动还原：等光标聚拢一会儿，再把真实页面放回来
    if (this.opts.restoreOnFinish) {
      const runId = this._runId;
      this._restoreTimer = setTimeout(() => {
        if (this._runId === runId && this.state === 'done') this.stop();
      }, Math.max(0, Number(this.opts.restoreDelay) || 0));
    }
  }

  _onPointer(e) {
    if (!this.overlay) return;
    const rect = this.overlay.getBoundingClientRect();
    this.mouse.x = e.clientX - rect.left;
    this.mouse.y = e.clientY - rect.top;
    this.mouse.inside = this.mouse.x >= 0 && this.mouse.y >= 0 && this.mouse.x <= rect.width && this.mouse.y <= rect.height;
  }
}

export default SwarmCursors;
