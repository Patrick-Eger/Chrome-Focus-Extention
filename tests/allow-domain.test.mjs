import { test } from 'node:test';
import { makeWorker } from './helpers/worker.mjs';
import { checks } from './helpers/check.mjs';

const base = () => ({
  storageVersion: 16, migratedLegacyData: true,
  activeWorkspaceId: 'w2',
  workspaces: [
    { id: 'w1', name: 'Other', domains: ['already.com'], tabs: [], favorites: [] },
    { id: 'w2', name: 'Deep work', domains: ['docs.example.com'], tabs: [], favorites: [] }
  ],
  focus: { active: true, endAt: Date.now() + 600000, workspaceId: 'w2' },
  temporaryAccess: {}, settings: { focusBlocksSites: true }
});

test('allowing a blocked site permanently', async (t) => {
  const ck = checks(t);

  {
    const w = makeWorker({ store: base() });
    const result = await w.api.allowDomain('reddit.com');
    const active = w.store.workspaces.find((x) => x.id === 'w2');
    const other = w.store.workspaces.find((x) => x.id === 'w1');
    ck('added to the active workspace', active.domains.includes('reddit.com'), active.domains.join(','));
    ck('the existing entry is kept', active.domains.includes('docs.example.com'));
    ck('other workspaces are untouched', other.domains.join(',') === 'already.com', other.domains.join(','));
    ck('reports back what it did', result.domain === 'reddit.com' && result.workspaceName === 'Deep work',
      JSON.stringify(result));
    ck('not flagged as already allowed', result.alreadyAllowed === false);
  }

  // A full URL is what the blocked page actually has on hand.
  {
    const w = makeWorker({ store: base() });
    await w.api.allowDomain('https://www.reddit.com/r/all?x=1');
    const active = w.store.workspaces.find((x) => x.id === 'w2');
    ck('a pasted URL is reduced to its host', active.domains.includes('reddit.com'), active.domains.join(','));
    ck('and www is stripped', !active.domains.some((d) => d.startsWith('www.')));
  }

  // localhost was the case that used to be rejected outright.
  {
    const w = makeWorker({ store: base() });
    await w.api.allowDomain('http://localhost:5173/');
    ck('a local dev server can be allowed', w.store.workspaces.find((x) => x.id === 'w2').domains.includes('localhost'));
  }

  // Adding the same site twice must not duplicate it.
  {
    const w = makeWorker({ store: base() });
    await w.api.allowDomain('docs.example.com');
    const active = w.store.workspaces.find((x) => x.id === 'w2');
    ck('an existing site is not added twice',
      active.domains.filter((d) => d === 'docs.example.com').length === 1, active.domains.join(','));
    const second = await w.api.allowDomain('docs.example.com');
    ck('and it says so', second.alreadyAllowed === true);
  }

  // The blocked page navigates the moment this resolves, so the rule has to be
  // current by then - not merely rebuilt eventually by the storage listener.
  // Chrome dispatches storage.onChanged asynchronously, so the listener is
  // deferred here; that is what makes the awaited rebuild observable.
  {
    const w = makeWorker({ store: base() });
    let written = null;
    w.chrome.declarativeNetRequest.getDynamicRules = async () => [];
    w.chrome.declarativeNetRequest.updateDynamicRules = async (arg) => { written = arg; };
    const inlineSet = w.chrome.storage.local.set;
    w.chrome.storage.local.set = (patch) => {
      Object.assign(w.store, structuredClone(patch));
      setTimeout(() => inlineSet.call(w.chrome.storage.local, patch), 0);
      return Promise.resolve();
    };
    await w.api.allowDomain('reddit.com');
    const excluded = (written && written.addRules[0].condition.excludedRequestDomains) || [];
    ck('the blocking rule is current when the call resolves', excluded.includes('reddit.com'),
      written ? excluded.join(',') : 'no rule written yet');
  }

  {
    const w = makeWorker({ store: base() });
    let error = '';
    try { await w.api.allowDomain('not a host'); } catch (e) { error = e.message; }
    ck('junk is refused', /cannot be added/.test(error), error);
    error = '';
    try { await w.api.allowDomain(''); } catch (e) { error = e.message; }
    ck('an empty value is refused', /cannot be added/.test(error), error);
    ck('nothing was written on refusal',
      w.store.workspaces.find((x) => x.id === 'w2').domains.join(',') === 'docs.example.com');
  }

  await ck.settled();
});
