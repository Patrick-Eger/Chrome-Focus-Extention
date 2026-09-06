import { test } from 'node:test';
import { loadPage } from './helpers/page.mjs';
import { checks } from './helpers/check.mjs';

test('routines panel', async (t) => {
  const ck = checks(t);

  const p = loadPage({
    workspaces: [{ id: 'w1', name: 'Work' }], projects: [], notes: [], tasks: [], reminders: [],
    dailyPlans: { '2026-09-07': [
      { id: 'sd--2026-09-07', seriesId: 'sd', title: 'Standup', time: '09:00', duration: 15, status: 'planned' },
      { id: 'plain', title: 'One-off', time: '11:00', duration: 60, status: 'planned' }
    ] },
    calendarEvents: [],
    recurringSeries: [
      { id: 'sd', kind: 'block', title: 'Standup', time: '09:00', duration: 15, active: true,
        rule: { freq: 'weekdays', interval: 1, weekdays: [], monthDay: 7 }, startDate: '2026-09-07', skipDates: [] },
      { id: 'wk', kind: 'block', title: 'Weekly review', time: '16:00', duration: 45, active: false,
        rule: { freq: 'weekly', interval: 2, weekdays: [5], monthDay: 1 }, startDate: '2026-09-04', skipDates: [] },
      { id: 'mt', kind: 'task', title: 'Water plants', active: true,
        rule: { freq: 'monthly', interval: 1, weekdays: [], monthDay: 15 }, startDate: '2026-09-15', skipDates: [] }
    ],
    settings: { calendarDayStart: '07:00', calendarDayEnd: '21:00' }
  });

  // --- Beschreibung der Regeln ---
  const d = (id) => p.run(`describeRecurrence(state.recurringSeries.find((s) => s.id === ${JSON.stringify(id)}))`);
  ck('weekday rule described', d('sd') === 'Every weekday', d('sd'));
  ck('fortnightly rule names the day', /Every 2 weeks on \w+/.test(d('wk')), d('wk'));
  ck('monthly rule names the date', d('mt') === 'Every month on day 15', d('mt'));

  // --- Routinen-Liste ---
  const html = p.run("routinesOpen = true; renderRoutines(); document.querySelector('#routinesList').innerHTML");
  ck('lists every routine', (html.match(/review-row/g) || []).length === 3, String((html.match(/review-row/g) || []).length));
  ck('a paused routine says so', /· paused/.test(html));
  ck('paused one offers Resume', /Resume<\/button>/.test(html));
  ck('active one offers Pause', /Pause<\/button>/.test(html));
  ck('task routines show Task instead of a time', /<time>Task<\/time>/.test(html));
  ck('block routines show their time', /<time>09:00<\/time>/.test(html));

  // --- Zeitleiste markiert Serien-Bloecke ---
  const timeline = p.run(`
    const box = { innerHTML: '', classList: { add(){}, remove(){}, toggle(){}, contains(){return false} } };
    renderDayTimeline(box, '2026-09-07', { interactive: true });
    box.innerHTML;
  `);
  ck('a routine block is marked', /work-block-entry status-planned from-routine/.test(timeline));
  ck('a one-off block is not', (timeline.match(/from-routine/g) || []).length === 1, String((timeline.match(/from-routine/g) || []).length));

  await ck.settled();
});
