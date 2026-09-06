import fs from 'node:fs';
import vm from 'node:vm';

// newtab.js is a browser script; give it just enough DOM to evaluate, then pull
// the pure whiteboard functions out of the context.
export function loadWhiteboard() {
  const src = fs.readFileSync(new URL('../../newtab.js', import.meta.url), 'utf8');
  const noop = () => {};
  const fakeCtx = {
    measureText: (t) => ({ width: String(t).length * 8 }),
    save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
    fill: noop, fillText: noop, rect: noop, arc: noop, ellipse: noop, strokeRect: noop,
    setTransform: noop, translate: noop, scale: noop, clearRect: noop, setLineDash: noop,
    getTransform: () => ({}), font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    lineCap: '', lineJoin: '', textBaseline: '', globalAlpha: 1
  };
  const el = () => ({
    getContext: () => fakeCtx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    addEventListener: noop, removeEventListener: noop, style: { setProperty: noop, removeProperty: noop },
    dataset: {}, setAttribute: noop, getAttribute: () => null, focus: noop, remove: noop,
    querySelector: () => null, querySelectorAll: () => [], appendChild: noop,
    value: 'rect', textContent: '', innerHTML: '', width: 800, height: 600, disabled: false, checked: false
  });
  const document_ = {
    addEventListener: noop, removeEventListener: noop,
    querySelector: () => el(), querySelectorAll: () => [],
    createElement: () => el(), documentElement: { ...el(), dataset: {} },
    body: { ...el() }, head: { ...el() }, activeElement: null, contains: () => false
  };
  const ctx = vm.createContext({
    document: document_,
    window: { addEventListener: noop, devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener: noop }) },
    navigator: { platform: 'MacIntel' },
    console, Date, JSON, Math, Object, Array, Set, Map, Promise, URL, crypto, Number, String,
    Boolean, Infinity, isNaN, parseInt, parseFloat, Error, RegExp, setTimeout, clearTimeout,
    setInterval, requestAnimationFrame: noop, ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#111111' }),
    indexedDB: { open: () => ({}) }, chrome: { runtime: { sendMessage: noop, onMessage: { addListener: noop } }, storage: { local: {}, onChanged: { addListener: noop } } },
    structuredClone, devicePixelRatio: 1
  });
  ctx.globalThis = ctx;
  ctx.window.document = document_;
  vm.runInContext(src, ctx);
  const names = ['whiteboardItems','whiteboardCollection','normalizedShapeBox','measureWhiteboardText',
    'whiteboardItemBounds','shapeTouchesPoint','strokeTouchesPoint','whiteboardItemAt','moveWhiteboardItem',
    'segmentDistanceSquared','emptyWhiteboard','undoWhiteboard','removeWhiteboardItem','eraseWhiteboardAt'];
  const api = {};
  for (const n of names) { try { api[n] = vm.runInContext(n, ctx); } catch (_) {} }
  api.setBoard = (b) => vm.runInContext('whiteboardBoard', ctx) !== undefined
    ? vm.runInContext(`whiteboardBoard = ${JSON.stringify(b)}; whiteboardView = {x:0,y:0,scale:1}; whiteboardSelection = null;`, ctx)
    : null;
  api.getBoard = () => vm.runInContext('whiteboardBoard', ctx);
  api.setSelection = (sel) => vm.runInContext(`whiteboardSelection = ${JSON.stringify(sel)};`, ctx);
  return api;
}
