import { test } from 'node:test';
import { makeWorker } from './helpers/worker.mjs';
import { checks } from './helpers/check.mjs';

test('host allowlists', async (t) => {
  const ck = checks(t);
  const { api, store } = makeWorker({ store: {} });

  // A focus session has to be able to allow a local dev server; these all used to
  // be rejected as "not a domain" and silently stripped from the workspace.
  for (const [input, want] of [
    ['http://localhost:3000/app?x=1', 'localhost'],
    ['localhost:8080', 'localhost'],
    ['https://127.0.0.1:5173/', '127.0.0.1'],
    ['http://[::1]:3000/', '::1'],
    ['https://www.example.com/path', 'example.com'],
    ['http://my-nas/', 'my-nas'],
    ['http://app.localhost:3000', 'app.localhost']
  ]) {
    ck(`cleanDomain(${input})`, api.cleanDomain(input) === want, `${api.cleanDomain(input)} (want ${want})`);
  }

  for (const host of ['localhost', '127.0.0.1', '0.0.0.0', '192.168.1.20', '::1', 'my-nas',
    'app.localhost', 'example.com', 'sub.example.co.uk']) {
    ck(`accepts ${host}`, api.validateDomain(host) === true);
  }
  for (const junk of ['', '  ', 'not a host', 'http://x', '999.999.999.999', 'a'.repeat(300), 'foo..bar']) {
    ck(`rejects ${JSON.stringify(junk)}`, api.validateDomain(junk) === false);
  }

  const workspace = api.normalizeWorkspace(
    { id: 'w', name: 'Dev', domains: ['localhost', '127.0.0.1', 'example.com', 'garbage host'] }, 0);
  ck('localhost survives normalisation', workspace.domains.includes('localhost'), workspace.domains.join(','));
  ck('a private address survives too', workspace.domains.includes('127.0.0.1'));
  ck('junk is still dropped', !workspace.domains.includes('garbage host'), workspace.domains.join(','));

  const unlockable = makeWorker({ store: {
    storageVersion: 16, migratedLegacyData: true,
    settings: { unlockMinutes: 15 }, temporaryAccess: {}, focus: { active: false }
  } });
  let error = '';
  try {
    await unlockable.api.grantTemporaryAccess({ domain: 'http://localhost:3000/', minutes: 10 });
  } catch (e) { error = e.message; }
  ck('localhost can be unlocked temporarily', !error && !!unlockable.store.temporaryAccess.localhost,
    error || JSON.stringify(unlockable.store.temporaryAccess));

  await ck.settled();
});
