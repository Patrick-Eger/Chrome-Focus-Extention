import { test } from 'node:test';
import { loadPage } from './helpers/page.mjs';
import { checks } from './helpers/check.mjs';

test('obsidian export', async (t) => {
  const ck = checks(t);

  const today = new Date();
  const key = (offset) => {
    const d = new Date(today); d.setDate(d.getDate() + offset);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };

  const p = loadPage({
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Work' }],
    projects: [{ id: 'p1', name: 'Alpha', workspaceId: 'w1', status: 'active', priority: 'high', links: [], updatedAt: 1 }],
    tasks: [
      { id: 't1', projectId: 'p1', title: 'Open task', completed: false, priority: 'high', dueDate: '2026-09-10', estimateMinutes: 45, labels: ['api'], subtasks: [{ id: 's1', title: 'Sub one', completed: true }], createdAt: 1 },
      { id: 't2', projectId: 'p1', title: 'Done task', completed: true, priority: 'medium', labels: [], subtasks: [], createdAt: 2 },
      { id: 't3', projectId: 'other', title: 'Elsewhere', completed: false, labels: [], subtasks: [], createdAt: 3 }
    ],
    notes: [],
    reminders: [{ id: 'r1', date: key(1), time: '10:00', title: 'Call the dentist', status: 'scheduled' }],
    dailyPlans: {
      [key(0)]: [
        { id: 'b1', title: 'Ship it', time: '09:00', duration: 60, projectId: 'p1', status: 'completed' },
        { id: 'b2', title: 'Review', time: '11:00', duration: 30, projectId: null, status: 'planned' },
        { id: 'b3', title: 'Dropped', time: '13:00', duration: 30, status: 'cancelled' }
      ],
      [key(-400)]: [{ id: 'old', title: 'Ancient', time: '08:00', duration: 30, status: 'planned' }]
    },
    settings: { obsidianExportFolder: 'Focus Desk' }
  });

  // --- Aufgabenliste im Projektdokument ---
  const list = p.run("obsidianTaskList(getProject('p1'))");
  ck('open task rendered unticked', list.includes('- [ ] Open task'), list.split('\n')[0]);
  ck('done task rendered ticked', list.includes('- [x] Done task'));
  ck('open task sorted before the done one', list.indexOf('Open task') < list.indexOf('Done task'));
  ck('metadata attached', /_\(high · due 2026-09-10 · 45 min · api\)_/.test(list), list.split('\n')[0]);
  ck('medium priority not spelled out', !list.includes('medium'), list);
  ck('subtask nested and ticked', /\n  - \[x\] Sub one/.test(list));
  ck('other projects excluded', !list.includes('Elsewhere'));
  ck('empty project says so', p.run("obsidianTaskList({ id: 'nope' })") === '_No tasks._');

  // --- Welche Tage exportiert werden ---
  const keys = p.run('obsidianExportDayKeys()');
  ck('today included', keys.includes(key(0)), keys.join(','));
  ck('a day with only a reminder included', keys.includes(key(1)), keys.join(','));
  ck('a day older than the window excluded', !keys.includes(key(-400)), keys.join(','));
  ck('keys sorted', keys.join(',') === [...keys].sort().join(','));

  // --- Tagesnotiz ---
  const day = p.run(`dayToObsidianMarkdown(${JSON.stringify(key(0))})`);
  ck('frontmatter marks it as a day', day.includes('focus_desk_type: day'));
  ck('planned minutes summed without the cancelled block', day.includes('planned_minutes: 90'), day.split('\n').find(l => l.startsWith('planned_minutes')));
  ck('block shows its span', day.includes('09:00–10:00 Ship it'), day);
  ck('completed block is ticked', day.includes('- [x] 09:00–10:00'));
  ck('planned block is not', day.includes('- [ ] 11:00–11:30'));
  ck('project named beside the block', day.includes('_(Alpha)_'));
  ck('cancelled block omitted', !day.includes('Dropped'));

  const dayWithReminder = p.run(`dayToObsidianMarkdown(${JSON.stringify(key(1))})`);
  ck('reminders get their own section', dayWithReminder.includes('## Reminders') && dayWithReminder.includes('- [ ] 10:00 Call the dentist'), dayWithReminder);
  ck('a day without a plan says so', dayWithReminder.includes('_Nothing planned._'));
  ck('no empty reminder section when there are none', !day.includes('## Reminders'));

  // --- Projektdokument enthaelt die Aufgaben ---
  const doc = p.run("projectToObsidianMarkdown(getProject('p1'), [], {})");
  ck('project file has a Tasks section', doc.includes('## Tasks') && doc.includes('- [ ] Open task'));
  ck('and still has Links and Notes', doc.includes('## Links') && doc.includes('## Notes'));

  await ck.settled();
});
