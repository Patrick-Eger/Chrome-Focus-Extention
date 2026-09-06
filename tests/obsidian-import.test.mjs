import { test } from 'node:test';
import { loadPage } from './helpers/page.mjs';
import { checks } from './helpers/check.mjs';

const noteFile = (id, title, body, extra = '') => `---
focus_desk_type: note
focus_desk_id: ${JSON.stringify(id)}
project_id: "p1"
project: "Alpha"
workspace: "Work"
updated: "2026-09-01T10:00:00.000Z"${extra}
tags:
  - focus-desk
  - focus-desk-note
---

# ${title}

${body}
`;

test('reading an Obsidian note file', async (t) => {
  const ck = checks(t);
  const p = loadPage({ workspaces: [], projects: [], notes: [], tasks: [], reminders: [],
    dailyPlans: {}, calendarEvents: [], settings: {} });
  const parse = (text) => p.run(`parseObsidianNoteFile(${JSON.stringify(text)})`);

  {
    const out = parse(noteFile('n1', 'Sync notes', 'First line.\n\nSecond paragraph.'));
    ck('the id is read back', out && out.id === 'n1', JSON.stringify(out && out.id));
    ck('the title comes from the heading', out.title === 'Sync notes', out.title);
    ck('the body keeps its paragraphs', out.body === 'First line.\n\nSecond paragraph.', JSON.stringify(out.body));
    ck('the project is carried along', out.projectId === 'p1', out.projectId);
  }

  ck('a file with no frontmatter is refused', parse('# Just a heading\n\ntext') === null);
  ck('a file of another type is refused',
    parse('---\nfocus_desk_type: project\nfocus_desk_id: "x"\n---\n\n# T\n') === null);
  ck('a file with no id is refused', parse('---\nfocus_desk_type: note\n---\n\n# T\n') === null);

  {
    // Titles are written verbatim, so anything a user types has to survive.
    const tricky = 'Notes: "quotes", a — dash & <html>';
    const out = parse(noteFile('n2', tricky, 'body'));
    ck('an awkward title round-trips', out.title === tricky, out.title);
  }
  {
    const out = parse(noteFile('n3', 'T', '- [ ] a task\n- [x] done\n\n## Heading in the body'));
    ck('markdown inside the body is untouched',
      out.body === '- [ ] a task\n- [x] done\n\n## Heading in the body', JSON.stringify(out.body));
  }
  {
    const out = parse(noteFile('n4', 'T', ''));
    ck('an emptied note reads as empty', out.body === '', JSON.stringify(out.body));
  }
  {
    const out = parse(`---\nfocus_desk_type: note\nfocus_desk_id: "n5"\n---\n\nNo heading here.\n`);
    ck('a note whose heading was deleted keeps its body', out.body === 'No heading here.', JSON.stringify(out.body));
    ck('and reports no title', out.title === '', JSON.stringify(out.title));
  }

  await ck.settled();
});

// A vault the page can read, so the import can be driven end to end.
function withVault(files, notes, records) {
  const p = loadPage({
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Work' }],
    projects: [{ id: 'p1', name: 'Alpha', workspaceId: 'w1', links: [] }],
    notes, tasks: [], reminders: [], dailyPlans: {}, calendarEvents: [], inboxItems: [],
    obsidianSyncRecords: records, settings: { obsidianExportFolder: 'Focus Desk' }
  });
  p.run(`
    obsidianVaultHandle = { name: 'MyVault' };
    ensureObsidianReadPermission = async () => true;
    flushPendingNoteSave = async () => {};
    renderObsidianSettings = () => {};
    renderNotes = () => {};
    openSelectedNote = () => { globalThis.__reopened = true; };
    globalThis.__saved = null;
    save = async (patch) => { Object.assign(state, patch); globalThis.__saved = patch; };
    globalThis.__vault = ${JSON.stringify(files)};
    readObsidianFile = async (path) => (path in globalThis.__vault ? globalThis.__vault[path] : null);
  `);
  return p;
}

const PATH = 'Focus Desk/Projects/Alpha--p1/Notes/Sync--n1.md';

test('importing note edits', async (t) => {
  const ck = checks(t);

  const records = (hash, syncedAt) => ({
    p1: { projectId: 'p1', vaultName: 'MyVault', notePaths: { n1: PATH },
      files: { [PATH]: { hash, syncedAt } } }
  });

  // Edited in Obsidian, untouched here: apply it.
  {
    const file = noteFile('n1', 'Sync notes', 'Edited in Obsidian.');
    const p = withVault({ [PATH]: file }, [{ id: 'n1', projectId: 'p1', title: 'Sync notes', body: 'Old body', updatedAt: 1000 }], records('stale-hash', 2000));
    await p.run("importNotesFromObsidian()");
    ck('the note takes the vault version', p.run("state.notes[0].body") === 'Edited in Obsidian.', p.run("state.notes[0].body"));
    ck('and it was saved', p.run("!!globalThis.__saved") === true);
    ck('the message says what happened', /1 note updated/.test(p.run('obsidianSyncMessage')), p.run('obsidianSyncMessage'));
    ck('no conflict raised', p.run('obsidianConflictNotes.length') === 0);
    ck('the recorded hash moves on', p.run(`state.obsidianSyncRecords.p1.files[${JSON.stringify(PATH)}].hash`) !== 'stale-hash');
  }

  // Changed on both sides: leave it alone and say so.
  {
    const file = noteFile('n1', 'Sync notes', 'Edited in Obsidian.');
    const p = withVault({ [PATH]: file }, [{ id: 'n1', projectId: 'p1', title: 'Sync notes', body: 'Edited here', updatedAt: 5000 }], records('stale-hash', 2000));
    await p.run("importNotesFromObsidian()");
    ck('a two-sided edit is left alone', p.run("state.notes[0].body") === 'Edited here', p.run("state.notes[0].body"));
    ck('and reported as a conflict', p.run('obsidianConflictNotes.length') === 1, String(p.run('obsidianConflictNotes.length')));
    ck('named in the message', /changed in both places/.test(p.run('obsidianSyncMessage')), p.run('obsidianSyncMessage'));
    ck('flagged as an error state', p.run('obsidianSyncError') === true);

    // Forcing is the explicit way out.
    await p.run("importNotesFromObsidian({ force: true })");
    ck('forcing takes the vault version', p.run("state.notes[0].body") === 'Edited in Obsidian.', p.run("state.notes[0].body"));
    ck('and clears the conflict', p.run('obsidianConflictNotes.length') === 0);
  }

  // Unchanged file: nothing to do.
  {
    const file = noteFile('n1', 'Sync notes', 'Same body');
    const p = withVault({ [PATH]: file }, [{ id: 'n1', projectId: 'p1', title: 'Sync notes', body: 'Same body', updatedAt: 1000 }], records('stale-hash', 2000));
    await p.run("importNotesFromObsidian()");
    ck('an identical body is not written', p.run("globalThis.__saved") === null, JSON.stringify(p.run("globalThis.__saved")));
    ck('and is counted as unchanged', /1 unchanged/.test(p.run('obsidianSyncMessage')), p.run('obsidianSyncMessage'));
  }

  // Deleting a file must never delete the note.
  {
    const p = withVault({}, [{ id: 'n1', projectId: 'p1', title: 'Sync notes', body: 'Still here', updatedAt: 1000 }], records('stale-hash', 2000));
    await p.run("importNotesFromObsidian()");
    ck('a missing file leaves the note alone', p.run("state.notes.length") === 1 && p.run("state.notes[0].body") === 'Still here');
    ck('and says nothing was deleted', /nothing was deleted/.test(p.run('obsidianSyncMessage')), p.run('obsidianSyncMessage'));
  }

  // A file whose id was changed is not our note.
  {
    const p = withVault({ [PATH]: noteFile('someone-else', 'Sync notes', 'Foreign') },
      [{ id: 'n1', projectId: 'p1', title: 'Sync notes', body: 'Mine', updatedAt: 1000 }], records('stale-hash', 2000));
    await p.run("importNotesFromObsidian()");
    ck('a mismatched id is not applied', p.run("state.notes[0].body") === 'Mine', p.run("state.notes[0].body"));
  }

  // A vault swapped underneath is skipped rather than mixed in.
  {
    const rec = records('stale-hash', 2000);
    rec.p1.vaultName = 'OtherVault';
    const p = withVault({ [PATH]: noteFile('n1', 'Sync notes', 'From elsewhere') },
      [{ id: 'n1', projectId: 'p1', title: 'Sync notes', body: 'Mine', updatedAt: 1000 }], rec);
    await p.run("importNotesFromObsidian()");
    ck('records from another vault are skipped', p.run("state.notes[0].body") === 'Mine', p.run("state.notes[0].body"));
  }

  // The day-note record has no notes and must not trip the loop.
  {
    const rec = records('stale-hash', 2000);
    rec.__days = { vaultName: 'MyVault', files: {}, dayCount: 3 };
    const p = withVault({ [PATH]: noteFile('n1', 'Sync notes', 'New text') },
      [{ id: 'n1', projectId: 'p1', title: 'Sync notes', body: 'Old', updatedAt: 1000 }], rec);
    await p.run("importNotesFromObsidian()");
    ck('the day-note record is skipped safely', p.run("state.notes[0].body") === 'New text', p.run("state.notes[0].body"));
  }

  // A title changed in Obsidian comes back too.
  {
    const p = withVault({ [PATH]: noteFile('n1', 'Renamed in Obsidian', 'Body') },
      [{ id: 'n1', projectId: 'p1', title: 'Sync notes', body: 'Body', updatedAt: 1000 }], records('stale-hash', 2000));
    await p.run("importNotesFromObsidian()");
    ck('a renamed note takes the new title', p.run("state.notes[0].title") === 'Renamed in Obsidian', p.run("state.notes[0].title"));
  }

  await ck.settled();
});
