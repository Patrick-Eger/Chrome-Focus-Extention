import { test } from 'node:test';
import fs from 'node:fs';
import { makeWorker } from './helpers/worker.mjs';
import { loadPage } from './helpers/page.mjs';
import { checks } from './helpers/check.mjs';

const src = fs.readFileSync(new URL('../newtab.js', import.meta.url), 'utf8');

const baseState = (dateTimeLocale) => ({
  workspaces: [{ id: 'default', name: 'Default', tabs: [], domains: [] }],
  projects: [], notes: [], reminders: [], tasks: [], calendarEvents: [], dailyPlans: {},
  settings: { calendarDayStart: '07:00', calendarDayEnd: '21:00', dateTimeLocale }
});

test('date and time locale', async (t) => {
  const ck = checks(t);

  // --- Die Einstellung schlaegt bis in die Uhrzeiten durch ---
  {
    const de = loadPage(baseState('de-DE'));
    const us = loadPage(baseState('en-US'));
    const gb = loadPage(baseState('en-GB'));

    ck('German renders a 24-hour clock', de.run(`formatHourMinute(15 * 60)`) === '15:00',
      de.run(`formatHourMinute(15 * 60)`));
    ck('US English renders a 12-hour clock', /3:00.?PM/i.test(us.run(`formatHourMinute(15 * 60)`)),
      us.run(`formatHourMinute(15 * 60)`));
    ck('British English is English but 24-hour', gb.run(`formatHourMinute(15 * 60)`) === '15:00',
      gb.run(`formatHourMinute(15 * 60)`));

    ck('a German weekday is German',
      /Mittwoch/.test(de.run(`formatDayHeading('2026-09-09')`)), de.run(`formatDayHeading('2026-09-09')`));
    ck('an English weekday is English',
      /Wednesday/.test(gb.run(`formatDayHeading('2026-09-09')`)), gb.run(`formatDayHeading('2026-09-09')`));
    ck('a German week range reads as German',
      de.run(`formatWeekHeading('2026-09-09')`) === '7.\u201313. September 2026',
      de.run(`formatWeekHeading('2026-09-09')`));
    ck('and does not borrow the English shape',
      !/September 7/.test(de.run(`formatWeekHeading('2026-09-09')`)),
      de.run(`formatWeekHeading('2026-09-09')`));
    ck('a cross-month German range names both months',
      /September/.test(de.run(`formatWeekHeading('2026-10-01')`))
        && /Oktober/.test(de.run(`formatWeekHeading('2026-10-01')`)),
      de.run(`formatWeekHeading('2026-10-01')`));

    // Die Stundenleiste der Woche ist der Ort, an dem "7:00 AM" aufgefallen ist.
    const draw = `(() => {
      const box = { innerHTML: '', classList: { add(){}, remove(){}, toggle(){}, contains(){return false} } };
      renderWeekTimeline(box, '2026-09-09', { interactive: true });
      return box.innerHTML;
    })()`;
    ck('the week grid has no AM/PM in German', !/AM|PM/.test(de.run(draw)));
    ck('and does have it in US English', /AM|PM/.test(us.run(draw)));
    ck('German hour marks read as 24-hour', />13:00</.test(de.run(draw)), 'no 13:00 mark');
  }

  // --- "System" heisst wirklich System ---
  {
    const sys = loadPage(baseState('system'));
    const plain = new Date(2026, 8, 9, 15, 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    ck('system passes no tag and matches the plain browser format',
      sys.run(`formatHourMinute(15 * 60)`) === plain, `${sys.run(`formatHourMinute(15 * 60)`)} vs ${plain}`);
    ck('and localeTags is empty for it', sys.run(`localeTags().length`) === 0);
    ck('a known tag is passed through', loadPage(baseState('de-DE')).run(`localeTags()[0]`) === 'de-DE');

    // Ein unbekanntes Tag laesst toLocaleDateString werfen und wuerde den ganzen
    // Render mitnehmen - eine Anzeigeeinstellung darf das Dashboard nicht killen.
    const junk = loadPage(baseState('kl-KL-nonsense'));
    ck('an unknown tag falls back instead of throwing',
      junk.run(`localeTags().length`) === 0 && typeof junk.run(`formatDayHeading('2026-09-09')`) === 'string');
  }

  // --- Nichts formatiert mehr am Schalter vorbei ---
  {
    const stray = [...src.matchAll(/toLocale(?:Date|Time)?String\((.{0,20})/g)]
      .map((m) => m[1].trim())
      .filter((args) => !args.startsWith('localeTags()'));
    ck('every date and time in the dashboard goes through the setting',
      stray.length === 0, stray.join(' | '));
    ck('the Moment clock no longer carries its own hour12 exception',
      !/hour12/.test(src) && !/momentClockFormat/.test(src));
  }

  // --- Die Migration der alten Moment-Uhr ---
  {
    const w = makeWorker({ store: {} });
    await w.api.initialize();
    ck('a fresh install follows the browser',
      w.store.settings.dateTimeLocale === 'system', String(w.store.settings.dateTimeLocale));

    const twelve = makeWorker({ store: { settings: { momentClockFormat: '12' } } });
    await twelve.api.initialize();
    ck('someone who chose a 12-hour clock keeps one',
      twelve.store.settings.dateTimeLocale === 'en-US', String(twelve.store.settings.dateTimeLocale));
    // Auf dem frischen Store waere das nichtssagend - dort gab es den Schluessel nie.
    ck('and the old key does not stay behind next to the new one',
      twelve.store.settings.momentClockFormat === undefined,
      String(twelve.store.settings.momentClockFormat));

    const chosen = makeWorker({ store: { settings: { dateTimeLocale: 'de-DE', momentClockFormat: '12' } } });
    await chosen.api.initialize();
    ck('an explicit new choice wins over the old key',
      chosen.store.settings.dateTimeLocale === 'de-DE', String(chosen.store.settings.dateTimeLocale));

    const junk = makeWorker({ store: { settings: { dateTimeLocale: 'not-a-locale' } } });
    await junk.api.initialize();
    ck('an unknown stored tag is repaired on the way in',
      junk.store.settings.dateTimeLocale === 'system', String(junk.store.settings.dateTimeLocale));

    // Zweimal normalisieren darf nichts mehr veraendern, sonst schreibt jeder
    // Kaltstart die Settings neu.
    const again = makeWorker({ store: { settings: { momentClockFormat: '12' } } });
    await again.api.initialize();
    const first = JSON.stringify(again.store.settings);
    await again.api.initialize();
    ck('normalising twice is a no-op', JSON.stringify(again.store.settings) === first);
  }

  await ck.settled();
});

// Der Fehler, der das ausgeloest hat: $ liefert ein Element, $$ eine Liste, und
// $('[data-calendar-scope]').forEach ist erst zur Laufzeit im Browser aufgefallen.
test('selector helpers', async (t) => {
  const ck = checks(t);
  const misuse = [...src.matchAll(/(?<!\$)\$\((\s*['"`][^'"`]*['"`])[^)]*\)\s*\.\s*(forEach|map|filter|some|every|reduce)\b/g)]
    .map((m) => `${m[1]} .${m[2]}`);
  ck('nothing treats a single element as a list', misuse.length === 0, misuse.join(' | '));

  // Und andersherum: $$ auf einer id ist bestenfalls verwirrend.
  const idLists = [...src.matchAll(/\$\$\(\s*['"`](#[\w-]+)['"`]/g)].map((m) => m[1]);
  ck('and nothing asks for a list of one id', idLists.length === 0, idLists.join(' | '));

  await ck.settled();
});
