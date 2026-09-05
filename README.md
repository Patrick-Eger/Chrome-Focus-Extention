# Focus Desk

Focus Desk is a local-first Chrome productivity extension built from the original
Chrome Focus Etention project. It combines a new-tab daily planner, task and note
management, workspace-based tab sets, Google Calendar previews, and focus sessions
that block every website outside the active workspace allowlist.

## Included in this version

- 25, 50, and 90 minute focus sessions
- Click-to-edit custom focus sessions from 1 to 180 minutes
- Switchable dashboard and full-screen Moment new-tab modes
- Customizable dashboard start page: show, hide, reorder, and re-column the
  Focus session, Day plan, Next tasks, Upcoming, and Obsidian recall cards
- On-dashboard editing mode that arranges those cards by dragging them where
  they sit, with background and transparency sliders that preview live
- Optional dashboard background photo from the personal image library, with an
  adjustable readability overlay and card transparency set either for the whole
  dashboard or per individual card
- System, light, and dark display modes with four shared UI color palettes
- Centred Moment screen with a time-of-day greeting, a daily main-focus prompt,
  and corner panels for links, tasks, and the focus timer
- Configurable Moment clock format and size, overlay, visible elements, and quote source
- Random or personal quotes with either online photos or a personal background-image library
- Workspace-specific website allowlists, including localhost, private IP
  addresses, and other single-name hosts for local development
- Optional site blocking: a focus session can run as a timer only
- A burst and a short chime when a task is finished, both switchable
- Remaining session time on the Moment screen
- Workspace favorites with quick capture from the extension popup
- Global search across projects, tasks, notes, flashcards, Inbox items, reminders,
  work blocks, saved links, and workspaces, opening each result where it lives
- Universal Inbox for ideas, tasks, notes, and links with editing, filters,
  processing history, restore, and conversion into project work
- Chrome side panel with current-page capture, direct project routing, recent
  Inbox items, and shared 25/90-minute focus controls
- Current-page capture from the popup, page context menu, or
  `Command+Shift+Y` (`Ctrl+Shift+Y` on Windows/Linux)
- Save the current window as a workspace and reopen its tabs as a Chrome tab group
- Visible saved-tab lists with individual open and remove actions
- Google-style day timelines in Today and Calendar with quarter-hour creation,
  overlap layout, an all-day lane, current-time marker, and drag rescheduling
- Standalone personal reminders with their own editor, exact-time browser
  notifications, timeline entries, and completion state
- Daily Planning Engine with a draggable task bank, one-click task scheduling,
  priority-based automatic planning, configurable work hours, and task estimates
- Calendar-aware scheduling that protects timed Google Calendar events and marks
  deliberate schedule conflicts
- Linked work blocks that retain their task, project, and workspace, then start
  the matching workspace and focus session together
- End-of-day review with completion and one-click rollover to tomorrow
- Personal projects inside each workspace with outcomes, status, priority, due dates,
  progress, and archive/restore
- Project link libraries with site favicons for saving and reopening useful
  websites and resources, including one-click opening of every project link
- Project task groups plus Overview, five-stage Kanban, and grouped List views
- A whiteboard per project on an infinite canvas with a pen, shapes, text, an
  eraser, a select tool for moving things afterwards, and a fullscreen view,
  saving itself as you draw
- Rich tasks with project/group relationships, Markdown details, labels, estimates,
  due and planned dates, priorities, and subtasks
- Searchable Markdown notes with a full editor, sanitized preview, and automatic saving
- Markdown notes linked to either a workspace or a specific project and organized
  in collapsible workspace/project folders
- Local Obsidian vault recall with configurable inline or frontmatter tags
- One-way Obsidian export for projects, saved links, and project notes with
  per-file conflict protection
- Flashcards created from notes
- Two-way Google Calendar sync for work blocks, writable-calendar selection,
  reminders in Google and the browser, incremental background sync, and visible
  conflict/error states
- Google account connection management and status in Settings
- Optional automatic focus start, workspace-tab opening, missed-block recovery,
  and end-of-block review notifications
- Configurable blocked-site gates:
  - hard block
  - math problem
  - review three flashcards
  - state an intention
  - complete an open task
- Temporary site access that expires automatically
- Full JSON export and import of every local record, including whiteboards
- Migration of existing whitelist lists and todos when this build uses the same
  Chrome extension ID as the original extension
- Automatic v3 migration that keeps existing tasks and notes unassigned until they
  are deliberately moved into a project
- Automatic v12 migration that adds the Inbox and linked planner metadata without
  changing existing workspaces, projects, tasks, or notes
- Automatic v13 migration that adds Calendar links, sync tokens, auto-start
  settings, and richer work-block lifecycle states
- Automatic v14 migration that adds browser reminder alarms and Obsidian project
  export records without changing existing project or note content
- Automatic v15 migration that adds standalone reminders without converting them
  into work blocks or focus sessions
- Automatic v16 migration that adds the start-page layout, dashboard background,
  and card-transparency settings, leaving every card on the shared value

All productivity data is stored in `chrome.storage.local`. No backend or account is
required for the extension itself.

## Backup: export and import

**Settings > Your data** writes everything to a single JSON file: projects, tasks,
notes, the Inbox, day plans, reminders, workspaces, flashcards, settings, and every
project whiteboard. Moment images are opt-in, since inlining photos can make the
file very large. The connected Google account and its sync tokens are deliberately
left out - they are credentials-adjacent and are re-established by reconnecting.

Importing replaces everything currently in the extension, after a confirmation that
names the backup's date and size. The file is run through the same migration the
extension performs at start-up, so an export from an older version is upgraded
rather than written in as-is. A running focus session and any temporary site
unlocks are never restored from a file.

This is also the answer to moving between machines: export on one, import on the
other.

Personal Moment images are stored separately in the browser's IndexedDB storage so
multiple large image files do not consume Chrome sync storage. Up to 30 images can
be selected, and a different one is chosen whenever a new tab opens. Online mode
uses the public random-image endpoint from [Lorem Picsum](https://picsum.photos/)
and does not require an API key.

## Load the extension

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `Chrome-Focus-Etention-Productivity` folder.
5. Open a new tab to use Focus Desk.

Chrome will show the extension ID on the extension card. Keep that ID for the
Google Calendar setup below.

## Connect Google Calendar

Google requires every extension owner to supply an OAuth client ID. The checked-in
manifest intentionally contains a placeholder and Calendar will show a setup error
until it is replaced.

1. Create or choose a project in Google Cloud Console.
2. Enable the **Google Calendar API** for that project.
3. Configure the OAuth consent screen.
4. Create an OAuth client ID with application type **Chrome Extension**.
5. Enter the extension ID shown on `chrome://extensions`.
6. Replace `000000000000-placeholder.apps.googleusercontent.com` in
   `manifest.json` with the generated client ID.
7. Reload Focus Desk from `chrome://extensions`.
8. Open Focus Desk, go to **Settings**, and choose **Connect Google**.

The requested OAuth scopes are:
`https://www.googleapis.com/auth/calendar.readonly` and
`https://www.googleapis.com/auth/calendar.events`.
The first reads the calendars and events visible to the account; the second creates,
updates, and deletes only the events the user asks Focus Desk to manage.
The `identity.email` permission is used only to show which Chrome account is connected.

## Connect an Obsidian vault

1. Open Focus Desk and go to **Settings**.
2. In **Obsidian vault**, choose **Choose vault**.
3. Select the folder that contains the vault.
4. Set the recall tag, such as `recall`, and save the settings.

Focus Desk recursively reads Markdown files smaller than 2 MB, skips hidden folders,
and shows one matching note on the Today dashboard. Tags may be written inline as
`#recall` or in YAML frontmatter, including `tags: [recall]` and list-style tags.
Use **Another note** for a different match and **Scan vault** after changing files.
The directory handle is kept in extension IndexedDB; note contents are rendered
locally and are not uploaded.

To export project material, choose an export folder name and use **Sync all
projects** in Settings or **Sync to Obsidian** inside one project. Focus Desk writes:

```text
Focus Desk/
  Projects/
    Project name--project-id/
      Project.md
      Notes/
        Note title--note-id.md
```

This is intentionally a one-way export from Focus Desk. It includes project
metadata, saved links, and notes assigned to the project. Tasks and day plans are
never exported. Before every write, Focus Desk compares each existing file with
the last exported version. Files changed in Obsidian are left untouched and the
project is marked for review; replacing them requires explicit confirmation.

## Important behavior

Finishing a task sets off a small burst of particles where you ticked it and plays
a two-note chime. **Celebrate finished tasks** and **Play a sound with it** in
Settings turn each off separately, and the burst is skipped for anyone whose system
asks for reduced motion. It fires on the way to done only, never on reopening, and
the sound is synthesised rather than shipped as an audio file.

**Block sites during focus** in Settings decides whether a session blocks anything.
With it off, focus still runs the timer, the workspace, and any linked work block,
but no navigation is redirected - useful when the session is about the timer rather
than about restriction. The switch takes effect immediately, including on a session
already running, and the dashboard, sidebar, and popup all say when a session is
running without blocking.

Allowlists accept any host, not only public domain names: `localhost`,
`localhost:3000`, `127.0.0.1`, a private address such as `192.168.1.20`, and
single-name machines on the local network all work. A port is ignored, so allowing
`localhost:3000` allows every port on `localhost`.

While blocking is on, all normal `http` and `https` navigation is redirected to the
blocked page unless the host belongs to the active workspace or has a temporary
access pass. Google authentication domains remain available so Calendar login can
complete. Ending the session removes the blocking rule.

The popup's **Allow current site** action permanently adds the current domain to the
active workspace. A successful focus gate only grants access for the configured
number of minutes.

Use **Save page to Inbox** in the popup for a one-click link capture. Open the side
panel when the page needs context or should go directly into a project. The page
context menu can also create an Inbox link/task or open the project capture panel.

The start page can be arranged from either of two places, both writing the same
settings.

**Customize** in the top bar, beside **New note**, opens an editing mode on the
dashboard itself. The button appears only on the Today view and turns into **Done
editing** while the mode is on; because the top bar is sticky, it stays reachable
at any scroll position. Each card gets a bar naming it and its column, cards are
dragged where they should go - onto another card to sit before it, or onto empty
column space to land at the end - and **Hide** removes one into a tray that puts
it back. Empty columns stay on screen as drop targets while editing. The card
contents are inert in this mode, so a card can be grabbed anywhere without
triggering its controls. The editing panel carries the task-bank toggle, the
background switch, and both sliders, so every change previews on the real
dashboard underneath.

**Settings > Start page** offers the same control as an ordered list, which is
the keyboard-friendly path: a checkbox, a column dropdown, and arrow buttons per
card. **Reset layout** in either place restores the defaults. Hiding every card
leaves a short note pointing back to the settings.

The same section can put a background photo behind the dashboard. It draws from
the personal image library shared with Moment mode, so images added under
**Moment screen** are available here too and a different one is chosen on every
new tab. **Readability overlay** fades the photo behind the whole interface, and
**Card transparency** sets how far the cards themselves let it through, from fully
opaque to almost invisible.

Transparency can also be set per card. While a photo is active, each card carries
its own slider - in its bar in editing mode, and as an extra row in the Settings
list. A card left on **Auto** follows the dashboard-wide value, so moving that
slider changes only the cards that have no value of their own; giving a card its
own value takes it out of that group until **Auto** puts it back. Per-card values
are kept when the photo is switched off and apply again when it returns.

Cards become translucent only while a photo is active, and the sidebar and top bar
keep a minimum opacity of their own so navigation stays readable at any slider
position. With an empty library the setting reports that no images are saved and
the dashboard stays plain.

## The Moment screen

Moment is the full-screen new-tab mode. Its layout follows the arrangement made
familiar by Momentum: a full-bleed photo, a large light-weight clock centred just
above the middle, a time-of-day greeting under it, and a single question below
that - **What is your main focus for today?**

While a focus session runs, the big clock becomes the remaining time, labelled
**Time left**, and the clock itself moves into a small line under the greeting
alongside the workspace name - so the countdown is the thing you cannot miss and
the time of day is still there. **Show remaining time** in Settings turns this off
and keeps the clock a clock; it is separate from **Show focus controls**, so
hiding the buttons does not hide how long is left.

Typing an answer replaces the question with the answer itself. Hovering it reveals
a circle to tick it off and a cross to clear it. The answer belongs to one day: a
new day asks the question again rather than carrying yesterday's answer forward.
The name in the greeting is set in **Settings > Moment screen**; with no name it
just reads "Good morning."

The corners hold everything else, each a plain label until it is clicked:

- **Links** (top left) - the current workspace's favorites
- **New photo** (top right) - another image from the library
- **Dashboard** and photo source (bottom left) - back to the full dashboard
- Quote (bottom centre)
- **Todo** and **Focus** (bottom right) - open tasks, tickable in place, and the
  25/50/90-minute focus timer. While a session runs, the Focus label counts down too

One panel is open at a time and Escape closes them. Every element has its own
switch under **Settings > Moment screen**, so the screen can be reduced to just a
clock. Momentum's weather corner is not implemented; it needs a third-party
weather service and a location, which the extension does not have.

## Project whiteboards

Every project has a **Whiteboard** tab beside Overview, Board, and List. The canvas
is unbounded: drag with **Pan** or hold Space to move, scroll to zoom between 20%
and 500%, and **Reset view** returns to the origin. A faint dot grid makes the
movement legible.

**Fullscreen** at the right of the bar hands the whole screen to the board, toolbar
included; the button and Escape both leave it again.

**Pen** draws freehand. **Shape** drags out a rectangle, ellipse, line or arrow -
the picker beside the tools chooses which, and holding Shift constrains it to a
square, a circle or a straight line. Shapes are outlines, so only their edge is
clickable and a large rectangle does not swallow everything behind it. **Text**
places a box wherever you click; clicking an existing text reopens it, and emptying
one removes it.

**Select** picks up whatever is under the cursor - a shape, a text, or a pen stroke
- and drags it somewhere else; Delete or Backspace removes it. When items overlap,
the most recently added one wins, which is also the one drawn on top. A drag is one
save, however far it goes.

**Eraser** removes whatever it touches - brush across several strokes and they all
go, and a ring shows its reach. It works per item rather than per pixel: a stroke,
shape or text box is removed whole, never cut in half. Text takes multiple lines,
Escape or Cmd/Ctrl+Enter commits it. The pen follows the interface text colour, so
it stays readable in dark mode. **Undo** removes the most recent stroke or text
(also Cmd/Ctrl+Z), and **Clear board** empties the whole canvas after a
confirmation.

Nothing needs saving by hand: every change is written half a second later and the
bar shows when it last saved. Strokes and text are stored per project in their own
IndexedDB database rather than in `chrome.storage.local`, because a drawing grows
without bound and that store is capped and sent to every page on load. Whiteboards
are therefore local to the browser profile and are not part of the Obsidian export.

## Search

**Search** sits in the top bar on every view and opens with `Command+K`
(`Ctrl+K` on Windows/Linux) or `/`. It looks through projects and their groups,
tasks including labels and subtasks, note titles and bodies, flashcards, Inbox
items, reminders, work blocks on every planned day, saved links and tabs, and
workspaces.

Titles outrank body text, a match at the start of a word outranks one inside it,
and recently touched items edge ahead of older ones. Completed, archived, and past
items still appear but are dimmed and ranked below open ones. Arrow keys move,
Enter opens, Escape closes.

Opening a result takes you to where the item actually lives - the task drawer, the
note editor, the work-block or reminder editor, the project, or the Inbox row -
and sets the surrounding view up first, so an archived project or a completed task
is not hidden behind a filter when you land. Saved links open in a new tab. If an
item was deleted in another tab in the meantime, Focus Desk says so instead of
opening an empty editor.

The **Appearance** settings offer System, Light, and Dark display modes. System
follows the operating-system preference; the selected mode and accent palette apply
to the dashboard, popup, blocked-site page, and Markdown editor.

Each planned work block creates a Chrome alarm for its start time and, when enabled,
a separate reminder alarm. The reminder appears as a browser notification and is
also attached to a linked Google Calendar event. With automatic start enabled,
Focus Desk starts the linked workspace and focus timer, then shows a browser
notification. Blocks due while Chrome or the computer was asleep start inside the
configured grace window; older blocks become missed. **Start** and **Done** work
from both the Today and Calendar timelines. When a linked focus timer ends, the
block becomes ready for review instead of being marked complete without
confirmation.

Standalone reminders are independent of work blocks. Create them from either the
Today or Calendar toolbar, then set a title, date, time, and optional notes. They
appear on both day timelines and in Upcoming, but do not add planned minutes, start
focus mode, or reserve a task. At the selected time, Focus Desk shows a browser
notification. Use **Done** to keep a muted record on that day or open the reminder
to edit or delete it.

**Plan my day** ranks ready tasks using priority, due date, today status, and
in-progress state. It places them into the first available workday slots around
existing blocks and timed Calendar events. Workday boundaries and the fallback
estimate for tasks without an estimate are configurable in Settings.

## Project structure

- `background.js` - storage migration, focus state, blocking rules, work-block
  notifications, temporary access, workspace tab capture, and Google Calendar requests
- `newtab.html`, `newtab.css`, `newtab.js` - full productivity dashboard
- `sidepanel.html`, `sidepanel.css`, `sidepanel.js` - current-page capture and
  focus side panel
- `blocked.html`, `blocked.css`, `blocked.js` - focus gate experience
- `popup.html`, `popup.css`, `popup.js` - quick controls
- `manifest.json` - Manifest V3 permissions, entry points, and OAuth configuration

## Current boundaries

- Data is local to this Chrome profile; cross-device/platform sync needs a backend.
  Export and import move it between machines by hand.
- Google Calendar access requires the extension owner's OAuth client ID. Background
  sync occurs while Chrome is running; Chrome alarms cannot wake a sleeping computer.
- Workspace restore opens saved tabs without closing existing tabs.
- Flashcard review is intentionally lightweight and does not yet use spaced
  repetition scheduling.
- Online Moment backgrounds require an internet connection. Personal backgrounds
  remain available offline.
- Obsidian recall scans up to 5,000 Markdown files per vault and requires a
  Chromium browser with local folder access support.
- Obsidian sync is one-way. It does not import project changes from Markdown and
  does not remove old exported files automatically.
