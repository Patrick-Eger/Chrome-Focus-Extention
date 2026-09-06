import { test } from 'node:test';
import { loadPage } from './helpers/page.mjs';
import { checks } from './helpers/check.mjs';

const today = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};
const shift = (days) => {
  const d = new Date(); d.setDate(d.getDate() + days);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};

const page = () => loadPage({
  workspaces: [], projects: [], reminders: [], tasks: [], dailyPlans: {}, calendarEvents: [],
  notes: [{ id: 'n1', title: 'Sync notes', body: '' }],
  flashcards: [
    { id: 'c1', noteId: 'n1', question: 'Due today', answer: 'A1', dueDate: today(), interval: 0, easeFactor: 2.5, repetitions: 0, lapses: 0 },
    { id: 'c2', noteId: 'n1', question: 'Overdue', answer: 'A2', dueDate: shift(-3), interval: 6, easeFactor: 2.5, repetitions: 2, lapses: 1 },
    { id: 'c3', noteId: null, question: 'Later', answer: 'A3', dueDate: shift(10), interval: 30, easeFactor: 2.6, repetitions: 4, lapses: 0 }
  ],
  settings: {}
});

test('flashcard view', async (t) => {
  const ck = checks(t);
  const p = page();

  const due = p.run('dueFlashcards().map((c) => c.id)');
  ck('due covers today and anything overdue', due.join(',') === 'c1,c2', due.join(','));
  ck('and leaves the future alone', !due.includes('c3'));

  p.run('renderCards()');
  ck('the nav count shows what is due', String(p.run("document.querySelector('#cardCount').textContent")) === '2',
    String(p.run("document.querySelector('#cardCount').textContent")));
  ck('the summary names both numbers', /2 cards due of 3/.test(p.run("document.querySelector('#cardsSummary').textContent")),
    p.run("document.querySelector('#cardsSummary').textContent"));

  const list = p.run("document.querySelector('#cardsList').innerHTML");
  const rows = list.match(/class="card-row(?: due)?"/g) || [];
  ck('every card is listed', rows.length === 3, String(rows.length));
  ck('due cards are marked', (list.match(/card-row due/g) || []).length === 2, String((list.match(/card-row due/g) || []).length));
  ck('the source note is named', /Sync notes/.test(list));
  ck('a card without a note says so', /No note/.test(list));
  ck('a new card is labelled new', /· new/.test(list));
  ck('a reviewed card shows its count', /2 reviews/.test(list));
  ck('lapses are shown when there are any', /1 lapse/.test(list));
  ck('every card offers edit and delete', (list.match(/data-edit-card/g) || []).length === 3
    && (list.match(/data-delete-card/g) || []).length === 3);

  // The grade buttons promise a specific next interval; it has to match the
  // worker's schedule or the promise is a lie.
  const preview = (id, grade) => p.run(`gradePreview(state.flashcards.find((c) => c.id === ${JSON.stringify(id)}), ${JSON.stringify(grade)})`);
  ck('again offers to come back today', preview('c1', 'again') === 'today', preview('c1', 'again'));
  ck('a new card graded good returns tomorrow', preview('c1', 'good') === 'tomorrow', preview('c1', 'good'));
  // Compared on the interval, not the label: 78 and 101 days both round to "3 months".
  const span = (id, grade) => p.run(`previewSchedule(state.flashcards.find((c) => c.id === ${JSON.stringify(id)}), ${JSON.stringify(grade)}).interval`);
  ck('easy reaches further out than good', span('c3', 'easy') > span('c3', 'good'),
    `${span('c3', 'easy')} vs ${span('c3', 'good')} days`);
  ck('long intervals read as months', /months|years/.test(preview('c3', 'good')), preview('c3', 'good'));

  // An empty library must not offer a study session.
  const empty = loadPage({ workspaces: [], projects: [], notes: [], reminders: [], tasks: [],
    dailyPlans: {}, calendarEvents: [], flashcards: [], settings: {} });
  empty.run('renderCards()');
  ck('no cards means nothing due', String(empty.run("document.querySelector('#cardCount').textContent")) === '0');
  ck('and study is unavailable', empty.run("document.querySelector('#startStudy').disabled") === true);
  ck('with a plain explanation', /No cards yet/.test(empty.run("document.querySelector('#cardsSummary').textContent")));

  await ck.settled();
});

test('flashcard preview matches the worker', async (t) => {
  const ck = checks(t);
  const { makeWorker } = await import('./helpers/worker.mjs');
  const { api } = makeWorker({ store: {} });
  const p = page();

  // Two implementations of SM-2 exist: the worker schedules, the page previews.
  // They must not drift.
  for (const id of ['c1', 'c2', 'c3']) {
    for (const grade of ['again', 'hard', 'good', 'easy']) {
      const card = p.run(`state.flashcards.find((c) => c.id === ${JSON.stringify(id)})`);
      const scheduled = api.scheduleFlashcard(api.normalizeFlashcard(card), grade);
      const previewed = p.run(`previewSchedule(state.flashcards.find((c) => c.id === ${JSON.stringify(id)}), ${JSON.stringify(grade)})`);
      ck(`preview matches the schedule for ${id}/${grade}`, previewed.interval === scheduled.interval,
        `preview ${previewed.interval} vs worker ${scheduled.interval}`);
    }
  }

  await ck.settled();
});
