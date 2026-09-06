import { test } from 'node:test';
import { loadTasks } from './helpers/tasks-dom.mjs';
import { checks } from './helpers/check.mjs';

test('task completion and celebration', async (t) => {
  const ck = checks(t);

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  // --- withTaskCompletion: die eigentliche Datenkorrektur ---
  {
    const t = loadTasks();
    const base = { id: 'a', title: 'x', status: 'backlog', completed: false, completedAt: null, subtasks: [], labels: [] };
    const done = t.run(`withTaskCompletion(${JSON.stringify(base)}, true)`);
    ck('completing sets status done', done.status === 'done' && done.completed === true);
    ck('completing stamps completedAt', Number.isFinite(done.completedAt) && done.completedAt > 0, String(done.completedAt));
    ck('and touches updatedAt', Number.isFinite(done.updatedAt));

    const reopened = t.run(`withTaskCompletion(${JSON.stringify(done)}, false)`);
    ck('reopening clears completedAt', reopened.completedAt === null, String(reopened.completedAt));
    ck('reopening leaves done behind', reopened.status !== 'done' && reopened.completed === false, reopened.status);

    const already = { ...done, completedAt: 1000 };
    const again = t.run(`withTaskCompletion(${JSON.stringify(already)}, true)`);
    ck('re-completing keeps the original timestamp', again.completedAt === 1000, String(again.completedAt));

    const forced = t.run(`withTaskCompletion(${JSON.stringify(base)}, false, 'waiting')`);
    ck('an explicit status wins', forced.status === 'waiting', forced.status);
  }

  // --- Belohnung: Animation und Ton ---
  {
    const t = loadTasks();
    const anchor = t.mkEl('input');
    t.run('globalThis.__anchor = null;');
    const fire = () => { t.run('celebrateTaskCompletion(globalThis.__anchor)'); };
    t.run('globalThis.__anchor = document.createElement("input")');
    fire();
    await sleep(20);
    ck('a burst layer is created', t.log.layers.length === 1, String(t.log.layers.length));
    ck('one animation per particle', t.log.animations === 14, String(t.log.animations));
    ck('the row is pulsed', t.log.pulses.length >= 1, String(t.log.pulses.length));
    ck('two oscillators for the two notes', t.log.oscillators.length === 2, String(t.log.oscillators.length));
    ck('audio context created lazily', t.log.contextCreated === true);
  }

  // --- Ton abschaltbar, Animation bleibt ---
  {
    const t = loadTasks({ settings: { celebrateTasksSound: false } });
    t.run('globalThis.__anchor = document.createElement("input"); celebrateTaskCompletion(globalThis.__anchor);');
    await sleep(20);
    ck('sound off still animates', t.log.animations === 14, String(t.log.animations));
    ck('and plays nothing', t.log.oscillators.length === 0, String(t.log.oscillators.length));
  }

  // --- Ganz abschaltbar ---
  {
    const t = loadTasks({ settings: { celebrateTasks: false } });
    t.run('globalThis.__anchor = document.createElement("input"); celebrateTaskCompletion(globalThis.__anchor);');
    await sleep(20);
    ck('off means no animation', t.log.animations === 0, String(t.log.animations));
    ck('off means no sound', t.log.oscillators.length === 0, String(t.log.oscillators.length));
  }

  // --- prefers-reduced-motion unterdrueckt die Animation, nicht den Ton ---
  {
    const t = loadTasks();
    t.setMatchMedia(true);
    t.run('globalThis.__anchor = document.createElement("input"); celebrateTaskCompletion(globalThis.__anchor);');
    await sleep(20);
    ck('reduced motion skips the burst', t.log.animations === 0, String(t.log.animations));
    ck('but the chime still plays', t.log.oscillators.length === 2, String(t.log.oscillators.length));
  }

  await ck.settled();
});
