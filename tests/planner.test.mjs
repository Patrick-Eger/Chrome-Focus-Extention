import { test } from 'node:test';
import { loadPage } from './helpers/page.mjs';
import { checks } from './helpers/check.mjs';

test('planner slots and comparisons', async (t) => {
  const ck = checks(t);

  const at = (k, h) => new Date(`${k}T${String(h).padStart(2,'0')}:00:00`).getTime();

  // --- Ein schwaecherer Tag muss als schwaecher erscheinen ---
  {
    const p = loadPage({
      workspaces: [], projects: [], notes: [], reminders: [],
      tasks: [
        { id: 'a', completed: true, completedAt: at('2026-09-05', 9) },
        { id: 'b', completed: true, completedAt: at('2026-09-05', 10) },
        { id: 'c', completed: true, completedAt: at('2026-09-05', 11) },
        { id: 'd', completed: true, completedAt: at('2026-09-06', 9) }
      ],
      dailyPlans: {
        '2026-09-05': [{ id: 'y', title: 'Lots', time: '09:00', duration: 180, status: 'completed' }],
        '2026-09-06': [{ id: 't', title: 'Little', time: '09:00', duration: 30, status: 'completed' }]
      },
      settings: {}
    });
    const html = p.run("renderDayScorecard('2026-09-06')");
    ck('a drop is shown as a drop', /−2 vs the day before/.test(html), (html.match(/[+−]\d+ vs the day before/g) || []).join(' | '));
    ck('and marked as down, not up', /delta down/.test(html) && !/delta up/.test(html));
    ck('fewer minutes reported too', /−150 vs the day before/.test(html));

    const same = p.run("renderDayScorecard('2026-09-04')");
    ck('an empty day is not compared at all', /Nothing finished/.test(same));
  }

  // --- Identischer Tag -> "same as the day before" ---
  {
    const p = loadPage({
      workspaces: [], projects: [], notes: [], reminders: [],
      tasks: [
        { id: 'a', completed: true, completedAt: at('2026-09-05', 9) },
        { id: 'b', completed: true, completedAt: at('2026-09-06', 9) }
      ],
      dailyPlans: {
        '2026-09-05': [{ id: 'y', time: '09:00', duration: 60, status: 'completed', title: 'x' }],
        '2026-09-06': [{ id: 't', time: '09:00', duration: 60, status: 'completed', title: 'x' }]
      },
      settings: {}
    });
    const html = p.run("renderDayScorecard('2026-09-06')");
    ck('an equal day says so instead of showing +0', /same as the day before/.test(html) && !/\+0/.test(html), (html.match(/(same as the day before|[+−]\d+ vs)/g) || []).join(' | '));
  }

  // --- Stunden-Slots in der Timeline ---
  {
    const p = loadPage({
      workspaces: [], projects: [], notes: [], reminders: [], tasks: [],
      dailyPlans: { '2026-09-06': [] }, calendarEvents: [],
      settings: { calendarDayStart: '07:00', calendarDayEnd: '21:00' }
    });
    const html = p.run(`
      const box = { innerHTML: '', classList: { add(){}, remove(){}, toggle(){}, contains(){return false} } };
      renderDayTimeline(box, '2026-09-06', { interactive: true });
      box.innerHTML;
    `);
    const minutes = [...html.matchAll(/data-timeline-minute="(\d+)"/g)].map((m) => Number(m[1]));
    ck('one slot per hour, not per quarter', minutes.length === 14, `${minutes.length} slots`);
    ck('slots start on the hour', minutes.every((m) => m % 60 === 0), minutes.slice(0, 4).join(','));
    ck('first slot is the day start', minutes[0] === 420, String(minutes[0]));
    ck('last slot is the hour before the end', minutes[minutes.length - 1] === 1200, String(minutes[minutes.length - 1]));
    const slotTags = [...html.matchAll(/<button class="timeline-slot" style="([^"]+)"/g)].map((m) => m[1]);
    ck('each slot spans a full hour', slotTags.every((s) => /height:72px/.test(s)), slotTags[0]);
    ck('the hour is labelled for the hover state', /<span>07:00<\/span>/.test(html));
    ck('non-interactive timelines get no slots', !p.run(`
      const b = { innerHTML: '', classList: { add(){}, remove(){}, toggle(){}, contains(){return false} } };
      renderDayTimeline(b, '2026-09-06', {});
      b.innerHTML;
    `).includes('timeline-slot'));
  }

  // --- Tagesbeginn auf halber Stunde: erster Slot darf nicht ueberstehen ---
  {
    const p = loadPage({
      workspaces: [], projects: [], notes: [], reminders: [], tasks: [],
      dailyPlans: { '2026-09-06': [] }, calendarEvents: [],
      settings: { calendarDayStart: '07:30', calendarDayEnd: '10:00' }
    });
    const html = p.run(`
      const box = { innerHTML: '', classList: { add(){}, remove(){}, toggle(){}, contains(){return false} } };
      renderDayTimeline(box, '2026-09-06', { interactive: true });
      box.innerHTML;
    `);
    const minutes = [...html.matchAll(/data-timeline-minute="(\d+)"/g)].map((m) => Number(m[1]));
    ck('a half-hour start clips the first slot instead of overflowing', minutes[0] === 450, String(minutes[0]));
    ck('and the rest still fall on the hour', minutes.slice(1).every((m) => m % 60 === 0), minutes.join(','));
    const slotStyles = [...html.matchAll(/<button class="timeline-slot" style="([^"]+)"/g)].map((m) => m[1]);
    const firstTop = Number((slotStyles[0].match(/top:([\d.]+)px/) || [])[1]);
    const firstHeight = Number((slotStyles[0].match(/height:([\d.]+)px/) || [])[1]);
    ck('first slot starts at the top of the visible day', firstTop === 0, String(firstTop));
    ck('and is clipped to the half hour it covers', firstHeight === 36, String(firstHeight));
  }

  await ck.settled();
});
