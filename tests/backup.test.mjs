import { test } from 'node:test';
import { makeWorker } from './helpers/worker.mjs';
import { checks } from './helpers/check.mjs';

test('export and import', async (t) => {
  const ck = checks(t);

  const seed = () => ({
    storageVersion: 16, migratedLegacyData: true,
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Work', color: '#E4002B', domains: ['localhost'], tabs: [], favorites: [] }],
    projects: [{ id: 'p1', name: 'Alpha', workspaceId: 'w1', links: [] }],
    projectGroups: [], inboxItems: [{ id: 'i1', title: 'Read this', type: 'link', status: 'open' }],
    tasks: [{ id: 't1', title: 'Ship it', status: 'done', completed: true, completedAt: 5, subtasks: [], labels: [] }],
    notes: [{ id: 'n1', title: 'Note', body: 'text' }],
    flashcards: [], reminders: [{ id: 'r1', title: 'Call', date: '2026-09-09', time: '10:00' }],
    dailyPlans: { '2026-09-05': [{ id: 'b1', title: 'Work block', time: '09:00', duration: 60 }] },
    settings: { gateType: 'math', celebrateTasks: false },
    focus: { active: true, endAt: Date.now() + 600000, workspaceId: 'w1' },
    temporaryAccess: { 'reddit.com': Date.now() + 900000 },
    calendarAccount: { email: 'patrick@speechmind.de', id: '42' },
    calendarSyncTokens: { primary: 'secret-token' },
    calendarConnected: true,
    calendarEvents: [], calendarList: []
  });

  // --- Export ---
  const w = makeWorker({ store: seed() });
  const out = await w.api.exportData();
  const ex = out.export;
  ck('marked as a Focus Desk export', ex.format === 'focus-desk-export' && ex.formatVersion === 1);
  ck('carries a timestamp and version', ex.exportedAt > 0 && !!ex.extensionVersion, `${ex.extensionVersion}`);
  ck('projects included', ex.data.projects.length === 1);
  ck('tasks included with their completion', ex.data.tasks[0].completedAt === 5);
  ck('day plans included', Object.keys(ex.data.dailyPlans).length === 1);
  ck('settings included', ex.data.settings.celebrateTasks === false);
  ck('sync tokens NOT exported', !('calendarSyncTokens' in ex.data), JSON.stringify(Object.keys(ex.data).filter(k => k.startsWith('calendar'))));
  ck('google account NOT exported', !('calendarAccount' in ex.data));
  ck('connection flag NOT exported', !('calendarConnected' in ex.data));

  // --- Import in ein anderes Profil ---
  const target = makeWorker({ store: { storageVersion: 16, migratedLegacyData: true, projects: [{ id: 'old', name: 'Vorher' }], tasks: [] } });
  const res = await target.api.importData(ex);
  ck('import reports what it wrote', res.counts.projects === 1 && res.counts.tasks === 1, JSON.stringify(res.counts));
  ck('old data replaced', target.store.projects.length === 1 && target.store.projects[0].id === 'p1', JSON.stringify(target.store.projects.map(p => p.id)));
  ck('tasks restored', target.store.tasks[0].id === 't1');
  ck('workspaces restored', target.store.workspaces[0].domains.includes('localhost'));
  ck('day plans restored', Object.keys(target.store.dailyPlans).length === 1);
  ck('a live focus session is NOT restored', target.store.focus.active === false, JSON.stringify(target.store.focus.active));
  ck('temporary unlocks are NOT restored', Object.keys(target.store.temporaryAccess).length === 0, JSON.stringify(target.store.temporaryAccess));
  ck('normalisation ran on import', target.store.settings.gateType === 'math' && 'celebrateTasks' in target.store.settings);

  // --- Abwehr kaputter Dateien ---
  const bad = async (payload, why) => {
    try { await target.api.importData(payload); return `kein Fehler (${why})`; }
    catch (e) { return e.message; }
  };
  ck('rejects a foreign file', /not a Focus Desk export/.test(await bad({ format: 'something-else' })), await bad({ format: 'x' }));
  ck('rejects null', /not a Focus Desk export/.test(await bad(null)));
  ck('rejects a newer format', /newer version/.test(await bad({ format: 'focus-desk-export', formatVersion: 99, data: {} })));
  ck('rejects an empty export', /no data/.test(await bad({ format: 'focus-desk-export', formatVersion: 1 })));

  // --- Alter Export ohne neue Felder wird hochmigriert ---
  const oldExport = { format: 'focus-desk-export', formatVersion: 1, data: { storageVersion: 12, projects: [], tasks: [{ id: 'x', title: 'Alt' }], notes: [] } };
  const t2 = makeWorker({ store: { storageVersion: 16, migratedLegacyData: true } });
  await t2.api.importData(oldExport);
  ck('an older export gains current defaults', t2.store.settings.focusBlocksSites === true && t2.store.storageVersion === 16, `sv=${t2.store.storageVersion}`);
  ck('and its task survives', t2.store.tasks[0].title === 'Alt', JSON.stringify(t2.store.tasks.map(t => t.title)));

  await ck.settled();
});
