import fs from 'node:fs';
import vm from 'node:vm';

export function loadPage(stateObj) {
  const noop = () => {};
  const mkEl = () => {
    const classes = new Set();
    return {
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c), toggle: () => false },
      style: { setProperty: noop, removeProperty: noop }, dataset: {},
      addEventListener: noop, setAttribute: noop, getAttribute: () => null,
      querySelector: () => null, querySelectorAll: () => [], appendChild: noop,
      getContext: () => ({ measureText: () => ({ width: 10 }), save: noop, restore: noop,
        beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, fill: noop, fillText: noop,
        rect: noop, arc: noop, ellipse: noop, strokeRect: noop, setTransform: noop,
        translate: noop, scale: noop, clearRect: noop, setLineDash: noop }),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
      remove: noop, focus: noop, animate: () => ({ onfinish: null }),
      value: '', textContent: '', innerHTML: '', checked: false, disabled: false, offsetWidth: 1
    };
  };
  // Cached per selector: without this a write and a later read hit two different
  // stub objects, and anything rendered into the DOM looks empty.
  const cache = new Map();
  const get = (sel) => {
    if (!cache.has(sel)) cache.set(sel, mkEl());
    return cache.get(sel);
  };
  const ctx = vm.createContext({
    document: { addEventListener: noop, querySelector: get, querySelectorAll: () => [],
      createElement: mkEl, documentElement: { ...mkEl(), dataset: {} }, body: mkEl(),
      head: mkEl(), activeElement: null, contains: () => false },
    window: { addEventListener: noop, devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener: noop }) },
    navigator: { platform: 'MacIntel' }, console, Date, JSON, Math, Object, Array, Set, Map,
    Promise, URL, crypto, Number, String, Boolean, Infinity, isNaN, parseInt, parseFloat,
    Error, RegExp, setTimeout, clearTimeout, setInterval, requestAnimationFrame: noop,
    ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#111' }),
    indexedDB: { open: () => ({}) },
    chrome: { runtime: { sendMessage: noop, onMessage: { addListener: noop } },
      storage: { local: {}, onChanged: { addListener: noop } } },
    structuredClone, devicePixelRatio: 1
  });
  ctx.globalThis = ctx;
  ctx.window.document = ctx.document;
  vm.runInContext(fs.readFileSync(new URL('../../newtab.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(`state = ${JSON.stringify(stateObj)};`, ctx);
  return { run: (code) => vm.runInContext(code, ctx) };
}
