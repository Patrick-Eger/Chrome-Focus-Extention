import { test } from 'node:test';
import { makeWorker } from './helpers/worker.mjs';
import { checks } from './helpers/check.mjs';

test('materialising routines', async (t) => {
  const ck = checks(t);

  // The queue-based paths use the real clock, so the fixture has to as well.
  const TODAY = new Date(); TODAY.setHours(12, 0, 0, 0);
  const key = (o) => { const d = new Date(TODAY); d.setDate(d.getDate() + o); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); };

  const base = (series) => ({
    storageVersion: 16, migratedLegacyData: true,
    recurringSeries: series, dailyPlans: {}, tasks: []
  });
  const blockSeries = { id: 'sd', kind: 'block', title: 'Standup', time: '09:00', duration: 15,
    workspaceId: 'default', startDate: key(0), rule: { freq: 'daily', interval: 1 } };

  // --- Bloecke ---
  {
    const w = makeWorker({ store: base([blockSeries]) });
    const patch = w.api.materializeRecurringSeries(w.store, TODAY);
    const days = Object.keys(patch.dailyPlans).sort();
    ck('writes the whole horizon', days.length === 21, String(days.length));
    ck('one block per day', Object.values(patch.dailyPlans).every((b) => b.length === 1));
    const first = patch.dailyPlans[key(0)][0];
    ck('block carries its series id', first.seriesId === 'sd', first.seriesId);
    ck('block takes the series time and length', first.time === '09:00' && first.duration === 15);
    ck('occurrence id is stable per day', first.id === `sd--${key(0)}`, first.id);
  }

  // --- Idempotenz: zweiter Lauf darf nichts doppeln ---
  {
    const store = base([blockSeries]);
    const w = makeWorker({ store });
    Object.assign(store, w.api.materializeRecurringSeries(store, TODAY));
    const again = w.api.materializeRecurringSeries(store, TODAY);
    ck('a second run adds nothing', !again.dailyPlans, JSON.stringify(Object.keys(again)));
  }

  // --- Bearbeitete Vorkommen bleiben unangetastet ---
  {
    const store = base([blockSeries]);
    const w = makeWorker({ store });
    Object.assign(store, w.api.materializeRecurringSeries(store, TODAY));
    store.dailyPlans[key(1)][0].time = '14:30';
    store.dailyPlans[key(1)][0].title = 'Moved standup';
    store.dailyPlans[key(2)][0].status = 'completed';
    const again = w.api.materializeRecurringSeries(store, TODAY);
    ck('materialising again leaves edits alone', !again.dailyPlans);
    ck('the moved time survives', store.dailyPlans[key(1)][0].time === '14:30');
    ck('a completed occurrence stays completed', store.dailyPlans[key(2)][0].status === 'completed');
  }

  // --- Aufgaben-Serien ---
  {
    const w = makeWorker({ store: base([{ id: 'st', kind: 'task', title: 'Water plants',
      workspaceId: 'default', startDate: key(0), rule: { freq: 'weekly', weekdays: [1] } }]) });
    const patch = w.api.materializeRecurringSeries(w.store, TODAY);
    ck('task series produces tasks, not blocks', !!patch.tasks && !patch.dailyPlans, JSON.stringify(Object.keys(patch)));
    ck('three Mondays inside a 21-day horizon', patch.tasks.length === 3, String(patch.tasks.length));
    ck('each planned on its day', patch.tasks.every((t) => t.plannedDate && t.seriesId === 'st'));
    ck('and starts out open', patch.tasks.every((t) => !t.completed));
  }

  // --- Eine Ausnahme entfernt genau ein Vorkommen und haelt es fern ---
  {
    const store = base([blockSeries]);
    const w = makeWorker({ store });
    await w.api.applyRecurrence();
    ck('materialised through the queue', Object.keys(store.dailyPlans).length === 21, String(Object.keys(store.dailyPlans).length));
    await w.api.skipSeriesOccurrence('sd', key(3));
    ck('the occurrence is gone', (store.dailyPlans[key(3)] || []).length === 0, JSON.stringify(store.dailyPlans[key(3)]));
    ck('the skip is recorded on the series', store.recurringSeries[0].skipDates.includes(key(3)), JSON.stringify(store.recurringSeries[0].skipDates));
    await w.api.applyRecurrence();
    ck('and it does not come back', (store.dailyPlans[key(3)] || []).length === 0, JSON.stringify(store.dailyPlans[key(3)]));
    ck('the other days are untouched', store.dailyPlans[key(4)].length === 1);
  }

  // --- Serie loeschen: Zukunft raeumen, Vergangenheit und Erledigtes behalten ---
  {
    const store = base([blockSeries]);
    const w = makeWorker({ store });
    await w.api.applyRecurrence();
    store.dailyPlans[key(-2)] = [{ id: 'sd--past', seriesId: 'sd', title: 'Standup', time: '09:00', duration: 15, status: 'completed' }];
    store.dailyPlans[key(5)][0].status = 'completed';
    await w.api.deleteRecurringSeries('sd', false);
    ck('the series is gone', store.recurringSeries.length === 0);
    ck('future planned occurrences removed', (store.dailyPlans[key(6)] || []).length === 0, JSON.stringify(store.dailyPlans[key(6)]));
    ck('a completed future one is kept as a record', store.dailyPlans[key(5)].length === 1, JSON.stringify(store.dailyPlans[key(5)]));
    ck('the past is left alone', store.dailyPlans[key(-2)].length === 1);
  }

  // --- Serie speichern materialisiert sofort ---
  {
    const store = base([]);
    const w = makeWorker({ store });
    await w.api.saveRecurringSeries({ kind: 'block', title: 'Review', time: '16:00', duration: 30,
      startDate: key(0), rule: { freq: 'weekdays' } });
    ck('saving creates the series', store.recurringSeries.length === 1);
    ck('and writes its occurrences at once', Object.keys(store.dailyPlans).length > 0, String(Object.keys(store.dailyPlans).length));
    const weekend = Object.entries(store.dailyPlans).filter(([k]) => [0, 6].includes(new Date(`${k}T12:00:00`).getDay()));
    ck('weekday rule wrote nothing on weekends', weekend.every(([, b]) => b.length === 0), JSON.stringify(weekend.map(([k, b]) => [k, b.length])));
  }

  await ck.settled();
});
