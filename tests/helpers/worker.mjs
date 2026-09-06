import fs from 'node:fs';
import vm from 'node:vm';

const SRC = process.env.BG_SRC || new URL('../../background.js', import.meta.url);

export function makeWorker({ store = {}, fetchImpl } = {}) {
  const listeners = { alarm: [], changed: [], installed: [] };
  const tabsCreated = [];
  const alarms = new Map();
  const changes = [];
  const noop = () => {};
  const mk = (arr) => ({ addListener: (f) => arr.push(f), removeListener: noop });

  const local = {
    async get(keys) {
      if (keys === null || keys === undefined) return structuredClone(store);
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in store) out[k] = structuredClone(store[k]);
      return out;
    },
    async set(patch) {
      changes.push(Object.keys(patch));
      Object.assign(store, structuredClone(patch));
      for (const f of listeners.changed) f(Object.fromEntries(Object.keys(patch).map(k => [k, {}])), 'local');
    },
    async remove(keys) {
      for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
    }
  };

  const chrome = {
    runtime: {
      id: 'test', lastError: null,
      getURL: (p) => `chrome-extension://test/${p}`,
      getManifest: () => ({ version: '5.13.0', oauth2: { client_id: '123-real.apps.googleusercontent.com' } }),
      onInstalled: mk(listeners.installed), onStartup: mk([]), onMessage: mk([]),
      sendMessage: async () => {}
    },
    storage: { local, onChanged: mk(listeners.changed), sync: { get: async () => ({}) } },
    alarms: {
      onAlarm: mk(listeners.alarm),
      create: (name, info) => alarms.set(name, { name, scheduledTime: (info && info.when) || Date.now() }),
      clear: async (name) => alarms.delete(name),
      getAll: async () => [...alarms.values()]
    },
    notifications: { onClicked: mk([]), onButtonClicked: mk([]), create: async () => {}, clear: async () => {} },
    contextMenus: { onClicked: mk([]), removeAll: (cb) => cb && cb(), create: noop },
    commands: { onCommand: mk([]) },
    declarativeNetRequest: { getDynamicRules: async () => [], updateDynamicRules: async () => {} },
    identity: {
      getAuthToken: (o, cb) => cb('tok'),
      getProfileUserInfo: (_o, cb) => cb({ email: 'a@b.c', id: '1' }),
      removeCachedAuthToken: async () => {}
    },
    tabs: { create: async (info) => { tabsCreated.push(info); }, query: async () => [] },
    tabGroups: {}, sidePanel: { open: async () => {} }
  };

  const ctx = vm.createContext({
    chrome, console, Date, JSON, Math, Object, Array, Set, Map, Promise, URL, URLSearchParams,
    crypto, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, String, Number,
    Boolean, TextEncoder, isNaN, parseInt, parseFloat, Error, structuredClone, Intl, RegExp,
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({ items: [] }) }))
  });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx);

  const names = ['initialize', 'ensureInitialized', 'syncCalendars', 'applyCalendarChangesToPlans',
    'findBlockForCalendarEvent', 'mergeCalendarEventsIntoCache', 'pruneCalendarEvents', 'completeTask',
    'clearTemporaryAccess', 'stopFocus', 'startFocus', 'normalizeTask', 'mergeDefaults',
    'validateDomain', 'cleanDomain', 'normalizeWorkspace', 'applyBlockRuleUpdate',
    'grantTemporaryAccess', 'updateBlockRule', 'exportData', 'importData',
    'connectNotion', 'disconnectNotion', 'syncNotion', 'notionRequest', 'notionTaskProperties',
    'notionProjectBlocks', 'normalizeNotionSync', 'normalizeRecurringSeries', 'seriesOccursOn',
    'materializeRecurringSeries', 'recurrenceHorizonKeys', 'saveRecurringSeries',
    'deleteRecurringSeries', 'skipSeriesOccurrence', 'applyRecurrence', 'allowDomain', 'normalizeFlashcard', 'scheduleFlashcard',
    'reviewFlashcard', 'saveFlashcard', 'deleteFlashcard', 'normalizeOnboarding'];
  const api = {};
  for (const n of names) { try { api[n] = vm.runInContext(n, ctx); } catch (_) {} }
  const fireInstalled = async (details) => {
    for (const fn of listeners.installed) await fn(details);
    // The listener chains off ensureInitialized, so give the promise a turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  // Read from the worker rather than repeated in every suite: a version bump is
  // then a one-line change in background.js, not a hunt through the tests.
  const storageVersion = vm.runInContext('STORAGE_VERSION', ctx);
  return { api, store, changes, alarms, chrome, tabsCreated, fireInstalled, storageVersion };
}
