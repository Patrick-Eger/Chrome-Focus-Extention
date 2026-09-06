import { test } from 'node:test';
import { makeWorker } from './helpers/worker.mjs';
import { checks } from './helpers/check.mjs';

test('recurrence rules', async (t) => {
  const ck = checks(t);

  const w = makeWorker({ store: { storageVersion: 16, migratedLegacyData: true } });
  const { normalizeRecurringSeries: norm, seriesOccursOn: occurs } = w.api;

  const S = (over) => norm({ id: 's', kind: 'block', title: 'Standup', time: '09:00', duration: 15, startDate: '2026-09-07', ...over });
  // 2026-09-07 ist ein Montag
  const dow = (k) => new Date(`${k}T12:00:00`).getDay();
  ck('reference date is a Monday', dow('2026-09-07') === 1, String(dow('2026-09-07')));

  // --- daily ---
  {
    const s = S({ rule: { freq: 'daily', interval: 1 } });
    ck('daily fires on the start date', occurs(s, '2026-09-07'));
    ck('daily fires the next day', occurs(s, '2026-09-08'));
    ck('daily does not fire before it starts', !occurs(s, '2026-09-06'));
    const every3 = S({ rule: { freq: 'daily', interval: 3 } });
    ck('every 3 days hits day 0 and 3', occurs(every3, '2026-09-07') && occurs(every3, '2026-09-10'));
    ck('and skips days 1 and 2', !occurs(every3, '2026-09-08') && !occurs(every3, '2026-09-09'));
  }

  // --- weekdays ---
  {
    const s = S({ rule: { freq: 'weekdays' } });
    ck('weekdays fires Monday to Friday', ['2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11'].every(k => occurs(s, k)));
    ck('and not on the weekend', !occurs(s, '2026-09-12') && !occurs(s, '2026-09-13'), `Sa=${dow('2026-09-12')} So=${dow('2026-09-13')}`);
  }

  // --- weekly ---
  {
    const s = S({ rule: { freq: 'weekly', interval: 1, weekdays: [1, 3] } });
    ck('weekly fires on the chosen days', occurs(s, '2026-09-07') && occurs(s, '2026-09-09'));
    ck('weekly ignores other days', !occurs(s, '2026-09-08'));
    ck('weekly repeats next week', occurs(s, '2026-09-14') && occurs(s, '2026-09-16'));

    // Alle zwei Wochen, gestartet an einem Mittwoch, gewaehlt: Montag
    const biweekly = norm({ id: 'b', kind: 'block', title: 'x', startDate: '2026-09-09', rule: { freq: 'weekly', interval: 2, weekdays: [1] } });
    ck('a fortnightly rule counts from the start week, not the start day',
      occurs(biweekly, '2026-09-14') && !occurs(biweekly, '2026-09-21') && occurs(biweekly, '2026-09-28'),
      `14=${occurs(biweekly,'2026-09-14')} 21=${occurs(biweekly,'2026-09-21')} 28=${occurs(biweekly,'2026-09-28')}`);

    const noDays = norm({ id: 'n', kind: 'block', title: 'x', startDate: '2026-09-09', rule: { freq: 'weekly', weekdays: [] } });
    ck('a weekly rule with no days falls back to the start weekday', noDays.rule.weekdays.join() === String(dow('2026-09-09')), noDays.rule.weekdays.join());
  }

  // --- monthly ---
  {
    const s = norm({ id: 'm', kind: 'block', title: 'x', startDate: '2026-09-15', rule: { freq: 'monthly', interval: 1, monthDay: 15 } });
    ck('monthly fires on its day', occurs(s, '2026-09-15') && occurs(s, '2026-10-15'));
    ck('monthly ignores other days', !occurs(s, '2026-10-14'));
    const q = norm({ id: 'q', kind: 'block', title: 'x', startDate: '2026-09-15', rule: { freq: 'monthly', interval: 3, monthDay: 15 } });
    ck('every 3 months skips the months between', occurs(q, '2026-12-15') && !occurs(q, '2026-10-15'));
    const day31 = norm({ id: 'd', kind: 'block', title: 'x', startDate: '2026-01-31', rule: { freq: 'monthly', monthDay: 31 } });
    ck('a 31st rule simply skips February', !occurs(day31, '2026-02-28') && occurs(day31, '2026-03-31'));
  }

  // --- Grenzen und Ausnahmen ---
  {
    const s = S({ rule: { freq: 'daily' }, endDate: '2026-09-09' });
    ck('nothing after the end date', occurs(s, '2026-09-09') && !occurs(s, '2026-09-10'));
    const skipped = S({ rule: { freq: 'daily' }, skipDates: ['2026-09-08'] });
    ck('a skipped date does not fire', !occurs(skipped, '2026-09-08') && occurs(skipped, '2026-09-09'));
    const paused = S({ rule: { freq: 'daily' }, active: false });
    ck('an inactive series never fires', !occurs(paused, '2026-09-07'));
  }

  await ck.settled();
});
