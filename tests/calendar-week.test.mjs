import { test } from 'node:test';
import { loadPage } from './helpers/page.mjs';
import { checks } from './helpers/check.mjs';

// `const` survives between runInContext calls in one context, so each render gets
// its own scope rather than a name that can only be declared once.
const draw = (call) => `(() => {
  const box = { innerHTML: '', classList: { add(){}, remove(){}, toggle(){}, contains(){return false} } };
  ${call};
  return box.innerHTML;
})()`;

// 2026-09-07 is a Monday, so the week under test runs Mon 07 .. Sun 13.
const baseState = (extra = {}) => ({
  workspaces: [{ id: 'default', name: 'Default', tabs: [], domains: [] }],
  projects: [], notes: [], reminders: [], tasks: [], calendarEvents: [],
  dailyPlans: {},
  settings: { calendarDayStart: '07:00', calendarDayEnd: '21:00', workdayStart: '09:00' },
  ...extra
});

test('calendar week grid', async (t) => {
  const ck = checks(t);

  // --- Die Woche selbst ---
  {
    const p = loadPage(baseState());
    const monday = p.run(`JSON.stringify(weekDays('2026-09-09'))`);
    ck('a week is seven days', JSON.parse(monday).length === 7, monday);
    ck('and starts on Monday', JSON.parse(monday)[0] === '2026-09-07', monday);
    ck('and ends on Sunday', JSON.parse(monday)[6] === '2026-09-13', monday);
    ck('the anchor day is in its own week', JSON.parse(monday).includes('2026-09-09'));

    // Sonntag ist der Tag, an dem eine Montags-Woche kippt, wenn getDay() naiv
    // benutzt wird - getDay() ist dort 0, nicht 7.
    const sunday = p.run(`JSON.stringify(weekDays('2026-09-13'))`);
    ck('a Sunday belongs to the week that started on Monday',
      JSON.parse(sunday)[0] === '2026-09-07', sunday);
    const nextMonday = p.run(`JSON.stringify(weekDays('2026-09-14'))`);
    ck('and the next Monday opens the next week',
      JSON.parse(nextMonday)[0] === '2026-09-14', nextMonday);
  }

  // --- Jeder Eintrag landet in seiner eigenen Spalte ---
  {
    const p = loadPage(baseState({
      dailyPlans: {
        '2026-09-07': [{ id: 'mon', title: 'Monday block', time: '09:00', duration: 60, status: 'planned' }],
        '2026-09-09': [{ id: 'wed', title: 'Wednesday block', time: '14:00', duration: 90, status: 'planned' }]
      },
      reminders: [{ id: 'r1', title: 'Call', date: '2026-09-11', time: '11:00', status: 'scheduled' }]
    }));
    const html = p.run(draw(`renderWeekTimeline(box, '2026-09-09', { interactive: true })`));
    const dates = [...html.matchAll(/class="timeline-canvas" data-timeline-date="([^"]+)"/g)].map((m) => m[1]);
    ck('seven columns are drawn', dates.length === 7, dates.join(','));
    ck('one per day of the week, in order',
      dates.join(',') === '2026-09-07,2026-09-08,2026-09-09,2026-09-10,2026-09-11,2026-09-12,2026-09-13',
      dates.join(','));

    // Jede Spalte fuer sich pruefen: ein Block darf nicht in allen sieben stehen.
    const columns = html.split('data-timeline-date="').slice(1);
    const columnFor = (dateKey) => columns.find((column) => column.startsWith(dateKey)) || '';
    ck('a Monday block is in the Monday column', /Monday block/.test(columnFor('2026-09-07')));
    ck('and nowhere else',
      columns.filter((column) => /Monday block/.test(column)).length === 1,
      String(columns.filter((column) => /Monday block/.test(column)).length));
    ck('a Wednesday block is in the Wednesday column', /Wednesday block/.test(columnFor('2026-09-09')));
    ck('a reminder lands on its own day', /data-reminder="r1"/.test(columnFor('2026-09-11')));
    ck('and not on the anchor day', !/data-reminder="r1"/.test(columnFor('2026-09-09')));
    ck('an empty day stays empty', !/timeline-entry/.test(columnFor('2026-09-08')));

    ck('every column offers hour slots',
      columns.every((column) => (column.match(/data-timeline-minute=/g) || []).length === 14),
      columns.map((c) => (c.match(/data-timeline-minute=/g) || []).length).join(','));
    ck('the header names each weekday', (html.match(/week-head-cell/g) || []).length === 7);
    ck('and shows the planned minutes it has', /60 min/.test(html) && /90 min/.test(html));

    const readOnly = p.run(draw(`renderWeekTimeline(box, '2026-09-09', {})`));
    ck('a non-interactive week has no slots', !readOnly.includes('timeline-slot'));
    ck('but still has its columns',
      (readOnly.match(/class="timeline-canvas"/g) || []).length === 7);
  }

  // --- Ganztaegige Events bekommen pro Tag eine Zelle ---
  {
    const p = loadPage(baseState({
      calendarEvents: [
        { id: 'e1', calendarId: 'c', title: 'Conference', allDay: true, start: '2026-09-08', end: '2026-09-09', status: 'confirmed' }
      ]
    }));
    const week = p.run(draw(`renderWeekTimeline(box, '2026-09-09', { interactive: true })`));
    ck('the all-day lane has one cell per day',
      (week.match(/all-day-cell/g) || []).length === 7,
      String((week.match(/all-day-cell/g) || []).length));
    const lane = week.slice(week.indexOf('all-day-lane'), week.indexOf('timeline-scroll'));
    const cells = lane.split('all-day-cell').slice(1);
    ck('the event sits in the day it falls on', /Conference/.test(cells[1]), cells[1].slice(0, 90));
    ck('and in no other day', cells.filter((cell) => /Conference/.test(cell)).length === 1);

    const day = p.run(draw(`renderDayTimeline(box, '2026-09-08', { interactive: true })`));
    ck('the day view uses the same lane with one cell',
      (day.match(/all-day-cell/g) || []).length === 1 && /Conference/.test(day));
    const quiet = p.run(draw(`renderDayTimeline(box, '2026-09-10', { interactive: true })`));
    ck('a day without all-day events gets no lane at all', !quiet.includes('all-day-lane'));
  }

  // --- Der Tag bleibt ein Tag ---
  {
    const p = loadPage(baseState({
      dailyPlans: { '2026-09-09': [{ id: 'x', title: 'One', time: '09:00', duration: 60, status: 'planned' }] }
    }));
    const html = p.run(draw(`renderDayTimeline(box, '2026-09-09', { interactive: true })`));
    ck('the day view draws a single column',
      (html.match(/class="timeline-canvas"/g) || []).length === 1);
    ck('and tags it with its date too, so one handler serves both',
      /data-timeline-date="2026-09-09"/.test(html));
    ck('the day view has no week header', !html.includes('week-head'));
  }

  // --- Welche Spalte ein Zeiger trifft ---
  {
    const p = loadPage(baseState());
    const setup = `
      const canvasFor = (dateKey) => ({
        dataset: { timelineDate: dateKey },
        getBoundingClientRect: () => ({ top: 0, height: 1008 })
      });
      canvases = ['2026-09-07', '2026-09-08', '2026-09-09'].map(canvasFor);
      dropEvent = (index, clientY) => ({
        clientY,
        target: { closest: (sel) => sel === '.timeline-canvas' || sel === '[data-timeline-date]'
          ? (index === null ? null : canvases[index]) : null },
        currentTarget: { querySelectorAll: () => canvases }
      });
    `;
    p.run(setup);
    const hit = JSON.parse(p.run(`JSON.stringify(timelineDropTarget(dropEvent(2, 100)))`));
    ck('the column under the pointer decides the day', hit.dateKey === '2026-09-09', JSON.stringify(hit));
    // 07:00 + (100/1008) * 840 min = 503.3 min, auf die Viertelstunde gerundet.
    ck('and the height decides the time', hit.time === '08:30', hit.time);
    const other = JSON.parse(p.run(`JSON.stringify(timelineDropTarget(dropEvent(0, 100)))`));
    ck('a different column gives a different day at the same height',
      other.dateKey === '2026-09-07' && other.time === '08:30', JSON.stringify(other));

    const nowhere = p.run(`JSON.stringify(timelineDropTarget(dropEvent(null, 100)))`);
    ck('a drop between columns resolves to nothing rather than guessing',
      nowhere === undefined || nowhere === 'null', String(nowhere));

    const named = p.run(`timelineDateAt(dropEvent(1, 0).target, 'fallback')`);
    ck('a click reads its date off the column', named === '2026-09-08', String(named));
    const fell = p.run(`timelineDateAt({ closest: () => null }, '2026-09-30')`);
    ck('and falls back when there is no column', fell === '2026-09-30', String(fell));

    p.run(`canvases = [{ dataset: { timelineDate: '2026-09-09' }, getBoundingClientRect: () => ({ top: 0, height: 1008 }) }]`);
    const single = JSON.parse(p.run(`JSON.stringify(timelineDropTarget(dropEvent(null, 100)))`));
    ck('a single-column rail still resolves a drop beside the canvas',
      single.dateKey === '2026-09-09', JSON.stringify(single));
  }

  // --- Verschieben ueber Tagesgrenzen ---
  {
    const p = loadPage(baseState({
      tasks: [{ id: 't1', title: 'Write', plannedDate: '2026-09-07', status: 'planned', completed: false }],
      dailyPlans: {
        '2026-09-07': [
          { id: 'b1', title: 'Write', time: '09:00', duration: 60, status: 'planned', taskId: 't1',
            calendar: { eventId: 'g1', calendarId: 'primary', syncState: 'synced' } },
          { id: 'b2', title: 'Other', time: '11:00', duration: 30, status: 'planned' }
        ]
      }
    }));
    p.run(`
      saved = null; sent = []; toasts = [];
      save = async (patch) => { saved = patch; Object.assign(state, patch); };
      send = async (type, payload) => { sent.push({ type, payload }); return {}; };
      loadState = async () => {};
      showToast = (message) => { toasts.push(message); };
    `);
    await p.run(`moveWorkBlock('b1', '2026-09-07', '2026-09-09', '14:00')`);
    const plans = JSON.parse(p.run(`JSON.stringify(saved.dailyPlans)`));
    ck('the block leaves the day it came from',
      !plans['2026-09-07'].some((b) => b.id === 'b1'), JSON.stringify(plans['2026-09-07'].map((b) => b.id)));
    ck('and the other block on that day stays',
      plans['2026-09-07'].some((b) => b.id === 'b2'));
    ck('it arrives on the target day', plans['2026-09-09'].some((b) => b.id === 'b1'));
    const moved = plans['2026-09-09'].find((b) => b.id === 'b1');
    ck('keeping its id, so the Google event is patched and not recreated', moved.id === 'b1');
    ck('at the dropped time', moved.time === '14:00', moved.time);
    ck('the calendar link survives the move',
      moved.calendar.eventId === 'g1' && moved.calendar.calendarId === 'primary', JSON.stringify(moved.calendar));
    ck('and is marked as owing Google an update', moved.calendar.syncState === 'pending', moved.calendar.syncState);
    const tasks = JSON.parse(p.run(`JSON.stringify(saved.tasks)`));
    ck('the linked task is planned for the new day',
      tasks[0].plannedDate === '2026-09-09', tasks[0].plannedDate);
    const sent = JSON.parse(p.run(`JSON.stringify(sent)`));
    ck('Google is told about the new date, not the old one',
      sent.length === 1 && sent[0].type === 'updateCalendarEvent' && sent[0].payload.dateKey === '2026-09-09',
      JSON.stringify(sent));
    ck('and the toast names the day it moved to',
      /September 9/.test(p.run(`toasts.join(' | ')`)), p.run(`toasts.join(' | ')`));
  }

  // --- Verschieben innerhalb eines Tages bleibt, was es war ---
  {
    const p = loadPage(baseState({
      tasks: [{ id: 't1', title: 'Write', plannedDate: '2026-09-07', status: 'planned', completed: false }],
      dailyPlans: {
        '2026-09-07': [{ id: 'b1', title: 'Write', time: '09:00', duration: 60, status: 'planned', taskId: 't1', calendar: {} }]
      }
    }));
    p.run(`
      saved = null; sent = []; toasts = [];
      save = async (patch) => { saved = patch; Object.assign(state, patch); };
      send = async (type, payload) => { sent.push({ type, payload }); return {}; };
      loadState = async () => {}; showToast = (m) => { toasts.push(m); };
    `);
    await p.run(`moveWorkBlock('b1', '2026-09-07', '2026-09-07', '15:00')`);
    const plans = JSON.parse(p.run(`JSON.stringify(saved.dailyPlans)`));
    ck('a same-day move keeps the block on its day',
      plans['2026-09-07'].length === 1 && plans['2026-09-07'][0].time === '15:00',
      JSON.stringify(plans['2026-09-07']));
    ck('an unlinked block asks Google for nothing', p.run(`sent.length`) === 0);
    ck('and the toast just names the time',
      p.run(`toasts.join('')`) === 'Moved to 15:00.', p.run(`toasts.join('')`));

    await p.run(`moveWorkBlock('b1', '2026-09-07', '2026-09-07', '15:00')`);
    ck('dropping a block where it already is writes nothing',
      p.run(`toasts.length`) === 1, p.run(`String(toasts.length)`));
    await p.run(`moveWorkBlock('b1', '2026-09-07', '2026-09-09', '99:99')`);
    ck('an impossible time is refused', p.run(`toasts.length`) === 1);
    await p.run(`moveWorkBlock('nope', '2026-09-07', '2026-09-09', '10:00')`);
    ck('and an unknown block too', p.run(`toasts.length`) === 1);
  }

  // --- Der Schrittweiten-Schalter ---
  {
    const p = loadPage(baseState());
    p.run(`renderCalendar = () => {}; selectedCalendarDate = '2026-09-09'; calendarScope = 'week';`);
    p.run(`stepCalendarDate(1)`);
    ck('the stepper moves a whole week in week scope',
      p.run(`selectedCalendarDate`) === '2026-09-16', p.run(`selectedCalendarDate`));
    p.run(`stepCalendarDate(-1)`);
    ck('and back again', p.run(`selectedCalendarDate`) === '2026-09-09', p.run(`selectedCalendarDate`));
    p.run(`calendarScope = 'day'; stepCalendarDate(1)`);
    ck('but only a day in day scope',
      p.run(`selectedCalendarDate`) === '2026-09-10', p.run(`selectedCalendarDate`));
  }

  // --- Ueberschrift und Standarddatum ---
  {
    const p = loadPage(baseState());
    const inside = p.run(`formatWeekHeading('2026-09-09')`);
    ck('a week inside one month names the month once',
      inside === 'September 7 - 13, 2026', inside);
    const across = p.run(`formatWeekHeading('2026-10-01')`);
    ck('a week across two months names both',
      across === 'September 28 - October 4, 2026', across);

    p.run(`calendarScope = 'week'; selectedCalendarDate = todayKey();`);
    const defaults = JSON.parse(p.run(`JSON.stringify(newCalendarEntryDefaults())`));
    ck('a new entry in the current week lands on today',
      defaults.dateKey === p.run(`todayKey()`), JSON.stringify(defaults));
    p.run(`selectedCalendarDate = '2026-09-09';`);
    const away = JSON.parse(p.run(`JSON.stringify(newCalendarEntryDefaults())`));
    ck('and on the anchor day in a week that is not this one',
      away.dateKey === '2026-09-09' && away.time === '09:00', JSON.stringify(away));
  }

  await ck.settled();
});
