import { test } from 'node:test';
import { makeWorker } from './helpers/worker.mjs';
import { checks } from './helpers/check.mjs';

test('calendar sync resilience', async (t) => {
  const ck = checks(t);

  const seed = () => ({
    storageVersion: 16, migratedLegacyData: true,
    calendarList: [
      { id: 'good', name: 'Work', selected: true, primary: true, backgroundColor: '#fff', accessRole: 'owner' },
      { id: 'broken', name: 'Shared team', selected: true, backgroundColor: '#fff', accessRole: 'reader' }
    ],
    calendarSyncTokens: {}, calendarEvents: [], calendarConnected: true,
    dailyPlans: {}, settings: {}
  });

  // Ein Kalender antwortet mit 403 (Freigabe entzogen), der andere funktioniert
  const makeFetch = (failFor) => async (url) => {
    if (url.includes(encodeURIComponent(failFor))) {
      return { ok: false, status: 403, json: async () => ({ error: { message: 'Forbidden' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ items: [], nextSyncToken: 'tok-good' }) };
  };

  {
    const w = makeWorker({ store: seed(), fetchImpl: makeFetch('broken') });
    const res = await w.api.syncCalendars(false);
    ck('the working calendar still syncs', w.store.calendarSyncTokens.good === 'tok-good', JSON.stringify(w.store.calendarSyncTokens));
    ck('sync completes instead of throwing', !!res.calendarLastSyncedAt);
    ck('the broken one is reported back', res.calendarErrors.length === 1 && res.calendarErrors[0].calendarId === 'broken', JSON.stringify(res.calendarErrors.map(e => e.calendarId)));
    const broken = w.store.calendarList.find(c => c.id === 'broken');
    const good = w.store.calendarList.find(c => c.id === 'good');
    ck('the failure is recorded on that calendar', !!broken.syncError, broken.syncError);
    ck('and not on the working one', !good.syncError);
    ck('last-synced timestamp still written', w.store.calendarLastSyncedAt > 0);
  }

  // Erholung: der Kalender geht wieder
  {
    const store = seed();
    store.calendarList[1].syncError = 'Forbidden';
    store.calendarList[1].syncErrorAt = 1;
    const w = makeWorker({ store, fetchImpl: makeFetch('nothing-fails') });
    await w.api.syncCalendars(false);
    const broken = w.store.calendarList.find(c => c.id === 'broken');
    ck('a recovered calendar clears its error', !broken.syncError, JSON.stringify(broken.syncError));
  }

  // Alle Kalender kaputt -> ehrlich scheitern statt so zu tun als sei alles gut
  {
    const w = makeWorker({ store: seed(), fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'Not Found' } }) }) });
    let err = '';
    try { await w.api.syncCalendars(false); } catch (e) { err = e.message; }
    ck('all failing still raises', /None of the 2 selected calendars/.test(err), err);
  }

  // Fehlerzustand ueberlebt die Normalisierung
  {
    const store = seed();
    store.calendarList[1].syncError = 'Forbidden';
    const w = makeWorker({ store });
    await w.api.initialize();
    const broken = w.store.calendarList.find(c => c.id === 'broken');
    ck('syncError survives a worker restart', broken.syncError === 'Forbidden', JSON.stringify(broken.syncError));
  }

  await ck.settled();
});
