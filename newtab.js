let state = null;
let selectedFocusMinutes = 25;
let selectedNoteId = null;
let markdownEditor = null;
let noteAutosaveTimer = null;
let noteSaveQueue = Promise.resolve();
let noteDirty = false;
let suppressEditorChange = false;
let toastTimer = null;
let momentInitialized = false;
let momentObjectUrl = null;
let momentImageSource = null;
let obsidianVaultHandle = null;
let obsidianRecallNotes = [];
let currentObsidianRecall = null;
let obsidianRecallState = 'disconnected';
let obsidianRecallMessage = '';
let obsidianSyncInProgress = false;
let obsidianSyncMessage = '';
let obsidianSyncError = false;
let selectedProjectId = null;
let projectIndexMode = 'active';
let projectViewMode = 'overview';
let projectGroupFilter = 'all';
let selectedDrawerTaskId = null;
let drawerSubtasks = [];
let dayReviewOpen = false;
let draggedPlannerTaskId = null;
let noteFoldersInitialized = false;
let inboxStatusFilter = 'open';
let inboxTypeFilter = 'all';
let selectedPlannerDate = null;
let selectedCalendarDate = null;
let editingWorkBlockId = null;
let editingWorkBlockDate = null;
let editingReminderId = null;
let draggedWorkBlockId = null;
let draggedWidgetId = null;
let draggedDashboardCard = null;
let dashboardEditing = false;
let dashboardPhotoStatus = '';
let pendingWidgetFocus = null;
let dashboardObjectUrl = null;
let dashboardBackgroundLoaded = false;
const openInboxItems = new Set();
const openNoteWorkspaceFolders = new Set();
const openNoteProjectFolders = new Set();

const PROJECT_STATUSES = ['idea', 'active', 'paused', 'completed'];
const TASK_STATUSES = ['backlog', 'planned', 'in-progress', 'waiting', 'done'];
const TASK_STATUS_LABELS = {
  backlog: 'Backlog',
  planned: 'Planned',
  'in-progress': 'In progress',
  waiting: 'Waiting',
  done: 'Done'
};

const DASHBOARD_LANES = ['full', 'main', 'side'];
const DASHBOARD_LANE_LABELS = { full: 'Full width', main: 'Main column', side: 'Side column' };
const DEFAULT_DASHBOARD_WIDGETS = [
  { id: 'focus', lane: 'full', visible: true },
  { id: 'dayPlan', lane: 'main', visible: true },
  { id: 'tasks', lane: 'side', visible: true },
  { id: 'upcoming', lane: 'side', visible: true },
  { id: 'recall', lane: 'side', visible: true }
];
const DASHBOARD_WIDGET_META = {
  focus: { title: 'Focus session', description: 'Timer, workspace picker, and start control.' },
  dayPlan: { title: 'Day plan', description: 'Timeline, work blocks, reminders, and review.' },
  tasks: { title: 'Next tasks', description: 'The open tasks waiting for attention.' },
  upcoming: { title: 'Upcoming', description: 'The next calendar events and reminders.' },
  recall: { title: 'Obsidian recall', description: 'A random tagged note from the vault.' }
};

const OBSIDIAN_DATABASE = 'focus-desk-integrations';
const OBSIDIAN_HANDLE_STORE = 'handles';
const OBSIDIAN_HANDLE_KEY = 'obsidian-vault';
const OBSIDIAN_MAX_FILES = 5000;
const OBSIDIAN_MAX_FILE_SIZE = 2 * 1024 * 1024;

const MOMENT_QUOTES = [
  { text: 'Nothing will work unless you do.', author: 'Maya Angelou' },
  { text: 'Well begun is half done.', author: 'Aristotle' },
  { text: 'Great things are done by a series of small things brought together.', author: 'Vincent van Gogh' },
  { text: 'The way to get started is to quit talking and begin doing.', author: 'Walt Disney' },
  { text: 'Concentrate all your thoughts upon the work in hand.', author: 'Alexander Graham Bell' },
  { text: 'It is not enough to be busy. The question is: what are we busy about?', author: 'Henry David Thoreau' },
  { text: 'The shorter way to do many things is to only do one thing at a time.', author: 'Mozart' },
  { text: 'You may delay, but time will not.', author: 'Benjamin Franklin' }
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const todayKey = () => {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
};

document.addEventListener('DOMContentLoaded', async () => {
  selectedPlannerDate = todayKey();
  selectedCalendarDate = todayKey();
  bindNavigation();
  bindFocus();
  bindPlanning();
  bindInbox();
  bindProjects();
  bindTasks();
  bindNotes();
  bindWorkspaces();
  bindCalendar();
  bindObsidianRecall();
  bindSettings();
  bindMomentMode();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(updateFocusTimer, 1000);
  await loadState();
  await initializeObsidianRecall();

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'stateUpdate') loadState();
    if (message && message.type === 'workBlockStarted') {
      const block = message.block || {};
      const duration = Number(block.duration) || 60;
      showToast(`Starting now: ${block.title || 'Your next work block'} (${duration} min)`);
    }
    if (message && message.type === 'workBlockDue') {
      showToast(`Due now: ${message.block && message.block.title || 'Your next work block'}`);
    }
    if (message && message.type === 'workBlockMissed') {
      showToast(`Missed: ${message.block && message.block.title || 'A planned work block'}`);
    }
    if (message && message.type === 'workBlockReminder') {
      const block = message.block || {};
      showToast(`${block.title || 'Work block'} starts in ${Number(block.reminderMinutes) || 10} minutes.`);
    }
    if (message && message.type === 'standaloneReminderDue') {
      const reminder = message.reminder || {};
      showToast(`Reminder: ${reminder.title || 'Something needs your attention.'}`);
    }
  });
});

async function send(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response || !response.ok) return reject(new Error(response && response.error || 'The extension did not respond.'));
      resolve(response);
    });
  });
}

async function loadState() {
  try {
    const response = await send('getState');
    state = response.state;
    selectedFocusMinutes = state.focus.active
      ? state.focus.durationMinutes
      : selectedFocusMinutes || state.settings.defaultFocusMinutes;
    render();
  } catch (error) {
    showToast(error.message);
  }
}

async function save(patch) {
  await chrome.storage.local.set(patch);
  Object.assign(state, patch);
  render();
}

function render() {
  if (!state) return;
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.projectGroups = Array.isArray(state.projectGroups) ? state.projectGroups : [];
  state.inboxItems = Array.isArray(state.inboxItems) ? state.inboxItems : [];
  state.reminders = Array.isArray(state.reminders) ? state.reminders : [];
  state.obsidianSyncRecords = state.obsidianSyncRecords && typeof state.obsidianSyncRecords === 'object'
    ? state.obsidianSyncRecords
    : {};
  applyPalette();
  applyDashboardLayout();
  applyDashboardBackground();
  renderWorkspaceOptions();
  renderFocus();
  renderDayRail();
  renderInbox();
  renderProjects();
  renderTasks();
  renderNotes();
  renderWorkspaces();
  renderCalendar();
  renderObsidianRecall();
  renderSettings();
  renderMomentMode();
  $('#inboxCount').textContent = state.inboxItems.filter((item) => item.status === 'open').length;
  $('#projectCount').textContent = state.projects.filter((project) => !project.archived).length;
  $('#taskCount').textContent = state.tasks.filter((task) => !task.completed).length;
  $('#noteCount').textContent = state.notes.length;
}

function bindNavigation() {
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-go-view]');
    if (link) showView(link.dataset.goView);
  });
  $('#quickNoteButton').addEventListener('click', async () => {
    await flushPendingNoteSave();
    beginNewNote();
    showView('notes');
  });
  $('#openMomentMode').addEventListener('click', () => setNewTabMode('moment'));
}

function showView(name) {
  $$('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `${name}View`));
  $('#toggleDashboardEditing').classList.toggle('hidden', name !== 'today');
  const view = $(`#${name}View`);
  $('#viewTitle').textContent = view ? view.dataset.title : 'Focus Desk';
  if (name === 'projects') renderProjects();
  if (name === 'today' && obsidianRecallNotes.length) chooseRandomObsidianRecall();
}

function bindFocus() {
  $$('.segment, .moment-segment').forEach((button) => button.addEventListener('click', () => {
    selectedFocusMinutes = Number(button.dataset.minutes);
    renderFocus();
  }));
  $('#focusTimer').addEventListener('click', openFocusDurationEditor);
  $('#focusDurationEditor').addEventListener('submit', (event) => {
    event.preventDefault();
    selectedFocusMinutes = clamp($('#focusDurationMinutes').value, 1, 180, selectedFocusMinutes);
    closeFocusDurationEditor();
    renderFocus();
  });
  $('#cancelFocusDuration').addEventListener('click', closeFocusDurationEditor);
  $('#focusDurationMinutes').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeFocusDurationEditor();
  });
  $('#focusWorkspace').addEventListener('change', async (event) => {
    await save({ activeWorkspaceId: event.target.value });
  });
  $('#focusToggle').addEventListener('click', toggleFocus);
  $('#momentFocusToggle').addEventListener('click', toggleFocus);
}

function openFocusDurationEditor() {
  const active = state && state.focus.active && state.focus.endAt > Date.now();
  if (active) return;
  $('#focusDurationMinutes').value = selectedFocusMinutes;
  $('#focusDurationEditor').classList.remove('hidden');
  $('#focusMessage').classList.add('hidden');
  $('#focusTimer').setAttribute('aria-expanded', 'true');
  setTimeout(() => $('#focusDurationMinutes').select(), 0);
}

function closeFocusDurationEditor() {
  $('#focusDurationEditor').classList.add('hidden');
  $('#focusMessage').classList.remove('hidden');
  $('#focusTimer').setAttribute('aria-expanded', 'false');
}

async function toggleFocus() {
  try {
    if (state.focus.active) await send('stopFocus');
    else await send('startFocus', {
      minutes: selectedFocusMinutes,
      mode: selectedFocusMinutes === 90 ? 'deep' : 'pomodoro'
    });
    await loadState();
  } catch (error) {
    showToast(error.message);
  }
}

function renderFocus() {
  const workspace = getWorkspace(state.activeWorkspaceId);
  const active = state.focus.active && state.focus.endAt > Date.now();
  $('#focusToggle').textContent = active ? 'End session' : 'Start focus';
  $('#focusToggle').classList.toggle('danger', active);
  $('#focusToggle').classList.toggle('primary', !active);
  $('#momentFocusToggle').textContent = active ? 'End session' : 'Start focus';
  $('#momentFocusToggle').classList.toggle('running', active);
  $('#momentFocusLabel').textContent = active ? getWorkspace(state.activeWorkspaceId).name : 'Focus session';
  $('#focusMessage').textContent = active
    ? `Only ${workspace.domains.length} allowed domain${workspace.domains.length === 1 ? '' : 's'} in ${workspace.name}.`
    : 'Choose a session length and protect your attention.';
  $('#sidebarFocusStatus').textContent = active ? 'Focus running' : 'Not running';
  $('#sidebarWorkspace').textContent = workspace.name;
  $$('.segment, .moment-segment').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.minutes) === selectedFocusMinutes);
    button.disabled = active;
  });
  $('#focusTimer').disabled = active;
  $('#focusTimer').title = active ? 'Focus session in progress' : 'Change session length';
  if (active) closeFocusDurationEditor();
  $('#focusWorkspace').disabled = active;
  updateFocusTimer();
}

function updateFocusTimer() {
  if (!state) return;
  const active = state.focus.active && state.focus.endAt > Date.now();
  const milliseconds = active
    ? Math.max(0, state.focus.endAt - Date.now())
    : selectedFocusMinutes * 60000;
  const totalSeconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  $('#focusTimer').textContent = display;
  $('#momentFocusTimer').textContent = display;
  if (state.focus.active && !active) loadState();
}

function bindPlanning() {
  $('#planTime').value = nextRoundedTime();
  $('#plannerPreviousDay').addEventListener('click', () => stepPlannerDate(-1));
  $('#plannerNextDay').addEventListener('click', () => stepPlannerDate(1));
  $('#plannerToday').addEventListener('click', () => {
    selectedPlannerDate = todayKey();
    renderDayRail();
  });
  $('#newWorkBlock').addEventListener('click', () => openWorkBlockModal({
    dateKey: selectedPlannerDate,
    time: selectedPlannerDate === todayKey() ? nextRoundedTime() : state.settings.workdayStart
  }));
  $('#newReminder').addEventListener('click', () => openReminderModal({
    dateKey: selectedPlannerDate,
    time: selectedPlannerDate === todayKey() ? nextRoundedTime() : state.settings.workdayStart
  }));
  $('#workBlockWorkspace').addEventListener('change', renderWorkBlockContextOptions);
  $('#workBlockStart').addEventListener('change', updateWorkBlockEndFromStart);
  $('#workBlockForm').addEventListener('submit', saveWorkBlockFromModal);
  $('#deleteWorkBlock').addEventListener('click', deleteWorkBlockFromModal);
  $('#closeWorkBlockModal').addEventListener('click', closeWorkBlockModal);
  $('#workBlockBackdrop').addEventListener('click', closeWorkBlockModal);
  $('#reminderForm').addEventListener('submit', saveReminderFromModal);
  $('#deleteReminder').addEventListener('click', deleteReminderFromModal);
  $('#closeReminderModal').addEventListener('click', closeReminderModal);
  $('#reminderBackdrop').addEventListener('click', closeReminderModal);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#reminderModal').classList.contains('hidden')) closeReminderModal();
  });
  $('#planForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const now = Date.now();
    const block = {
      id: createId('block'),
      time: $('#planTime').value,
      title: $('#planTitle').value.trim(),
      duration: clamp($('#planDuration').value, 5, 480, 60),
      workspaceId: state.activeWorkspaceId,
      projectId: null,
      taskId: null,
      status: 'planned',
      source: 'manual',
      autoStart: state.settings.autoStartBlocks !== false,
      calendar: defaultWorkBlockCalendar(),
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    };
    if (!block.title) return;
    const dailyPlans = { ...state.dailyPlans };
    dailyPlans[selectedPlannerDate] = [...(dailyPlans[selectedPlannerDate] || []), block];
    $('#planTitle').value = '';
    await save({ dailyPlans });
  });

  $('#autoPlanDay').addEventListener('click', autoPlanDay);
  $('#toggleDayReview').addEventListener('click', () => {
    dayReviewOpen = !dayReviewOpen;
    renderDayRail();
  });
  $('#closeDayReview').addEventListener('click', () => {
    dayReviewOpen = false;
    renderDayRail();
  });

  $('#plannerTaskBank').addEventListener('dragstart', (event) => {
    const task = event.target.closest('[data-planner-task]');
    if (!task) return;
    draggedPlannerTaskId = task.dataset.plannerTask;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/plain', draggedPlannerTaskId);
  });
  $('#plannerTaskBank').addEventListener('dragend', () => {
    draggedPlannerTaskId = null;
    draggedWorkBlockId = null;
    $('#dayRail').classList.remove('drop-ready');
  });
  $('#plannerTaskBank').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-schedule-task]');
    if (!button) return;
    await scheduleTaskBlock(button.dataset.scheduleTask);
  });

  $('#dayRail').addEventListener('dragover', (event) => {
    if (!draggedPlannerTaskId && !draggedWorkBlockId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    $('#dayRail').classList.add('drop-ready');
  });
  $('#dayRail').addEventListener('dragleave', (event) => {
    if (!$('#dayRail').contains(event.relatedTarget)) $('#dayRail').classList.remove('drop-ready');
  });
  $('#dayRail').addEventListener('drop', async (event) => {
    event.preventDefault();
    $('#dayRail').classList.remove('drop-ready');
    const taskId = draggedPlannerTaskId || event.dataTransfer.getData('text/plain');
    const blockId = draggedWorkBlockId || event.dataTransfer.getData('application/x-focus-desk-block');
    draggedPlannerTaskId = null;
    draggedWorkBlockId = null;
    if (blockId) {
      await moveWorkBlockToTime(blockId, timelineDropTime(event));
      return;
    }
    if (!taskId) return;
    const task = state.tasks.find((entry) => entry.id === taskId);
    const duration = taskEstimate(task);
    await scheduleTaskBlock(taskId, workdayDropTime(event, duration));
  });

  $('#dayRail').addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-work-block]');
    if (!card) return;
    draggedWorkBlockId = card.dataset.workBlock;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-focus-desk-block', draggedWorkBlockId);
  });

  $('#dayRail').addEventListener('click', async (event) => {
    const remove = event.target.closest('[data-delete-block]');
    const blockCard = event.target.closest('[data-work-block]');
    const reminderCard = event.target.closest('[data-reminder]');
    const eventCard = event.target.closest('[data-calendar-event]');
    const timeSlot = event.target.closest('[data-timeline-minute]');
    if (await handleReminderAction(event)) return;
    if (await handleWorkBlockAction(event, selectedPlannerDate)) return;
    if (!remove) {
      if (blockCard) {
        openWorkBlockModal({ dateKey: selectedPlannerDate, blockId: blockCard.dataset.workBlock });
      } else if (reminderCard) {
        openReminderModal({ reminderId: reminderCard.dataset.reminder });
      } else if (eventCard) {
        const calendarEvent = (state.calendarEvents || []).find((entry) => (
          `${entry.calendarId}:${entry.id}` === eventCard.dataset.calendarEvent
        ));
        if (calendarEvent && calendarEvent.htmlLink) window.open(calendarEvent.htmlLink, '_blank', 'noopener');
      } else if (timeSlot) {
        openWorkBlockModal({
          dateKey: selectedPlannerDate,
          time: minutesToTime(Number(timeSlot.dataset.timelineMinute))
        });
      }
      return;
    }
    try {
      if (remove) {
        const block = getWorkBlock(selectedPlannerDate, remove.dataset.deleteBlock);
        if (block && block.status === 'active') await send('stopFocus');
        const dailyPlans = { ...state.dailyPlans };
        dailyPlans[selectedPlannerDate] = (dailyPlans[selectedPlannerDate] || []).filter((block) => block.id !== remove.dataset.deleteBlock);
        await save({ dailyPlans });
        return;
      }
      await loadState();
    } catch (error) {
      showToast(error.message);
    }
  });

  $('#dayReviewList').addEventListener('click', async (event) => {
    const complete = event.target.closest('[data-review-complete]');
    const rollover = event.target.closest('[data-review-rollover]');
    if (!complete && !rollover) return;
    try {
      if (complete) {
        await send('completeWorkBlock', { dateKey: selectedPlannerDate, id: complete.dataset.reviewComplete });
        showToast('Marked complete.');
      }
      if (rollover) {
        const block = getWorkBlock(selectedPlannerDate, rollover.dataset.reviewRollover);
        const targetDate = dateKeyFromDate(addDays(new Date(`${selectedPlannerDate}T12:00:00`), 1));
        const time = findAvailableWorkTime(targetDate, Number(block.duration), state.dailyPlans[targetDate] || [])
          || block.time;
        await send('rolloverWorkBlock', { dateKey: selectedPlannerDate, id: block.id, targetDate, time });
        showToast(`Rolled forward to ${formatShortDate(targetDate)}.`);
      }
      await loadState();
    } catch (error) {
      showToast(error.message);
    }
  });
}

function openReminderModal({ dateKey, time, reminderId = null } = {}) {
  const reminder = reminderId ? getReminder(reminderId) : null;
  editingReminderId = reminder ? reminder.id : null;
  const selectedDate = reminder ? reminder.date : dateKey || todayKey();
  const selectedTime = reminder
    ? reminder.time
    : validWorkTime(time) ? time : nextRoundedTime();
  $('#reminderModalHeading').textContent = reminder ? 'Edit reminder' : 'New reminder';
  $('#reminderTitle').value = reminder ? reminder.title : '';
  $('#reminderDate').value = selectedDate;
  $('#reminderTime').value = selectedTime;
  $('#reminderNotes').value = reminder ? reminder.notes || '' : '';
  $('#deleteReminder').classList.toggle('hidden', !reminder);
  $('#reminderFormStatus').textContent = '';
  $('#reminderFormStatus').classList.remove('error');
  $('#reminderBackdrop').classList.remove('hidden');
  $('#reminderModal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  setTimeout(() => $('#reminderTitle').focus(), 0);
}

function closeReminderModal() {
  $('#reminderBackdrop').classList.add('hidden');
  $('#reminderModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  editingReminderId = null;
}

async function saveReminderFromModal(event) {
  event.preventDefault();
  const title = $('#reminderTitle').value.trim();
  const date = $('#reminderDate').value;
  const time = $('#reminderTime').value;
  const reminderAt = reminderTimestamp({ date, time });
  if (!title) return;
  if (!reminderAt || reminderAt <= Date.now()) {
    $('#reminderFormStatus').textContent = 'Choose a reminder time in the future.';
    $('#reminderFormStatus').classList.add('error');
    return;
  }
  const existing = editingReminderId ? getReminder(editingReminderId) : null;
  const now = Date.now();
  const reminder = {
    ...(existing || {}),
    id: existing ? existing.id : createId('reminder'),
    title,
    notes: $('#reminderNotes').value.trim(),
    date,
    time,
    status: 'scheduled',
    notifiedAt: null,
    completedAt: null,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
  const reminders = existing
    ? state.reminders.map((entry) => entry.id === reminder.id ? reminder : entry)
    : [...state.reminders, reminder];
  selectedPlannerDate = date;
  selectedCalendarDate = date;
  await save({ reminders });
  closeReminderModal();
  showToast(existing ? 'Reminder updated.' : 'Reminder scheduled.');
}

async function deleteReminderFromModal() {
  const reminder = editingReminderId ? getReminder(editingReminderId) : null;
  if (!reminder || !confirm(`Delete the reminder "${reminder.title}"?`)) return;
  await save({ reminders: state.reminders.filter((entry) => entry.id !== reminder.id) });
  closeReminderModal();
  showToast('Reminder deleted.');
}

async function handleReminderAction(event) {
  const complete = event.target.closest('[data-complete-reminder]');
  if (!complete) return false;
  event.preventDefault();
  event.stopPropagation();
  if (complete.disabled) return true;
  complete.disabled = true;
  complete.setAttribute('aria-busy', 'true');
  try {
    await send('completeReminder', { id: complete.dataset.completeReminder });
    await loadState();
    showToast('Reminder completed.');
  } catch (error) {
    showToast(error.message);
    complete.disabled = false;
    complete.removeAttribute('aria-busy');
  }
  return true;
}

function getReminder(reminderId) {
  return (state.reminders || []).find((reminder) => reminder.id === reminderId) || null;
}

function reminderTimestamp(reminder) {
  if (!reminder || !/^\d{4}-\d{2}-\d{2}$/.test(reminder.date || '') || !validWorkTime(reminder.time)) return null;
  const date = new Date(`${reminder.date}T${reminder.time}:00`);
  return Number.isNaN(date.getTime()) || dateKeyFromDate(date) !== reminder.date ? null : date.getTime();
}

async function handleWorkBlockAction(event, dateKey) {
  const start = event.target.closest('[data-start-block]');
  const complete = event.target.closest('[data-complete-block]');
  if (!start && !complete) return false;
  event.preventDefault();
  event.stopPropagation();
  const button = start || complete;
  const blockId = start ? start.dataset.startBlock : complete.dataset.completeBlock;
  const block = getWorkBlock(dateKey, blockId);
  if (!block || button.disabled) return true;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    if (start) {
      const workspace = getWorkspace(block.workspaceId);
      const openTabs = Boolean(workspace.tabs && workspace.tabs.length
        && confirm(`Open ${workspace.name}'s ${workspace.tabs.length} saved tab${workspace.tabs.length === 1 ? '' : 's'} too?`));
      await send('startWorkBlock', { dateKey, id: block.id, openTabs });
      showToast(`${block.title} is now in focus.`);
    } else {
      await send('completeWorkBlock', { dateKey, id: block.id });
      showToast('Work block completed.');
    }
    await loadState();
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
  return true;
}

function renderDayRail() {
  selectedPlannerDate ||= todayKey();
  const blocks = [...(state.dailyPlans[selectedPlannerDate] || [])].sort((a, b) => a.time.localeCompare(b.time));
  const activeBlocks = blocks.filter((block) => block.status !== 'skipped');
  $('#plannedMinutes').textContent = `${activeBlocks.reduce((sum, block) => sum + Number(block.duration || 0), 0)} min`;
  $('#plannerDateHeading').textContent = formatDayHeading(selectedPlannerDate);
  renderDayTimeline($('#dayRail'), selectedPlannerDate, { interactive: true });
  renderPlannerTaskBank();
  renderDayReview(blocks);
}

function renderDayTimeline(container, dateKey, { interactive = false } = {}) {
  const startMinute = timeToMinutes(state.settings.calendarDayStart || '07:00');
  const requestedEnd = timeToMinutes(state.settings.calendarDayEnd || '21:00');
  const endMinute = requestedEnd > startMinute ? requestedEnd : startMinute + 14 * 60;
  const pixelsPerMinute = 1.2;
  const height = (endMinute - startMinute) * pixelsPerMinute;
  const blocks = (state.dailyPlans[dateKey] || []).filter((block) => block.status !== 'cancelled');
  const reminders = (state.reminders || []).filter((reminder) => reminder.date === dateKey);
  const blockIds = new Set(blocks.map((block) => block.id));
  const events = (state.calendarEvents || []).filter((event) => eventOccursOnDate(event, dateKey)
    && event.status !== 'cancelled'
    && !blockIds.has(event.focusDeskBlockId));
  const allDay = events.filter((event) => event.allDay);
  const timedEntries = [
    ...blocks.map((block) => ({
      kind: 'block',
      item: block,
      start: timeToMinutes(block.time),
      end: timeToMinutes(block.time) + Number(block.duration || 60)
    })),
    ...reminders.map((reminder) => ({
      kind: 'reminder',
      item: reminder,
      start: timeToMinutes(reminder.time),
      end: timeToMinutes(reminder.time) + 30
    })),
    ...events.filter((event) => !event.allDay).map((event) => {
      const start = new Date(event.start);
      const end = event.end ? new Date(event.end) : new Date(start.getTime() + 3600000);
      return {
        kind: 'event',
        item: event,
        start: eventMinuteOnDate(start, dateKey, 0),
        end: eventMinuteOnDate(end, dateKey, 1440)
      };
    })
  ].filter((entry) => entry.end > startMinute && entry.start < endMinute);
  const laidOut = layoutTimelineEntries(timedEntries);
  const hourMarks = [];
  for (let minute = Math.ceil(startMinute / 60) * 60; minute <= endMinute; minute += 60) {
    hourMarks.push(`<time style="top:${(minute - startMinute) * pixelsPerMinute}px">${escapeHtml(formatHourMinute(minute))}</time>`);
  }
  const slots = [];
  if (interactive) {
    for (let minute = startMinute; minute < endMinute; minute += 15) {
      slots.push(`<button class="timeline-slot" style="top:${(minute - startMinute) * pixelsPerMinute}px;height:${15 * pixelsPerMinute}px" data-timeline-minute="${minute}" type="button" aria-label="Add work block at ${escapeHtml(minutesToTime(minute))}"></button>`);
    }
  }
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const showNow = dateKey === todayKey() && nowMinute >= startMinute && nowMinute <= endMinute;

  container.innerHTML = `
    ${allDay.length ? `<div class="all-day-lane"><span>All day</span><div>${allDay.map((event) => `
      <a href="${escapeHtml(event.htmlLink || '#')}" ${event.htmlLink ? 'target="_blank" rel="noreferrer"' : ''} style="border-color:${safeCalendarColor(event.calendarColor)}">${escapeHtml(event.title)}</a>
    `).join('')}</div></div>` : ''}
    <div class="timeline-scroll">
      <div class="timeline-hours" style="height:${height}px">${hourMarks.join('')}</div>
      <div class="timeline-canvas" style="height:${height}px;--hour-height:${60 * pixelsPerMinute}px">
        ${slots.join('')}
        ${laidOut.map((entry) => renderTimelineEntry(entry, startMinute, endMinute, pixelsPerMinute, interactive)).join('')}
        ${showNow ? `<div class="timeline-now" style="top:${(nowMinute - startMinute) * pixelsPerMinute}px"><span></span></div>` : ''}
      </div>
    </div>`;
}

function renderTimelineEntry(entry, startMinute, endMinute, pixelsPerMinute, interactive) {
  const top = (Math.max(entry.start, startMinute) - startMinute) * pixelsPerMinute;
  const entryHeight = (Math.min(entry.end, endMinute) - Math.max(entry.start, startMinute)) * pixelsPerMinute;
  const height = Math.max(entry.kind === 'reminder' ? 36 : 22, entryHeight);
  const left = `calc(${entry.column / entry.columns * 100}% + 4px)`;
  const width = `calc(${100 / entry.columns}% - 7px)`;
  if (entry.kind === 'reminder') {
    const reminder = entry.item;
    const status = reminder.status || 'scheduled';
    return `<article class="timeline-entry reminder-entry status-${escapeHtml(status)}" data-reminder="${escapeHtml(reminder.id)}"
      style="top:${top}px;height:${height}px;left:${left};width:${width}">
      <div class="timeline-entry-copy">
        <strong>${escapeHtml(reminder.title)}</strong>
        <span>${escapeHtml(reminder.time)} · Reminder</span>
      </div>
      ${interactive && status === 'scheduled' ? `<div class="timeline-entry-actions">
        <button data-complete-reminder="${escapeHtml(reminder.id)}" type="button">Done</button>
      </div>` : ''}
    </article>`;
  }
  if (entry.kind === 'event') {
    const event = entry.item;
    return `<article class="timeline-entry calendar-entry" data-calendar-event="${escapeHtml(`${event.calendarId}:${event.id}`)}"
      style="top:${top}px;height:${height}px;left:${left};width:${width};--event-color:${safeCalendarColor(event.calendarColor)}">
      <strong>${escapeHtml(event.title)}</strong>
      <span>${escapeHtml(formatEventTime(event.start, event.end))}${event.calendarName ? ` · ${escapeHtml(event.calendarName)}` : ''}</span>
    </article>`;
  }
  const block = entry.item;
  const workspace = getWorkspace(block.workspaceId);
  const project = getProject(block.projectId);
  const status = block.status || 'planned';
  const syncState = block.calendar && block.calendar.syncState;
  const reminderLabel = block.calendar && block.calendar.reminderEnabled
    ? `${Number(block.calendar.reminderMinutes) || 10} min reminder`
    : '';
  return `<article class="timeline-entry work-block-entry status-${escapeHtml(status)}" draggable="${interactive}" data-work-block="${escapeHtml(block.id)}"
    style="top:${top}px;height:${height}px;left:${left};width:${width}">
    <div class="timeline-entry-copy">
      <strong>${escapeHtml(block.title)}</strong>
      <span>${escapeHtml(block.time)} · ${Number(block.duration)} min · ${escapeHtml(project ? project.name : workspace.name)}</span>
      ${reminderLabel || syncState && syncState !== 'local'
        ? `<small class="sync-${escapeHtml(syncState || 'local')}">${escapeHtml([
            reminderLabel,
            syncState && syncState !== 'local' ? calendarSyncLabel(syncState) : ''
          ].filter(Boolean).join(' · '))}</small>`
        : ''}
    </div>
    ${interactive && height >= 48 ? `<div class="timeline-entry-actions">
      ${status === 'planned' ? `<button data-start-block="${escapeHtml(block.id)}" type="button">Start</button>` : ''}
      ${!['completed', 'skipped', 'cancelled'].includes(status) ? `<button data-complete-block="${escapeHtml(block.id)}" type="button">Done</button>` : ''}
    </div>` : ''}
  </article>`;
}

function layoutTimelineEntries(entries) {
  const sorted = [...entries].sort((a, b) => a.start - b.start || b.end - a.end);
  const columnEnds = [];
  let maxColumns = 1;
  for (const entry of sorted) {
    let column = columnEnds.findIndex((end) => end <= entry.start);
    if (column < 0) column = columnEnds.length;
    columnEnds[column] = entry.end;
    entry.column = column;
    maxColumns = Math.max(maxColumns, columnEnds.filter((end) => end > entry.start).length);
  }
  return sorted.map((entry) => ({ ...entry, columns: Math.max(maxColumns, entry.column + 1) }));
}

function eventOccursOnDate(event, dateKey) {
  if (!event.start) return false;
  if (event.allDay) {
    const end = event.end || event.start;
    return event.start <= dateKey && dateKey < end;
  }
  const dayStart = new Date(`${dateKey}T00:00:00`);
  const dayEnd = addDays(dayStart, 1);
  const start = new Date(event.start);
  const end = event.end ? new Date(event.end) : new Date(start.getTime() + 3600000);
  return start < dayEnd && end > dayStart;
}

function eventMinuteOnDate(date, dateKey, boundary) {
  return dateKeyFromDate(date) === dateKey ? date.getHours() * 60 + date.getMinutes() : boundary;
}

function safeCalendarColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#4285f4';
}

function calendarSyncLabel(stateValue) {
  return ({
    pending: 'Syncing',
    synced: 'Google Calendar',
    conflict: 'Calendar conflict',
    error: 'Sync failed'
  })[stateValue] || '';
}

function formatDayHeading(dateKey) {
  const date = new Date(`${dateKey}T12:00:00`);
  const prefix = dateKey === todayKey() ? 'Today · ' : '';
  return `${prefix}${date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}`;
}

function formatHourMinute(minutes) {
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function stepPlannerDate(amount) {
  selectedPlannerDate = dateKeyFromDate(addDays(new Date(`${selectedPlannerDate}T12:00:00`), amount));
  renderDayRail();
}

function renderPlannerTaskBank() {
  const scheduledTaskIds = new Set((state.dailyPlans[selectedPlannerDate] || [])
    .filter((block) => block.status !== 'skipped')
    .map((block) => block.taskId)
    .filter(Boolean));
  const tasks = state.tasks
    .filter((task) => !task.completed && task.status !== 'waiting' && !scheduledTaskIds.has(task.id))
    .sort((a, b) => planningTaskScore(b) - planningTaskScore(a));
  $('#plannerTaskCount').textContent = tasks.length;
  $('#plannerTaskBank').innerHTML = tasks.length ? tasks.slice(0, 8).map((task) => {
    const project = getProject(task.projectId);
    return `
      <article class="planner-task priority-${escapeHtml(task.priority || 'medium')}" draggable="true" data-planner-task="${escapeHtml(task.id)}">
        <div>
          <strong>${escapeHtml(task.title)}</strong>
          <span>${escapeHtml(project ? project.name : getWorkspace(task.workspaceId).name)} · ${taskEstimate(task)} min</span>
        </div>
        <button data-schedule-task="${escapeHtml(task.id)}" type="button">Schedule</button>
      </article>`;
  }).join('') : emptyState('Every ready task is scheduled.');
}

function renderDayReview(blocks) {
  $('#dayReview').classList.toggle('hidden', !dayReviewOpen);
  $('#toggleDayReview').classList.toggle('active', dayReviewOpen);
  if (!dayReviewOpen) return;
  const unresolved = blocks.filter((block) => !['completed', 'skipped', 'cancelled'].includes(block.status));
  $('#dayReviewList').innerHTML = unresolved.length ? unresolved.map((block) => `
    <article class="review-row">
      <time>${escapeHtml(block.time)}</time>
      <div><strong>${escapeHtml(block.title)}</strong><span>${Number(block.duration)} min · ${escapeHtml(block.status || 'planned')}</span></div>
      <div class="button-row">
        <button class="button secondary small" data-review-rollover="${escapeHtml(block.id)}" type="button">Tomorrow</button>
        <button class="button primary small" data-review-complete="${escapeHtml(block.id)}" type="button">Complete</button>
      </div>
    </article>
  `).join('') : emptyState('The day is closed. Every work block has a decision.');
}

async function scheduleTaskBlock(taskId, preferredTime = null, source = 'task') {
  const task = state.tasks.find((entry) => entry.id === taskId && !entry.completed);
  if (!task) return;
  const duration = taskEstimate(task);
  const blocks = [...(state.dailyPlans[selectedPlannerDate] || [])];
  const time = preferredTime || findAvailableWorkTime(selectedPlannerDate, duration, blocks);
  if (!time) {
    showToast('No open workday slot fits this task.');
    return;
  }
  const now = Date.now();
  const block = {
    id: createId('block'),
    time,
    title: task.title,
    duration,
    workspaceId: task.workspaceId || state.activeWorkspaceId,
    projectId: task.projectId || null,
    taskId: task.id,
    status: 'planned',
    source,
    autoStart: state.settings.autoStartBlocks !== false,
    calendar: defaultWorkBlockCalendar(),
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  };
  const dailyPlans = { ...state.dailyPlans, [selectedPlannerDate]: [...blocks, block] };
  const tasks = state.tasks.map((entry) => entry.id === task.id ? {
    ...entry,
    status: 'planned',
    plannedDate: selectedPlannerDate,
    updatedAt: now
  } : entry);
  await save({ dailyPlans, tasks });
  showToast(`${task.title} scheduled at ${time}.`);
}

async function autoPlanDay() {
  const button = $('#autoPlanDay');
  button.disabled = true;
  try {
    const scheduledTaskIds = new Set((state.dailyPlans[selectedPlannerDate] || []).map((block) => block.taskId).filter(Boolean));
    const candidates = state.tasks
      .filter((task) => !task.completed && task.status !== 'waiting' && !scheduledTaskIds.has(task.id))
      .sort((a, b) => planningTaskScore(b) - planningTaskScore(a))
      .slice(0, 8);
    const blocks = [...(state.dailyPlans[selectedPlannerDate] || [])];
    const scheduledIds = [];
    const now = Date.now();

    for (const task of candidates) {
      const duration = taskEstimate(task);
      const time = findAvailableWorkTime(selectedPlannerDate, duration, blocks);
      if (!time) continue;
      blocks.push({
        id: createId('block'),
        time,
        title: task.title,
        duration,
        workspaceId: task.workspaceId || state.activeWorkspaceId,
        projectId: task.projectId || null,
        taskId: task.id,
        status: 'planned',
        source: 'auto',
        autoStart: state.settings.autoStartBlocks !== false,
        calendar: defaultWorkBlockCalendar(),
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now
      });
      scheduledIds.push(task.id);
    }

    if (!scheduledIds.length) {
      showToast(candidates.length ? 'The remaining tasks do not fit the open workday.' : 'No unscheduled ready tasks were found.');
      return;
    }
    const tasks = state.tasks.map((task) => scheduledIds.includes(task.id) ? {
      ...task,
      status: 'planned',
      plannedDate: selectedPlannerDate,
      updatedAt: now
    } : task);
    await save({ dailyPlans: { ...state.dailyPlans, [selectedPlannerDate]: blocks }, tasks });
    showToast(`Planned ${scheduledIds.length} task${scheduledIds.length === 1 ? '' : 's'} around your calendar.`);
  } finally {
    button.disabled = false;
  }
}

function findAvailableWorkTime(dateKey, duration, blocks) {
  const start = timeToMinutes(state.settings.workdayStart || '09:00');
  const end = timeToMinutes(state.settings.workdayEnd || '18:00');
  const busy = [
    ...blocks.filter((block) => block.status !== 'skipped').map((block) => ({
      start: timeToMinutes(block.time),
      end: timeToMinutes(block.time) + Number(block.duration || 0)
    })),
    ...calendarIntervalsForDate(dateKey)
  ];
  for (let minute = start; minute + duration <= end; minute += 15) {
    if (!busy.some((interval) => intervalsOverlap(minute, minute + duration, interval.start, interval.end))) {
      return minutesToTime(minute);
    }
  }
  return null;
}

function workdayDropTime(event, duration) {
  const minute = timeToMinutes(timelineDropTime(event));
  const start = timeToMinutes(state.settings.calendarDayStart || '07:00');
  const end = timeToMinutes(state.settings.calendarDayEnd || '21:00');
  return minutesToTime(Math.min(end - duration, Math.max(start, minute)));
}

function timelineDropTime(event) {
  const canvas = event.currentTarget.querySelector('.timeline-canvas');
  if (!canvas) return nextRoundedTime();
  const bounds = canvas.getBoundingClientRect();
  const start = timeToMinutes(state.settings.calendarDayStart || '07:00');
  const end = timeToMinutes(state.settings.calendarDayEnd || '21:00');
  const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / Math.max(1, bounds.height)));
  return minutesToTime(Math.round((start + ratio * (end - start)) / 15) * 15);
}

function workBlockConflicts(block, blocks, dateKey = selectedPlannerDate) {
  if (block.status === 'skipped') return [];
  const start = timeToMinutes(block.time);
  const end = start + Number(block.duration || 0);
  const calendarConflicts = calendarIntervalsForDate(dateKey)
    .filter((interval) => intervalsOverlap(start, end, interval.start, interval.end))
    .map((interval) => interval.title);
  const blockConflict = blocks.some((other) => other.id !== block.id
    && other.status !== 'skipped'
    && intervalsOverlap(start, end, timeToMinutes(other.time), timeToMinutes(other.time) + Number(other.duration || 0)));
  return [...calendarConflicts, ...(blockConflict ? ['Overlaps another block'] : [])];
}

function calendarIntervalsForDate(dateKey) {
  return (state.calendarEvents || []).flatMap((event) => {
    if (!event.start || String(event.start).length === 10) return [];
    const start = new Date(event.start);
    const end = event.end ? new Date(event.end) : new Date(start.getTime() + 60 * 60000);
    const dayStart = new Date(`${dateKey}T00:00:00`);
    const dayEnd = new Date(`${dateKey}T23:59:59`);
    if (end <= dayStart || start >= dayEnd) return [];
    return [{
      start: start <= dayStart ? 0 : start.getHours() * 60 + start.getMinutes(),
      end: end >= dayEnd ? 1440 : end.getHours() * 60 + end.getMinutes(),
      title: event.title || 'Calendar event'
    }];
  });
}

function planningTaskScore(task) {
  const priorityScore = { high: 300, medium: 200, low: 100 }[task.priority] || 200;
  const plannedScore = task.plannedDate === todayKey() ? 180 : 0;
  const dueTime = task.dueDate ? new Date(`${task.dueDate}T12:00:00`).getTime() : null;
  const daysUntilDue = dueTime ? Math.ceil((dueTime - Date.now()) / 86400000) : null;
  const dueScore = daysUntilDue === null ? 0 : daysUntilDue <= 0 ? 220 : Math.max(0, 150 - daysUntilDue * 15);
  const progressScore = task.status === 'in-progress' ? 80 : 0;
  return priorityScore + plannedScore + dueScore + progressScore;
}

function taskEstimate(task) {
  const estimate = Number(task && task.estimateMinutes);
  return estimate > 0
    ? clamp(estimate, 5, 240, 45)
    : clamp(state.settings.defaultTaskEstimateMinutes, 5, 240, 45);
}

function defaultWorkBlockCalendar() {
  return {
    calendarId: null,
    eventId: null,
    etag: null,
    htmlLink: null,
    reminderEnabled: state.settings.calendarReminderEnabled !== false,
    reminderMinutes: clamp(state.settings.calendarReminderMinutes, 0, 120, 10),
    syncState: 'local',
    lastSyncedAt: null,
    lastError: ''
  };
}

function validWorkTime(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function minutesToTime(value) {
  const minutes = Math.max(0, Math.min(1439, Math.round(Number(value) || 0)));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function getWorkBlock(dateKey, id) {
  return (state.dailyPlans[dateKey] || []).find((block) => block.id === id);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function dateKeyFromDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function openWorkBlockModal({ dateKey, time, blockId = null }) {
  editingWorkBlockDate = dateKey || todayKey();
  editingWorkBlockId = blockId;
  const block = blockId ? getWorkBlock(editingWorkBlockDate, blockId) : null;
  const start = block ? block.time : validWorkTime(time) ? time : nextRoundedTime();
  const duration = block ? Number(block.duration || 60) : 60;
  $('#workBlockModalHeading').textContent = block ? 'Edit work block' : 'New work block';
  $('#workBlockTitle').value = block ? block.title : '';
  $('#workBlockDate').value = editingWorkBlockDate;
  $('#workBlockStart').value = start;
  $('#workBlockEnd').value = minutesToTime(timeToMinutes(start) + duration);
  $('#workBlockDescription').value = block ? block.description || '' : '';
  $('#workBlockWorkspace').innerHTML = state.workspaces.map((workspace) => (
    `<option value="${escapeHtml(workspace.id)}">${escapeHtml(workspace.name)}</option>`
  )).join('');
  $('#workBlockWorkspace').value = block ? block.workspaceId : state.activeWorkspaceId;
  renderWorkBlockContextOptions(block && block.projectId, block && block.taskId);
  renderWorkBlockCalendarOptions(block);
  $('#workBlockAutoStart').checked = block ? block.autoStart !== false : state.settings.autoStartBlocks !== false;
  const reminderEnabled = block
    ? Boolean(block.calendar && block.calendar.reminderEnabled)
    : state.settings.calendarReminderEnabled !== false;
  const reminderMinutes = block && block.calendar
    ? block.calendar.reminderMinutes
    : state.settings.calendarReminderMinutes;
  setWorkBlockReminderValue(reminderEnabled ? reminderMinutes : 'none');
  $('#deleteWorkBlock').classList.toggle('hidden', !block);
  $('#workBlockFormStatus').textContent = '';
  $('#workBlockBackdrop').classList.remove('hidden');
  $('#workBlockModal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  setTimeout(() => $('#workBlockTitle').focus(), 0);
}

function closeWorkBlockModal() {
  $('#workBlockBackdrop').classList.add('hidden');
  $('#workBlockModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  editingWorkBlockId = null;
  editingWorkBlockDate = null;
}

function renderWorkBlockContextOptions(projectId = $('#workBlockProject').value, taskId = $('#workBlockTask').value) {
  const workspaceId = $('#workBlockWorkspace').value || state.activeWorkspaceId;
  const projects = state.projects.filter((project) => project.workspaceId === workspaceId && !project.archived);
  $('#workBlockProject').innerHTML = `<option value="">No project</option>${projects.map((project) => (
    `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>`
  )).join('')}`;
  $('#workBlockProject').value = projects.some((project) => project.id === projectId) ? projectId : '';
  const tasks = state.tasks.filter((task) => !task.completed
    && task.workspaceId === workspaceId
    && (!$('#workBlockProject').value || task.projectId === $('#workBlockProject').value));
  $('#workBlockTask').innerHTML = `<option value="">No task</option>${tasks.map((task) => (
    `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}</option>`
  )).join('')}`;
  $('#workBlockTask').value = tasks.some((task) => task.id === taskId) ? taskId : '';
  $('#workBlockProject').onchange = () => renderWorkBlockContextOptions($('#workBlockProject').value, null);
}

function renderWorkBlockCalendarOptions(block = null) {
  const writable = (state.calendarList || []).filter((calendar) => calendar.writable);
  const selectedId = block && block.calendar && block.calendar.calendarId
    || state.settings.calendarDefaultId
    || 'primary';
  $('#workBlockCalendar').innerHTML = `<option value="">Do not sync</option>${writable.map((calendar) => (
    `<option value="${escapeHtml(calendar.id)}">${escapeHtml(calendar.name)}${calendar.primary ? ' (primary)' : ''}</option>`
  )).join('')}`;
  $('#workBlockCalendar').value = writable.some((calendar) => calendar.id === selectedId) ? selectedId : '';
  const canSync = Boolean(state.calendarConnected && writable.length);
  const linked = Boolean(block && block.calendar && block.calendar.eventId);
  $('#workBlockSync').checked = linked || canSync && state.settings.calendarAutoSyncBlocks !== false;
  $('#workBlockSync').disabled = !canSync;
  $('#workBlockCalendar').disabled = !canSync || linked;
}

function setWorkBlockReminderValue(value) {
  const select = $('#workBlockReminder');
  const normalized = value === 'none' ? 'none' : String(clamp(value, 0, 120, 10));
  if (normalized !== 'none' && !Array.from(select.options).some((option) => option.value === normalized)) {
    const option = document.createElement('option');
    option.value = normalized;
    option.textContent = `${normalized} minutes before`;
    select.append(option);
  }
  select.value = normalized;
}

function updateWorkBlockEndFromStart() {
  const start = timeToMinutes($('#workBlockStart').value);
  const currentEnd = timeToMinutes($('#workBlockEnd').value);
  if (currentEnd <= start) $('#workBlockEnd').value = minutesToTime(start + 60);
}

async function saveWorkBlockFromModal(event) {
  event.preventDefault();
  const title = $('#workBlockTitle').value.trim();
  const dateKey = $('#workBlockDate').value;
  const start = $('#workBlockStart').value;
  const startMinute = timeToMinutes(start);
  const endMinute = timeToMinutes($('#workBlockEnd').value);
  if (!title || !dateKey || !validWorkTime(start) || endMinute <= startMinute) {
    $('#workBlockFormStatus').textContent = 'Choose a title and an end time after the start.';
    $('#workBlockFormStatus').classList.add('error');
    return;
  }
  const existing = editingWorkBlockId && getWorkBlock(editingWorkBlockDate, editingWorkBlockId);
  const now = Date.now();
  const syncRequested = $('#workBlockSync').checked && !$('#workBlockSync').disabled;
  const calendarId = existing && existing.calendar && existing.calendar.eventId
    ? existing.calendar.calendarId
    : $('#workBlockCalendar').value || null;
  const block = {
    ...(existing || {}),
    id: existing ? existing.id : createId('block'),
    time: start,
    title,
    description: $('#workBlockDescription').value.trim(),
    duration: endMinute - startMinute,
    workspaceId: $('#workBlockWorkspace').value,
    projectId: $('#workBlockProject').value || null,
    taskId: $('#workBlockTask').value || null,
    status: existing ? existing.status : 'planned',
    source: existing ? existing.source : 'manual',
    autoStart: $('#workBlockAutoStart').checked,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    calendar: {
      ...(existing && existing.calendar || {}),
      calendarId,
      reminderEnabled: $('#workBlockReminder').value !== 'none',
      reminderMinutes: $('#workBlockReminder').value === 'none'
        ? clamp(state.settings.calendarReminderMinutes, 0, 120, 10)
        : clamp($('#workBlockReminder').value, 0, 120, 10),
      syncState: syncRequested ? 'pending' : 'local',
      lastError: ''
    },
    startedAt: existing ? existing.startedAt : null,
    completedAt: existing ? existing.completedAt : null,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
  const dailyPlans = { ...state.dailyPlans };
  if (existing) {
    dailyPlans[editingWorkBlockDate] = (dailyPlans[editingWorkBlockDate] || [])
      .filter((entry) => entry.id !== existing.id);
  }
  dailyPlans[dateKey] = [...(dailyPlans[dateKey] || []), block];
  const tasks = state.tasks.map((task) => task.id === block.taskId ? {
    ...task,
    status: task.status === 'done' ? 'done' : 'planned',
    plannedDate: dateKey,
    updatedAt: now
  } : task);
  $('#workBlockFormStatus').classList.remove('error');
  $('#workBlockFormStatus').textContent = syncRequested ? 'Saving and syncing…' : 'Saving…';
  try {
    await chrome.storage.local.set({ dailyPlans, tasks });
    Object.assign(state, { dailyPlans, tasks });
    if (syncRequested) {
      await send(existing && existing.calendar && existing.calendar.eventId
        ? 'updateCalendarEvent'
        : 'createCalendarEvent', {
        dateKey,
        id: block.id,
        calendarId,
        interactive: true
      });
    } else if (existing && existing.calendar && existing.calendar.eventId) {
      await send('deleteCalendarEvent', { dateKey, id: block.id, interactive: true });
    }
    selectedPlannerDate = dateKey;
    selectedCalendarDate = dateKey;
    closeWorkBlockModal();
    await loadState();
    showToast(syncRequested ? 'Work block saved to Focus Desk and Google Calendar.' : 'Work block saved.');
  } catch (error) {
    await loadState();
    $('#workBlockFormStatus').textContent = error.message;
    $('#workBlockFormStatus').classList.add('error');
  }
}

async function deleteWorkBlockFromModal() {
  const block = editingWorkBlockId && getWorkBlock(editingWorkBlockDate, editingWorkBlockId);
  if (!block || !confirm(`Delete "${block.title}"?`)) return;
  try {
    if (block.calendar && block.calendar.eventId) {
      await send('deleteCalendarEvent', {
        dateKey: editingWorkBlockDate,
        id: block.id,
        interactive: true
      });
      await loadState();
    }
    if (block.status === 'active') await send('stopFocus');
    const dailyPlans = { ...state.dailyPlans };
    dailyPlans[editingWorkBlockDate] = (dailyPlans[editingWorkBlockDate] || [])
      .filter((entry) => entry.id !== block.id);
    await chrome.storage.local.set({ dailyPlans });
    closeWorkBlockModal();
    await loadState();
    showToast('Work block deleted.');
  } catch (error) {
    $('#workBlockFormStatus').textContent = error.message;
    $('#workBlockFormStatus').classList.add('error');
  }
}

async function moveWorkBlockToTime(blockId, time) {
  const block = getWorkBlock(selectedPlannerDate, blockId);
  if (!block || !validWorkTime(time)) return;
  const dailyPlans = {
    ...state.dailyPlans,
    [selectedPlannerDate]: (state.dailyPlans[selectedPlannerDate] || []).map((entry) => (
      entry.id === blockId
        ? {
            ...entry,
            time,
            calendar: {
              ...entry.calendar,
              syncState: entry.calendar && entry.calendar.eventId ? 'pending' : 'local'
            },
            updatedAt: Date.now()
          }
        : entry
    ))
  };
  await chrome.storage.local.set({ dailyPlans });
  Object.assign(state, { dailyPlans });
  renderDayRail();
  if (block.calendar && block.calendar.eventId) {
    try {
      await send('updateCalendarEvent', {
        dateKey: selectedPlannerDate,
        id: blockId,
        interactive: true
      });
      await loadState();
    } catch (error) {
      await loadState();
      showToast(`Moved locally. Calendar sync failed: ${error.message}`);
      return;
    }
  }
  showToast(`Moved to ${time}.`);
}

function bindInbox() {
  $('#inboxForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = $('#inboxCaptureTitle').value.trim();
    if (!title) return;
    try {
      await send('captureInboxItem', {
        item: {
          type: $('#inboxCaptureType').value,
          title,
          body: $('#inboxCaptureBody').value,
          url: $('#inboxCaptureUrl').value,
          workspaceId: $('#inboxCaptureWorkspace').value,
          projectId: $('#inboxCaptureProject').value || null
        }
      });
      $('#inboxCaptureTitle').value = '';
      $('#inboxCaptureBody').value = '';
      $('#inboxCaptureUrl').value = '';
      inboxStatusFilter = 'open';
      await loadState();
      showToast('Capture added to Inbox.');
    } catch (error) {
      showToast(error.message);
    }
  });

  $('#inboxCaptureWorkspace').addEventListener('change', renderInboxCaptureProjects);
  $('#inboxTypeFilter').addEventListener('change', (event) => {
    inboxTypeFilter = event.target.value;
    renderInbox();
  });
  $$('.inbox-filter-group [data-inbox-status]').forEach((button) => {
    button.addEventListener('click', () => {
      inboxStatusFilter = button.dataset.inboxStatus;
      renderInbox();
    });
  });

  $('#inboxList').addEventListener('toggle', (event) => {
    const row = event.target.closest('[data-inbox-item]');
    if (!row) return;
    if (row.open) openInboxItems.add(row.dataset.inboxItem);
    else openInboxItems.delete(row.dataset.inboxItem);
  }, true);

  $('#inboxList').addEventListener('change', (event) => {
    if (!event.target.matches('[data-inbox-workspace]')) return;
    const row = event.target.closest('[data-inbox-item]');
    const projectSelect = $('[data-inbox-project]', row);
    projectSelect.innerHTML = inboxProjectOptions(event.target.value);
  });

  $('#inboxList').addEventListener('click', async (event) => {
    const button = event.target.closest('button');
    const row = event.target.closest('[data-inbox-item]');
    if (!button || !row) return;
    const id = row.dataset.inboxItem;
    try {
      if (button.matches('[data-update-inbox]')) {
        await send('updateInboxItem', { item: inboxEditorPayload(row, id) });
        showToast('Inbox capture updated.');
      }
      if (button.matches('[data-process-inbox]')) {
        await send('updateInboxItem', { item: inboxEditorPayload(row, id) });
        await send('processInboxItem', {
          id,
          targetType: $('[data-inbox-target]', row).value,
          workspaceId: $('[data-inbox-workspace]', row).value,
          projectId: $('[data-inbox-project]', row).value || null
        });
        openInboxItems.delete(id);
        showToast('Capture moved into your work.');
      }
      if (button.matches('[data-restore-inbox]')) {
        await send('restoreInboxItem', { id });
        inboxStatusFilter = 'open';
        showToast('Capture restored to the open Inbox.');
      }
      if (button.matches('[data-delete-inbox]')) {
        if (!confirm('Delete this Inbox capture?')) return;
        await send('deleteInboxItem', { id });
        openInboxItems.delete(id);
        showToast('Capture deleted.');
      }
      await loadState();
    } catch (error) {
      showToast(error.message);
    }
  });
}

function renderInbox() {
  if (!state) return;
  const items = state.inboxItems
    .filter((item) => inboxStatusFilter === 'all' || item.status === inboxStatusFilter)
    .filter((item) => inboxTypeFilter === 'all' || item.type === inboxTypeFilter)
    .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
  $$('.inbox-filter-group [data-inbox-status]').forEach((button) => {
    button.classList.toggle('active', button.dataset.inboxStatus === inboxStatusFilter);
  });
  $('#inboxTypeFilter').value = inboxTypeFilter;
  renderInboxCaptureProjects();
  $('#inboxList').innerHTML = items.length
    ? items.map(renderInboxItem).join('')
    : emptyState(inboxStatusFilter === 'processed'
      ? 'Processed captures will remain here as a lightweight history.'
      : 'Nothing waiting. Capture a thought here or from the side panel.');
}

function renderInboxItem(item, index) {
  const sourceUrl = normalizeHttpUrl(item.url || item.sourceUrl);
  const sourceLabel = item.sourceTitle || (sourceUrl ? hostnameFromUrl(sourceUrl) : '');
  const workspace = getWorkspace(item.workspaceId);
  const project = state.projects.find((entry) => entry.id === item.projectId);
  const itemType = ['idea', 'task', 'note', 'link'].includes(item.type) ? item.type : 'idea';
  const defaultTarget = itemType === 'idea' ? 'note' : itemType;
  const isProcessed = item.status === 'processed';
  const isOpen = openInboxItems.has(item.id);
  const destination = [workspace && workspace.name, project && project.name].filter(Boolean).join(' / ');

  return `
    <details class="inbox-row ${isProcessed ? 'processed' : ''}" data-inbox-item="${escapeHtml(item.id)}" ${isOpen ? 'open' : ''}>
      <summary>
        <span class="inbox-row-number">${String(index + 1).padStart(2, '0')}</span>
        <span class="inbox-type">${escapeHtml(itemType)}</span>
        <span class="inbox-row-title">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(isProcessed ? `${item.processedAs || itemType} / ${destination || 'Unassigned'}` : sourceLabel || destination || 'Unassigned')}</small>
        </span>
        <time>${formatInboxTime(item.updatedAt)}</time>
        <span class="inbox-row-state">${isProcessed ? 'Processed' : 'Open'}</span>
      </summary>
      ${isProcessed ? `
        <div class="inbox-history">
          <div>
            <span class="eyebrow">Capture record</span>
            <p>${escapeHtml(item.body || 'No additional context.')}</p>
            ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(hostnameFromUrl(sourceUrl))}</a>` : ''}
          </div>
          <div class="button-row">
            <button class="button secondary" data-restore-inbox type="button">Restore</button>
            <button class="button danger" data-delete-inbox type="button">Delete</button>
          </div>
        </div>` : `
        <div class="inbox-editor">
          <div class="inbox-editor-copy">
            <label>Type
              <select data-inbox-type>
                ${['idea', 'task', 'note', 'link'].map((type) => `<option value="${type}" ${type === itemType ? 'selected' : ''}>${type[0].toUpperCase()}${type.slice(1)}</option>`).join('')}
              </select>
            </label>
            <label>Title<input data-inbox-title type="text" maxlength="500" value="${escapeHtml(item.title)}"></label>
            <label>Context<textarea data-inbox-body rows="5" maxlength="12000">${escapeHtml(item.body || '')}</textarea></label>
            <label>URL<input data-inbox-url type="url" maxlength="2048" value="${escapeHtml(sourceUrl || '')}" placeholder="https://"></label>
            <button class="text-button inbox-save" data-update-inbox type="button">Save changes</button>
          </div>
          <div class="inbox-routing">
            <span class="eyebrow">Process into</span>
            <label>Result
              <select data-inbox-target>
                <option value="task" ${defaultTarget === 'task' ? 'selected' : ''}>Task</option>
                <option value="note" ${defaultTarget === 'note' ? 'selected' : ''}>Markdown note</option>
                <option value="link" ${defaultTarget === 'link' ? 'selected' : ''}>Project link</option>
              </select>
            </label>
            <label>Workspace
              <select data-inbox-workspace>${inboxWorkspaceOptions(item.workspaceId)}</select>
            </label>
            <label>Project
              <select data-inbox-project>${inboxProjectOptions(item.workspaceId, item.projectId)}</select>
            </label>
            <button class="button primary" data-process-inbox type="button">Process capture</button>
          </div>
        </div>`}
    </details>`;
}

function inboxEditorPayload(row, id) {
  return {
    id,
    type: $('[data-inbox-type]', row).value,
    title: $('[data-inbox-title]', row).value,
    body: $('[data-inbox-body]', row).value,
    url: $('[data-inbox-url]', row).value
  };
}

function inboxWorkspaceOptions(selectedId) {
  return state.workspaces.map((workspace) => `
    <option value="${escapeHtml(workspace.id)}" ${workspace.id === selectedId ? 'selected' : ''}>${escapeHtml(workspace.name)}</option>
  `).join('');
}

function inboxProjectOptions(workspaceId, selectedId = null) {
  const projects = state.projects.filter((project) => project.workspaceId === workspaceId && !project.archived);
  return `<option value="">Unassigned</option>${projects.map((project) => `
    <option value="${escapeHtml(project.id)}" ${project.id === selectedId ? 'selected' : ''}>${escapeHtml(project.name)}</option>
  `).join('')}`;
}

function renderInboxCaptureProjects() {
  const workspaceSelect = $('#inboxCaptureWorkspace');
  if (!workspaceSelect || !state) return;
  const selectedWorkspace = workspaceSelect.value || state.activeWorkspaceId;
  if (!workspaceSelect.options.length) {
    workspaceSelect.innerHTML = inboxWorkspaceOptions(selectedWorkspace);
    workspaceSelect.value = selectedWorkspace;
  }
  const projectSelect = $('#inboxCaptureProject');
  const previousProject = projectSelect.value;
  projectSelect.innerHTML = inboxProjectOptions(workspaceSelect.value || selectedWorkspace, previousProject);
}

function formatInboxTime(value) {
  const date = new Date(Number(value) || Date.now());
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function bindProjects() {
  $('#projectForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#projectName').value.trim();
    if (!name) return;
    const now = Date.now();
    const project = {
      id: createId('project'),
      workspaceId: $('#projectWorkspace').value,
      name,
      description: '',
      outcome: '',
      color: projectColorForPriority($('#projectPriority').value),
      status: 'active',
      priority: $('#projectPriority').value,
      dueDate: $('#projectDueDate').value || null,
      links: [],
      archived: false,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    };
    $('#projectName').value = '';
    $('#projectDueDate').value = '';
    selectedProjectId = project.id;
    await save({ projects: [project, ...state.projects] });
  });

  $('#projectWorkspaceFilter').addEventListener('change', renderProjects);
  $('#projectsView').addEventListener('error', (event) => {
    const image = event.target.closest('img[data-project-favicon]');
    if (!image) return;
    image.classList.add('hidden');
    image.nextElementSibling?.classList.add('visible');
  }, true);
  $('#projectsView').addEventListener('click', async (event) => {
    const modeButton = event.target.closest('[data-project-index-mode]');
    if (modeButton) {
      projectIndexMode = modeButton.dataset.projectIndexMode;
      renderProjects();
      return;
    }

    const openProject = event.target.closest('[data-open-project]');
    if (openProject) {
      selectedProjectId = openProject.dataset.openProject;
      projectViewMode = 'overview';
      projectGroupFilter = 'all';
      renderProjects();
      return;
    }

    const viewButton = event.target.closest('[data-project-view-mode]');
    if (viewButton) {
      projectViewMode = viewButton.dataset.projectViewMode;
      renderProjects();
      return;
    }

    const taskButton = event.target.closest('[data-edit-project-task]');
    if (taskButton) {
      if (getProject(selectedProjectId)?.archived) {
        showToast('Restore this project before adding or editing tasks.');
        return;
      }
      openTaskDrawer(taskButton.dataset.editProjectTask || null, selectedProjectId);
      return;
    }

    const deleteGroup = event.target.closest('[data-delete-project-group]');
    if (deleteGroup) {
      const group = state.projectGroups.find((item) => item.id === deleteGroup.dataset.deleteProjectGroup);
      if (!group || !confirm(`Remove the group "${group.name}"? Its tasks will become ungrouped.`)) return;
      const projectGroups = state.projectGroups.filter((item) => item.id !== group.id);
      const tasks = state.tasks.map((task) => task.groupId === group.id
        ? { ...task, groupId: null, updatedAt: Date.now() }
        : task);
      await save({ projectGroups, tasks });
      return;
    }

    const openLink = event.target.closest('[data-open-project-link]');
    if (openLink) {
      const url = normalizeHttpUrl(openLink.dataset.openProjectLink);
      if (url) await chrome.tabs.create({ url });
      return;
    }

    const openAllLinks = event.target.closest('[data-open-all-project-links]');
    if (openAllLinks) {
      const project = getProject(selectedProjectId);
      const urls = [...new Set((project?.links || [])
        .map((link) => normalizeHttpUrl(link.url))
        .filter(Boolean))];
      if (!urls.length) {
        showToast('This project has no saved links.');
        return;
      }
      openAllLinks.disabled = true;
      try {
        await Promise.all(urls.map((url) => chrome.tabs.create({ url, active: false })));
        showToast(`Opened ${urls.length} project resource${urls.length === 1 ? '' : 's'}.`);
      } catch (error) {
        showToast(error.message || 'The project resources could not be opened.');
      } finally {
        openAllLinks.disabled = false;
      }
      return;
    }

    const deleteLink = event.target.closest('[data-delete-project-link]');
    if (deleteLink) {
      const current = getProject(selectedProjectId);
      const link = (current?.links || []).find((item) => item.id === deleteLink.dataset.deleteProjectLink);
      if (!current || !link || !confirm(`Remove "${link.title || hostnameFromUrl(link.url)}" from this project?`)) return;
      if (current.archived) return showToast('Restore this project before changing its links.');
      const projects = state.projects.map((project) => project.id === current.id
        ? {
            ...project,
            links: (project.links || []).filter((item) => item.id !== link.id),
            updatedAt: Date.now()
          }
        : project);
      await save({ projects });
      return;
    }

    const projectNote = event.target.closest('[data-open-project-note]');
    if (projectNote) {
      await flushPendingNoteSave();
      const noteId = projectNote.dataset.openProjectNote;
      if (noteId) {
        selectedNoteId = noteId;
        openSelectedNote();
      } else {
        const project = getProject(selectedProjectId);
        beginNewNote();
        if (project) {
          $('#noteWorkspace').value = project.workspaceId;
          renderNoteProjectOptions(project.id);
        }
      }
      showView('notes');
    }
  });

  $('#projectsView').addEventListener('submit', async (event) => {
    if (event.target.matches('#projectBriefForm')) {
      event.preventDefault();
      const projects = state.projects.map((project) => project.id === selectedProjectId ? {
        ...project,
        name: $('#projectEditName').value.trim() || project.name,
        description: $('#projectEditDescription').value.trim(),
        outcome: $('#projectEditOutcome').value.trim(),
        status: $('#projectEditStatus').value,
        priority: $('#projectEditPriority').value,
        dueDate: $('#projectEditDueDate').value || null,
        updatedAt: Date.now()
      } : project);
      await save({ projects });
      showToast('Project updated.');
      return;
    }

    if (event.target.matches('#projectGroupForm')) {
      event.preventDefault();
      const name = $('#projectGroupName').value.trim();
      if (!name) return;
      const groups = state.projectGroups.filter((group) => group.projectId === selectedProjectId);
      const projectGroups = [...state.projectGroups, {
        id: createId('group'),
        projectId: selectedProjectId,
        name,
        order: groups.length,
        createdAt: Date.now()
      }];
      await save({ projectGroups });
      return;
    }

    if (event.target.matches('#projectLinkForm')) {
      event.preventDefault();
      const current = getProject(selectedProjectId);
      if (!current) return;
      if (current.archived) return showToast('Restore this project before changing its links.');
      const url = normalizeHttpUrl($('#projectLinkUrl').value);
      if (!url) return showToast('Enter a valid website URL.');
      if ((current.links || []).some((link) => link.url === url)) {
        return showToast('This link is already saved in the project.');
      }
      const link = {
        id: createId('project-link'),
        title: $('#projectLinkTitle').value.trim() || hostnameFromUrl(url),
        url,
        createdAt: Date.now()
      };
      const projects = state.projects.map((project) => project.id === current.id
        ? { ...project, links: [...(project.links || []), link], updatedAt: Date.now() }
        : project);
      await save({ projects });
      showToast('Link saved.');
    }
  });

  $('#projectsView').addEventListener('change', (event) => {
    if (event.target.matches('#projectBoardGroupFilter')) {
      projectGroupFilter = event.target.value;
      renderProjectBoard(getProject(selectedProjectId));
    }
  });

  $('#projectBoard').addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-project-task-card]');
    if (!card || !event.dataTransfer) return;
    event.dataTransfer.setData('text/plain', card.dataset.projectTaskCard);
    event.dataTransfer.effectAllowed = 'move';
    card.classList.add('dragging');
  });
  $('#projectBoard').addEventListener('dragend', (event) => {
    event.target.closest('[data-project-task-card]')?.classList.remove('dragging');
    $$('.kanban-column').forEach((column) => column.classList.remove('drag-over'));
  });
  $('#projectBoard').addEventListener('dragover', (event) => {
    const column = event.target.closest('[data-board-status]');
    if (!column) return;
    event.preventDefault();
    $$('.kanban-column').forEach((item) => item.classList.toggle('drag-over', item === column));
  });
  $('#projectBoard').addEventListener('drop', async (event) => {
    const column = event.target.closest('[data-board-status]');
    if (!column || !event.dataTransfer) return;
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    const status = column.dataset.boardStatus;
    if (!TASK_STATUSES.includes(status)) return;
    const tasks = state.tasks.map((task) => task.id === id
      ? { ...task, status, completed: status === 'done', updatedAt: Date.now() }
      : task);
    await save({ tasks });
  });

  $('#backToProjects').addEventListener('click', () => {
    selectedProjectId = null;
    renderProjects();
  });
  $('#archiveProject').addEventListener('click', async () => {
    const current = getProject(selectedProjectId);
    if (!current) return;
    const archived = !current.archived;
    const projects = state.projects.map((project) => project.id === current.id
      ? { ...project, archived, archivedAt: archived ? Date.now() : null, updatedAt: Date.now() }
      : project);
    await save({ projects });
    showToast(archived ? 'Project archived.' : 'Project restored.');
  });
  $('#syncProjectObsidian').addEventListener('click', async () => {
    if (!selectedProjectId) return;
    const record = state.obsidianSyncRecords && state.obsidianSyncRecords[selectedProjectId];
    const force = record && record.status === 'conflict'
      ? confirm('This project has files changed in Obsidian. Replace those exported files with the Focus Desk version?')
      : false;
    if (record && record.status === 'conflict' && !force) return;
    await syncProjectsToObsidian([selectedProjectId], {
      showToastOnSuccess: true,
      force
    });
  });
  $('#newProjectTask').addEventListener('click', () => openTaskDrawer(null, selectedProjectId));

  $('#taskDrawerBackdrop').addEventListener('click', closeTaskDrawer);
  $('#closeTaskDrawer').addEventListener('click', closeTaskDrawer);
  $('#drawerTaskProject').addEventListener('change', renderDrawerGroupOptions);
  $('#addSubtask').addEventListener('click', addDrawerSubtask);
  $('#newSubtaskTitle').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addDrawerSubtask();
    }
  });
  $('#drawerSubtaskList').addEventListener('change', (event) => {
    const toggle = event.target.closest('[data-toggle-subtask]');
    if (!toggle) return;
    drawerSubtasks = drawerSubtasks.map((subtask) => subtask.id === toggle.dataset.toggleSubtask
      ? { ...subtask, completed: toggle.checked }
      : subtask);
    renderDrawerSubtasks();
  });
  $('#drawerSubtaskList').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-delete-subtask]');
    if (!remove) return;
    drawerSubtasks = drawerSubtasks.filter((subtask) => subtask.id !== remove.dataset.deleteSubtask);
    renderDrawerSubtasks();
  });
  $('#taskDrawerForm').addEventListener('submit', saveDrawerTask);
  $('#deleteDrawerTask').addEventListener('click', deleteDrawerTask);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#taskDrawer').classList.contains('hidden')) closeTaskDrawer();
  });
}

function renderProjects() {
  const project = getProject(selectedProjectId);
  if (selectedProjectId && !project) selectedProjectId = null;
  const detailActive = Boolean(getProject(selectedProjectId));
  $('#projectIndex').classList.toggle('hidden', detailActive);
  $('#projectDetail').classList.toggle('hidden', !detailActive);

  $$('[data-project-index-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.projectIndexMode === projectIndexMode);
  });

  if (!detailActive) {
    if ($('#projectsView').classList.contains('active')) $('#viewTitle').textContent = 'Projects';
    const workspaceId = $('#projectWorkspaceFilter').value || 'all';
    const projects = state.projects.filter((item) => {
      const archiveMatches = projectIndexMode === 'archived' ? item.archived : !item.archived;
      return archiveMatches && (workspaceId === 'all' || item.workspaceId === workspaceId);
    });
    $('#projectGrid').innerHTML = projects.length
      ? projects.map(projectIndexCard).join('')
      : emptyState(projectIndexMode === 'archived'
        ? 'No archived projects in this workspace.'
        : 'No active projects here yet. Create one above.');
    return;
  }

  renderProjectDetail(getProject(selectedProjectId));
}

function projectIndexCard(project) {
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const done = tasks.filter((task) => task.status === 'done' || task.completed).length;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const groups = state.projectGroups.filter((group) => group.projectId === project.id).length;
  const links = (project.links || []).length;
  return `<article class="project-card" style="--project-color:${escapeHtml(project.color || '#E4002B')}">
    <button class="project-card-main" data-open-project="${project.id}" type="button">
      <span class="project-card-kicker">${escapeHtml(getWorkspace(project.workspaceId).name)} · ${escapeHtml(project.priority)} priority</span>
      <strong>${escapeHtml(project.name)}</strong>
      <span class="project-card-description">${escapeHtml(project.outcome || project.description || 'No project outcome defined yet.')}</span>
      <span class="project-progress-track"><i style="width:${progress}%"></i></span>
      <span class="project-card-foot"><b>${progress}%</b><span>${done}/${tasks.length} tasks · ${groups} groups · ${links} links${project.dueDate ? ` · due ${formatShortDate(project.dueDate)}` : ''}</span></span>
    </button>
  </article>`;
}

function renderProjectDetail(project) {
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const notes = state.notes.filter((note) => note.projectId === project.id);
  const links = Array.isArray(project.links) ? project.links : [];
  const open = tasks.filter((task) => task.status !== 'done' && !task.completed).length;
  const done = tasks.length - open;
  const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  const obsidianState = projectObsidianSyncState(project);
  if ($('#projectsView').classList.contains('active')) $('#viewTitle').textContent = project.name;
  $('#syncProjectObsidian').textContent = obsidianState.label;
  $('#syncProjectObsidian').dataset.syncState = obsidianState.state;
  $('#syncProjectObsidian').disabled = obsidianSyncInProgress;
  $('#archiveProject').textContent = project.archived ? 'Restore project' : 'Archive';
  $('#newProjectTask').disabled = project.archived;
  $('#projectLedger').style.setProperty('--project-color', project.color || '#E4002B');
  $('#projectLedger').innerHTML = `
    <div class="project-ledger-main">
      <span class="project-status-line">${escapeHtml(getWorkspace(project.workspaceId).name)} / ${escapeHtml(project.status)}</span>
      <h2>${escapeHtml(project.name)}</h2>
      <p>${escapeHtml(project.outcome || 'Define the outcome in Overview.')}</p>
    </div>
    <div class="project-ledger-stat"><span>Progress</span><strong>${progress}%</strong><i><b style="width:${progress}%"></b></i></div>
    <div class="project-ledger-stat"><span>Open</span><strong>${open}</strong><small>${tasks.length} total tasks</small></div>
    <div class="project-ledger-stat"><span>Knowledge</span><strong>${notes.length + links.length}</strong><small>${notes.length} notes · ${links.length} links</small></div>`;

  $$('[data-project-view-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.projectViewMode === projectViewMode);
  });
  $('#projectOverview').classList.toggle('hidden', projectViewMode !== 'overview');
  $('#projectBoard').classList.toggle('hidden', projectViewMode !== 'board');
  $('#projectListView').classList.toggle('hidden', projectViewMode !== 'list');
  if (projectViewMode === 'overview') renderProjectOverview(project);
  if (projectViewMode === 'board') renderProjectBoard(project);
  if (projectViewMode === 'list') renderProjectList(project);
}

function projectObsidianSyncState(project) {
  if (!obsidianVaultHandle) return { state: 'new', label: 'Sync to Obsidian' };
  const record = state.obsidianSyncRecords && state.obsidianSyncRecords[project.id];
  if (!record) return { state: 'new', label: 'Sync to Obsidian' };
  if (record.status === 'conflict') return { state: 'conflict', label: 'Review Obsidian conflict' };
  const latestSourceUpdate = Math.max(
    Number(project.updatedAt) || 0,
    ...state.notes.filter((note) => note.projectId === project.id)
      .map((note) => Number(note.updatedAt) || 0)
  );
  if (latestSourceUpdate > Number(record.sourceUpdatedAt || 0)) {
    return { state: 'pending', label: 'Sync changes' };
  }
  return { state: 'synced', label: 'Synced to Obsidian' };
}

function renderProjectOverview(project) {
  const groups = projectGroupsFor(project.id);
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const notes = state.notes
    .filter((note) => note.projectId === project.id)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const nextTasks = tasks.filter((task) => task.status !== 'done' && !task.completed).slice(0, 6);
  const links = [...(project.links || [])].sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  $('#projectOverview').innerHTML = `
    <div class="project-overview-grid">
      <form id="projectBriefForm" class="project-brief">
        <div class="project-section-heading"><div><span class="eyebrow">Project brief</span><h3>Definition</h3></div><button class="button small primary" type="submit">Save brief</button></div>
        <label class="drawer-field">Project name<input id="projectEditName" type="text" maxlength="120" value="${escapeHtml(project.name)}" required></label>
        <label class="drawer-field">Desired outcome<textarea id="projectEditOutcome" rows="3" maxlength="1000" placeholder="What changes when this project is complete?">${escapeHtml(project.outcome || '')}</textarea></label>
        <label class="drawer-field">Working notes<textarea id="projectEditDescription" rows="5" maxlength="4000" placeholder="Scope, constraints, useful context...">${escapeHtml(project.description || '')}</textarea></label>
        <div class="drawer-field-grid project-brief-fields">
          <label class="drawer-field">Status<select id="projectEditStatus">${PROJECT_STATUSES.map((status) => `<option value="${status}" ${project.status === status ? 'selected' : ''}>${titleCase(status)}</option>`).join('')}</select></label>
          <label class="drawer-field">Priority<select id="projectEditPriority">${['low', 'medium', 'high'].map((priority) => `<option value="${priority}" ${project.priority === priority ? 'selected' : ''}>${titleCase(priority)}</option>`).join('')}</select></label>
          <label class="drawer-field">Due date<input id="projectEditDueDate" type="date" value="${escapeHtml(project.dueDate || '')}"></label>
        </div>
      </form>
      <section class="project-groups-panel">
        <div class="project-section-heading"><div><span class="eyebrow">Work structure</span><h3>Task groups</h3></div><span>${groups.length}</span></div>
        <form id="projectGroupForm" class="project-group-form"><input id="projectGroupName" type="text" maxlength="100" placeholder="e.g. Research" required><button class="button secondary" type="submit">Add group</button></form>
        <div class="project-group-list">${groups.length ? groups.map((group) => {
          const count = tasks.filter((task) => task.groupId === group.id).length;
          return `<div class="project-group-row"><span>${String(group.order + 1).padStart(2, '0')}</span><strong>${escapeHtml(group.name)}</strong><small>${count} task${count === 1 ? '' : 's'}</small><button data-delete-project-group="${group.id}" type="button">Remove</button></div>`;
        }).join('') : emptyState('Add groups for phases, workstreams, or deliverables.')}</div>
      </section>
      <section class="project-overview-list">
        <div class="project-section-heading"><div><span class="eyebrow">Next actions</span><h3>Open work</h3></div><button class="text-button" data-edit-project-task="" type="button">Add task</button></div>
        <div>${nextTasks.length ? nextTasks.map(projectListTaskRow).join('') : emptyState('No open tasks in this project.')}</div>
      </section>
      <section class="project-overview-list">
        <div class="project-section-heading"><div><span class="eyebrow">Project knowledge</span><h3>Notes</h3></div><button class="text-button" data-open-project-note type="button">New note</button></div>
        <div>${notes.length ? notes.slice(0, 6).map((note) => `<button class="project-note-row" data-open-project-note="${note.id}" type="button"><strong>${escapeHtml(note.title)}</strong><span>${formatShortDate(new Date(note.updatedAt).toISOString().slice(0, 10))}</span></button>`).join('') : emptyState('No notes linked to this project.')}</div>
      </section>
      <section class="project-overview-list project-links-panel">
        <div class="project-section-heading">
          <div><span class="eyebrow">Project resources</span><h3>Saved links</h3></div>
          <div class="project-section-actions">
            <span>${links.length}</span>
            ${links.length ? '<button class="text-button" data-open-all-project-links type="button">Open all</button>' : ''}
          </div>
        </div>
        <form id="projectLinkForm" class="project-link-form">
          <input id="projectLinkTitle" type="text" maxlength="200" placeholder="Title (optional)">
          <input id="projectLinkUrl" type="text" maxlength="2000" placeholder="example.com/resource" required>
          <button class="button secondary" type="submit">Save link</button>
        </form>
        <div class="project-link-list">${links.length ? links.map((link) => `<div class="project-link-row">
          <button class="project-link-main" data-open-project-link="${escapeHtml(link.url)}" type="button" title="Open ${escapeHtml(link.title || hostnameFromUrl(link.url))}">
            <span class="project-link-favicon" aria-hidden="true">
              <img data-project-favicon src="${escapeHtml(projectFaviconUrl(link.url))}" alt="" width="32" height="32" loading="lazy">
              <span class="project-link-fallback"></span>
            </span>
            <span class="project-link-copy">
              <strong>${escapeHtml(link.title || hostnameFromUrl(link.url))}</strong>
              <span>${escapeHtml(hostnameFromUrl(link.url))}</span>
            </span>
          </button>
          <button class="project-link-remove" data-delete-project-link="${escapeHtml(link.id)}" type="button">Remove</button>
        </div>`).join('') : emptyState('No links saved in this project.')}</div>
      </section>
    </div>`;
}

function renderProjectBoard(project) {
  const groups = projectGroupsFor(project.id);
  if (projectGroupFilter !== 'all' && !groups.some((group) => group.id === projectGroupFilter)) {
    projectGroupFilter = 'all';
  }
  const tasks = state.tasks.filter((task) => task.projectId === project.id
    && (projectGroupFilter === 'all' || task.groupId === projectGroupFilter));
  $('#projectBoard').innerHTML = `
    <div class="project-board-toolbar">
      <span>${tasks.length} visible task${tasks.length === 1 ? '' : 's'}</span>
      <select id="projectBoardGroupFilter" aria-label="Filter board by task group">
        <option value="all">All groups</option>
        ${groups.map((group) => `<option value="${group.id}" ${projectGroupFilter === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}
      </select>
    </div>
    <div class="kanban-board">${TASK_STATUSES.map((status) => {
      const columnTasks = tasks.filter((task) => normalizedTaskStatus(task) === status);
      return `<section class="kanban-column" data-board-status="${status}">
        <header><span>${TASK_STATUS_LABELS[status]}</span><strong>${columnTasks.length}</strong></header>
        <div class="kanban-stack">${columnTasks.length ? columnTasks.map(projectTaskCard).join('') : '<p class="kanban-empty">Drop tasks here</p>'}</div>
        <button class="kanban-add" data-edit-project-task="" type="button">Add task</button>
      </section>`;
    }).join('')}</div>`;
}

function renderProjectList(project) {
  const groups = projectGroupsFor(project.id);
  const tasks = state.tasks.filter((task) => task.projectId === project.id);
  const sections = [{ id: null, name: 'Ungrouped' }, ...groups];
  $('#projectListView').innerHTML = `<div class="grouped-task-list">${sections.map((group) => {
    const groupTasks = tasks.filter((task) => (task.groupId || null) === group.id);
    return `<section class="task-group-section">
      <header><div><span>${group.id ? 'Group' : 'Project'}</span><h3>${escapeHtml(group.name)}</h3></div><strong>${groupTasks.length}</strong></header>
      <div>${groupTasks.length ? groupTasks.map(projectListTaskRow).join('') : '<p class="task-group-empty">No tasks in this group.</p>'}</div>
      <button class="task-group-add" data-edit-project-task="" type="button">Add task</button>
    </section>`;
  }).join('')}</div>`;
}

function projectTaskCard(task) {
  const group = getProjectGroup(task.groupId);
  const completeSubtasks = (task.subtasks || []).filter((subtask) => subtask.completed).length;
  return `<article class="kanban-card priority-${escapeHtml(task.priority || 'medium')}" draggable="true" data-project-task-card="${task.id}">
    <button data-edit-project-task="${task.id}" type="button">
      <span class="kanban-card-meta">${escapeHtml(group?.name || 'Ungrouped')}</span>
      <strong>${escapeHtml(task.title)}</strong>
      ${(task.labels || []).length ? `<span class="task-labels">${task.labels.slice(0, 3).map((label) => `<i>${escapeHtml(label)}</i>`).join('')}</span>` : ''}
      <span class="kanban-card-foot">${task.dueDate ? `Due ${formatShortDate(task.dueDate)}` : 'No due date'}${(task.subtasks || []).length ? ` · ${completeSubtasks}/${task.subtasks.length}` : ''}</span>
    </button>
  </article>`;
}

function projectListTaskRow(task) {
  const group = getProjectGroup(task.groupId);
  return `<button class="project-task-row" data-edit-project-task="${task.id}" type="button">
    <span class="task-priority-mark priority-${escapeHtml(task.priority || 'medium')}"></span>
    <strong>${escapeHtml(task.title)}</strong>
    <span>${escapeHtml(group?.name || 'Ungrouped')}</span>
    <span>${TASK_STATUS_LABELS[normalizedTaskStatus(task)]}</span>
    <time>${task.dueDate ? formatShortDate(task.dueDate) : 'No due date'}</time>
  </button>`;
}

function openTaskDrawer(taskId = null, projectId = null) {
  const task = state.tasks.find((item) => item.id === taskId);
  selectedDrawerTaskId = task?.id || null;
  drawerSubtasks = (task?.subtasks || []).map((subtask) => ({ ...subtask }));
  $('#taskDrawerHeading').textContent = task ? 'Edit task' : 'New task';
  $('#drawerTaskTitle').value = task?.title || '';
  const selectedProject = task?.projectId || projectId || '';
  const projectOptions = [
    '<option value="">No project</option>',
    ...state.projects
      .filter((project) => !project.archived || project.id === selectedProject)
      .map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`)
  ].join('');
  $('#drawerTaskProject').innerHTML = projectOptions;
  $('#drawerTaskProject').value = selectedProject;
  renderDrawerGroupOptions(task?.groupId || null);
  $('#drawerTaskStatus').value = normalizedTaskStatus(task || {});
  $('#drawerTaskPriority').value = task?.priority || 'medium';
  $('#drawerTaskDueDate').value = task?.dueDate || '';
  $('#drawerTaskPlannedDate').value = task?.plannedDate || '';
  $('#drawerTaskEstimate').value = Number(task?.estimateMinutes) || '';
  $('#drawerTaskLabels').value = (task?.labels || []).join(', ');
  $('#drawerTaskDescription').value = task?.description || '';
  $('#newSubtaskTitle').value = '';
  $('#deleteDrawerTask').classList.toggle('hidden', !task);
  renderDrawerSubtasks();
  $('#taskDrawerBackdrop').classList.remove('hidden');
  $('#taskDrawer').classList.remove('hidden');
  $('#taskDrawer').setAttribute('aria-hidden', 'false');
  document.body.classList.add('drawer-open');
  setTimeout(() => $('#drawerTaskTitle').focus(), 0);
}

function closeTaskDrawer() {
  $('#taskDrawerBackdrop').classList.add('hidden');
  $('#taskDrawer').classList.add('hidden');
  $('#taskDrawer').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('drawer-open');
  selectedDrawerTaskId = null;
  drawerSubtasks = [];
}

function renderDrawerGroupOptions(selectedGroupId = null) {
  const projectId = $('#drawerTaskProject').value;
  const groups = projectGroupsFor(projectId);
  $('#drawerTaskGroup').innerHTML = `<option value="">Ungrouped</option>${groups.map((group) => `<option value="${group.id}">${escapeHtml(group.name)}</option>`).join('')}`;
  $('#drawerTaskGroup').value = groups.some((group) => group.id === selectedGroupId) ? selectedGroupId : '';
  $('#drawerTaskGroup').disabled = !projectId;
}

function addDrawerSubtask() {
  const input = $('#newSubtaskTitle');
  const title = input.value.trim();
  if (!title) return;
  drawerSubtasks.push({ id: createId('subtask'), title, completed: false });
  input.value = '';
  renderDrawerSubtasks();
}

function renderDrawerSubtasks() {
  const complete = drawerSubtasks.filter((subtask) => subtask.completed).length;
  $('#subtaskProgress').textContent = `${complete} / ${drawerSubtasks.length}`;
  $('#drawerSubtaskList').innerHTML = drawerSubtasks.length ? drawerSubtasks.map((subtask) => `
    <label class="drawer-subtask-row">
      <input type="checkbox" data-toggle-subtask="${subtask.id}" ${subtask.completed ? 'checked' : ''}>
      <span>${escapeHtml(subtask.title)}</span>
      <button data-delete-subtask="${subtask.id}" type="button" aria-label="Remove ${escapeHtml(subtask.title)}">Remove</button>
    </label>`).join('') : '<p class="task-group-empty">No subtasks yet.</p>';
}

async function saveDrawerTask(event) {
  event.preventDefault();
  const title = $('#drawerTaskTitle').value.trim();
  if (!title) return;
  const now = Date.now();
  const existing = state.tasks.find((task) => task.id === selectedDrawerTaskId);
  const projectId = $('#drawerTaskProject').value || null;
  const project = getProject(projectId);
  const status = $('#drawerTaskStatus').value;
  const task = {
    id: existing?.id || createId('task'),
    title,
    description: $('#drawerTaskDescription').value.trim(),
    workspaceId: project?.workspaceId || existing?.workspaceId || state.activeWorkspaceId,
    projectId,
    groupId: projectId ? $('#drawerTaskGroup').value || null : null,
    status,
    priority: $('#drawerTaskPriority').value,
    dueDate: $('#drawerTaskDueDate').value || null,
    plannedDate: $('#drawerTaskPlannedDate').value || null,
    estimateMinutes: clamp($('#drawerTaskEstimate').value, 0, 1440, 0),
    labels: Array.from(new Set($('#drawerTaskLabels').value.split(',').map((label) => label.trim()).filter(Boolean))).slice(0, 12),
    subtasks: drawerSubtasks,
    completed: status === 'done',
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  const tasks = existing
    ? state.tasks.map((item) => item.id === task.id ? task : item)
    : [task, ...state.tasks];
  await save({ tasks });
  closeTaskDrawer();
  showToast(existing ? 'Task updated.' : 'Task created.');
}

async function deleteDrawerTask() {
  const task = state.tasks.find((item) => item.id === selectedDrawerTaskId);
  if (!task || !confirm(`Delete "${task.title}"?`)) return;
  await save({ tasks: state.tasks.filter((item) => item.id !== task.id) });
  closeTaskDrawer();
  showToast('Task deleted.');
}

function projectGroupsFor(projectId) {
  return state.projectGroups
    .filter((group) => group.projectId === projectId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function getProject(id) {
  return state?.projects?.find((project) => project.id === id) || null;
}

function getProjectGroup(id) {
  return state?.projectGroups?.find((group) => group.id === id) || null;
}

function normalizedTaskStatus(task) {
  if (TASK_STATUSES.includes(task.status)) return task.status;
  if (task.completed) return 'done';
  return task.plannedDate ? 'planned' : 'backlog';
}

function projectColorForPriority(priority) {
  if (priority === 'high') return '#E4002B';
  if (priority === 'low') return '#007A4D';
  return '#002FA7';
}

function titleCase(value) {
  return String(value || '').replace(/(^|-)([a-z])/g, (_, separator, letter) => `${separator ? ' ' : ''}${letter.toUpperCase()}`);
}

function projectFaviconUrl(pageUrl, size = 32) {
  const endpoint = chrome.runtime.getURL('/_favicon/');
  return `${endpoint}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
}

function bindTasks() {
  $('#taskDate').value = todayKey();
  $('#taskWorkspace').addEventListener('change', renderTaskProjectOptions);
  $('#taskForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = $('#taskTitle').value.trim();
    if (!title) return;
    const now = Date.now();
    const projectId = $('#taskProject').value || null;
    const plannedDate = $('#taskDate').value || null;
    const tasks = [...state.tasks, {
      id: createId('task'),
      title,
      description: '',
      workspaceId: $('#taskWorkspace').value,
      projectId,
      groupId: null,
      status: plannedDate ? 'planned' : 'backlog',
      priority: 'medium',
      dueDate: null,
      plannedDate,
      estimateMinutes: 0,
      labels: [],
      subtasks: [],
      completed: false,
      createdAt: now,
      updatedAt: now
    }];
    $('#taskTitle').value = '';
    await save({ tasks });
  });
  $('#taskFilter').addEventListener('change', renderTasks);
  $('#taskList').addEventListener('click', handleTaskListAction);
  $('#taskList').addEventListener('change', handleTaskListAction);
  $('#todayTasks').addEventListener('change', handleTaskListAction);
}

async function handleTaskListAction(event) {
  const edit = event.target.closest('[data-edit-task]');
  if (edit) {
    openTaskDrawer(edit.dataset.editTask);
    return;
  }
  const toggle = event.target.closest('[data-toggle-task]');
  const remove = event.target.closest('[data-delete-task]');
  if (!toggle && !remove) return;
  const id = (toggle && toggle.dataset.toggleTask) || remove.dataset.deleteTask;
  const tasks = remove
    ? state.tasks.filter((task) => task.id !== id)
    : state.tasks.map((task) => task.id === id ? {
        ...task,
        completed: toggle.checked,
        status: toggle.checked ? 'done' : task.status === 'done' ? 'backlog' : normalizedTaskStatus(task),
        updatedAt: Date.now()
      } : task);
  await save({ tasks });
}

function renderTasks() {
  const filter = $('#taskFilter').value;
  const filtered = state.tasks.filter((task) => {
    if (filter === 'open') return !task.completed;
    if (filter === 'today') return task.plannedDate === todayKey();
    if (filter === 'completed') return task.completed;
    return true;
  });
  $('#taskList').innerHTML = filtered.length ? filtered.map(taskRow).join('') : emptyState('No tasks match this view.');

  const todayTasks = state.tasks.filter((task) => !task.completed && (!task.plannedDate || task.plannedDate === todayKey())).slice(0, 4);
  $('#todayTasks').innerHTML = todayTasks.length ? todayTasks.map((task) => `
    <label class="compact-item">
      <input type="checkbox" data-toggle-task="${task.id}" aria-label="Complete ${escapeHtml(task.title)}">
      <span><strong>${escapeHtml(task.title)}</strong><span>${escapeHtml(getWorkspace(task.workspaceId).name)}</span></span>
    </label>`).join('') : emptyState('Nothing is queued for today.');
}

function taskRow(task) {
  const workspace = getWorkspace(task.workspaceId);
  const project = getProject(task.projectId);
  const context = project ? `${project.name}${getProjectGroup(task.groupId) ? ` / ${getProjectGroup(task.groupId).name}` : ''}` : workspace.name;
  return `<article class="task-row ${task.completed ? 'completed' : ''}">
    <input type="checkbox" data-toggle-task="${task.id}" ${task.completed ? 'checked' : ''} aria-label="Toggle ${escapeHtml(task.title)}">
    <button class="task-name task-open-button" data-edit-task="${task.id}" type="button">${escapeHtml(task.title)}</button>
    <span class="task-meta">${escapeHtml(context)}</span>
    <span class="task-meta task-date">${task.plannedDate ? formatShortDate(task.plannedDate) : 'Unscheduled'}</span>
    <button class="icon-button" data-delete-task="${task.id}" aria-label="Delete ${escapeHtml(task.title)}">Delete</button>
  </article>`;
}

function bindNotes() {
  $('#newNoteButton').addEventListener('click', async () => {
    await flushPendingNoteSave();
    beginNewNote();
  });
  $('#noteSearch').addEventListener('input', renderNotes);
  $('#noteTitle').addEventListener('input', scheduleNoteAutosave);
  $('#noteWorkspace').addEventListener('change', () => {
    renderNoteProjectOptions();
    scheduleNoteAutosave();
  });
  $('#noteProject').addEventListener('change', scheduleNoteAutosave);
  $('#notesList').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-note-id]');
    if (!button) return;
    await flushPendingNoteSave();
    selectedNoteId = button.dataset.noteId;
    openSelectedNote();
  });
  $('#notesList').addEventListener('toggle', (event) => {
    const folder = event.target;
    if (!folder.matches('details[data-note-folder-id]')) return;
    const collection = folder.dataset.noteFolderType === 'workspace'
      ? openNoteWorkspaceFolders
      : openNoteProjectFolders;
    if (folder.open) collection.add(folder.dataset.noteFolderId);
    else collection.delete(folder.dataset.noteFolderId);
  }, true);
  $('#noteForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    noteDirty = true;
    await saveCurrentNote({ notify: true });
  });
  $('#deleteNoteButton').addEventListener('click', async () => {
    if (!selectedNoteId || !confirm('Delete this note?')) return;
    clearTimeout(noteAutosaveTimer);
    noteAutosaveTimer = null;
    noteDirty = false;
    await noteSaveQueue.catch(() => {});
    const notes = state.notes.filter((note) => note.id !== selectedNoteId);
    const flashcards = state.flashcards.filter((card) => card.noteId !== selectedNoteId);
    selectedNoteId = null;
    await save({ notes, flashcards });
    showEmptyNoteEditor();
  });
  $('#addFlashcardButton').addEventListener('click', async () => {
    const question = $('#flashcardQuestion').value.trim();
    const answer = $('#flashcardAnswer').value.trim();
    await flushPendingNoteSave();
    if (!selectedNoteId) return showToast('Save the note before adding a flashcard.');
    if (!question || !answer) return showToast('Add both a question and an answer.');
    const flashcards = [...state.flashcards, { id: createId('card'), noteId: selectedNoteId, question, answer, createdAt: Date.now() }];
    $('#flashcardQuestion').value = '';
    $('#flashcardAnswer').value = '';
    await save({ flashcards });
    showToast('Flashcard added.');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingNoteSave();
  });
}

function renderNotes() {
  const query = $('#noteSearch').value.trim().toLowerCase();
  const matchingNotes = state.notes
    .filter((note) => `${note.title} ${note.body}`.toLowerCase().includes(query))
    .sort((a, b) => Number(b.updatedAt || b.createdAt) - Number(a.updatedAt || a.createdAt));

  if (!noteFoldersInitialized) {
    state.workspaces.forEach((workspace) => openNoteWorkspaceFolders.add(workspace.id));
    state.projects.forEach((project) => {
      if (state.notes.some((note) => note.projectId === project.id)) openNoteProjectFolders.add(project.id);
    });
    noteFoldersInitialized = true;
  }

  if (query && !matchingNotes.length) {
    $('#notesList').innerHTML = emptyState('No notes match your search.');
    return;
  }

  const tree = state.workspaces.map((workspace) => {
    const workspaceNotes = matchingNotes.filter((note) => getWorkspace(note.workspaceId).id === workspace.id);
    const projects = state.projects
      .filter((project) => project.workspaceId === workspace.id)
      .filter((project) => {
        const hasNotes = workspaceNotes.some((note) => note.projectId === project.id);
        return query ? hasNotes : !project.archived || hasNotes;
      })
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name));
    const directNotes = workspaceNotes.filter((note) => {
      const project = getProject(note.projectId);
      return !project || project.workspaceId !== workspace.id;
    });
    const visibleCount = directNotes.length + projects.reduce(
      (count, project) => count + workspaceNotes.filter((note) => note.projectId === project.id).length,
      0
    );
    if (query && !visibleCount) return '';
    const workspaceOpen = query || openNoteWorkspaceFolders.has(workspace.id);

    return `<details class="note-folder note-workspace-folder" data-note-folder-type="workspace" data-note-folder-id="${workspace.id}" ${workspaceOpen ? 'open' : ''}>
      <summary>
        <span class="note-folder-name"><strong>${escapeHtml(workspace.name)}</strong><small>Workspace</small></span>
        <span class="note-folder-count">${visibleCount}</span>
      </summary>
      <div class="note-folder-body">
        ${directNotes.length ? `<div class="note-folder-section">
          <span class="note-folder-label">Workspace notes</span>
          ${directNotes.map(noteIndexButton).join('')}
        </div>` : ''}
        ${projects.map((project) => {
          const projectNotes = workspaceNotes.filter((note) => note.projectId === project.id);
          if (query && !projectNotes.length) return '';
          const projectOpen = query || openNoteProjectFolders.has(project.id);
          return `<details class="note-folder note-project-folder" data-note-folder-type="project" data-note-folder-id="${project.id}" ${projectOpen ? 'open' : ''}>
            <summary>
              <span class="note-project-signal" style="background:${escapeHtml(project.color || '#E4002B')}"></span>
              <span class="note-folder-name"><strong>${escapeHtml(project.name)}</strong><small>${project.archived ? 'Archived project' : 'Project'}</small></span>
              <span class="note-folder-count">${projectNotes.length}</span>
            </summary>
            <div class="note-project-notes">${projectNotes.length
              ? projectNotes.map(noteIndexButton).join('')
              : '<p class="note-folder-empty">No notes</p>'}</div>
          </details>`;
        }).join('')}
        ${!directNotes.length && !projects.length ? '<p class="note-folder-empty">No notes or projects</p>' : ''}
      </div>
    </details>`;
  }).join('');

  $('#notesList').innerHTML = tree || emptyState('No notes yet.');
}

function noteIndexButton(note) {
  const updatedAt = Number(note.updatedAt || note.createdAt);
  const updated = updatedAt ? formatShortDate(new Date(updatedAt).toISOString().slice(0, 10)) : 'Note';
  return `<button class="note-index-item ${note.id === selectedNoteId ? 'active' : ''}" data-note-id="${note.id}" type="button">
    <strong>${escapeHtml(note.title)}</strong>
    <span>${escapeHtml(updated)}</span>
  </button>`;
}

function openNoteFoldersFor(note) {
  if (!note) return;
  const workspace = getWorkspace(note.workspaceId);
  openNoteWorkspaceFolders.add(workspace.id);
  if (getProject(note.projectId)) openNoteProjectFolders.add(note.projectId);
}

function beginNewNote() {
  selectedNoteId = null;
  $('#noteEmpty').classList.add('hidden');
  $('#noteForm').classList.remove('hidden');
  $('#deleteNoteButton').classList.add('hidden');
  $('#noteTitle').value = '';
  $('#noteWorkspace').value = state ? state.activeWorkspaceId : 'default';
  openNoteWorkspaceFolders.add($('#noteWorkspace').value);
  renderNoteProjectOptions();
  ensureMarkdownEditor();
  setEditorValue('');
  noteDirty = false;
  setNoteSaveStatus('Autosave ready');
  $('#noteTitle').focus();
  renderNotes();
}

function openSelectedNote() {
  const note = state.notes.find((item) => item.id === selectedNoteId);
  if (!note) return showEmptyNoteEditor();
  openNoteFoldersFor(note);
  $('#noteEmpty').classList.add('hidden');
  $('#noteForm').classList.remove('hidden');
  $('#deleteNoteButton').classList.remove('hidden');
  $('#noteTitle').value = note.title;
  $('#noteWorkspace').value = note.workspaceId || state.activeWorkspaceId;
  renderNoteProjectOptions(note.projectId || null);
  ensureMarkdownEditor();
  setEditorValue(note.body);
  noteDirty = false;
  setNoteSaveStatus('Saved');
  renderNotes();
}

function showEmptyNoteEditor() {
  clearTimeout(noteAutosaveTimer);
  noteAutosaveTimer = null;
  noteDirty = false;
  $('#noteEmpty').classList.remove('hidden');
  $('#noteForm').classList.add('hidden');
  renderNotes();
}

function ensureMarkdownEditor() {
  if (markdownEditor || !window.EasyMDE) {
    if (markdownEditor) setTimeout(() => markdownEditor.codemirror.refresh(), 0);
    return;
  }
  const tool = (name, action, text, title, className = '') => ({
    name,
    action,
    text,
    title,
    className: `mde-tool ${className}`.trim()
  });
  markdownEditor = new window.EasyMDE({
    element: $('#noteBody'),
    autoDownloadFontAwesome: false,
    autoRefresh: { delay: 100 },
    autofocus: false,
    forceSync: true,
    indentWithTabs: false,
    minHeight: '460px',
    placeholder: 'Write your note here',
    previewClass: ['editor-preview', 'markdown-preview'],
    previewImagesInEditor: true,
    previewRender: renderMarkdownHtml,
    promptURLs: true,
    sideBySideFullscreen: false,
    spellChecker: true,
    status: ['lines', 'words', 'cursor'],
    tabSize: 2,
    toolbar: [
      tool('bold', window.EasyMDE.toggleBold, 'B', 'Bold', 'mde-bold'),
      tool('italic', window.EasyMDE.toggleItalic, 'I', 'Italic', 'mde-italic'),
      tool('strikethrough', window.EasyMDE.toggleStrikethrough, 'S', 'Strikethrough', 'mde-strike'),
      tool('heading', window.EasyMDE.toggleHeadingSmaller, 'H', 'Heading'),
      '|',
      tool('quote', window.EasyMDE.toggleBlockquote, 'Quote', 'Quote'),
      tool('unordered-list', window.EasyMDE.toggleUnorderedList, 'List', 'Bulleted list'),
      tool('ordered-list', window.EasyMDE.toggleOrderedList, '1.', 'Numbered list'),
      tool('check-list', window.EasyMDE.toggleCheckList, '[ ]', 'Task list'),
      '|',
      tool('code', window.EasyMDE.toggleCodeBlock, 'Code', 'Code block'),
      tool('link', window.EasyMDE.drawLink, 'Link', 'Link'),
      tool('table', window.EasyMDE.drawTable, 'Table', 'Table'),
      '|',
      tool('preview', window.EasyMDE.togglePreview, 'Preview', 'Preview', 'no-disable'),
      tool('side-by-side', window.EasyMDE.toggleSideBySide, 'Split', 'Split view', 'mde-split no-disable no-mobile')
    ]
  });
  markdownEditor.codemirror.on('change', () => {
    if (!suppressEditorChange) scheduleNoteAutosave();
  });
  setTimeout(() => markdownEditor.codemirror.refresh(), 0);
}

function setEditorValue(value) {
  ensureMarkdownEditor();
  if (!markdownEditor) {
    $('#noteBody').value = value || '';
    return;
  }
  suppressEditorChange = true;
  markdownEditor.value(value || '');
  markdownEditor.codemirror.clearHistory();
  suppressEditorChange = false;
  setTimeout(() => markdownEditor.codemirror.refresh(), 0);
}

function getEditorValue() {
  return markdownEditor ? markdownEditor.value() : $('#noteBody').value;
}

function scheduleNoteAutosave() {
  if (suppressEditorChange || !state || $('#noteForm').classList.contains('hidden')) return;
  noteDirty = true;
  setNoteSaveStatus('Unsaved changes', true);
  clearTimeout(noteAutosaveTimer);
  noteAutosaveTimer = setTimeout(() => saveCurrentNote(), 700);
}

async function flushPendingNoteSave() {
  clearTimeout(noteAutosaveTimer);
  noteAutosaveTimer = null;
  if (noteDirty) await saveCurrentNote();
  else await noteSaveQueue.catch(() => {});
}

async function saveCurrentNote({ notify = false } = {}) {
  clearTimeout(noteAutosaveTimer);
  noteAutosaveTimer = null;
  if (!state || $('#noteForm').classList.contains('hidden')) return;
  const body = getEditorValue();
  const rawTitle = $('#noteTitle').value.trim();
  if (!selectedNoteId && !rawTitle && !body.trim()) {
    noteDirty = false;
    setNoteSaveStatus('Autosave ready');
    return;
  }
  const now = Date.now();
  const id = selectedNoteId || createId('note');
  const existing = state.notes.find((note) => note.id === id);
  const title = rawTitle || 'Untitled note';
  const snapshot = {
    id,
    title,
    body,
    workspaceId: $('#noteWorkspace').value,
    projectId: $('#noteProject').value || null,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  selectedNoteId = id;
  if (!rawTitle) $('#noteTitle').value = title;
  $('#deleteNoteButton').classList.remove('hidden');
  setNoteSaveStatus('Saving...');

  noteSaveQueue = noteSaveQueue.catch(() => {}).then(async () => {
    const notes = state.notes.some((note) => note.id === snapshot.id)
      ? state.notes.map((note) => note.id === snapshot.id ? snapshot : note)
      : [snapshot, ...state.notes];
    await chrome.storage.local.set({ notes });
    state.notes = notes;
  });

  try {
    await noteSaveQueue;
    openNoteFoldersFor(snapshot);
    renderNotes();
    $('#noteCount').textContent = state.notes.length;
    const unchanged = selectedNoteId === snapshot.id
      && $('#noteTitle').value.trim() === snapshot.title
      && getEditorValue() === snapshot.body
      && $('#noteWorkspace').value === snapshot.workspaceId
      && ($('#noteProject').value || null) === snapshot.projectId;
    noteDirty = !unchanged;
    setNoteSaveStatus(unchanged ? `Saved ${formatSaveTime(Date.now())}` : 'Unsaved changes', !unchanged);
    if (notify) showToast('Note saved.');
  } catch (error) {
    noteDirty = true;
    setNoteSaveStatus('Save failed', true);
    showToast(error.message || 'The note could not be saved.');
  }
}

function setNoteSaveStatus(message, dirty = false) {
  const status = $('#noteSaveStatus');
  status.textContent = message;
  status.classList.toggle('dirty', dirty);
}

function formatSaveTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderMarkdownHtml(source) {
  if (!source.trim()) return emptyState('Nothing to preview yet.');
  if (!window.marked || !window.DOMPurify) {
    return `<pre>${escapeHtml(source)}</pre>`;
  }
  try {
    const html = window.marked.parse(source, { gfm: true, breaks: false });
    const container = document.createElement('div');
    container.innerHTML = window.DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      SANITIZE_NAMED_PROPS: true,
      FORBID_TAGS: ['style'],
      FORBID_ATTR: ['style']
    });
    container.querySelectorAll('a').forEach((link) => {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });
    container.querySelectorAll('img').forEach((image) => { image.loading = 'lazy'; });
    container.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.disabled = true; });
    return container.innerHTML;
  } catch (_) {
    return `<pre>${escapeHtml(source)}</pre>`;
  }
}

function bindWorkspaces() {
  $('#workspaceForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = $('#workspaceName').value.trim();
    if (!name) return;
    const workspace = {
      id: createId('workspace'),
      name,
      color: '#E4002B',
      tabs: [],
      favorites: [],
      domains: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    $('#workspaceName').value = '';
    await save({ workspaces: [...state.workspaces, workspace], activeWorkspaceId: workspace.id });
  });
  $('#workspaceGrid').addEventListener('click', async (event) => {
    const action = event.target.closest('[data-workspace-action]');
    if (!action) return;
    const workspaceId = action.dataset.workspaceId;
    try {
      if (action.dataset.workspaceAction === 'activate') await save({ activeWorkspaceId: workspaceId });
      if (action.dataset.workspaceAction === 'capture') {
        const response = await send('captureWorkspace', { workspaceId });
        showToast(`${response.workspace.tabs.length} tabs saved.`);
        await loadState();
      }
      if (action.dataset.workspaceAction === 'open') {
        const response = await send('openWorkspace', { workspaceId });
        showToast(`${response.opened} tabs opened.`);
        await loadState();
      }
      if (action.dataset.workspaceAction === 'delete') await deleteWorkspace(workspaceId);
    } catch (error) {
      showToast(error.message);
    }
  });
  $('#workspaceDetail').addEventListener('submit', async (event) => {
    if (event.target.matches('#domainForm')) {
      event.preventDefault();
      const input = $('#domainInput');
      const domain = normalizeDomain(input.value);
      if (!isDomain(domain)) return showToast('Enter a valid domain such as example.com.');
      const workspaces = state.workspaces.map((workspace) => workspace.id === state.activeWorkspaceId
        ? { ...workspace, domains: Array.from(new Set([...workspace.domains, domain])), updatedAt: Date.now() }
        : workspace);
      input.value = '';
      await save({ workspaces });
      return;
    }

    if (event.target.matches('#favoriteForm')) {
      event.preventDefault();
      const url = normalizeHttpUrl($('#favoriteUrl').value);
      if (!url) return showToast('Enter a valid website URL.');
      const active = getWorkspace(state.activeWorkspaceId);
      if ((active.favorites || []).some((favorite) => favorite.url === url)) {
        return showToast('This website is already a favorite in the workspace.');
      }
      const favorite = {
        id: createId('favorite'),
        title: $('#favoriteTitle').value.trim() || hostnameFromUrl(url),
        url,
        createdAt: Date.now()
      };
      const workspaces = state.workspaces.map((workspace) => workspace.id === state.activeWorkspaceId
        ? { ...workspace, favorites: [...(workspace.favorites || []), favorite], updatedAt: Date.now() }
        : workspace);
      await save({ workspaces });
    }
  });
  $('#workspaceDetail').addEventListener('click', async (event) => {
    const projectButton = event.target.closest('[data-workspace-project]');
    if (projectButton) {
      selectedProjectId = projectButton.dataset.workspaceProject;
      projectViewMode = 'overview';
      showView('projects');
      renderProjects();
      return;
    }

    const openButton = event.target.closest('[data-open-url]');
    if (openButton) {
      const url = normalizeHttpUrl(openButton.dataset.openUrl);
      if (url) await chrome.tabs.create({ url });
      return;
    }

    const removeDomain = event.target.closest('[data-remove-domain]');
    const removeFavorite = event.target.closest('[data-remove-favorite]');
    const removeTab = event.target.closest('[data-remove-tab]');
    if (!removeDomain && !removeFavorite && !removeTab) return;

    const workspaces = state.workspaces.map((workspace) => {
      if (workspace.id !== state.activeWorkspaceId) return workspace;
      if (removeDomain) {
        return { ...workspace, domains: workspace.domains.filter((domain) => domain !== removeDomain.dataset.removeDomain) };
      }
      if (removeFavorite) {
        return { ...workspace, favorites: (workspace.favorites || []).filter((favorite) => favorite.id !== removeFavorite.dataset.removeFavorite) };
      }
      return { ...workspace, tabs: workspace.tabs.filter((_, index) => index !== Number(removeTab.dataset.removeTab)) };
    });
    await save({ workspaces });
  });
}

function renderWorkspaces() {
  $('#workspaceGrid').innerHTML = state.workspaces.map((workspace) => `
    <article class="workspace-card ${workspace.id === state.activeWorkspaceId ? 'active' : ''}">
      <h3>${escapeHtml(workspace.name)}</h3>
      <p>${state.projects.filter((project) => project.workspaceId === workspace.id && !project.archived).length} projects · ${(workspace.favorites || []).length} favorites · ${workspace.tabs.length} saved tabs · ${workspace.domains.length} allowed domains</p>
      <div class="workspace-actions">
        ${workspace.id === state.activeWorkspaceId ? '' : `<button class="button small secondary" data-workspace-action="activate" data-workspace-id="${workspace.id}">Use</button>`}
        <button class="button small secondary" data-workspace-action="capture" data-workspace-id="${workspace.id}">Save current tabs</button>
        <button class="button small primary" data-workspace-action="open" data-workspace-id="${workspace.id}" ${workspace.tabs.length ? '' : 'disabled'}>Open</button>
        ${state.workspaces.length > 1 ? `<button class="text-button" data-workspace-action="delete" data-workspace-id="${workspace.id}">Delete</button>` : ''}
      </div>
    </article>`).join('');

  const active = getWorkspace(state.activeWorkspaceId);
  const favorites = active.favorites || [];
  const projects = state.projects.filter((project) => project.workspaceId === active.id && !project.archived);
  $('#workspaceDetail').innerHTML = `
    <div class="workspace-detail-header"><div><span class="eyebrow">Active workspace</span><h2>${escapeHtml(active.name)}</h2></div><span>${favorites.length + active.tabs.length} links</span></div>
    <section class="allowlist-section">
      <div class="workspace-subheading"><h3>Focus allowlist</h3><span>${active.domains.length} domains</span></div>
      <form id="domainForm" class="domain-form"><input id="domainInput" type="text" placeholder="example.com" required><button class="button primary">Allow domain</button></form>
      <div class="domain-list">${active.domains.length ? active.domains.map((domain) => `<span class="domain-chip">${escapeHtml(domain)}<button data-remove-domain="${escapeHtml(domain)}" aria-label="Remove ${escapeHtml(domain)}">Remove</button></span>`).join('') : '<p class="workspace-empty">No allowed domains.</p>'}</div>
    </section>
    <section class="workspace-projects-section">
      <div class="workspace-subheading"><h3>Projects</h3><span>${projects.length}</span></div>
      <div class="workspace-project-links">${projects.length ? projects.map((project) => {
        const taskCount = state.tasks.filter((task) => task.projectId === project.id && !task.completed).length;
        return `<button data-workspace-project="${project.id}" type="button"><span style="background:${escapeHtml(project.color || '#E4002B')}"></span><strong>${escapeHtml(project.name)}</strong><small>${taskCount} open tasks</small></button>`;
      }).join('') : '<p class="workspace-empty">No active projects in this workspace.</p>'}</div>
    </section>
    <div class="workspace-assets">
      <section class="workspace-index-section">
        <div class="workspace-subheading"><h3>Favorites</h3><span>${favorites.length}</span></div>
        <form id="favoriteForm" class="favorite-form">
          <input id="favoriteTitle" type="text" maxlength="160" placeholder="Name (optional)">
          <input id="favoriteUrl" type="text" placeholder="https://example.com" required>
          <button class="button primary">Add favorite</button>
        </form>
        <div class="workspace-link-list">${favorites.length
          ? favorites.map((favorite, index) => workspaceLinkRow(favorite, index, 'favorite')).join('')
          : '<p class="workspace-empty">No favorites yet.</p>'}</div>
      </section>
      <section class="workspace-index-section saved-tabs-section">
        <div class="workspace-subheading"><h3>Saved tabs</h3><span>${active.tabs.length}</span></div>
        <div class="workspace-link-list">${active.tabs.length
          ? active.tabs.map((tab, index) => workspaceLinkRow(tab, index, 'tab')).join('')
          : '<p class="workspace-empty">Save the current tabs to build this list.</p>'}</div>
      </section>
    </div>`;
}

function workspaceLinkRow(link, index, type) {
  const removeAttribute = type === 'favorite'
    ? `data-remove-favorite="${escapeHtml(link.id)}"`
    : `data-remove-tab="${index}"`;
  return `<div class="workspace-link-row">
    <span class="workspace-link-index">${String(index + 1).padStart(2, '0')}</span>
    <button class="workspace-link-main" data-open-url="${escapeHtml(link.url)}" title="Open ${escapeHtml(link.title || hostnameFromUrl(link.url))}">
      <strong>${escapeHtml(link.title || hostnameFromUrl(link.url))}</strong>
      <span>${escapeHtml(hostnameFromUrl(link.url))}</span>
    </button>
    <button class="workspace-remove" ${removeAttribute}>Remove</button>
  </div>`;
}

async function deleteWorkspace(workspaceId) {
  if (!confirm('Delete this workspace? Its projects and groups will be removed; tasks and notes will move to another workspace.')) return;
  const workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
  const nextId = state.activeWorkspaceId === workspaceId ? workspaces[0].id : state.activeWorkspaceId;
  const removedProjectIds = new Set(state.projects.filter((project) => project.workspaceId === workspaceId).map((project) => project.id));
  const removedGroupIds = new Set(state.projectGroups.filter((group) => removedProjectIds.has(group.projectId)).map((group) => group.id));
  const projects = state.projects.filter((project) => !removedProjectIds.has(project.id));
  const projectGroups = state.projectGroups.filter((group) => !removedGroupIds.has(group.id));
  const tasks = state.tasks.map((task) => task.workspaceId === workspaceId ? {
    ...task,
    workspaceId: nextId,
    projectId: null,
    groupId: null,
    updatedAt: Date.now()
  } : task);
  const notes = state.notes.map((note) => note.workspaceId === workspaceId ? {
    ...note,
    workspaceId: nextId,
    projectId: null,
    updatedAt: Date.now()
  } : note);
  if (removedProjectIds.has(selectedProjectId)) selectedProjectId = null;
  await save({ workspaces, projects, projectGroups, tasks, notes, activeWorkspaceId: nextId });
}

function bindCalendar() {
  $('#calendarPreviousDay').addEventListener('click', () => stepCalendarDate(-1));
  $('#calendarNextDay').addEventListener('click', () => stepCalendarDate(1));
  $('#calendarToday').addEventListener('click', () => {
    selectedCalendarDate = todayKey();
    renderCalendar();
  });
  $('#calendarNewWorkBlock').addEventListener('click', () => openWorkBlockModal({
    dateKey: selectedCalendarDate,
    time: selectedCalendarDate === todayKey() ? nextRoundedTime() : state.settings.workdayStart
  }));
  $('#calendarNewReminder').addEventListener('click', () => openReminderModal({
    dateKey: selectedCalendarDate,
    time: selectedCalendarDate === todayKey() ? nextRoundedTime() : state.settings.workdayStart
  }));
  $('#calendarList').addEventListener('click', async (event) => {
    if (await handleReminderAction(event)) return;
    if (await handleWorkBlockAction(event, selectedCalendarDate)) return;
    const blockCard = event.target.closest('[data-work-block]');
    const reminderCard = event.target.closest('[data-reminder]');
    const eventCard = event.target.closest('[data-calendar-event]');
    const timeSlot = event.target.closest('[data-timeline-minute]');
    if (blockCard) {
      openWorkBlockModal({ dateKey: selectedCalendarDate, blockId: blockCard.dataset.workBlock });
    } else if (reminderCard) {
      openReminderModal({ reminderId: reminderCard.dataset.reminder });
    } else if (eventCard) {
      const calendarEvent = (state.calendarEvents || []).find((entry) => (
        `${entry.calendarId}:${entry.id}` === eventCard.dataset.calendarEvent
      ));
      if (calendarEvent && calendarEvent.htmlLink) window.open(calendarEvent.htmlLink, '_blank', 'noopener');
    } else if (timeSlot) {
      openWorkBlockModal({
        dateKey: selectedCalendarDate,
        time: minutesToTime(Number(timeSlot.dataset.timelineMinute))
      });
    }
  });
  $('#connectCalendar').addEventListener('click', () => connectGoogleCalendar($('#connectCalendar'), $('#calendarNotice')));
  $('#settingsConnectCalendar').addEventListener('click', () => connectGoogleCalendar($('#settingsConnectCalendar'), $('#settingsCalendarMessage')));
  $('#disconnectCalendar').addEventListener('click', () => disconnectGoogleCalendar($('#disconnectCalendar'), $('#calendarNotice')));
  $('#settingsDisconnectCalendar').addEventListener('click', () => disconnectGoogleCalendar($('#settingsDisconnectCalendar'), $('#settingsCalendarMessage')));
  $('#copyExtensionId').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.extensionId);
      $('#settingsCalendarMessage').textContent = 'Extension ID copied.';
    } catch (_) {
      showToast('Could not copy the extension ID.');
    }
  });
}

async function connectGoogleCalendar(button, messageElement) {
  button.disabled = true;
  setCalendarMessage(messageElement, 'Connecting...');
  try {
    await send('syncCalendars', { interactive: true });
    await loadState();
    setCalendarMessage(messageElement, 'Google Calendar connected and updated.');
    showToast('Calendar updated.');
  } catch (error) {
    setCalendarMessage(messageElement, error.message, true);
  } finally {
    button.disabled = !state.calendarConfigured;
  }
}

async function disconnectGoogleCalendar(button, messageElement) {
  button.disabled = true;
  try {
    await send('disconnectCalendar');
    await loadState();
    setCalendarMessage(messageElement, 'Google Calendar disconnected.');
  } catch (error) {
    setCalendarMessage(messageElement, error.message, true);
  } finally {
    button.disabled = false;
  }
}

function setCalendarMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('hidden', !message);
  element.classList.toggle('error', isError);
}

function renderCalendar() {
  $('#connectCalendar').textContent = state.calendarConnected ? 'Refresh events' : 'Connect Google Calendar';
  $('#disconnectCalendar').classList.toggle('hidden', !state.calendarConnected);
  renderCalendarSettings();
  const events = [...(state.calendarEvents || [])]
    .filter((event) => event.status !== 'cancelled' && calendarEventEndTime(event) >= Date.now())
    .sort((a, b) => calendarEventStartTime(a) - calendarEventStartTime(b));
  const reminders = (state.reminders || [])
    .filter((reminder) => reminder.status === 'scheduled' && reminderTimestamp(reminder) >= Date.now());
  const upcoming = [
    ...events.map((event) => ({
      at: calendarEventStartTime(event),
      time: formatEventTimeOnly(event.start),
      title: event.title,
      detail: formatEventDateLong(event.start)
    })),
    ...reminders.map((reminder) => ({
      at: reminderTimestamp(reminder),
      time: reminder.time,
      title: reminder.title,
      detail: `${formatEventDateLong(`${reminder.date}T${reminder.time}:00`)} · Reminder`
    }))
  ].sort((a, b) => a.at - b.at);
  selectedCalendarDate ||= todayKey();
  $('#calendarDateHeading').textContent = formatDayHeading(selectedCalendarDate);
  renderDayTimeline($('#calendarList'), selectedCalendarDate, { interactive: true });
  $('#calendarPreview').innerHTML = upcoming.length ? upcoming.slice(0, 3).map((item) => `
    <article class="compact-item"><time>${escapeHtml(item.time)}</time><span><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></span></article>`).join('') : emptyState(state.calendarConnected ? 'No upcoming events or reminders.' : 'No upcoming reminders. Calendar is not connected.');
}

function calendarEventStartTime(event) {
  if (!event || !event.start) return Number.MAX_SAFE_INTEGER;
  return new Date(event.start.length === 10 ? `${event.start}T00:00:00` : event.start).getTime();
}

function calendarEventEndTime(event) {
  const value = event && (event.end || event.start);
  if (!value) return 0;
  return new Date(value.length === 10 ? `${value}T23:59:59` : value).getTime();
}

function renderCalendarSettings() {
  const configured = Boolean(state.calendarConfigured);
  const connected = Boolean(state.calendarConnected);
  const account = state.calendarAccount || {};
  const events = state.calendarEvents || [];
  const status = $('#settingsCalendarState');
  status.textContent = !configured ? 'Setup required' : connected ? 'Connected' : 'Not connected';
  status.classList.toggle('connected', connected);
  status.classList.toggle('setup', !configured);
  $('#settingsCalendarAccount').textContent = connected && account.email ? account.email : 'Google account';
  $('#settingsCalendarDetail').textContent = !configured
    ? 'Add an OAuth client ID before connecting this unpacked extension.'
    : connected
      ? `Read and write access. ${events.length} event${events.length === 1 ? '' : 's'} loaded.`
      : 'No account connected.';
  $('#settingsConnectCalendar').textContent = connected ? 'Refresh calendar' : 'Connect Google';
  $('#settingsConnectCalendar').disabled = !configured;
  $('#settingsDisconnectCalendar').classList.toggle('hidden', !connected);
  $('#settingsCalendarSetup').classList.toggle('hidden', configured);
  $('#settingsExtensionId').textContent = state.extensionId || '';
  const writable = (state.calendarList || []).filter((calendar) => calendar.writable);
  $('#calendarDefaultId').innerHTML = writable.length
    ? writable.map((calendar) => `<option value="${escapeHtml(calendar.id)}">${escapeHtml(calendar.name)}${calendar.primary ? ' (primary)' : ''}</option>`).join('')
    : '<option value="primary">Primary calendar</option>';
  $('#calendarDefaultId').value = writable.some((calendar) => calendar.id === state.settings.calendarDefaultId)
    ? state.settings.calendarDefaultId
    : writable.find((calendar) => calendar.primary)?.id || 'primary';
}

function stepCalendarDate(amount) {
  selectedCalendarDate = dateKeyFromDate(addDays(new Date(`${selectedCalendarDate}T12:00:00`), amount));
  renderCalendar();
}

function bindObsidianRecall() {
  $('#nextObsidianRecall').addEventListener('click', chooseRandomObsidianRecall);
  $('#connectObsidianVault').addEventListener('click', connectObsidianVault);
  $('#refreshObsidianVault').addEventListener('click', async () => {
    if (!await ensureObsidianReadPermission(true)) {
      obsidianRecallState = 'permission';
      obsidianRecallMessage = 'Chrome needs permission to read this vault again.';
      renderObsidianRecall();
      renderObsidianSettings();
      return;
    }
    await scanObsidianVault(true);
  });
  $('#syncAllObsidianProjects').addEventListener('click', async () => {
    const settings = {
      ...state.settings,
      obsidianExportFolder: normalizeObsidianExportFolder($('#obsidianExportFolder').value),
      obsidianIncludeArchivedProjects: $('#obsidianIncludeArchivedProjects').checked
    };
    await chrome.storage.local.set({ settings });
    state.settings = settings;
    const projects = state.projects.filter((project) => (
      settings.obsidianIncludeArchivedProjects || !project.archived
    ));
    await syncProjectsToObsidian(projects.map((project) => project.id), {
      showToastOnSuccess: true
    });
  });
  $('#disconnectObsidianVault').addEventListener('click', disconnectObsidianVault);
}

async function initializeObsidianRecall() {
  if (!('showDirectoryPicker' in window)) {
    obsidianRecallState = 'unsupported';
    obsidianRecallMessage = 'This Chrome version does not support local folder access.';
    renderObsidianRecall();
    renderObsidianSettings();
    return;
  }

  try {
    obsidianVaultHandle = await getObsidianVaultHandle();
    if (!obsidianVaultHandle) {
      obsidianRecallState = 'disconnected';
      renderObsidianRecall();
      renderObsidianSettings();
      return;
    }
    if (!await ensureObsidianReadPermission(false)) {
      obsidianRecallState = 'permission';
      obsidianRecallMessage = 'Reconnect the vault to restore read access.';
      renderObsidianRecall();
      renderObsidianSettings();
      return;
    }
    await scanObsidianVault(false);
  } catch (error) {
    obsidianRecallState = 'error';
    obsidianRecallMessage = error.message || 'The Obsidian vault could not be opened.';
    renderObsidianRecall();
    renderObsidianSettings();
  }
}

async function connectObsidianVault() {
  if (!('showDirectoryPicker' in window)) {
    showToast('Local folder access is unavailable in this Chrome version.');
    return;
  }
  try {
    if (obsidianVaultHandle && obsidianRecallState === 'permission') {
      if (!await ensureObsidianReadPermission(true)) {
        obsidianRecallMessage = 'Chrome did not grant read access to this vault.';
        renderObsidianSettings();
        return;
      }
      await scanObsidianVault(true);
      return;
    }
    const options = { id: 'focus-desk-obsidian', mode: 'readwrite' };
    if (obsidianVaultHandle) options.startIn = obsidianVaultHandle;
    else options.startIn = 'documents';
    obsidianVaultHandle = await window.showDirectoryPicker(options);
    await saveObsidianVaultHandle(obsidianVaultHandle);
    await scanObsidianVault(true);
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    obsidianRecallState = 'error';
    obsidianRecallMessage = error.message || 'The selected vault could not be opened.';
    renderObsidianRecall();
    renderObsidianSettings();
  }
}

async function disconnectObsidianVault() {
  await removeObsidianVaultHandle();
  obsidianVaultHandle = null;
  obsidianRecallNotes = [];
  currentObsidianRecall = null;
  obsidianRecallState = 'disconnected';
  obsidianRecallMessage = '';
  obsidianSyncMessage = '';
  obsidianSyncError = false;
  renderObsidianRecall();
  renderObsidianSettings();
  showToast('Obsidian vault disconnected.');
}

async function ensureObsidianReadPermission(requestPermission) {
  return ensureObsidianPermission('read', requestPermission);
}

async function ensureObsidianPermission(mode, requestPermission) {
  if (!obsidianVaultHandle) return false;
  const options = { mode };
  if (!obsidianVaultHandle.queryPermission) return true;
  if (await obsidianVaultHandle.queryPermission(options) === 'granted') return true;
  return Boolean(requestPermission
    && obsidianVaultHandle.requestPermission
    && await obsidianVaultHandle.requestPermission(options) === 'granted');
}

async function syncProjectsToObsidian(projectIds, {
  showToastOnSuccess = false,
  force = false
} = {}) {
  if (obsidianSyncInProgress) return;
  if (!obsidianVaultHandle) {
    showToast('Connect an Obsidian vault in Settings first.');
    showView('settings');
    return;
  }
  obsidianSyncInProgress = true;
  obsidianSyncMessage = 'Requesting write access...';
  obsidianSyncError = false;
  renderObsidianSettings();
  renderProjects();

  try {
    if (!await ensureObsidianPermission('readwrite', true)) {
      throw new Error('Chrome needs read and write access to sync this vault.');
    }
    await flushPendingNoteSave();
    const records = { ...(state.obsidianSyncRecords || {}) };
    const failures = [];
    let synced = 0;

    for (const projectId of projectIds) {
      const project = getProject(projectId);
      if (!project) continue;
      obsidianSyncMessage = `Syncing ${project.name}...`;
      renderObsidianSettings();
      try {
        records[project.id] = await exportProjectToObsidian(project, records[project.id], { force });
        synced += 1;
      } catch (error) {
        records[project.id] = {
          ...(records[project.id] || {}),
          projectId: project.id,
          vaultName: obsidianVaultHandle.name,
          status: error.name === 'ObsidianSyncConflictError' ? 'conflict' : 'error',
          lastError: error.message,
          lastAttemptAt: Date.now()
        };
        failures.push({ project, error });
      }
    }

    await chrome.storage.local.set({ obsidianSyncRecords: records });
    state.obsidianSyncRecords = records;
    if (failures.length) {
      const conflictCount = failures.filter(({ error }) => error.name === 'ObsidianSyncConflictError').length;
      obsidianSyncError = true;
      obsidianSyncMessage = conflictCount
        ? `${synced} synced. ${conflictCount} project${conflictCount === 1 ? '' : 's'} need review because files changed in Obsidian.`
        : `${synced} synced. ${failures.length} project${failures.length === 1 ? '' : 's'} failed.`;
      showToast(obsidianSyncMessage);
    } else {
      obsidianSyncMessage = `${synced} project${synced === 1 ? '' : 's'} synced to ${normalizeObsidianExportFolder(state.settings.obsidianExportFolder)}.`;
      if (showToastOnSuccess) showToast(obsidianSyncMessage);
    }
    await scanObsidianVault(false);
  } catch (error) {
    obsidianSyncError = true;
    obsidianSyncMessage = error.message || 'Projects could not be synced to Obsidian.';
    showToast(obsidianSyncMessage);
  } finally {
    obsidianSyncInProgress = false;
    renderObsidianSettings();
    renderProjects();
  }
}

async function exportProjectToObsidian(project, previousRecord = null, { force = false } = {}) {
  const exportRoot = normalizeObsidianExportFolder(state.settings.obsidianExportFolder);
  const reusableRecord = previousRecord
    && previousRecord.vaultName === obsidianVaultHandle.name
    && previousRecord.exportRoot === exportRoot
    ? previousRecord
    : null;
  const projectNotes = state.notes
    .filter((note) => note.projectId === project.id)
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  const folderPath = reusableRecord && reusableRecord.folderPath
    || `${exportRoot}/Projects/${obsidianFileSegment(project.name, 'Project')}--${obsidianShortId(project.id)}`;
  const projectPath = `${folderPath}/Project.md`;
  const notePaths = { ...(reusableRecord && reusableRecord.notePaths || {}) };

  for (const note of projectNotes) {
    notePaths[note.id] ||= `${folderPath}/Notes/${obsidianFileSegment(note.title, 'Note')}--${obsidianShortId(note.id)}.md`;
  }

  const outputs = new Map();
  for (const note of projectNotes) {
    outputs.set(notePaths[note.id], projectNoteToObsidianMarkdown(project, note));
  }
  outputs.set(projectPath, projectToObsidianMarkdown(project, projectNotes, notePaths));

  // Inspect every target before writing any file so a conflict cannot produce a partial export.
  const prepared = [];
  const conflicts = [];
  for (const [path, content] of outputs) {
    const generatedHash = await hashObsidianText(content);
    const existing = await readObsidianFile(path);
    const previousHash = reusableRecord && reusableRecord.files
      && reusableRecord.files[path] && reusableRecord.files[path].hash;
    if (existing != null) {
      const existingHash = await hashObsidianText(existing);
      if (!force && existingHash !== generatedHash && (!previousHash || existingHash !== previousHash)) {
        conflicts.push(path);
        continue;
      }
      if (existingHash === generatedHash) {
        prepared.push({ path, content, hash: generatedHash, write: false });
        continue;
      }
    }
    prepared.push({ path, content, hash: generatedHash, write: true });
  }
  if (conflicts.length) {
    const error = new Error(`Obsidian changed ${conflicts.length} exported file${conflicts.length === 1 ? '' : 's'}. Focus Desk left them untouched.`);
    error.name = 'ObsidianSyncConflictError';
    error.paths = conflicts;
    throw error;
  }

  for (const file of prepared) {
    if (file.write) await writeObsidianFile(file.path, file.content);
  }

  const now = Date.now();
  const files = { ...(reusableRecord && reusableRecord.files || {}) };
  for (const file of prepared) {
    files[file.path] = { hash: file.hash, syncedAt: now };
  }
  return {
    projectId: project.id,
    vaultName: obsidianVaultHandle.name,
    exportRoot,
    folderPath,
    projectPath,
    notePaths,
    files,
    status: 'synced',
    lastError: '',
    lastSyncedAt: now,
    lastAttemptAt: now,
    sourceUpdatedAt: Math.max(
      Number(project.updatedAt) || 0,
      ...projectNotes.map((note) => Number(note.updatedAt) || 0)
    ),
    noteCount: projectNotes.length,
    linkCount: (project.links || []).length
  };
}

function projectToObsidianMarkdown(project, notes, notePaths) {
  const workspace = getWorkspace(project.workspaceId);
  const links = Array.isArray(project.links) ? project.links : [];
  const frontmatter = [
    '---',
    'focus_desk_type: project',
    `focus_desk_id: ${obsidianYamlString(project.id)}`,
    `title: ${obsidianYamlString(project.name)}`,
    `workspace: ${obsidianYamlString(workspace.name)}`,
    `status: ${obsidianYamlString(project.status || 'active')}`,
    `priority: ${obsidianYamlString(project.priority || 'medium')}`,
    ...(project.dueDate ? [`due: ${obsidianYamlString(project.dueDate)}`] : []),
    `updated: ${obsidianYamlString(new Date(Number(project.updatedAt) || Date.now()).toISOString())}`,
    'tags:',
    '  - focus-desk',
    '  - focus-desk-project',
    '---'
  ].join('\n');
  const sections = [
    frontmatter,
    `# ${obsidianMarkdownHeading(project.name)}`,
    project.outcome ? `## Outcome\n\n${project.outcome}` : '',
    project.description ? `## Context\n\n${project.description}` : '',
    `## Links\n\n${links.length
      ? links.map((link) => `- [${escapeObsidianLinkLabel(link.title || hostnameFromUrl(link.url))}](${link.url})`).join('\n')
      : '_No saved links._'}`,
    `## Notes\n\n${notes.length
      ? notes.map((note) => `- [[${notePaths[note.id].split('/').pop().replace(/\.md$/i, '')}|${escapeObsidianWikiLabel(note.title)}]]`).join('\n')
      : '_No project notes._'}`
  ];
  return `${sections.filter(Boolean).join('\n\n')}\n`;
}

function projectNoteToObsidianMarkdown(project, note) {
  const workspace = getWorkspace(note.workspaceId || project.workspaceId);
  const frontmatter = [
    '---',
    'focus_desk_type: note',
    `focus_desk_id: ${obsidianYamlString(note.id)}`,
    `project_id: ${obsidianYamlString(project.id)}`,
    `project: ${obsidianYamlString(project.name)}`,
    `workspace: ${obsidianYamlString(workspace.name)}`,
    `updated: ${obsidianYamlString(new Date(Number(note.updatedAt) || Date.now()).toISOString())}`,
    'tags:',
    '  - focus-desk',
    '  - focus-desk-note',
    '---'
  ].join('\n');
  return `${frontmatter}\n\n# ${obsidianMarkdownHeading(note.title)}\n\n${note.body || ''}\n`;
}

function normalizeObsidianExportFolder(value) {
  const segments = String(value || 'Focus Desk').split('/')
    .map((segment) => obsidianFileSegment(segment, ''))
    .filter(Boolean);
  return segments.length ? segments.slice(0, 6).join('/') : 'Focus Desk';
}

function obsidianFileSegment(value, fallback) {
  const segment = String(value || '').trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 100)
    .trim();
  return segment || fallback;
}

function obsidianShortId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(-12) || 'item';
}

function obsidianYamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function escapeObsidianLinkLabel(value) {
  return String(value || '').replace(/[\[\]]/g, '').replace(/\|/g, '-');
}

function escapeObsidianWikiLabel(value) {
  return String(value || '').replace(/[\[\]|]/g, '-');
}

function obsidianMarkdownHeading(value) {
  return String(value || 'Untitled').replace(/[\r\n]+/g, ' ').trim();
}

async function hashObsidianText(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function readObsidianFile(relativePath) {
  try {
    const handle = await getObsidianFileHandle(relativePath, false);
    return await (await handle.getFile()).text();
  } catch (error) {
    if (error && error.name === 'NotFoundError') return null;
    throw error;
  }
}

async function writeObsidianFile(relativePath, content) {
  const handle = await getObsidianFileHandle(relativePath, true);
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}

async function getObsidianFileHandle(relativePath, create) {
  const segments = String(relativePath).split('/').filter(Boolean);
  const filename = segments.pop();
  let directory = obsidianVaultHandle;
  for (const segment of segments) {
    directory = await directory.getDirectoryHandle(segment, { create });
  }
  return directory.getFileHandle(filename, { create });
}

async function scanObsidianVault(showFeedback) {
  if (!obsidianVaultHandle) return;
  obsidianRecallState = 'scanning';
  obsidianRecallMessage = 'Scanning Markdown notes...';
  renderObsidianRecall();
  renderObsidianSettings();

  try {
    const tag = normalizeObsidianTag(state.settings.obsidianRecallTag);
    const result = { files: 0, limited: false, notes: [] };
    await scanObsidianDirectory(obsidianVaultHandle, '', tag, result);
    obsidianRecallNotes = result.notes;
    obsidianRecallState = 'connected';
    obsidianRecallMessage = result.limited
      ? `Scanned the first ${OBSIDIAN_MAX_FILES} Markdown files.`
      : `${result.notes.length} note${result.notes.length === 1 ? '' : 's'} found with #${tag}.`;
    chooseRandomObsidianRecall();
    renderObsidianSettings();
    if (showFeedback) showToast(obsidianRecallMessage);
  } catch (error) {
    obsidianRecallNotes = [];
    currentObsidianRecall = null;
    obsidianRecallState = error && error.name === 'NotAllowedError' ? 'permission' : 'error';
    obsidianRecallMessage = error.message || 'The Obsidian vault could not be scanned.';
    renderObsidianRecall();
    renderObsidianSettings();
  }
}

async function scanObsidianDirectory(directory, relativePath, tag, result) {
  for await (const [name, handle] of directory.entries()) {
    if (result.files >= OBSIDIAN_MAX_FILES) {
      result.limited = true;
      return;
    }
    if (handle.kind === 'directory') {
      if (name.startsWith('.') || name === 'node_modules') continue;
      await scanObsidianDirectory(handle, relativePath ? `${relativePath}/${name}` : name, tag, result);
      if (result.limited) return;
      continue;
    }
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.md')) continue;

    result.files += 1;
    const file = await handle.getFile();
    if (file.size > OBSIDIAN_MAX_FILE_SIZE) continue;
    const source = await file.text();
    if (!noteHasObsidianTag(source, tag)) continue;
    const path = relativePath ? `${relativePath}/${name}` : name;
    result.notes.push(createObsidianRecallNote(source, name, path));
  }
}

function noteHasObsidianTag(source, tag) {
  const normalizedTag = normalizeObsidianTag(tag);
  const frontmatter = parseObsidianFrontmatter(source);
  if ((frontmatter.tags || []).some((item) => normalizeObsidianTag(item) === normalizedTag)) return true;
  const escapedTag = normalizedTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const searchableBody = frontmatter.body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\r\n]*`/g, '');
  return new RegExp(`(^|[\\s(])#${escapedTag}(?=$|[\\s.,!?;:)\\]])`, 'im').test(searchableBody);
}

function parseObsidianFrontmatter(source) {
  const match = String(source || '').match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { body: String(source || ''), tags: [], title: '' };
  const fields = { tags: [], title: '' };
  const lines = match[1].split(/\r?\n/);
  let collectingTags = false;

  for (const line of lines) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (field) {
      collectingTags = field[1].toLowerCase() === 'tags';
      if (field[1].toLowerCase() === 'title') fields.title = cleanYamlValue(field[2]);
      if (collectingTags && field[2]) fields.tags.push(...parseYamlTagValues(field[2]));
      continue;
    }
    if (collectingTags) {
      const item = line.match(/^\s*-\s*(.+)$/);
      if (item) fields.tags.push(cleanYamlValue(item[1]));
      else if (line.trim()) collectingTags = false;
    }
  }
  return { ...fields, body: String(source || '').slice(match[0].length) };
}

function parseYamlTagValues(value) {
  const unwrapped = String(value || '').trim().replace(/^\[/, '').replace(/\]$/, '');
  return unwrapped.split(',').map(cleanYamlValue).filter(Boolean);
}

function cleanYamlValue(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function createObsidianRecallNote(source, filename, path) {
  const frontmatter = parseObsidianFrontmatter(source);
  const heading = frontmatter.body.match(/^#\s+(.+)$/m);
  const title = frontmatter.title || (heading && heading[1].trim()) || filename.replace(/\.md$/i, '');
  const body = heading ? frontmatter.body.replace(heading[0], '').trim() : frontmatter.body.trim();
  return {
    title: title.slice(0, 180),
    body: body.slice(0, 12000),
    path
  };
}

function normalizeObsidianTag(value) {
  return String(value || 'recall').trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase() || 'recall';
}

function chooseRandomObsidianRecall() {
  if (!obsidianRecallNotes.length) {
    currentObsidianRecall = null;
    renderObsidianRecall();
    return;
  }
  const alternatives = obsidianRecallNotes.filter((note) => note !== currentObsidianRecall);
  const pool = alternatives.length ? alternatives : obsidianRecallNotes;
  currentObsidianRecall = pool[Math.floor(Math.random() * pool.length)];
  renderObsidianRecall();
}

function renderObsidianRecall() {
  const title = $('#obsidianRecallTitle');
  const content = $('#obsidianRecallContent');
  const source = $('#obsidianRecallSource');
  const nextButton = $('#nextObsidianRecall');
  if (!title || !content || !source || !nextButton) return;

  nextButton.disabled = obsidianRecallNotes.length < 2;
  if (currentObsidianRecall) {
    title.textContent = currentObsidianRecall.title;
    content.innerHTML = renderObsidianMarkdownHtml(currentObsidianRecall.body);
    source.textContent = `${currentObsidianRecall.path} · #${normalizeObsidianTag(state.settings.obsidianRecallTag)}`;
    source.classList.remove('hidden');
    return;
  }

  title.textContent = 'Random note';
  source.classList.add('hidden');
  if (obsidianRecallState === 'scanning') content.innerHTML = emptyState('Scanning the connected vault...');
  else if (obsidianRecallState === 'permission') content.innerHTML = emptyState('Reconnect the vault in Settings to restore read access.');
  else if (obsidianRecallState === 'connected') content.innerHTML = emptyState(`No Markdown notes use #${normalizeObsidianTag(state.settings.obsidianRecallTag)}.`);
  else if (obsidianRecallState === 'unsupported') content.innerHTML = emptyState('Local folder access is unavailable in this Chrome version.');
  else if (obsidianRecallState === 'error') content.innerHTML = emptyState(obsidianRecallMessage || 'The vault could not be read.');
  else content.innerHTML = emptyState('Connect an Obsidian vault in Settings to begin recall.');
}

function renderObsidianMarkdownHtml(source) {
  const container = document.createElement('div');
  container.innerHTML = renderMarkdownHtml(source);
  container.querySelectorAll('img').forEach((image) => image.remove());
  return container.innerHTML;
}

function renderObsidianSettings() {
  const status = $('#settingsObsidianState');
  if (!status) return;
  const connected = obsidianRecallState === 'connected' || obsidianRecallState === 'scanning';
  status.textContent = obsidianRecallState === 'unsupported'
    ? 'Unavailable'
    : obsidianRecallState === 'permission'
      ? 'Reconnect required'
      : connected
        ? obsidianRecallState === 'scanning' ? 'Scanning' : 'Connected'
        : obsidianRecallState === 'error' ? 'Connection error' : 'Not connected';
  status.classList.toggle('connected', connected);
  status.classList.toggle('setup', obsidianRecallState === 'permission' || obsidianRecallState === 'error');
  $('#settingsObsidianVault').textContent = obsidianVaultHandle ? obsidianVaultHandle.name : 'Obsidian vault';
  $('#settingsObsidianDetail').textContent = obsidianVaultHandle
    ? `${obsidianRecallNotes.length} matching note${obsidianRecallNotes.length === 1 ? '' : 's'}. Local read and write access.`
    : 'No vault connected.';
  $('#connectObsidianVault').textContent = obsidianRecallState === 'permission'
    ? 'Reconnect vault'
    : obsidianVaultHandle ? 'Change vault' : 'Choose vault';
  $('#connectObsidianVault').disabled = obsidianRecallState === 'unsupported' || obsidianRecallState === 'scanning';
  $('#disconnectObsidianVault').classList.toggle('hidden', !obsidianVaultHandle);
  $('#refreshObsidianVault').disabled = !obsidianVaultHandle || obsidianRecallState === 'scanning';
  $('#syncAllObsidianProjects').disabled = !obsidianVaultHandle || obsidianSyncInProgress;
  $('#syncAllObsidianProjects').textContent = obsidianSyncInProgress ? 'Syncing...' : 'Sync all projects';
  $('#obsidianSyncMessage').textContent = obsidianSyncMessage;
  $('#obsidianSyncMessage').classList.toggle('error', obsidianSyncError);
  $('#settingsObsidianMessage').textContent = obsidianRecallMessage;
}

function openObsidianDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OBSIDIAN_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBSIDIAN_HANDLE_STORE)) {
        request.result.createObjectStore(OBSIDIAN_HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open Obsidian connection storage.'));
  });
}

async function getObsidianVaultHandle() {
  const database = await openObsidianDatabase();
  const handle = await new Promise((resolve, reject) => {
    const request = database.transaction(OBSIDIAN_HANDLE_STORE, 'readonly').objectStore(OBSIDIAN_HANDLE_STORE).get(OBSIDIAN_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not restore the Obsidian vault.'));
  });
  database.close();
  return handle;
}

async function saveObsidianVaultHandle(handle) {
  const database = await openObsidianDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(OBSIDIAN_HANDLE_STORE, 'readwrite');
    transaction.objectStore(OBSIDIAN_HANDLE_STORE).put(handle, OBSIDIAN_HANDLE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not remember the Obsidian vault.'));
  });
  database.close();
}

async function removeObsidianVaultHandle() {
  const database = await openObsidianDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(OBSIDIAN_HANDLE_STORE, 'readwrite');
    transaction.objectStore(OBSIDIAN_HANDLE_STORE).delete(OBSIDIAN_HANDLE_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not remove the Obsidian connection.'));
  });
  database.close();
}

function bindSettings() {
  bindDashboardLayoutSettings();
  $('#momentOverlay').addEventListener('input', (event) => {
    $('#momentOverlayValue').textContent = `${event.target.value}%`;
  });
  $('#momentQuoteMode').addEventListener('change', toggleCustomQuoteFields);
  $$('input[name="colorMode"]').forEach((input) => input.addEventListener('change', (event) => {
    document.documentElement.dataset.theme = event.target.value;
  }));
  $$('input[name="palette"]').forEach((input) => input.addEventListener('change', (event) => {
    document.documentElement.dataset.palette = event.target.value;
  }));
  $('#saveSettings').addEventListener('click', async () => {
    const gateType = $('input[name="gateType"]:checked')?.value || 'hard';
    const palette = $('input[name="palette"]:checked')?.value || 'signal';
    const newTabMode = $('input[name="newTabMode"]:checked')?.value || 'dashboard';
    const nextImageSource = $('input[name="momentImageSource"]:checked')?.value || 'online';
    const momentSettingsBefore = JSON.stringify({
      source: state.settings.momentImageSource,
      quoteMode: state.settings.momentQuoteMode,
      quote: state.settings.momentCustomQuote,
      author: state.settings.momentCustomAuthor
    });
    const obsidianTagBefore = normalizeObsidianTag(state.settings.obsidianRecallTag);
    const settings = {
      ...state.settings,
      gateType,
      palette: ['signal', 'cobalt', 'forest', 'orange'].includes(palette) ? palette : 'signal',
      colorMode: ['system', 'light', 'dark'].includes($('input[name="colorMode"]:checked')?.value)
        ? $('input[name="colorMode"]:checked').value
        : 'system',
      unlockMinutes: clamp($('#unlockMinutes').value, 1, 60, 15),
      defaultFocusMinutes: clamp($('#defaultFocusMinutes').value, 1, 180, 25),
      workdayStart: validWorkTime($('#workdayStart').value) ? $('#workdayStart').value : '09:00',
      workdayEnd: validWorkTime($('#workdayEnd').value) ? $('#workdayEnd').value : '18:00',
      defaultTaskEstimateMinutes: clamp($('#defaultTaskEstimateMinutes').value, 5, 240, 45),
      calendarDefaultId: $('#calendarDefaultId').value || 'primary',
      calendarAutoSyncBlocks: $('#calendarAutoSyncBlocks').checked,
      calendarReminderEnabled: $('#calendarReminderEnabled').checked,
      calendarReminderMinutes: clamp($('#calendarReminderMinutes').value, 0, 120, 10),
      calendarDayStart: validWorkTime($('#calendarDayStart').value) ? $('#calendarDayStart').value : '07:00',
      calendarDayEnd: validWorkTime($('#calendarDayEnd').value) ? $('#calendarDayEnd').value : '21:00',
      autoStartBlocks: $('#autoStartBlocks').checked,
      autoOpenWorkspaceTabs: $('#autoOpenWorkspaceTabs').checked,
      autoStartGraceMinutes: clamp($('#autoStartGraceMinutes').value, 0, 60, 10),
      newTabMode: newTabMode === 'moment' ? 'moment' : 'dashboard',
      momentImageSource: nextImageSource === 'custom' ? 'custom' : 'online',
      momentLayout: $('#momentLayout').value === 'right' ? 'right' : 'left',
      momentClockFormat: $('#momentClockFormat').value === '12' ? '12' : '24',
      momentClockSize: $('#momentClockSize').value === 'compact' ? 'compact' : 'large',
      momentOverlay: clamp($('#momentOverlay').value, 0, 75, 42),
      momentShowQuote: $('#momentShowQuote').checked,
      momentShowDate: $('#momentShowDate').checked,
      momentShowFocus: $('#momentShowFocus').checked,
      momentShowSource: $('#momentShowSource').checked,
      momentQuoteMode: $('#momentQuoteMode').value === 'custom' ? 'custom' : 'random',
      momentCustomQuote: $('#momentCustomQuote').value.trim().slice(0, 360),
      momentCustomAuthor: $('#momentCustomAuthor').value.trim().slice(0, 120),
      obsidianRecallTag: normalizeObsidianTag($('#obsidianRecallTag').value),
      obsidianExportFolder: normalizeObsidianExportFolder($('#obsidianExportFolder').value),
      obsidianIncludeArchivedProjects: $('#obsidianIncludeArchivedProjects').checked
    };
    if (timeToMinutes(settings.workdayEnd) <= timeToMinutes(settings.workdayStart)) {
      settings.workdayStart = '09:00';
      settings.workdayEnd = '18:00';
    }
    if (timeToMinutes(settings.calendarDayEnd) <= timeToMinutes(settings.calendarDayStart)) {
      settings.calendarDayStart = '07:00';
      settings.calendarDayEnd = '21:00';
    }
    selectedFocusMinutes = settings.defaultFocusMinutes;
    const momentSettingsAfter = JSON.stringify({
      source: settings.momentImageSource,
      quoteMode: settings.momentQuoteMode,
      quote: settings.momentCustomQuote,
      author: settings.momentCustomAuthor
    });
    if (momentSettingsBefore !== momentSettingsAfter) {
      momentInitialized = false;
      $('#momentQuote').textContent = '';
      $('#momentQuoteAuthor').textContent = '';
      delete $('#momentQuote').dataset.mode;
    }
    await save({ settings });
    if (obsidianVaultHandle && obsidianTagBefore !== settings.obsidianRecallTag) {
      await scanObsidianVault(false);
    }
    $('#settingsStatus').textContent = 'Settings saved.';
    setTimeout(() => { $('#settingsStatus').textContent = ''; }, 1800);
  });
}

function renderSettings() {
  const gate = $(`input[name="gateType"][value="${state.settings.gateType}"]`);
  const palette = $(`input[name="palette"][value="${state.settings.palette}"]`);
  const colorMode = $(`input[name="colorMode"][value="${state.settings.colorMode || 'system'}"]`);
  if (gate) gate.checked = true;
  if (palette) palette.checked = true;
  if (colorMode) colorMode.checked = true;
  $('#unlockMinutes').value = state.settings.unlockMinutes;
  $('#defaultFocusMinutes').value = state.settings.defaultFocusMinutes;
  $('#workdayStart').value = state.settings.workdayStart || '09:00';
  $('#workdayEnd').value = state.settings.workdayEnd || '18:00';
  $('#defaultTaskEstimateMinutes').value = state.settings.defaultTaskEstimateMinutes || 45;
  $('#calendarAutoSyncBlocks').checked = state.settings.calendarAutoSyncBlocks !== false;
  $('#calendarReminderEnabled').checked = state.settings.calendarReminderEnabled !== false;
  $('#calendarReminderMinutes').value = state.settings.calendarReminderMinutes ?? 10;
  $('#calendarDayStart').value = state.settings.calendarDayStart || '07:00';
  $('#calendarDayEnd').value = state.settings.calendarDayEnd || '21:00';
  $('#autoStartBlocks').checked = state.settings.autoStartBlocks !== false;
  $('#autoOpenWorkspaceTabs').checked = Boolean(state.settings.autoOpenWorkspaceTabs);
  $('#autoStartGraceMinutes').value = state.settings.autoStartGraceMinutes ?? 10;
  const newTabMode = $(`input[name="newTabMode"][value="${state.settings.newTabMode}"]`);
  const imageSource = $(`input[name="momentImageSource"][value="${state.settings.momentImageSource}"]`);
  if (newTabMode) newTabMode.checked = true;
  if (imageSource) imageSource.checked = true;
  $('#momentLayout').value = state.settings.momentLayout;
  $('#momentClockSize').value = state.settings.momentClockSize;
  $('#momentClockFormat').value = state.settings.momentClockFormat;
  $('#momentOverlay').value = state.settings.momentOverlay;
  $('#momentOverlayValue').textContent = `${state.settings.momentOverlay}%`;
  $('#momentShowQuote').checked = state.settings.momentShowQuote;
  $('#momentShowDate').checked = state.settings.momentShowDate;
  $('#momentShowFocus').checked = state.settings.momentShowFocus;
  $('#momentShowSource').checked = state.settings.momentShowSource;
  $('#momentQuoteMode').value = state.settings.momentQuoteMode;
  $('#momentCustomQuote').value = state.settings.momentCustomQuote;
  $('#momentCustomAuthor').value = state.settings.momentCustomAuthor;
  if (document.activeElement !== $('#obsidianRecallTag')) {
    $('#obsidianRecallTag').value = normalizeObsidianTag(state.settings.obsidianRecallTag);
  }
  if (document.activeElement !== $('#obsidianExportFolder')) {
    $('#obsidianExportFolder').value = normalizeObsidianExportFolder(state.settings.obsidianExportFolder);
  }
  $('#obsidianIncludeArchivedProjects').checked = Boolean(state.settings.obsidianIncludeArchivedProjects);
  renderDashboardWidgetList();
  renderDashboardBackgroundSettings();
  toggleCustomQuoteFields();
  updateMomentImageStatus();
  renderObsidianSettings();
}

function toggleCustomQuoteFields() {
  $('#customQuoteFields').classList.toggle('hidden', $('#momentQuoteMode').value !== 'custom');
}

function applyPalette() {
  const palette = ['signal', 'cobalt', 'forest', 'orange'].includes(state.settings.palette)
    ? state.settings.palette
    : 'signal';
  const colorMode = ['system', 'light', 'dark'].includes(state.settings.colorMode)
    ? state.settings.colorMode
    : 'system';
  document.documentElement.dataset.palette = palette;
  document.documentElement.dataset.theme = colorMode;
}

function applyDashboardLayout() {
  const widgets = dashboardWidgets();
  const lanes = new Map(DASHBOARD_LANES.map((lane) => [lane, $(`[data-lane="${lane}"]`)]));
  const desired = new Map(DASHBOARD_LANES.map((lane) => [lane, []]));
  for (const widget of widgets) {
    const element = $(`[data-widget="${widget.id}"]`);
    if (!element) continue;
    element.classList.toggle('hidden', !widget.visible);
    (desired.get(widget.lane) || desired.get('main')).push(element);
  }

  // Rendering happens on every storage broadcast, so only touch the DOM when the
  // arrangement really changed - moving a node blurs whatever is focused inside it.
  const rearranged = DASHBOARD_LANES.some((name) => {
    const lane = lanes.get(name);
    if (!lane) return false;
    const wanted = desired.get(name);
    const current = Array.from(lane.children);
    return current.length !== wanted.length || current.some((child, index) => child !== wanted[index]);
  });
  if (rearranged) {
    for (const [name, lane] of lanes) {
      if (lane) desired.get(name).forEach((element) => lane.appendChild(element));
    }
  }

  for (const [name, lane] of lanes) {
    if (!lane) continue;
    const laneHasCards = desired.get(name).some((element) => !element.classList.contains('hidden'));
    // While editing, an empty lane stays on screen as a drop target.
    lane.classList.toggle('hidden', !laneHasCards && !dashboardEditing);
    lane.classList.toggle('lane-empty', !laneHasCards);
  }
  const grid = $('#dashboardGrid');
  if (grid) {
    grid.classList.toggle('single-column', $('#dashboardSide').classList.contains('hidden')
      || $('#dashboardMain').classList.contains('hidden'));
    grid.classList.toggle('hidden', $('#dashboardSide').classList.contains('hidden')
      && $('#dashboardMain').classList.contains('hidden'));
  }
  const taskBank = $('[data-widget-part="taskBank"]');
  if (taskBank) taskBank.classList.toggle('hidden', state.settings.dashboardShowTaskBank === false);
  $('#dashboardEmptyState').classList.toggle('hidden', dashboardEditing || widgets.some((widget) => widget.visible));
  renderDashboardEditor();
}

function bindDashboardEditor() {
  $('#toggleDashboardEditing').addEventListener('click', () => setDashboardEditing(!dashboardEditing));

  $('#dashboardResetLayout').addEventListener('click', async () => {
    await save({
      settings: {
        ...state.settings,
        dashboardWidgets: DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })),
        dashboardShowTaskBank: true
      }
    });
    showToast('Start page layout reset.');
  });

  $('#dashboardEditTaskBank').addEventListener('change', async (event) => {
    await save({ settings: { ...state.settings, dashboardShowTaskBank: event.target.checked } });
  });

  $('#dashboardEditBackground').addEventListener('change', async (event) => {
    dashboardBackgroundLoaded = false;
    await save({ settings: { ...state.settings, dashboardBackground: event.target.checked ? 'library' : 'none' } });
  });

  $('#dashboardEditOverlay').addEventListener('input', (event) => {
    $('#dashboardEditOverlayValue').textContent = `${event.target.value}%`;
    document.documentElement.style.setProperty('--dashboard-overlay', clamp(event.target.value, 0, 90, 55) / 100);
  });
  $('#dashboardEditOverlay').addEventListener('change', async (event) => {
    await save({ settings: { ...state.settings, dashboardOverlay: clamp(event.target.value, 0, 90, 55) } });
  });

  $('#dashboardEditTransparency').addEventListener('input', (event) => {
    $('#dashboardEditTransparencyValue').textContent = `${event.target.value}%`;
    setDashboardPanelTransparency(event.target.value);
  });
  $('#dashboardEditTransparency').addEventListener('change', async (event) => {
    await save({ settings: { ...state.settings, dashboardPanelTransparency: clamp(event.target.value, 0, 85, 30) } });
  });

  $('#dashboardEditNewPhoto').addEventListener('click', async () => {
    dashboardBackgroundLoaded = false;
    await refreshDashboardBackground();
  });

  $('#dashboardHiddenCards').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-widget-show]');
    if (!button) return;
    await saveDashboardWidgets(dashboardWidgets().map((widget) => (widget.id === button.dataset.widgetShow
      ? { ...widget, visible: true }
      : widget)));
  });

  const view = $('#todayView');

  view.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-widget-hide]');
    if (!button) return;
    await saveDashboardWidgets(dashboardWidgets().map((widget) => (widget.id === button.dataset.widgetHide
      ? { ...widget, visible: false }
      : widget)));
  });

  view.addEventListener('dragstart', (event) => {
    if (!dashboardEditing) return;
    const card = event.target.closest('[data-widget]');
    if (!card) return;
    draggedDashboardCard = card.dataset.widget;
    card.classList.add('card-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedDashboardCard);
  });

  view.addEventListener('dragend', () => {
    draggedDashboardCard = null;
    clearDashboardDropHints();
  });

  view.addEventListener('dragover', (event) => {
    if (!dashboardEditing || !draggedDashboardCard) return;
    const lane = event.target.closest('[data-lane]');
    if (!lane) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    clearDashboardDropHints();
    const card = event.target.closest('[data-widget]');
    if (card && card.dataset.widget !== draggedDashboardCard) card.classList.add('drop-before');
    else if (!card) lane.classList.add('drop-into');
  });

  view.addEventListener('drop', async (event) => {
    if (!dashboardEditing || !draggedDashboardCard) return;
    const lane = event.target.closest('[data-lane]');
    if (!lane) return;
    event.preventDefault();
    const card = event.target.closest('[data-widget]');
    const movedId = draggedDashboardCard;
    draggedDashboardCard = null;
    clearDashboardDropHints();
    await moveDashboardCard(movedId, lane.dataset.lane, card && card.dataset.widget);
  });
}

function clearDashboardDropHints() {
  $$('.card-dragging').forEach((element) => element.classList.remove('card-dragging'));
  $$('.drop-before').forEach((element) => element.classList.remove('drop-before'));
  $$('.drop-into').forEach((element) => element.classList.remove('drop-into'));
}

async function moveDashboardCard(movedId, lane, beforeId) {
  if (!DASHBOARD_LANES.includes(lane) || movedId === beforeId) return;
  const widgets = dashboardWidgets();
  const from = widgets.findIndex((widget) => widget.id === movedId);
  if (from < 0) return;
  const [moved] = widgets.splice(from, 1);
  moved.lane = lane;
  moved.visible = true;

  let index;
  if (beforeId) {
    index = widgets.findIndex((widget) => widget.id === beforeId);
  } else {
    // Dropped on empty lane space: park the card after the last card already there.
    const lastInLane = widgets.map((widget) => widget.lane).lastIndexOf(lane);
    index = lastInLane < 0 ? widgets.length : lastInLane + 1;
  }
  widgets.splice(index < 0 ? widgets.length : index, 0, moved);
  await saveDashboardWidgets(widgets);
}

function setDashboardEditing(editing) {
  dashboardEditing = Boolean(editing);
  if (dashboardEditing) showView('today');
  render();
}

function renderDashboardEditor() {
  const toggle = $('#toggleDashboardEditing');
  toggle.textContent = dashboardEditing ? 'Done editing' : 'Customize';
  toggle.setAttribute('aria-pressed', String(dashboardEditing));
  toggle.classList.toggle('primary', dashboardEditing);
  toggle.classList.toggle('secondary', !dashboardEditing);
  toggle.classList.toggle('hidden', !$('#todayView').classList.contains('active'));
  $('#dashboardEditor').classList.toggle('hidden', !dashboardEditing);
  document.body.classList.toggle('dashboard-editing', dashboardEditing);
  if (!dashboardEditing) {
    clearDashboardDropHints();
    $$('.widget-edit-bar').forEach((bar) => bar.remove());
    $$('[data-widget]').forEach((card) => card.removeAttribute('draggable'));
    return;
  }

  const widgets = dashboardWidgets();
  for (const widget of widgets) {
    const card = $(`[data-widget="${widget.id}"]`);
    if (!card) continue;
    if (!widget.visible) {
      // Off the board and represented by the tray instead, so it needs no chrome.
      card.querySelector(':scope > .widget-edit-bar')?.remove();
      card.removeAttribute('draggable');
      continue;
    }
    card.setAttribute('draggable', 'true');
    let bar = card.querySelector(':scope > .widget-edit-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'widget-edit-bar';
      // Absolutely positioned, so it never becomes a grid or flex item of the card.
      card.appendChild(bar);
    }
    bar.innerHTML = `
      <span class="widget-edit-title"><span aria-hidden="true">⠿</span> ${escapeHtml(DASHBOARD_WIDGET_META[widget.id].title)}</span>
      <span class="widget-edit-lane">${DASHBOARD_LANE_LABELS[widget.lane]}</span>
      <button type="button" data-widget-hide="${widget.id}">Hide</button>`;
  }

  const hidden = widgets.filter((widget) => !widget.visible);
  $('#dashboardHiddenTray').classList.toggle('hidden', !hidden.length);
  $('#dashboardHiddenCards').innerHTML = hidden.map((widget) => `
    <button class="button secondary small" type="button" data-widget-show="${widget.id}">${escapeHtml(DASHBOARD_WIDGET_META[widget.id].title)} +</button>
  `).join('');

  $('#dashboardEditTaskBank').checked = state.settings.dashboardShowTaskBank !== false;
  const usesPhoto = state.settings.dashboardBackground === 'library';
  $('#dashboardEditBackground').checked = usesPhoto;
  $('#dashboardEditSliders').classList.toggle('hidden', !usesPhoto);
  const overlay = clamp(state.settings.dashboardOverlay, 0, 90, 55);
  const transparency = clamp(state.settings.dashboardPanelTransparency, 0, 85, 30);
  $('#dashboardEditOverlay').value = overlay;
  $('#dashboardEditOverlayValue').textContent = `${overlay}%`;
  $('#dashboardEditTransparency').value = transparency;
  $('#dashboardEditTransparencyValue').textContent = `${transparency}%`;
  $('#dashboardEditPhotoStatus').textContent = dashboardPhotoStatus;
}

function dashboardWidgets() {
  const stored = Array.isArray(state.settings.dashboardWidgets) ? state.settings.dashboardWidgets : [];
  const widgets = [];
  const seen = new Set();
  for (const entry of stored) {
    const id = entry && typeof entry === 'object' ? entry.id : entry;
    const fallback = DEFAULT_DASHBOARD_WIDGETS.find((widget) => widget.id === id);
    if (!fallback || seen.has(id)) continue;
    seen.add(id);
    widgets.push({
      id,
      lane: DASHBOARD_LANES.includes(entry && entry.lane) ? entry.lane : fallback.lane,
      visible: !(entry && entry.visible === false)
    });
  }
  for (const fallback of DEFAULT_DASHBOARD_WIDGETS) {
    if (!seen.has(fallback.id)) widgets.push({ ...fallback });
  }
  return widgets;
}

async function saveDashboardWidgets(widgets, focusKey = '') {
  // A storage write echoes back as a stateUpdate broadcast, so the list renders
  // twice. Keep the focus target alive for both renders, then let it expire.
  pendingWidgetFocus = focusKey ? { key: focusKey, until: Date.now() + 800 } : null;
  await save({ settings: { ...state.settings, dashboardWidgets: widgets } });
}

function renderDashboardWidgetList() {
  const list = $('#dashboardWidgetList');
  if (!list) return;
  const widgets = dashboardWidgets();
  list.innerHTML = widgets.map((widget, index) => {
    const meta = DASHBOARD_WIDGET_META[widget.id];
    const laneOptions = DASHBOARD_LANES
      .map((lane) => `<option value="${lane}"${lane === widget.lane ? ' selected' : ''}>${DASHBOARD_LANE_LABELS[lane]}</option>`)
      .join('');
    return `
      <li class="widget-row${widget.visible ? '' : ' widget-hidden'}" draggable="true" data-widget-id="${widget.id}">
        <span class="widget-handle" aria-hidden="true">⠿</span>
        <label class="widget-toggle">
          <input type="checkbox" data-widget-visible="${widget.id}"${widget.visible ? ' checked' : ''}>
          <span><strong>${escapeHtml(meta.title)}</strong>${escapeHtml(meta.description)}</span>
        </label>
        <select class="widget-lane" data-widget-lane="${widget.id}" aria-label="Column for ${escapeHtml(meta.title)}">${laneOptions}</select>
        <span class="widget-move">
          <button type="button" data-widget-move="up" data-widget-id="${widget.id}" aria-label="Move ${escapeHtml(meta.title)} up"${index === 0 ? ' disabled' : ''}>↑</button>
          <button type="button" data-widget-move="down" data-widget-id="${widget.id}" aria-label="Move ${escapeHtml(meta.title)} down"${index === widgets.length - 1 ? ' disabled' : ''}>↓</button>
        </span>
      </li>`;
  }).join('');
  $('#dashboardShowTaskBank').checked = state.settings.dashboardShowTaskBank !== false;
  restoreWidgetFocus();
}

function restoreWidgetFocus() {
  if (!pendingWidgetFocus) return;
  if (Date.now() > pendingWidgetFocus.until) {
    pendingWidgetFocus = null;
    return;
  }
  const [widgetId, direction] = pendingWidgetFocus.key.split(':');
  const target = $(`[data-widget-move="${direction}"][data-widget-id="${widgetId}"]`);
  if (target && !target.disabled) target.focus();
  else $(`[data-widget-id="${widgetId}"] [data-widget-move]:not(:disabled)`)?.focus();
}

function bindDashboardLayoutSettings() {
  bindDashboardEditor();
  const list = $('#dashboardWidgetList');
  if (!list) return;

  list.addEventListener('change', async (event) => {
    const visibleId = event.target.dataset.widgetVisible;
    if (visibleId) {
      await saveDashboardWidgets(dashboardWidgets().map((widget) => (widget.id === visibleId
        ? { ...widget, visible: event.target.checked }
        : widget)));
      return;
    }
    const laneId = event.target.dataset.widgetLane;
    if (laneId) {
      const lane = DASHBOARD_LANES.includes(event.target.value) ? event.target.value : 'main';
      await saveDashboardWidgets(dashboardWidgets().map((widget) => (widget.id === laneId
        ? { ...widget, lane }
        : widget)));
    }
  });

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-widget-move]');
    if (!button) return;
    const widgets = dashboardWidgets();
    const index = widgets.findIndex((widget) => widget.id === button.dataset.widgetId);
    const target = button.dataset.widgetMove === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= widgets.length) return;
    [widgets[index], widgets[target]] = [widgets[target], widgets[index]];
    await saveDashboardWidgets(widgets, `${button.dataset.widgetId}:${button.dataset.widgetMove}`);
  });

  list.addEventListener('dragstart', (event) => {
    const row = event.target.closest('[data-widget-id]');
    if (!row) return;
    draggedWidgetId = row.dataset.widgetId;
    row.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedWidgetId);
  });

  list.addEventListener('dragend', () => {
    draggedWidgetId = null;
    $$('.widget-row').forEach((row) => row.classList.remove('dragging', 'drop-target'));
  });

  list.addEventListener('dragover', (event) => {
    if (!draggedWidgetId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const row = event.target.closest('[data-widget-id]');
    $$('.widget-row').forEach((item) => item.classList.toggle('drop-target', item === row && item.dataset.widgetId !== draggedWidgetId));
  });

  list.addEventListener('drop', async (event) => {
    if (!draggedWidgetId) return;
    event.preventDefault();
    const row = event.target.closest('[data-widget-id]');
    const widgets = dashboardWidgets();
    const from = widgets.findIndex((widget) => widget.id === draggedWidgetId);
    const to = row ? widgets.findIndex((widget) => widget.id === row.dataset.widgetId) : widgets.length - 1;
    draggedWidgetId = null;
    if (from < 0 || to < 0 || from === to) return renderDashboardWidgetList();
    const [moved] = widgets.splice(from, 1);
    widgets.splice(to, 0, moved);
    await saveDashboardWidgets(widgets);
  });

  $('#dashboardShowTaskBank').addEventListener('change', async (event) => {
    await save({ settings: { ...state.settings, dashboardShowTaskBank: event.target.checked } });
  });

  $('#resetDashboardLayout').addEventListener('click', async () => {
    await save({
      settings: {
        ...state.settings,
        dashboardWidgets: DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })),
        dashboardShowTaskBank: true
      }
    });
    showToast('Start page layout reset.');
  });

  $$('input[name="dashboardBackground"]').forEach((input) => input.addEventListener('change', async (event) => {
    dashboardBackgroundLoaded = false;
    await save({ settings: { ...state.settings, dashboardBackground: event.target.value === 'library' ? 'library' : 'none' } });
  }));

  $('#dashboardOverlay').addEventListener('input', (event) => {
    $('#dashboardOverlayValue').textContent = `${event.target.value}%`;
    document.documentElement.style.setProperty('--dashboard-overlay', clamp(event.target.value, 0, 90, 55) / 100);
  });

  $('#dashboardOverlay').addEventListener('change', async (event) => {
    await save({ settings: { ...state.settings, dashboardOverlay: clamp(event.target.value, 0, 90, 55) } });
  });

  $('#dashboardPanelTransparency').addEventListener('input', (event) => {
    $('#dashboardPanelTransparencyValue').textContent = `${event.target.value}%`;
    setDashboardPanelTransparency(event.target.value);
  });

  $('#dashboardPanelTransparency').addEventListener('change', async (event) => {
    await save({ settings: { ...state.settings, dashboardPanelTransparency: clamp(event.target.value, 0, 85, 30) } });
  });

  $('#dashboardNewBackground').addEventListener('click', async () => {
    dashboardBackgroundLoaded = false;
    await refreshDashboardBackground();
  });
}

function renderDashboardBackgroundSettings() {
  const source = $(`input[name="dashboardBackground"][value="${state.settings.dashboardBackground === 'library' ? 'library' : 'none'}"]`);
  if (source) source.checked = true;
  const overlay = clamp(state.settings.dashboardOverlay, 0, 90, 55);
  $('#dashboardOverlay').value = overlay;
  $('#dashboardOverlayValue').textContent = `${overlay}%`;
  const transparency = clamp(state.settings.dashboardPanelTransparency, 0, 85, 30);
  $('#dashboardPanelTransparency').value = transparency;
  $('#dashboardPanelTransparencyValue').textContent = `${transparency}%`;
  $('#dashboardBackgroundOptions').classList.toggle('hidden', state.settings.dashboardBackground !== 'library');
}

function applyDashboardBackground() {
  document.documentElement.style.setProperty('--dashboard-overlay', clamp(state.settings.dashboardOverlay, 0, 90, 55) / 100);
  setDashboardPanelTransparency(state.settings.dashboardPanelTransparency);
  if (state.settings.dashboardBackground !== 'library') {
    dashboardBackgroundLoaded = false;
    clearDashboardBackground();
    return;
  }
  if (!dashboardBackgroundLoaded) {
    refreshDashboardBackground().catch((error) => showToast(error.message));
    return;
  }
  const hasImage = Boolean(dashboardObjectUrl);
  document.body.classList.toggle('dashboard-has-background', hasImage);
  $('#dashboardBackdrop').classList.toggle('hidden', !hasImage);
}

async function refreshDashboardBackground() {
  dashboardBackgroundLoaded = true;
  let image = null;
  try {
    image = await getRandomMomentImage();
  } catch (_) {
    setDashboardPhotoStatus('Personal image storage is unavailable.');
    return;
  }
  if (!image) {
    clearDashboardBackground();
    setDashboardPhotoStatus('No personal images saved yet. Add images under Moment screen to use them here.');
    return;
  }
  const count = await countMomentImages();
  setDashboardPhotoStatus(`Showing a random photo from ${count} saved image${count === 1 ? '' : 's'}.`);
  if (dashboardObjectUrl) URL.revokeObjectURL(dashboardObjectUrl);
  dashboardObjectUrl = URL.createObjectURL(image.blob);
  const backdropImage = $('#dashboardBackdropImage');
  backdropImage.onerror = () => clearDashboardBackground();
  backdropImage.src = dashboardObjectUrl;
  $('#dashboardBackdrop').classList.remove('hidden');
  document.body.classList.add('dashboard-has-background');
}

function setDashboardPhotoStatus(message) {
  dashboardPhotoStatus = message;
  const settingsStatus = $('#dashboardBackgroundStatus');
  if (settingsStatus) settingsStatus.textContent = message;
  const editorStatus = $('#dashboardEditPhotoStatus');
  if (editorStatus) editorStatus.textContent = message;
}

function setDashboardPanelTransparency(value) {
  // Stored as transparency so the slider reads the way the label does; CSS wants
  // the opaque share for color-mix.
  const transparency = clamp(value, 0, 85, 30);
  document.documentElement.style.setProperty('--dashboard-panel-opacity', `${100 - transparency}%`);
}

function clearDashboardBackground() {
  if (dashboardObjectUrl) {
    URL.revokeObjectURL(dashboardObjectUrl);
    dashboardObjectUrl = null;
  }
  $('#dashboardBackdropImage').removeAttribute('src');
  $('#dashboardBackdrop').classList.add('hidden');
  document.body.classList.remove('dashboard-has-background');
}

function bindMomentMode() {
  $('#returnDashboard').addEventListener('click', () => setNewTabMode('dashboard'));
  $('#momentNewBackground').addEventListener('click', async () => {
    momentInitialized = false;
    await refreshMomentExperience();
  });
  $('#momentImages').addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    try {
      const saved = await saveMomentImages(files);
      const settings = { ...state.settings, momentImageSource: 'custom' };
      momentInitialized = false;
      event.target.value = '';
      await save({ settings });
      await updateMomentImageStatus();
      showToast(`${saved} image${saved === 1 ? '' : 's'} added.`);
    } catch (error) {
      showToast(error.message);
    }
  });
  $('#removeMomentImages').addEventListener('click', async () => {
    const count = await countMomentImages();
    if (!count || !confirm('Remove all personal background images?')) return;
    await clearMomentImages();
    momentInitialized = false;
    await updateMomentImageStatus();
    if (state.settings.newTabMode === 'moment') await refreshMomentExperience();
  });
}

async function setNewTabMode(mode) {
  if (!state) return;
  const settings = { ...state.settings, newTabMode: mode === 'moment' ? 'moment' : 'dashboard' };
  await save({ settings });
  if (settings.newTabMode === 'dashboard' && obsidianRecallNotes.length) chooseRandomObsidianRecall();
}

function renderMomentMode() {
  const isMoment = state.settings.newTabMode === 'moment';
  applyMomentConfiguration();
  $('.app-shell').classList.toggle('hidden', isMoment);
  $('#momentScreen').classList.toggle('hidden', !isMoment);
  document.body.classList.toggle('moment-active', isMoment);
  if (isMoment && (!momentInitialized || momentImageSource !== state.settings.momentImageSource)) {
    refreshMomentExperience().catch((error) => showToast(error.message));
  }
}

function applyMomentConfiguration() {
  const screen = $('#momentScreen');
  screen.classList.toggle('layout-right', state.settings.momentLayout === 'right');
  screen.classList.toggle('clock-compact', state.settings.momentClockSize === 'compact');
  screen.style.setProperty('--moment-overlay', clamp(state.settings.momentOverlay, 0, 75, 42) / 100);
  $('.moment-quote').classList.toggle('hidden', !state.settings.momentShowQuote);
  $('#momentDate').classList.toggle('hidden', !state.settings.momentShowDate);
  $('.moment-focus').classList.toggle('hidden', !state.settings.momentShowFocus);
  $('#momentImageSourceLabel').classList.toggle('hidden', !state.settings.momentShowSource);
  renderMomentQuote();
}

function renderMomentQuote() {
  const quoteElement = $('#momentQuote');
  const authorElement = $('#momentQuoteAuthor');
  const useCustom = state.settings.momentQuoteMode === 'custom' && state.settings.momentCustomQuote.trim();
  if (useCustom) {
    quoteElement.textContent = state.settings.momentCustomQuote;
    authorElement.textContent = state.settings.momentCustomAuthor;
    quoteElement.dataset.mode = 'custom';
    return;
  }
  if (quoteElement.dataset.mode !== 'random' || !quoteElement.textContent) {
    const quote = MOMENT_QUOTES[Math.floor(Math.random() * MOMENT_QUOTES.length)];
    quoteElement.textContent = quote.text;
    authorElement.textContent = quote.author;
    quoteElement.dataset.mode = 'random';
  }
}

async function refreshMomentExperience() {
  if (!state) return;
  momentInitialized = true;
  momentImageSource = state.settings.momentImageSource;
  renderMomentQuote();

  if (state.settings.momentImageSource === 'custom') {
    const image = await getRandomMomentImage();
    if (image) {
      const url = URL.createObjectURL(image.blob);
      showMomentImage(url, 'Your image library', true);
      return;
    }
    showMomentImage(createOnlineImageUrl(), 'Online photo · no personal images saved', false);
    return;
  }
  showMomentImage(createOnlineImageUrl(), 'Online photo via Lorem Picsum', false);
}

function showMomentImage(url, label, isObjectUrl) {
  if (momentObjectUrl) {
    URL.revokeObjectURL(momentObjectUrl);
    momentObjectUrl = null;
  }
  if (isObjectUrl) momentObjectUrl = url;
  const image = $('#momentImage');
  image.classList.remove('loaded');
  image.onload = () => image.classList.add('loaded');
  image.onerror = () => {
    image.classList.remove('loaded');
    if (isObjectUrl) {
      showMomentImage(createOnlineImageUrl(), 'Online photo · personal image could not be opened', false);
    } else {
      $('#momentImageSourceLabel').textContent = 'Online image unavailable';
    }
  };
  image.src = url;
  $('#momentImageSourceLabel').textContent = label;
}

function createOnlineImageUrl() {
  const random = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `https://picsum.photos/1920/1080?random=${encodeURIComponent(random)}`;
}

async function updateMomentImageStatus() {
  const status = $('#momentImageStatus');
  if (!status) return;
  try {
    const count = await countMomentImages();
    status.textContent = count
      ? `${count} personal image${count === 1 ? '' : 's'} saved.`
      : 'No personal images saved.';
    $('#removeMomentImages').disabled = count === 0;
  } catch (_) {
    status.textContent = 'Personal image storage is unavailable.';
  }
}

function renderWorkspaceOptions() {
  const options = state.workspaces.map((workspace) => `<option value="${workspace.id}">${escapeHtml(workspace.name)}</option>`).join('');
  ['focusWorkspace', 'taskWorkspace', 'noteWorkspace', 'projectWorkspace'].forEach((id) => {
    const select = $(`#${id}`);
    const previous = select.value;
    select.innerHTML = options;
    select.value = previous && state.workspaces.some((workspace) => workspace.id === previous) ? previous : state.activeWorkspaceId;
  });
  const filter = $('#projectWorkspaceFilter');
  const previousFilter = filter.value || state.activeWorkspaceId;
  filter.innerHTML = `<option value="all">All workspaces</option>${options}`;
  filter.value = previousFilter === 'all' || state.workspaces.some((workspace) => workspace.id === previousFilter)
    ? previousFilter
    : state.activeWorkspaceId;
  $('#focusWorkspace').value = state.activeWorkspaceId;
  renderTaskProjectOptions();
  renderNoteProjectOptions();
}

function renderTaskProjectOptions() {
  const select = $('#taskProject');
  const previous = select.value;
  const workspaceId = $('#taskWorkspace').value || state.activeWorkspaceId;
  const projects = state.projects.filter((project) => project.workspaceId === workspaceId && !project.archived);
  select.innerHTML = `<option value="">No project</option>${projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join('')}`;
  select.value = projects.some((project) => project.id === previous) ? previous : '';
}

function renderNoteProjectOptions(selectedProject = undefined) {
  const select = $('#noteProject');
  const previous = selectedProject === undefined ? select.value : selectedProject;
  const workspaceId = $('#noteWorkspace').value || state.activeWorkspaceId;
  const projects = state.projects.filter((project) => project.workspaceId === workspaceId
    && (!project.archived || project.id === previous));
  select.innerHTML = `<option value="">No project</option>${projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join('')}`;
  select.value = projects.some((project) => project.id === previous) ? previous : '';
}

function getWorkspace(id) {
  return state.workspaces.find((workspace) => workspace.id === id) || state.workspaces[0];
}

function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const momentTime = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: state ? state.settings.momentClockFormat === '12' : false
  });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  $('#headerClock').textContent = time;
  $('#todayLabel').textContent = date;
  $('#momentClock').textContent = momentTime;
  $('#momentDate').textContent = date;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
}

function emptyState(message) {
  return `<p class="empty-state">${escapeHtml(message)}</p>`;
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
}

function normalizeHttpUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch (_) {
    return null;
  }
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch (_) {
    return 'Website';
  }
}

function isDomain(value) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function nextRoundedTime() {
  const date = new Date();
  date.setMinutes(Math.ceil(date.getMinutes() / 30) * 30, 0, 0);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatShortDate(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatEventDate(value) {
  if (!value) return '';
  return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatEventDateLong(value) {
  if (!value) return '';
  return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatEventTimeOnly(value) {
  if (!value || value.length === 10) return 'Day';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatEventTime(start, end) {
  if (!start || start.length === 10) return 'All day';
  const startText = new Date(start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const endText = end ? new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return endText ? `${startText}–${endText}` : startText;
}

function openMomentImageDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('focus-desk-moment-images', 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('images')) {
        database.createObjectStore('images', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open personal image storage.'));
  });
}

async function saveMomentImages(files) {
  const currentCount = await countMomentImages();
  const remainingSlots = Math.max(0, 30 - currentCount);
  const accepted = files
    .filter((file) => file.type.startsWith('image/') && file.size <= 20 * 1024 * 1024)
    .slice(0, remainingSlots);
  if (!remainingSlots) throw new Error('The personal image library can contain up to 30 images.');
  if (!accepted.length) throw new Error('Choose image files smaller than 20 MB.');

  const database = await openMomentImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('images', 'readwrite');
    const store = transaction.objectStore('images');
    accepted.forEach((file) => store.put({
      id: createId('image'),
      name: file.name,
      type: file.type,
      size: file.size,
      addedAt: Date.now(),
      blob: file
    }));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not save the selected images.'));
    transaction.onabort = () => reject(transaction.error || new Error('Saving the selected images was cancelled.'));
  });
  database.close();
  return accepted.length;
}

async function getRandomMomentImage() {
  const database = await openMomentImageDatabase();
  const images = await new Promise((resolve, reject) => {
    const request = database.transaction('images', 'readonly').objectStore('images').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('Could not read personal images.'));
  });
  database.close();
  return images.length ? images[Math.floor(Math.random() * images.length)] : null;
}

async function countMomentImages() {
  const database = await openMomentImageDatabase();
  const count = await new Promise((resolve, reject) => {
    const request = database.transaction('images', 'readonly').objectStore('images').count();
    request.onsuccess = () => resolve(request.result || 0);
    request.onerror = () => reject(request.error || new Error('Could not count personal images.'));
  });
  database.close();
  return count;
}

async function clearMomentImages() {
  const database = await openMomentImageDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('images', 'readwrite');
    transaction.objectStore('images').clear();
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Could not remove personal images.'));
  });
  database.close();
}
