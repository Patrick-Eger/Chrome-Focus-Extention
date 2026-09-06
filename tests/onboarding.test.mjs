import { test } from 'node:test';
import { makeWorker } from './helpers/worker.mjs';
import { loadPage } from './helpers/page.mjs';
import { checks } from './helpers/check.mjs';

test('who sees the checklist', async (t) => {
  const ck = checks(t);
  const { api } = makeWorker({ store: {} });
  const seen = (store) => api.normalizeOnboarding(store).dismissed === false;

  ck('an empty profile sees it', seen({}));
  ck('a profile with only a bare workspace sees it',
    seen({ workspaces: [{ id: 'w', name: 'Focus workspace', domains: [] }] }));

  // Anyone already using the extension has plainly done these things; showing
  // them a getting-started list on update would be noise.
  ck('a profile with projects does not', !seen({ projects: [{ id: 'p' }] }));
  ck('nor one with tasks', !seen({ tasks: [{ id: 't' }] }));
  ck('nor one with notes', !seen({ notes: [{ id: 'n' }] }));
  ck('nor one with inbox items', !seen({ inboxItems: [{ id: 'i' }] }));
  ck('nor one with flashcards', !seen({ flashcards: [{ id: 'c' }] }));
  ck('nor one that has planned a day', !seen({ dailyPlans: { '2026-09-10': [{ id: 'b' }] } }));
  ck('nor one that has allowed a site', !seen({ workspaces: [{ id: 'w', domains: ['example.com'] }] }));

  // An explicit choice always wins over the guess.
  ck('a stored dismissal is respected', !seen({ onboarding: { dismissed: true }, projects: [] }));
  ck('and so is a stored decision to keep it', seen({ onboarding: { dismissed: false }, projects: [{ id: 'p' }] }));

  const w = makeWorker({ store: { storageVersion: 17, migratedLegacyData: true } });
  await w.api.ensureInitialized();
  ck('a fresh install stores it undismissed', w.store.onboarding.dismissed === false,
    JSON.stringify(w.store.onboarding));

  // A first install lands the user somewhere; an update must not steal a tab
  // from someone in the middle of something.
  {
    const fresh = makeWorker({ store: {} });
    await fresh.fireInstalled({ reason: 'install' });
    ck('installing opens the dashboard', fresh.tabsCreated.length === 1,
      JSON.stringify(fresh.tabsCreated));
    ck('and it is the dashboard', /newtab\.html$/.test((fresh.tabsCreated[0] || {}).url || ''),
      JSON.stringify(fresh.tabsCreated[0]));
  }
  {
    const updated = makeWorker({ store: { storageVersion: 17, migratedLegacyData: true, projects: [{ id: 'p' }] } });
    await updated.fireInstalled({ reason: 'update' });
    ck('updating opens nothing', updated.tabsCreated.length === 0, JSON.stringify(updated.tabsCreated));
  }

  await ck.settled();
});

test('the checklist reflects real state', async (t) => {
  const ck = checks(t);
  const page = (over) => loadPage({
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Work', domains: [] }],
    projects: [], tasks: [], notes: [], inboxItems: [], reminders: [], flashcards: [],
    dailyPlans: {}, calendarEvents: [],
    focus: { active: false, startedAt: null },
    onboarding: { dismissed: false }, settings: {}, ...over
  });

  {
    const p = page();
    const steps = p.run('onboardingSteps()');
    ck('there are five steps', steps.length === 5, String(steps.length));
    ck('none done on a fresh profile', steps.every((s) => !s.done), JSON.stringify(steps.map((s) => s.done)));
    p.run('renderOnboarding()');
    ck('the panel is shown', p.run("document.querySelector('#onboarding').classList.contains('hidden')") === false);
    ck('the lead counts progress', /0 of 5 done/.test(p.run("document.querySelector('#onboardingLead').textContent")),
      p.run("document.querySelector('#onboardingLead').textContent"));
  }

  const doneFor = (over) => p2(over).run('onboardingSteps().filter((s) => s.done).map((s) => s.id)');
  const p2 = (over) => page(over);

  ck('allowing a site ticks the first step',
    doneFor({ workspaces: [{ id: 'w1', name: 'Work', domains: ['example.com'] }] }).join(',') === 'sites');
  ck('planning a block ticks the second',
    doneFor({ dailyPlans: { '2026-09-10': [{ id: 'b', title: 'x' }] } }).join(',') === 'block');
  ck('an empty day does not count',
    doneFor({ dailyPlans: { '2026-09-10': [] } }).length === 0);
  ck('having run focus ticks the third',
    doneFor({ focus: { active: false, startedAt: 1 } }).join(',') === 'focus');
  ck('a capture ticks the fourth', doneFor({ inboxItems: [{ id: 'i' }] }).join(',') === 'capture');
  ck('a note ticks the fifth', doneFor({ notes: [{ id: 'n' }] }).join(',') === 'note');

  {
    const p = page({
      workspaces: [{ id: 'w1', name: 'Work', domains: ['example.com'] }],
      dailyPlans: { '2026-09-10': [{ id: 'b', title: 'x' }] },
      focus: { active: false, startedAt: 1 },
      inboxItems: [{ id: 'i' }], notes: [{ id: 'n' }]
    });
    p.run('renderOnboarding()');
    ck('all five done says so', /whole tour/.test(p.run("document.querySelector('#onboardingHeading').textContent")),
      p.run("document.querySelector('#onboardingHeading').textContent"));
    ck('and the panel stays until hidden', p.run("document.querySelector('#onboarding').classList.contains('hidden')") === false);
    const html = p.run("document.querySelector('#onboardingSteps').innerHTML");
    ck('completed steps offer no button', !/data-onboarding-step/.test(html));
  }

  {
    const p = page({ onboarding: { dismissed: true } });
    p.run('renderOnboarding()');
    ck('a dismissed checklist is not rendered',
      p.run("document.querySelector('#onboarding').classList.contains('hidden')") === true);
  }

  {
    const p = page();
    p.run('renderOnboarding()');
    const html = p.run("document.querySelector('#onboardingSteps').innerHTML");
    ck('unfinished steps offer a way in', (html.match(/data-onboarding-step/g) || []).length === 4,
      String((html.match(/data-onboarding-step/g) || []).length));
    ck('the focus step has no button of its own', !/data-onboarding-step="focus"/.test(html));
  }

  await ck.settled();
});
