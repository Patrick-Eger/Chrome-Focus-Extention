import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { checks } from './helpers/check.mjs';

const html = readFileSync(new URL('../newtab.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../newtab.js', import.meta.url), 'utf8');
const settingsBlock = html.slice(html.indexOf('<section id="settingsView"'), html.indexOf('<section id="momentScreen"'));

const GROUPS = ['focus', 'planning', 'appearance', 'newtab', 'connections', 'data'];

test('settings structure', async (t) => {
  const ck = checks(t);

  const sections = [...settingsBlock.matchAll(/<section class="settings-section[^"]*"(?: data-settings-group="(\w+)")?>/g)];
  ck('every section belongs to a group', sections.every((m) => m[1]), 
    String(sections.filter((m) => !m[1]).length) + ' untagged');
  ck('every group used is one the nav offers', sections.every((m) => GROUPS.includes(m[1])),
    [...new Set(sections.map((m) => m[1]))].join(','));

  const navs = [...settingsBlock.matchAll(/data-settings-nav="(\w+)"/g)].map((m) => m[1]);
  ck('the nav lists every group', GROUPS.every((g) => navs.includes(g)), navs.join(','));
  ck('and offers nothing empty', navs.every((g) => sections.some((m) => m[1] === g)),
    navs.filter((g) => !sections.some((m) => m[1] === g)).join(','));

  // The whole point of the rework: nothing may quietly save on a different rule
  // from its neighbour.
  ck('the Save button is gone', !/id="saveSettings"/.test(html));
  ck('and nothing still calls it', !/saveSettings/.test(js));
  ck('a saved indicator took its place', /id="settingsStatus"/.test(settingsBlock));

  ck('the dirty flag is gone', !/settingsFormDirty/.test(js));
  ck('one change listener covers the form', /\$\('#settingsView'\)\.addEventListener\('change'/.test(js));

  // Controls that used to save on their own must no longer do so separately.
  for (const id of ['focusBlocksSites', 'dashboardShowTaskBank', 'dashboardOverlay', 'dashboardPanelTransparency']) {
    const own = new RegExp(`\\$\\('#${id}'\\)\\.addEventListener\\('change'`);
    ck(`${id} has no save handler of its own`, !own.test(js));
  }
  for (const key of ['dashboardOverlay', 'dashboardPanelTransparency', 'dashboardShowTaskBank', 'dashboardBackground']) {
    ck(`${key} is built by the shared committer`, new RegExp(`${key}:`).test(js));
  }

  // Celebration is about finishing a task, not about blocked sites.
  const gateSection = settingsBlock.slice(settingsBlock.indexOf('Focus gate'), settingsBlock.indexOf('</section>', settingsBlock.indexOf('Focus gate')));
  ck('celebration left the blocked-site section', !/celebrateTasks/.test(gateSection));
  ck('and lives under its own heading', /Finishing a task/.test(settingsBlock));

  // Planner settings were split out of the calendar connection.
  const calendarSection = settingsBlock.slice(settingsBlock.indexOf('Google Calendar'), settingsBlock.indexOf('</section>', settingsBlock.indexOf('Google Calendar')));
  ck('timeline hours left the calendar section', !/calendarDayStart/.test(calendarSection));
  ck('auto-start left it too', !/autoStartBlocks/.test(calendarSection));
  ck('both are in the planning group', /Your working day/.test(settingsBlock) 
    && /id="calendarDayStart"/.test(settingsBlock) && /id="autoStartBlocks"/.test(settingsBlock));

  // Nothing may go missing in the move.
  for (const id of ['workdayStart', 'workdayEnd', 'calendarDayStart', 'calendarDayEnd',
    'defaultTaskEstimateMinutes', 'autoStartBlocks', 'autoOpenWorkspaceTabs', 'autoStartGraceMinutes',
    'celebrateTasks', 'celebrateTasksSound', 'unlockMinutes', 'defaultFocusMinutes']) {
    ck(`${id} still exists`, new RegExp(`id="${id}"`).test(settingsBlock));
  }

  // An untagged section must fall somewhere visible rather than nowhere.
  ck('untagged sections default to Focus', /section\.dataset\.settingsGroup \|\| 'focus'/.test(js));

  // A render must not stamp over a field being typed into.
  ck('in-progress typing is preserved across renders', /if \(typing !== null\) focused\.value = typing;/.test(js));

  await ck.settled();
});
