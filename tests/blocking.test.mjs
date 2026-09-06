import { test } from 'node:test';
import { makeWorker } from './helpers/worker.mjs';
import { checks } from './helpers/check.mjs';

test('focus blocking rule', async (t) => {
  const ck = checks(t);
  const base = (settings) => ({
    storageVersion: 16, migratedLegacyData: true, settings,
    activeWorkspaceId: 'w',
    workspaces: [{ id: 'w', name: 'Dev', domains: ['localhost', 'example.com'], tabs: [], favorites: [] }],
    focus: { active: true, endAt: Date.now() + 600000, workspaceId: 'w' },
    temporaryAccess: {}
  });
  const runRule = async (store, existing = []) => {
    const w = makeWorker({ store });
    let written = null;
    w.chrome.declarativeNetRequest.getDynamicRules = async () => existing;
    w.chrome.declarativeNetRequest.updateDynamicRules = async (arg) => { written = arg; };
    await w.api.applyBlockRuleUpdate();
    return written;
  };

  const on = await runRule(base({ focusBlocksSites: true }));
  ck('blocking on writes a rule', on && on.addRules.length === 1);
  const excluded = (on && on.addRules[0].condition.excludedRequestDomains) || [];
  ck('localhost is excluded from blocking', excluded.includes('localhost'), excluded.join(','));

  const off = await runRule(base({ focusBlocksSites: false }));
  ck('blocking off adds no rule', !off || !off.addRules.length, JSON.stringify(off && off.addRules));

  // Turning it off mid-session has to lift the rule already in place.
  const lifted = await runRule(base({ focusBlocksSites: false }), [{ id: 1, priority: 1, action: {}, condition: {} }]);
  ck('an existing rule is removed when switched off', (lifted.removeRuleIds || []).includes(1), JSON.stringify(lifted));

  const missing = await runRule(base({}));
  ck('a missing setting still blocks', missing && missing.addRules.length === 1);

  // Temporary access must not outlive the session that granted it.
  const w = makeWorker({ store: {
    storageVersion: 16, migratedLegacyData: true,
    temporaryAccess: { 'reddit.com': Date.now() + 900000 },
    focus: { active: true, endAt: Date.now() + 60000, workspaceId: 'default' }
  } });
  await w.api.ensureInitialized();
  w.chrome.alarms.create('temporary-access:reddit.com', { when: Date.now() + 900000 });
  await w.api.stopFocus();
  ck('temporary access cleared when focus stops', Object.keys(w.store.temporaryAccess).length === 0,
    JSON.stringify(w.store.temporaryAccess));
  const leftover = (await w.chrome.alarms.getAll()).filter((a) => a.name.startsWith('temporary-access:'));
  ck('and its alarm is gone', leftover.length === 0, JSON.stringify(leftover.map((a) => a.name)));

  await ck.settled();
});
