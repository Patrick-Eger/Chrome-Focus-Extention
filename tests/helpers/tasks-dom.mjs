import fs from 'node:fs';
import vm from 'node:vm';

export function loadTasks({ settings = {} } = {}) {
  const noop = () => {};
  const log = { animations: 0, oscillators: [], layers: [], removedLayers: 0, pulses: [] };
  const mkEl = (tag = 'div') => {
    const classes = new Set();
    const kids = [];
    const el = {
      tagName: tag, style: { setProperty: noop, removeProperty: noop },
      classList: {
        add: (c) => { classes.add(c); if (c === 'task-done-pulse') log.pulses.push(c); },
        remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
        toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; v ? classes.add(c) : classes.delete(c); return v; }
      },
      appendChild: (k) => { kids.push(k); return k; },
      remove: () => { if (el.className === 'task-burst') log.removedLayers += 1; },
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 16, height: 16 }),
      animate: () => { log.animations += 1; const a = {}; Object.defineProperty(a, 'onfinish', { set(fn) { a._fn = fn; }, get() { return a._fn; } }); setTimeout(() => a._fn && a._fn(), 0); return a; },
      closest: (sel) => (sel.includes('li') ? mkEl('li') : null),
      addEventListener: noop, dataset: {}, setAttribute: noop, getAttribute: () => null,
      querySelector: () => null, querySelectorAll: () => [], focus: noop, checked: false,
      value: '', textContent: '', innerHTML: '', disabled: false, offsetWidth: 1, children: kids
    };
    Object.defineProperty(el, 'className', { get: () => [...classes].join(' '), set: (v) => { classes.clear(); String(v).split(' ').filter(Boolean).forEach((c) => classes.add(c)); } });
    return el;
  };
  const body = mkEl('body');
  body.appendChild = (k) => { if (k.className === 'task-burst') log.layers.push(k); return k; };

  const audioNode = () => ({ connect: noop, start: noop, stop: noop, type: '', frequency: { value: 0 },
    gain: { setValueAtTime: noop, exponentialRampToValueAtTime: noop } });

  const ctx = vm.createContext({
    document: { addEventListener: noop, querySelector: () => mkEl(), querySelectorAll: () => [],
      createElement: (t) => mkEl(t), documentElement: { ...mkEl(), dataset: {} }, body,
      head: mkEl(), activeElement: null, contains: () => false },
    window: {
      addEventListener: noop, devicePixelRatio: 1,
      matchMedia: (q) => ({ matches: false, addEventListener: noop }),
      AudioContext: class { constructor() { this.state = 'running'; this.currentTime = 0; log.contextCreated = true; }
        resume() {} createOscillator() { const o = audioNode(); log.oscillators.push(o); return o; } createGain() { return audioNode(); }
        get destination() { return {}; } }
    },
    navigator: { platform: 'MacIntel' }, console, Date, JSON, Math, Object, Array, Set, Map, Promise,
    URL, crypto, Number, String, Boolean, Infinity, isNaN, parseInt, parseFloat, Error, RegExp,
    setTimeout, clearTimeout, setInterval, requestAnimationFrame: noop,
    ResizeObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#111' }),
    indexedDB: { open: () => ({}) },
    chrome: { runtime: { sendMessage: noop, onMessage: { addListener: noop } }, storage: { local: {}, onChanged: { addListener: noop } } },
    structuredClone, devicePixelRatio: 1
  });
  ctx.globalThis = ctx;
  ctx.window.document = ctx.document;
  vm.runInContext(fs.readFileSync(new URL('../../newtab.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(`state = { settings: ${JSON.stringify({ celebrateTasks: true, celebrateTasksSound: true, ...settings })}, tasks: [] };`, ctx);
  return {
    log,
    run: (code) => vm.runInContext(code, ctx),
    mkEl,
    setSettings: (s) => vm.runInContext(`Object.assign(state.settings, ${JSON.stringify(s)});`, ctx),
    setMatchMedia: (matches) => { ctx.window.matchMedia = () => ({ matches, addEventListener: noop }); }
  };
}
