import { test } from 'node:test';
import { makeWorker } from './helpers/worker.mjs';
import { checks } from './helpers/check.mjs';

test('notion sync', async (t) => {
  const ck = checks(t);

  function notionStub({ pages = {}, failOn = null } = {}) {
    const calls = [];
    let idCounter = 0;
    return {
      calls,
      fetch: async (url, options = {}) => {
        const path = url.replace('https://api.notion.com/v1', '');
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ method: options.method || 'GET', path, body, headers: options.headers });
        if (failOn && failOn(path, options)) {
          return { ok: false, status: 404, text: async () => JSON.stringify({ message: 'Not found', code: 'object_not_found' }) };
        }
        let payload = { id: `id-${++idCounter}` };
        if (path === '/users/me') payload = { bot: { workspace_name: 'Patricks Workspace' } };
        else if (path.startsWith('/pages/') && (options.method || 'GET') === 'GET') {
          payload = pages[path.slice(7)] || { id: path.slice(7), archived: false, properties: { title: { type: 'title', title: [{ plain_text: 'Focus Desk' }] } } };
        } else if (path.startsWith('/blocks/') && path.includes('/children') && (options.method || 'GET') === 'GET') {
          payload = { results: [] };
        }
        return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
      }
    };
  }

  const seed = () => ({
    storageVersion: 16, migratedLegacyData: true,
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Work', domains: [], tabs: [], favorites: [] }],
    projects: [
      { id: 'p1', name: 'Alpha', workspaceId: 'w1', outcome: 'Ship it', description: '', status: 'active', links: [{ id: 'l1', url: 'https://example.com', title: 'Docs' }], archived: false },
      { id: 'p2', name: 'Archived one', workspaceId: 'w1', links: [], archived: true }
    ],
    tasks: [
      { id: 't1', projectId: 'p1', workspaceId: 'w1', title: 'Open task', status: 'in-progress', priority: 'high', completed: false, dueDate: '2026-09-10', labels: [], subtasks: [] },
      { id: 't2', projectId: 'p2', workspaceId: 'w1', title: 'Archived task', status: 'backlog', completed: false, labels: [], subtasks: [] }
    ],
    notes: [{ id: 'n1', projectId: 'p1', title: 'Design note', body: 'text' }],
    settings: { ...{}, notionToken: 'ntn_secret', notionParentPageId: 'a'.repeat(32) },
    notionSync: { taskDatabaseId: null, projects: {}, tasks: {}, notes: {}, lastSyncedAt: null, workspaceName: '' }
  });

  // --- Verbinden ---
  {
    const stub = notionStub();
    const w = makeWorker({ store: { storageVersion: 16, migratedLegacyData: true }, fetchImpl: stub.fetch });
    const res = await w.api.connectNotion({ token: 'ntn_x', parentPageId: 'b'.repeat(32) });
    ck('connect verifies the page and the bot', stub.calls.some(c => c.path.startsWith('/pages/')) && stub.calls.some(c => c.path === '/users/me'));
    ck('reports the workspace name', res.workspaceName === 'Patricks Workspace', res.workspaceName);
    ck('token stored', w.store.settings.notionToken === 'ntn_x');
    ck('auth header sent as bearer', stub.calls[0].headers.Authorization === 'Bearer ntn_x', stub.calls[0].headers.Authorization);
    ck('api version pinned', stub.calls[0].headers['Notion-Version'] === '2022-06-28');

    let err = '';
    try { await w.api.connectNotion({ token: 'x', parentPageId: 'not-a-page' }); } catch (e) { err = e.message; }
    ck('rejects a bad page id', /Notion page ID/.test(err), err);
    err = '';
    try { await w.api.connectNotion({ token: '', parentPageId: 'b'.repeat(32) }); } catch (e) { err = e.message; }
    ck('rejects an empty token', /integration token/.test(err), err);
  }

  // --- Erste Synchronisation ---
  {
    const stub = notionStub();
    const w = makeWorker({ store: seed(), fetchImpl: stub.fetch });
    const res = await w.api.syncNotion({ includeArchived: false });
    const dbCreate = stub.calls.find(c => c.path === '/databases' && c.method === 'POST');
    ck('creates the task database once', !!dbCreate);
    ck('database has the expected properties', dbCreate && ['Name','Status','Priority','Done','Due','Project','Focus Desk ID'].every(k => k in dbCreate.body.properties), Object.keys(dbCreate.body.properties).join(','));
    ck('database parented on the chosen page', dbCreate.body.parent.page_id === 'a'.repeat(32));

    const pageCreates = stub.calls.filter(c => c.path === '/pages' && c.method === 'POST');
    ck('archived project skipped', res.projectCount === 1, String(res.projectCount));
    ck('archived project task skipped', res.taskCount === 1, String(res.taskCount));
    const projectPage = pageCreates.find(c => c.body.parent.type === 'page_id');
    ck('project page created under the parent', !!projectPage);
    ck('project title written', projectPage.body.properties.title.title[0].text.content === 'Alpha');
    const blockTypes = projectPage.body.children.map(b => b.type);
    ck('project page carries outcome, links, tasks, notes', blockTypes.includes('heading_2') && blockTypes.includes('bookmark') && blockTypes.includes('to_do') && blockTypes.includes('bulleted_list_item'), blockTypes.join(','));

    const taskPage = pageCreates.find(c => c.body.parent.type === 'database_id');
    ck('task row created in the database', !!taskPage);
    ck('task carries its Focus Desk id', taskPage.body.properties['Focus Desk ID'].rich_text[0].text.content === 't1');
    ck('task status and due date mapped', taskPage.body.properties.Status.select.name === 'in-progress' && taskPage.body.properties.Due.date.start === '2026-09-10');
    ck('project name on the task', taskPage.body.properties.Project.rich_text[0].text.content === 'Alpha');
    ck('ids remembered for next time', !!w.store.notionSync.projects.p1 && !!w.store.notionSync.tasks.t1);
    ck('sync timestamp recorded', w.store.notionSync.lastSyncedAt > 0);
  }

  // --- Zweite Synchronisation aktualisiert, statt zu duplizieren ---
  {
    const stub = notionStub();
    const w = makeWorker({ store: seed(), fetchImpl: stub.fetch });
    await w.api.syncNotion({});
    const firstCreates = stub.calls.filter(c => c.path === '/pages' && c.method === 'POST').length;
    stub.calls.length = 0;
    await w.api.syncNotion({});
    const secondCreates = stub.calls.filter(c => c.path === '/pages' && c.method === 'POST').length;
    const patches = stub.calls.filter(c => c.method === 'PATCH' && c.path.startsWith('/pages/')).length;
    ck('second run creates nothing new', secondCreates === 0, `${firstCreates} -> ${secondCreates}`);
    ck('it patches the existing pages instead', patches === 2, String(patches));
    ck('and reuses the same database', !stub.calls.some(c => c.path === '/databases' && c.method === 'POST'));
  }

  // --- Seite in Notion geloescht -> neu anlegen statt scheitern ---
  {
    const stub = notionStub({ failOn: (path, o) => path.startsWith('/pages/') && (o.method || 'GET') === 'GET' });
    const store = seed();
    store.notionSync = { taskDatabaseId: 'db-1', projects: { p1: 'gone-1' }, tasks: { t1: 'gone-2' }, notes: {}, lastSyncedAt: 1, workspaceName: '' };
    const w = makeWorker({ store, fetchImpl: stub.fetch });
    await w.api.syncNotion({});
    const creates = stub.calls.filter(c => c.path === '/pages' && c.method === 'POST').length;
    ck('a page deleted in Notion is recreated', creates === 2, String(creates));
    ck('and the new ids replace the dead ones', w.store.notionSync.projects.p1 !== 'gone-1', w.store.notionSync.projects.p1);
  }

  // --- Ohne Verbindung ---
  {
    const w = makeWorker({ store: { storageVersion: 16, migratedLegacyData: true }, fetchImpl: notionStub().fetch });
    let err = '';
    try { await w.api.syncNotion({}); } catch (e) { err = e.message; }
    ck('sync without a connection is refused', /Connect Notion/.test(err), err);
  }

  // --- Token darf nicht in den Export ---
  {
    const w = makeWorker({ store: seed(), fetchImpl: notionStub().fetch });
    const ex = (await w.api.exportData()).export;
    ck('notion token excluded from the export', !('notionToken' in ex.data.settings), JSON.stringify(Object.keys(ex.data.settings).filter(k => k.startsWith('notion'))));
    ck('but the parent page is kept', ex.data.settings.notionParentPageId === 'a'.repeat(32));
  }

  await ck.settled();
});
