import { test } from 'node:test';
import { loadPage } from './helpers/page.mjs';
import { checks } from './helpers/check.mjs';

test('day scorecard', async (t) => {
  const ck = checks(t);

  const at = (dateKey, h, m = 0) => new Date(`${dateKey}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`).getTime();

  const TODAY = '2026-09-06';
  const YESTERDAY = '2026-09-05';

  const p = loadPage({
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Work' }],
    projects: [], notes: [],
    tasks: [
      { id: 'a', title: 'Done today 1', completed: true, completedAt: at(TODAY, 10) },
      { id: 'b', title: 'Done today 2', completed: true, completedAt: at(TODAY, 16) },
      { id: 'c', title: 'Done today 3', completed: true, completedAt: at(TODAY, 23, 59) },
      { id: 'd', title: 'Done yesterday', completed: true, completedAt: at(YESTERDAY, 9) },
      { id: 'e', title: 'Still open', completed: false, completedAt: null },
      { id: 'f', title: 'Done before the timestamp existed', completed: true, completedAt: null }
    ],
    reminders: [
      { id: 'r1', date: TODAY, time: '10:00', title: 'Call', status: 'done' },
      { id: 'r2', date: TODAY, time: '11:00', title: 'Other', status: 'scheduled' }
    ],
    dailyPlans: {
      [TODAY]: [
        { id: 'b1', title: 'Deep work', time: '09:00', duration: 90, status: 'completed' },
        { id: 'b2', title: 'Review', time: '11:00', duration: 30, status: 'completed' },
        { id: 'b3', title: 'Untouched', time: '14:00', duration: 60, status: 'planned' },
        { id: 'b4', title: 'Dropped', time: '16:00', duration: 60, status: 'cancelled' }
      ],
      [YESTERDAY]: [
        { id: 'y1', title: 'Yesterday work', time: '09:00', duration: 60, status: 'completed' }
      ]
    },
    settings: { calendarDayStart: '07:00', calendarDayEnd: '21:00' }
  });

  // --- Kennzahlen ---
  const today = p.run(`dayScorecard(${JSON.stringify(TODAY)})`);
  ck('counts only tasks finished on that day', today.tasksDone === 3, String(today.tasksDone));
  ck('a task without a timestamp is not attributed', today.tasksDone === 3);
  ck('counts completed blocks', today.blocksDone === 2, String(today.blocksDone));
  ck('planned excludes the cancelled block', today.blocksPlanned === 3, String(today.blocksPlanned));
  ck('focused minutes sum the completed blocks', today.focusMinutes === 120, String(today.focusMinutes));
  ck('planned minutes exclude the cancelled block', today.plannedMinutes === 180, String(today.plannedMinutes));
  ck('counts finished reminders only', today.remindersDone === 1, String(today.remindersDone));

  const yesterday = p.run(`dayScorecard(${JSON.stringify(YESTERDAY)})`);
  ck('yesterday measured separately', yesterday.tasksDone === 1 && yesterday.focusMinutes === 60, `${yesterday.tasksDone}/${yesterday.focusMinutes}`);

  // --- Vortagsberechnung, auch ueber Monatsgrenzen ---
  ck('previous day', p.run("previousDateKey('2026-09-06')") === '2026-09-05');
  ck('previous day across a month boundary', p.run("previousDateKey('2026-09-01')") === '2026-08-31', p.run("previousDateKey('2026-09-01')"));
  ck('previous day across a year boundary', p.run("previousDateKey('2026-01-01')") === '2025-12-31', p.run("previousDateKey('2026-01-01')"));

  // --- Vergleichsanzeige ---
  const html = p.run(`renderDayScorecard(${JSON.stringify(TODAY)})`);
  ck('shows tasks finished', /Tasks finished/.test(html));
  ck('reports the gain over yesterday', /\+2 vs the day before/.test(html), (html.match(/[+−]\d+ vs the day before/g) || []).join(' | '));
  ck('focus minutes compared too', /\+60 vs the day before/.test(html));
  ck('shows what was planned alongside', /of 3 planned/.test(html) && /of 180 planned/.test(html));
  ck('reminders shown because there were some', /Reminders done/.test(html));

  const quiet = p.run(`renderDayScorecard('2026-09-20')`);
  ck('a day with nothing says so plainly', /Nothing finished/.test(quiet), quiet);

  // eine Verschlechterung muss auch als solche erscheinen
  const worse = p.run(`renderDayScorecard(${JSON.stringify(YESTERDAY)})`);
  ck('a weaker day is not dressed up', /vs the day before/.test(worse), (worse.match(/[+−]\d+ vs the day before/g) || []).join(' | '));

  await ck.settled();
});
