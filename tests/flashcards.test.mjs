import { test } from 'node:test';
import { makeWorker } from './helpers/worker.mjs';
import { checks } from './helpers/check.mjs';

const CURRENT_VERSION = makeWorker({}).storageVersion;

const NOW = new Date('2026-09-10T12:00:00');
const plus = (days) => {
  const d = new Date(NOW); d.setDate(d.getDate() + days);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
};

test('flashcard scheduling', async (t) => {
  const ck = checks(t);
  const { api } = makeWorker({ store: {} });
  const card = (over = {}) => api.normalizeFlashcard({ id: 'c', question: 'q', answer: 'a', ...over });
  const grade = (c, g) => api.scheduleFlashcard(c, g, NOW);

  // --- Defaults and migration of cards written before scheduling existed ---
  {
    const fresh = api.normalizeFlashcard({ id: 'old', question: 'q', answer: 'a', createdAt: Date.parse('2026-01-05T00:00:00') });
    ck('an unscheduled card starts at ease 2.5', fresh.easeFactor === 2.5, String(fresh.easeFactor));
    ck('with no repetitions', fresh.repetitions === 0 && fresh.interval === 0);
    ck('and is due from the day it was made', fresh.dueDate === '2026-01-05', fresh.dueDate);
    ck('a card missing a question survives normalisation', api.normalizeFlashcard({}).question === '');
  }

  // --- The four grades ---
  {
    const first = grade(card(), 'good');
    ck('first good schedules one day out', first.interval === 1 && first.dueDate === plus(1), `${first.interval}/${first.dueDate}`);
    const second = grade(first, 'good');
    ck('second good jumps to six days', second.interval === 6 && second.dueDate === plus(6), String(second.interval));
    const third = grade(second, 'good');
    ck('third good multiplies by the ease', third.interval === Math.round(6 * 2.5), String(third.interval));
    ck('good leaves the ease alone', third.easeFactor === 2.5, String(third.easeFactor));
  }
  {
    const easy = grade(grade(grade(card(), 'good'), 'good'), 'easy');
    const good = grade(grade(grade(card(), 'good'), 'good'), 'good');
    ck('easy pushes further out than good', easy.interval > good.interval, `${easy.interval} > ${good.interval}`);
    ck('and raises the ease', easy.easeFactor > 2.5, String(easy.easeFactor));
  }
  {
    const hard = grade(grade(card(), 'good'), 'hard');
    ck('hard still advances, but barely', hard.interval >= 1 && hard.interval < 6, String(hard.interval));
    ck('and lowers the ease', hard.easeFactor < 2.5, String(hard.easeFactor));
  }
  {
    const lapsed = grade(grade(grade(card(), 'good'), 'good'), 'again');
    ck('again resets the streak', lapsed.repetitions === 0 && lapsed.interval === 0);
    ck('again brings it back the same day', lapsed.dueDate === plus(0), lapsed.dueDate);
    ck('again counts a lapse', lapsed.lapses === 1, String(lapsed.lapses));
    ck('and drops the ease', lapsed.easeFactor < 2.5, String(lapsed.easeFactor));
  }

  // --- Ease stays inside its bounds ---
  {
    let c = card();
    for (let i = 0; i < 20; i += 1) c = grade(c, 'again');
    ck('ease never falls below 1.3', c.easeFactor === 1.3, String(c.easeFactor));
    let e = card();
    for (let i = 0; i < 20; i += 1) e = grade(e, 'easy');
    ck('ease never climbs above 3', e.easeFactor === 3, String(e.easeFactor));
    ck('the interval is capped at ten years', e.interval === 3650, String(e.interval));
    ck('and the due date stays a real date', /^\d{4}-\d{2}-\d{2}$/.test(e.dueDate), e.dueDate);
  }

  ck('every review stamps the time', grade(card(), 'good').lastReviewedAt === NOW.getTime());

  await ck.settled();
});

test('flashcard storage', async (t) => {
  const ck = checks(t);
  const base = () => ({
    storageVersion: CURRENT_VERSION, migratedLegacyData: true,
    flashcards: [{ id: 'c1', noteId: 'n1', question: 'Q1', answer: 'A1', createdAt: 1000 }],
    notes: []
  });

  {
    const w = makeWorker({ store: base() });
    const result = await w.api.reviewFlashcard('c1', 'good');
    ck('review is written back', w.store.flashcards[0].repetitions === 1, JSON.stringify(w.store.flashcards[0].repetitions));
    ck('and reported to the caller', result.card.interval === 1, JSON.stringify(result.card.interval));
    let error = '';
    try { await w.api.reviewFlashcard('c1', 'brilliant'); } catch (e) { error = e.message; }
    ck('an unknown grade is refused', /not a review grade/.test(error), error);
    error = '';
    try { await w.api.reviewFlashcard('nope', 'good'); } catch (e) { error = e.message; }
    ck('an unknown card is refused', /no longer exists/.test(error), error);
  }

  {
    const w = makeWorker({ store: base() });
    await w.api.saveFlashcard({ noteId: 'n1', question: 'New', answer: 'Card' });
    ck('a new card is appended', w.store.flashcards.length === 2, String(w.store.flashcards.length));
    let error = '';
    try { await w.api.saveFlashcard({ question: 'only a question' }); } catch (e) { error = e.message; }
    ck('a half-filled card is refused', /both a question and an answer/.test(error), error);
  }

  // Editing the text must not wipe what the card has learned.
  {
    const w = makeWorker({ store: base() });
    await w.api.reviewFlashcard('c1', 'good');
    await w.api.reviewFlashcard('c1', 'good');
    const before = { ...w.store.flashcards[0] };
    await w.api.saveFlashcard({ id: 'c1', noteId: 'n1', question: 'Reworded', answer: 'A1' });
    const after = w.store.flashcards[0];
    ck('the text changes', after.question === 'Reworded', after.question);
    ck('the schedule survives an edit', after.interval === before.interval && after.repetitions === before.repetitions,
      `${after.interval}/${after.repetitions} vs ${before.interval}/${before.repetitions}`);
    ck('as does the ease', after.easeFactor === before.easeFactor);
  }

  {
    const w = makeWorker({ store: base() });
    await w.api.deleteFlashcard('c1');
    ck('a card can be deleted', w.store.flashcards.length === 0);
  }

  // Old records gain the scheduling fields on the next start-up.
  {
    const w = makeWorker({ store: { flashcards: [{ id: 'legacy', question: 'q', answer: 'a' }] } });
    await w.api.initialize();
    const migrated = w.store.flashcards[0];
    ck('a legacy card gains an ease', migrated.easeFactor === 2.5, String(migrated.easeFactor));
    ck('and a due date', !!migrated.dueDate, migrated.dueDate);
    ck('storage version moved to the current one', w.store.storageVersion === CURRENT_VERSION, String(w.store.storageVersion));
  }

  await ck.settled();
});
