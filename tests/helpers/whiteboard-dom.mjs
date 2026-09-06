import fs from 'node:fs';
import vm from 'node:vm';

// A DOM stub small enough to be honest about, but real enough to deliver events:
// elements are cached per selector and dispatch to their own listeners, so the
// whiteboard's pointer handlers can actually be exercised.
export function loadWhiteboardDom() {
  const noop = () => {};
  const cache = new Map();
  const fakeCtx = {
    measureText: (t) => ({ width: String(t).length * 8 }),
    save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop,
    fill: noop, fillText: noop, rect: noop, arc: noop, ellipse: noop, strokeRect: noop,
    setTransform: noop, translate: noop, scale: noop, clearRect: noop, setLineDash: noop,
    getTransform: () => ({}), font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    lineCap: '', lineJoin: '', textBaseline: '', globalAlpha: 1
  };

  function makeEl(selector) {
    const listeners = new Map();
    const classes = new Set(selector === '#whiteboardTextInput' ? ['hidden'] : []);
    const el = {
      _selector: selector,
      listeners,
      getContext: () => fakeCtx,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
      classList: {
        add: (c) => classes.add(c), remove: (c) => classes.delete(c),
        toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; v ? classes.add(c) : classes.delete(c); return v; },
        contains: (c) => classes.has(c)
      },
      addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      removeEventListener: noop,
      dispatchEvent: (event) => { (listeners.get(event.type) || []).forEach((fn) => fn(event)); return true; },
      style: { setProperty: noop, removeProperty: noop },
      dataset: {}, setAttribute: noop, getAttribute: () => null, focus: noop, blur: noop, remove: noop,
      setPointerCapture: noop, releasePointerCapture: noop, hasPointerCapture: () => false,
      setSelectionRange: noop, closest: () => null,
      querySelector: () => null, querySelectorAll: () => [], appendChild: noop, scrollIntoView: noop,
      value: 'rect', textContent: '', innerHTML: '', width: 800, height: 600,
      disabled: false, checked: false, scrollHeight: 20
    };
    return el;
  }
  const get = (selector) => {
    if (!cache.has(selector)) cache.set(selector, makeEl(selector));
    return cache.get(selector);
  };

  const document_ = {
    addEventListener: noop, removeEventListener: noop,
    querySelector: (sel) => get(sel),
    querySelectorAll: (sel) => (sel === '[data-whiteboard-tool]' ? [] : []),
    createElement: () => makeEl('created'), documentElement: { ...makeEl('html'), dataset: {} },
    body: makeEl('body'), head: makeEl('head'), activeElement: null, contains: () => false,
    fullscreenElement: null
  };

  const ctx = vm.createContext({
    document: document_,
    window: { addEventListener: noop, devicePixelRatio: 1 },
    navigator: { platform: 'MacIntel' },
    console, Date, JSON, Math, Object, Array, Set, Map, Promise, URL, crypto, Number, String,
    Boolean, Infinity, isNaN, parseInt, parseFloat, Error, RegExp, setTimeout, clearTimeout,
    setInterval, requestAnimationFrame: noop,
    ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#111111' }),
    indexedDB: { open: () => ({}) },
    chrome: { runtime: { sendMessage: noop, onMessage: { addListener: noop } }, storage: { local: {}, onChanged: { addListener: noop } } },
    structuredClone, devicePixelRatio: 1, confirm: () => true
  });
  ctx.globalThis = ctx;
  ctx.window.document = document_;
  vm.runInContext(fs.readFileSync(new URL('../../newtab.js', import.meta.url), 'utf8'), ctx);

  // Saving would hit IndexedDB; the board state is what we are testing.
  vm.runInContext('scheduleWhiteboardSave = function () { whiteboardBoard.updatedAt = Date.now(); saveCalls = (globalThis.saveCalls||0)+1; };', ctx);
  vm.runInContext('bindWhiteboard();', ctx);

  return {
    el: get,
    run: (code) => vm.runInContext(code, ctx),
    setBoard: (b) => vm.runInContext(`whiteboardBoard = ${JSON.stringify(b)}; whiteboardView={x:0,y:0,scale:1}; whiteboardSelection=null; whiteboardPointer=null; whiteboardShapeDraft=null; whiteboardDraft=null; saveCalls=0;`, ctx),
    board: () => vm.runInContext('whiteboardBoard', ctx),
    saves: () => vm.runInContext('globalThis.saveCalls || 0', ctx),
    selection: () => vm.runInContext('whiteboardSelection', ctx),
    setTool: (t) => vm.runInContext(`setWhiteboardTool(${JSON.stringify(t)});`, ctx)
  };
}

export function pointerEvent(type, x, y, extra = {}) {
  return { type, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y,
    shiftKey: false, preventDefault() {}, stopPropagation() {}, target: null, ...extra };
}
