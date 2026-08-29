const STORAGE_VERSION = 16;
const BLOCK_RULE_IDS = [1, 2];
const FOCUS_ALARM = 'focus-session-end';
const CALENDAR_SYNC_ALARM = 'calendar-background-sync';
const TEMP_ACCESS_PREFIX = 'temporary-access:';
const WORK_BLOCK_ALARM_PREFIX = 'work-block:';
const WORK_BLOCK_REMINDER_ALARM_PREFIX = 'work-block-reminder:';
const STANDALONE_REMINDER_ALARM_PREFIX = 'standalone-reminder:';
const WORK_BLOCK_NOTIFICATION_PREFIX = 'work-block-notification:';
const STANDALONE_REMINDER_NOTIFICATION_PREFIX = 'standalone-reminder-notification:';
const WORK_BLOCK_ICON = 'images/focus-desk-icon.png';
const CONTEXT_CAPTURE_LINK = 'focus-desk-capture-link';
const CONTEXT_CAPTURE_TASK = 'focus-desk-capture-task';
const CONTEXT_SAVE_PROJECT = 'focus-desk-save-project';
const CONTEXT_OPEN_PANEL = 'focus-desk-open-panel';
const DASHBOARD_WIDGET_IDS = ['focus', 'dayPlan', 'tasks', 'upcoming', 'recall'];
const DASHBOARD_LANES = ['full', 'main', 'side'];
const DEFAULT_DASHBOARD_WIDGETS = [
  { id: 'focus', lane: 'full', visible: true },
  { id: 'dayPlan', lane: 'main', visible: true },
  { id: 'tasks', lane: 'side', visible: true },
  { id: 'upcoming', lane: 'side', visible: true },
  { id: 'recall', lane: 'side', visible: true }
];
const SYSTEM_ALLOWLIST = [
  'accounts.google.com',
  'googleapis.com',
  'chrome.google.com'
];
let initializationPromise = null;
let blockRuleUpdateQueue = Promise.resolve();
let workBlockAlarmSyncQueue = Promise.resolve();
let standaloneReminderAlarmSyncQueue = Promise.resolve();

const DEFAULTS = {
  storageVersion: STORAGE_VERSION,
  activeWorkspaceId: 'default',
  workspaces: [
    {
      id: 'default',
      name: 'Focus workspace',
      color: '#E4002B',
      domains: [],
      tabs: [],
      favorites: [],
      createdAt: 0,
      updatedAt: 0
    }
  ],
  projects: [],
  projectGroups: [],
  inboxItems: [],
  tasks: [],
  notes: [],
  flashcards: [],
  dailyPlans: {},
  reminders: [],
  settings: {
    gateType: 'math',
    unlockMinutes: 15,
    defaultFocusMinutes: 25,
    pomodoroBreakMinutes: 5,
    workdayStart: '09:00',
    workdayEnd: '18:00',
    defaultTaskEstimateMinutes: 45,
    calendarDefaultId: 'primary',
    calendarAutoSyncBlocks: true,
    calendarReminderEnabled: true,
    calendarReminderMinutes: 10,
    calendarDayStart: '07:00',
    calendarDayEnd: '21:00',
    autoStartBlocks: true,
    autoOpenWorkspaceTabs: false,
    autoStartGraceMinutes: 10,
    palette: 'signal',
    colorMode: 'system',
    newTabMode: 'dashboard',
    momentImageSource: 'online',
    momentLayout: 'left',
    momentClockFormat: '24',
    momentClockSize: 'large',
    momentOverlay: 42,
    momentShowQuote: true,
    momentShowDate: true,
    momentShowFocus: true,
    momentShowSource: true,
    momentQuoteMode: 'random',
    momentCustomQuote: '',
    momentCustomAuthor: '',
    obsidianRecallTag: 'recall',
    obsidianExportFolder: 'Focus Desk',
    obsidianIncludeArchivedProjects: false,
    dashboardWidgets: DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({ ...widget })),
    dashboardShowTaskBank: true,
    dashboardBackground: 'none',
    dashboardOverlay: 55,
    dashboardPanelTransparency: 30
  },
  focus: {
    active: false,
    mode: 'pomodoro',
    startedAt: null,
    endAt: null,
    durationMinutes: 25,
    workspaceId: 'default',
    blockId: null,
    dateKey: null
  },
  temporaryAccess: {},
  calendarEvents: [],
  calendarList: [],
  calendarSyncTokens: {},
  calendarLastSyncedAt: null,
  calendarConnected: false,
  calendarAccount: null,
  obsidianSyncRecords: {},
  migratedLegacyData: false
};

chrome.runtime.onInstalled.addListener(() => {
  initializationPromise = null;
  setupBrowserIntegrations();
  ensureInitialized().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => ensureInitialized().catch(console.error));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.focus || changes.workspaces || changes.activeWorkspaceId || changes.temporaryAccess) {
    updateBlockRule().catch(console.error);
  }
  if (changes.dailyPlans) syncWorkBlockAlarms().catch(console.error);
  if (changes.reminders) syncStandaloneReminderAlarms().catch(console.error);
  chrome.runtime.sendMessage({ type: 'stateUpdate' }).catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  handleAlarm(alarm).catch(console.error);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  openFocusDeskNotification(notificationId).catch(console.error);
});

chrome.notifications.onButtonClicked.addListener((notificationId) => {
  openFocusDeskNotification(notificationId).catch(console.error);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab).catch(console.error);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-quick-capture') return;
  const options = tab && tab.id ? { tabId: tab.id } : tab && tab.windowId ? { windowId: tab.windowId } : null;
  if (options) chrome.sidePanel.open(options).catch(console.error);
});

async function handleAlarm(alarm) {
  if (alarm.name === FOCUS_ALARM) {
    const { focus, dailyPlans = {} } = await chrome.storage.local.get(['focus', 'dailyPlans']);
    const nextFocus = {
      ...(focus || DEFAULTS.focus),
      active: false,
      endAt: null,
      blockId: null,
      dateKey: null
    };
    let nextPlans = dailyPlans;
    if (focus && focus.blockId && focus.dateKey) {
      nextPlans = updateBlockInPlans(dailyPlans, focus.dateKey, focus.blockId, (block) => ({
        ...block,
        status: block.status === 'active' ? 'needs-review' : block.status,
        updatedAt: Date.now()
      }));
    }
    await chrome.storage.local.set({
      dailyPlans: nextPlans,
      focus: {
        ...nextFocus
      }
    });
    if (focus && focus.blockId) {
      await createWorkBlockNotification({
        id: `${focus.dateKey}:${focus.blockId}`,
        title: 'Work block ready for review',
        message: 'Your planned focus time is over. Mark the block complete or move it forward.',
        contextMessage: 'Open Focus Desk to review',
        requireInteraction: true
      });
    }
    await updateBlockRule();
    return;
  }

  if (alarm.name === CALENDAR_SYNC_ALARM) {
    const { calendarConnected } = await chrome.storage.local.get('calendarConnected');
    if (calendarConnected && hasGoogleOAuthClientId()) await syncCalendars(false);
    return;
  }

  if (alarm.name.startsWith(WORK_BLOCK_ALARM_PREFIX)) {
    await triggerScheduledWorkBlock(alarm);
    return;
  }

  if (alarm.name.startsWith(WORK_BLOCK_REMINDER_ALARM_PREFIX)) {
    await notifyUpcomingWorkBlock(alarm);
    return;
  }

  if (alarm.name.startsWith(STANDALONE_REMINDER_ALARM_PREFIX)) {
    await notifyStandaloneReminder(alarm);
    return;
  }

  if (alarm.name.startsWith(TEMP_ACCESS_PREFIX)) {
    const domain = alarm.name.slice(TEMP_ACCESS_PREFIX.length);
    const { temporaryAccess = {} } = await chrome.storage.local.get('temporaryAccess');
    delete temporaryAccess[domain];
    await chrome.storage.local.set({ temporaryAccess });
    await updateBlockRule();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      if (!isCalendarSetupError(error)) console.error(error);
      sendResponse({ ok: false, error: error.message || 'Something went wrong.' });
    });
  return true;
});

async function initialize() {
  const current = await chrome.storage.local.get(null);
  const next = mergeDefaults(current);

  if (!next.migratedLegacyData) {
    const legacy = await chrome.storage.sync.get(['lists', 'todos', 'activeList']);
    migrateLegacyData(next, legacy);
  }

  next.temporaryAccess = removeExpiredAccess(next.temporaryAccess);
  if (next.focus.active && next.focus.endAt && next.focus.endAt <= Date.now()) {
    if (next.focus.blockId && next.focus.dateKey) {
      next.dailyPlans = updateBlockInPlans(
        next.dailyPlans,
        next.focus.dateKey,
        next.focus.blockId,
        (block) => ({
          ...block,
          status: block.status === 'active' ? 'needs-review' : block.status,
          updatedAt: Date.now()
        })
      );
    }
    next.focus = { ...next.focus, active: false, endAt: null, blockId: null, dateKey: null };
  }

  await chrome.storage.local.set(next);
  if (next.focus.active && next.focus.endAt) {
    chrome.alarms.create(FOCUS_ALARM, { when: next.focus.endAt });
  }
  await restoreTemporaryAccessAlarms(next.temporaryAccess);
  chrome.alarms.create(CALENDAR_SYNC_ALARM, { periodInMinutes: 15 });
  await reconcileScheduledWorkBlocks();
  await syncWorkBlockAlarms();
  await reconcileDueStandaloneReminders();
  await syncStandaloneReminderAlarms();
  await updateBlockRule();
}

function ensureInitialized() {
  if (!initializationPromise) {
    initializationPromise = initialize().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  return initializationPromise;
}

function mergeDefaults(current) {
  return {
    ...DEFAULTS,
    ...current,
    storageVersion: STORAGE_VERSION,
    settings: normalizeSettings({ ...DEFAULTS.settings, ...(current.settings || {}) }),
    focus: { ...DEFAULTS.focus, ...(current.focus || {}) },
    workspaces: (Array.isArray(current.workspaces) && current.workspaces.length
      ? current.workspaces
      : DEFAULTS.workspaces).map(normalizeWorkspace),
    projects: Array.isArray(current.projects) ? current.projects.map(normalizeProject) : [],
    projectGroups: Array.isArray(current.projectGroups)
      ? current.projectGroups.map(normalizeProjectGroup)
      : [],
    inboxItems: Array.isArray(current.inboxItems) ? current.inboxItems.map(normalizeInboxItem) : [],
    tasks: Array.isArray(current.tasks) ? current.tasks.map(normalizeTask) : [],
    notes: Array.isArray(current.notes) ? current.notes.map(normalizeNote) : [],
    flashcards: Array.isArray(current.flashcards) ? current.flashcards : [],
    dailyPlans: normalizeDailyPlans(current.dailyPlans, current.activeWorkspaceId || DEFAULTS.activeWorkspaceId),
    reminders: Array.isArray(current.reminders)
      ? current.reminders.map(normalizeStandaloneReminder)
      : [],
    temporaryAccess: current.temporaryAccess && typeof current.temporaryAccess === 'object'
      ? current.temporaryAccess
      : {},
    calendarEvents: Array.isArray(current.calendarEvents)
      ? current.calendarEvents.map(normalizeCalendarEvent)
      : [],
    calendarList: Array.isArray(current.calendarList)
      ? current.calendarList.map(normalizeCalendarListEntry)
      : [],
    calendarSyncTokens: current.calendarSyncTokens && typeof current.calendarSyncTokens === 'object'
      ? current.calendarSyncTokens
      : {},
    obsidianSyncRecords: current.obsidianSyncRecords && typeof current.obsidianSyncRecords === 'object'
      ? current.obsidianSyncRecords
      : {},
    calendarAccount: current.calendarAccount && typeof current.calendarAccount === 'object'
      ? {
          email: cleanText(current.calendarAccount.email, 320),
          id: cleanText(current.calendarAccount.id, 200)
        }
      : null
  };
}

function migrateLegacyData(target, legacy) {
  const lists = legacy.lists && typeof legacy.lists === 'object' ? legacy.lists : null;
  if (lists && Object.keys(lists).length) {
    target.workspaces = Object.entries(lists).map(([name, domains], index) => ({
      id: `legacy-${index}-${slug(name)}`,
      name: cleanText(name, 60) || `Workspace ${index + 1}`,
      color: '#E4002B',
      domains: Array.isArray(domains) ? domains.filter(validateDomain) : [],
      tabs: [],
      favorites: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }));

    const activeIndex = Math.max(0, Object.keys(lists).indexOf(legacy.activeList));
    target.activeWorkspaceId = target.workspaces[activeIndex].id;
    target.focus.workspaceId = target.activeWorkspaceId;
  }

  const legacyTodos = legacy.todos && typeof legacy.todos === 'object' ? legacy.todos : {};
  target.tasks = Object.entries(legacyTodos).flatMap(([listName, items]) => {
    const workspace = target.workspaces.find((item) => item.name === listName);
    return Array.isArray(items) ? items.map((todo, index) => ({
      id: `legacy-task-${Date.now()}-${index}-${slug(listName)}`,
      title: cleanText(todo && todo.text, 500),
      description: '',
      completed: Boolean(todo && todo.done),
      status: todo && todo.done ? 'done' : 'backlog',
      priority: 'medium',
      workspaceId: workspace ? workspace.id : target.activeWorkspaceId,
      projectId: null,
      groupId: null,
      dueDate: null,
      plannedDate: null,
      estimateMinutes: 0,
      labels: [],
      subtasks: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    })).filter((task) => task.title) : [];
  });
  target.migratedLegacyData = true;
}

async function handleMessage(message, sender) {
  switch (message && message.type) {
    case 'getState':
      await ensureInitialized();
      return {
        state: {
          ...await chrome.storage.local.get(null),
          calendarConfigured: hasGoogleOAuthClientId(),
          extensionId: chrome.runtime.id
        }
      };
    case 'startFocus':
      return startFocus(message);
    case 'stopFocus':
      return stopFocus();
    case 'grantTemporaryAccess':
      return grantTemporaryAccess(message);
    case 'captureWorkspace':
      return captureWorkspace(message.workspaceId);
    case 'openWorkspace':
      return openWorkspace(message.workspaceId);
    case 'fetchCalendar':
      return fetchCalendar(Boolean(message.interactive));
    case 'listCalendars':
      return listCalendars(Boolean(message.interactive));
    case 'syncCalendars':
      return syncCalendars(Boolean(message.interactive));
    case 'createCalendarEvent':
      return createCalendarEventForBlock(message);
    case 'updateCalendarEvent':
      return updateCalendarEventForBlock(message);
    case 'deleteCalendarEvent':
      return deleteCalendarEventForBlock(message);
    case 'disconnectCalendar':
      return disconnectCalendar();
    case 'openDashboard':
      await chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
      return {};
    case 'captureInboxItem':
      return captureInboxItem(message.item || {}, message.source || {});
    case 'updateInboxItem':
      return updateInboxItem(message.item || {});
    case 'processInboxItem':
      return processInboxItem(message);
    case 'restoreInboxItem':
      return restoreInboxItem(message.id);
    case 'deleteInboxItem':
      return deleteInboxItem(message.id);
    case 'openSidePanel':
      return openSidePanel(sender);
    case 'startWorkBlock':
      return startWorkBlock(message);
    case 'completeWorkBlock':
      return completeWorkBlock(message);
    case 'rolloverWorkBlock':
      return rolloverWorkBlock(message);
    case 'completeReminder':
      return completeStandaloneReminder(message.id);
    default:
      throw new Error('Unknown extension message.');
  }
}

function setupBrowserIntegrations() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_CAPTURE_LINK,
      title: 'Save page to Focus Desk Inbox',
      contexts: ['page', 'link']
    });
    chrome.contextMenus.create({
      id: CONTEXT_CAPTURE_TASK,
      title: 'Create Focus Desk task from page',
      contexts: ['page', 'link', 'selection']
    });
    chrome.contextMenus.create({
      id: CONTEXT_SAVE_PROJECT,
      title: 'Save page to a Focus Desk project...',
      contexts: ['page', 'link']
    });
    chrome.contextMenus.create({
      id: CONTEXT_OPEN_PANEL,
      title: 'Open Focus Desk side panel',
      contexts: ['page', 'link', 'selection']
    });
  });
}

async function handleContextMenuClick(info, tab) {
  if ([CONTEXT_OPEN_PANEL, CONTEXT_SAVE_PROJECT].includes(info.menuItemId)) {
    if (tab && tab.id) await chrome.sidePanel.open({ tabId: tab.id });
    return;
  }
  if (![CONTEXT_CAPTURE_LINK, CONTEXT_CAPTURE_TASK].includes(info.menuItemId)) return;
  const url = cleanHttpUrl(info.linkUrl || info.pageUrl || tab && tab.url);
  if (!url) throw new Error('This page cannot be captured.');
  const type = info.menuItemId === CONTEXT_CAPTURE_TASK ? 'task' : 'link';
  const title = cleanText(info.selectionText, 500)
    || cleanText(tab && tab.title, 500)
    || hostnameFromHttpUrl(url);
  await captureInboxItem({
    type,
    title,
    body: info.selectionText && type === 'task' ? cleanLongText(info.selectionText, 4000) : '',
    url
  }, {
    title: cleanText(tab && tab.title, 500),
    url
  });
}

async function openSidePanel(sender) {
  if (sender && sender.tab && sender.tab.id) {
    await chrome.sidePanel.open({ tabId: sender.tab.id });
    return {};
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active browser tab was found.');
  await chrome.sidePanel.open({ windowId: tab.windowId });
  return {};
}

async function captureInboxItem(payload, source = {}) {
  await ensureInitialized();
  const { inboxItems = [], activeWorkspaceId = 'default' } =
    await chrome.storage.local.get(['inboxItems', 'activeWorkspaceId']);
  const now = Date.now();
  const url = cleanHttpUrl(payload.url || source.url);
  const type = ['task', 'note', 'link', 'idea'].includes(payload.type) ? payload.type : 'idea';
  const title = cleanText(payload.title || source.title, 500)
    || (url ? hostnameFromHttpUrl(url) : 'Untitled capture');
  const item = normalizeInboxItem({
    id: createBackgroundId('inbox'),
    type,
    title,
    body: cleanLongText(payload.body, 12000),
    url,
    sourceTitle: cleanText(source.title, 500),
    sourceUrl: cleanHttpUrl(source.url),
    workspaceId: cleanText(payload.workspaceId, 120) || activeWorkspaceId,
    projectId: cleanText(payload.projectId, 120) || null,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    processedAt: null,
    processedAs: null
  }, inboxItems.length);
  await chrome.storage.local.set({ inboxItems: [item, ...inboxItems] });
  return { item };
}

async function updateInboxItem(payload) {
  const { inboxItems = [] } = await chrome.storage.local.get('inboxItems');
  const existing = inboxItems.find((item) => item.id === payload.id);
  if (!existing) throw new Error('Inbox item not found.');
  const updated = normalizeInboxItem({
    ...existing,
    title: cleanText(payload.title, 500) || existing.title,
    body: cleanLongText(payload.body, 12000),
    url: cleanHttpUrl(payload.url),
    type: ['task', 'note', 'link', 'idea'].includes(payload.type) ? payload.type : existing.type,
    updatedAt: Date.now()
  }, 0);
  const next = inboxItems.map((item) => item.id === updated.id ? updated : item);
  await chrome.storage.local.set({ inboxItems: next });
  return { item: updated };
}

async function processInboxItem(message) {
  const data = await chrome.storage.local.get(['inboxItems', 'workspaces', 'projects', 'tasks', 'notes']);
  const item = (data.inboxItems || []).find((entry) => entry.id === message.id);
  if (!item) throw new Error('Inbox item not found.');
  if (item.status === 'processed') throw new Error('This inbox item has already been processed.');
  const targetType = ['task', 'note', 'link'].includes(message.targetType)
    ? message.targetType
    : item.type === 'idea' ? 'note' : item.type;
  const project = (data.projects || []).find((entry) => entry.id === message.projectId && !entry.archived);
  const workspace = (data.workspaces || []).find((entry) => entry.id === (project ? project.workspaceId : message.workspaceId))
    || data.workspaces[0];
  const now = Date.now();
  const patch = {};

  if (targetType === 'task') {
    patch.tasks = [{
      id: createBackgroundId('task'),
      title: item.title,
      description: inboxBodyWithSource(item),
      workspaceId: workspace.id,
      projectId: project ? project.id : null,
      groupId: null,
      status: 'backlog',
      priority: 'medium',
      dueDate: null,
      plannedDate: null,
      estimateMinutes: 0,
      labels: [],
      subtasks: [],
      completed: false,
      createdAt: now,
      updatedAt: now
    }, ...(data.tasks || [])];
  }

  if (targetType === 'note') {
    patch.notes = [{
      id: createBackgroundId('note'),
      title: item.title,
      body: inboxBodyWithSource(item),
      workspaceId: workspace.id,
      projectId: project ? project.id : null,
      createdAt: now,
      updatedAt: now
    }, ...(data.notes || [])];
  }

  if (targetType === 'link') {
    if (!project) throw new Error('Choose an active project for this link.');
    const url = cleanHttpUrl(item.url || item.sourceUrl);
    if (!url) throw new Error('This capture does not contain a valid link.');
    if ((project.links || []).some((link) => link.url === url)) {
      throw new Error('This link is already saved in the project.');
    }
    patch.projects = (data.projects || []).map((entry) => entry.id === project.id ? {
      ...entry,
      links: [...(entry.links || []), {
        id: createBackgroundId('project-link'),
        title: item.title || hostnameFromHttpUrl(url),
        url,
        createdAt: now
      }],
      updatedAt: now
    } : entry);
  }

  const processed = {
    ...item,
    workspaceId: workspace.id,
    projectId: project ? project.id : null,
    status: 'processed',
    processedAt: now,
    processedAs: targetType,
    updatedAt: now
  };
  patch.inboxItems = (data.inboxItems || []).map((entry) => entry.id === item.id ? processed : entry);
  await chrome.storage.local.set(patch);
  return { item: processed };
}

async function restoreInboxItem(id) {
  const { inboxItems = [] } = await chrome.storage.local.get('inboxItems');
  const item = inboxItems.find((entry) => entry.id === id);
  if (!item) throw new Error('Inbox item not found.');
  const restored = { ...item, status: 'open', processedAt: null, processedAs: null, updatedAt: Date.now() };
  await chrome.storage.local.set({
    inboxItems: inboxItems.map((entry) => entry.id === id ? restored : entry)
  });
  return { item: restored };
}

async function deleteInboxItem(id) {
  const { inboxItems = [] } = await chrome.storage.local.get('inboxItems');
  await chrome.storage.local.set({ inboxItems: inboxItems.filter((item) => item.id !== id) });
  return {};
}

function inboxBodyWithSource(item) {
  const sourceUrl = cleanHttpUrl(item.url || item.sourceUrl);
  const parts = [cleanLongText(item.body, 12000)];
  if (sourceUrl) parts.push(`[Source](${sourceUrl})`);
  return parts.filter(Boolean).join('\n\n');
}

async function startWorkBlock(message) {
  const dateKey = normalizeDate(message.dateKey);
  const data = await chrome.storage.local.get(['dailyPlans', 'workspaces', 'tasks', 'settings']);
  const blocks = dateKey && data.dailyPlans[dateKey];
  const block = Array.isArray(blocks) && blocks.find((entry) => entry.id === message.id);
  if (!block) throw new Error('Work block not found.');
  const workspace = (data.workspaces || []).find((entry) => entry.id === block.workspaceId)
    || data.workspaces[0];
  const previousActiveTaskIds = new Set(blocks
    .filter((entry) => entry.id !== block.id && entry.status === 'active' && entry.taskId)
    .map((entry) => entry.taskId));
  const now = Date.now();
  const dailyPlans = {
    ...data.dailyPlans,
    [dateKey]: blocks.map((entry) => entry.id === block.id
      ? { ...entry, status: 'active', startedAt: now, updatedAt: now }
      : entry.status === 'active'
        ? { ...entry, status: 'interrupted', interruptedAt: now, updatedAt: now }
        : entry)
  };
  const tasks = (data.tasks || []).map((task) => task.id === block.taskId ? {
        ...task,
        status: 'in-progress',
        completed: false,
        plannedDate: dateKey,
        updatedAt: now
      } : previousActiveTaskIds.has(task.id) ? {
        ...task,
        status: 'planned',
        completed: false,
        updatedAt: now
      } : task);
  await chrome.storage.local.set({
    dailyPlans,
    tasks,
    activeWorkspaceId: workspace.id
  });
  const result = await startFocus({
    minutes: clampNumber(block.duration, 5, 180, 45),
    mode: Number(block.duration) >= 90 ? 'deep' : 'pomodoro',
    blockId: block.id,
    dateKey
  });

  const openTabs = typeof message.openTabs === 'boolean'
    ? message.openTabs
    : Boolean(data.settings && data.settings.autoOpenWorkspaceTabs);
  if (openTabs && workspace.tabs && workspace.tabs.length) {
    await openWorkspace(workspace.id);
  }
  return { block: dailyPlans[dateKey].find((entry) => entry.id === block.id), focus: result.focus };
}

async function completeWorkBlock(message) {
  await ensureInitialized();
  const dateKey = normalizeDate(message.dateKey);
  const data = await chrome.storage.local.get(['dailyPlans', 'tasks', 'focus']);
  const blocks = dateKey && data.dailyPlans[dateKey];
  const block = Array.isArray(blocks) && blocks.find((entry) => entry.id === message.id);
  if (!block) throw new Error('Work block not found.');
  const now = Date.now();
  const dailyPlans = {
    ...data.dailyPlans,
    [dateKey]: blocks.map((entry) => entry.id === block.id ? {
      ...entry,
      status: 'completed',
      completedAt: now,
      updatedAt: now
    } : entry)
  };
  const tasks = block.taskId
    ? (data.tasks || []).map((task) => task.id === block.taskId ? {
        ...task,
        status: 'done',
        completed: true,
        plannedDate: dateKey,
        updatedAt: now
      } : task)
    : data.tasks || [];
  await chrome.storage.local.set({ dailyPlans, tasks });
  if (data.focus && data.focus.active && block.status === 'active') await stopFocus();
  return { block: dailyPlans[dateKey].find((entry) => entry.id === block.id) };
}

async function rolloverWorkBlock(message) {
  await ensureInitialized();
  const dateKey = normalizeDate(message.dateKey);
  const targetDate = normalizeDate(message.targetDate);
  if (!dateKey || !targetDate) throw new Error('Choose a valid rollover date.');
  const data = await chrome.storage.local.get(['dailyPlans', 'tasks', 'focus']);
  const blocks = data.dailyPlans[dateKey];
  const block = Array.isArray(blocks) && blocks.find((entry) => entry.id === message.id);
  if (!block) throw new Error('Work block not found.');
  const now = Date.now();
  const rolledBlock = normalizeWorkBlock({
    ...block,
    id: createBackgroundId('block'),
    time: cleanWorkTime(message.time) || block.time,
    status: 'planned',
    source: 'rollover',
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  }, 0);
  const dailyPlans = {
    ...data.dailyPlans,
    [dateKey]: blocks.map((entry) => entry.id === block.id ? {
      ...entry,
      status: 'skipped',
      updatedAt: now
    } : entry),
    [targetDate]: [...(data.dailyPlans[targetDate] || []), rolledBlock]
  };
  const tasks = block.taskId
    ? (data.tasks || []).map((task) => task.id === block.taskId ? {
        ...task,
        status: 'planned',
        completed: false,
        plannedDate: targetDate,
        updatedAt: now
      } : task)
    : data.tasks || [];
  await chrome.storage.local.set({ dailyPlans, tasks });
  if (data.focus && data.focus.active && block.status === 'active') await stopFocus();
  return { block: rolledBlock, targetDate };
}

async function startFocus(message) {
  const durationMinutes = clampNumber(message.minutes, 1, 180, 25);
  const mode = message.mode === 'deep' ? 'deep' : 'pomodoro';
  const { activeWorkspaceId } = await chrome.storage.local.get('activeWorkspaceId');
  const now = Date.now();
  const focus = {
    active: true,
    mode,
    startedAt: now,
    endAt: now + durationMinutes * 60000,
    durationMinutes,
    workspaceId: activeWorkspaceId || 'default',
    blockId: cleanText(message.blockId, 120) || null,
    dateKey: normalizeDate(message.dateKey)
  };
  await chrome.storage.local.set({ focus });
  chrome.alarms.create(FOCUS_ALARM, { when: focus.endAt });
  await updateBlockRule();
  return { focus };
}

async function stopFocus() {
  const { focus = DEFAULTS.focus } = await chrome.storage.local.get('focus');
  const nextFocus = { ...focus, active: false, endAt: null, blockId: null, dateKey: null };
  await chrome.storage.local.set({ focus: nextFocus });
  await chrome.alarms.clear(FOCUS_ALARM);
  await updateBlockRule();
  return { focus: nextFocus };
}

async function grantTemporaryAccess(message) {
  let domain = cleanDomain(message.domain);
  if (!validateDomain(domain)) throw new Error('This domain cannot be unlocked.');

  const { settings = DEFAULTS.settings, temporaryAccess = {} } =
    await chrome.storage.local.get(['settings', 'temporaryAccess']);
  const minutes = clampNumber(message.minutes, 1, 60, settings.unlockMinutes);
  const expiresAt = Date.now() + minutes * 60000;

  temporaryAccess[domain] = expiresAt;
  await chrome.storage.local.set({ temporaryAccess });
  chrome.alarms.create(`${TEMP_ACCESS_PREFIX}${domain}`, { when: expiresAt });
  await updateBlockRule();
  return { domain, expiresAt };
}

async function captureWorkspace(workspaceId) {
  const data = await chrome.storage.local.get(['workspaces']);
  const index = data.workspaces.findIndex((workspace) => workspace.id === workspaceId);
  if (index === -1) throw new Error('Workspace not found.');

  const tabs = await chrome.tabs.query({ currentWindow: true });
  data.workspaces[index] = {
    ...data.workspaces[index],
    tabs: tabs
      .filter((tab) => /^https?:/.test(tab.url || ''))
      .map((tab) => ({ title: cleanText(tab.title, 200), url: tab.url })),
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ workspaces: data.workspaces });
  return { workspace: data.workspaces[index] };
}

async function openWorkspace(workspaceId) {
  const { workspaces = [] } = await chrome.storage.local.get('workspaces');
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) throw new Error('Workspace not found.');
  if (!workspace.tabs.length) throw new Error('This workspace has no saved tabs yet.');

  const created = [];
  for (const savedTab of workspace.tabs.slice(0, 40)) {
    if (!/^https?:/.test(savedTab.url || '')) continue;
    created.push(await chrome.tabs.create({ url: savedTab.url, active: false }));
  }

  if (created.length > 1) {
    const groupId = await chrome.tabs.group({ tabIds: created.map((tab) => tab.id) });
    await chrome.tabGroups.update(groupId, {
      title: workspace.name.slice(0, 25),
      color: chromeGroupColor(workspace.color)
    });
  }

  await chrome.storage.local.set({ activeWorkspaceId: workspaceId });
  if (created[0]) await chrome.tabs.update(created[0].id, { active: true });
  return { opened: created.length };
}

async function fetchCalendar(interactive) {
  return syncCalendars(interactive);
}

async function listCalendars(interactive) {
  const token = await getGoogleToken(interactive);
  const items = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ maxResults: '250' });
    if (pageToken) params.set('pageToken', pageToken);
    const body = await googleCalendarRequest(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`,
      { token }
    );
    items.push(...(body.items || []));
    pageToken = body.nextPageToken || '';
  } while (pageToken);

  const calendarList = items
    .filter((item) => !item.deleted)
    .map(normalizeCalendarListEntry);
  const calendarAccount = await getGoogleProfile();
  await chrome.storage.local.set({
    calendarList,
    calendarConnected: true,
    calendarAccount
  });
  return { calendarList, calendarAccount };
}

async function syncCalendars(interactive) {
  await ensureInitialized();
  let data = await chrome.storage.local.get([
    'calendarList',
    'calendarEvents',
    'calendarSyncTokens',
    'settings',
    'dailyPlans'
  ]);
  if (!data.calendarList || !data.calendarList.length) {
    await listCalendars(interactive);
    data = await chrome.storage.local.get([
      'calendarList',
      'calendarEvents',
      'calendarSyncTokens',
      'settings',
      'dailyPlans'
    ]);
  }
  const token = await getGoogleToken(interactive);
  const selected = (data.calendarList || []).filter((calendar) => calendar.selected || calendar.primary);
  let calendarEvents = data.calendarEvents || [];
  let calendarSyncTokens = { ...(data.calendarSyncTokens || {}) };
  let dailyPlans = data.dailyPlans || {};

  for (const calendar of selected) {
    const result = await syncOneCalendar(calendar, token, calendarEvents, calendarSyncTokens[calendar.id]);
    calendarEvents = result.calendarEvents;
    if (result.nextSyncToken) calendarSyncTokens[calendar.id] = result.nextSyncToken;
    dailyPlans = applyCalendarChangesToPlans(dailyPlans, result.changedEvents, calendar.id);
  }

  const calendarAccount = await getGoogleProfile();
  const calendarLastSyncedAt = Date.now();
  await chrome.storage.local.set({
    calendarEvents,
    calendarSyncTokens,
    calendarLastSyncedAt,
    calendarConnected: true,
    calendarAccount,
    dailyPlans
  });
  return { calendarEvents, calendarList: data.calendarList, calendarAccount, calendarLastSyncedAt };
}

async function syncOneCalendar(calendar, token, allEvents, syncToken, retrying = false) {
  const changedEvents = [];
  const eventMap = new Map(allEvents
    .filter((event) => event.calendarId === calendar.id)
    .map((event) => [event.id, event]));
  let pageToken = '';
  let nextSyncToken = syncToken || '';

  do {
    const params = new URLSearchParams({
      maxResults: '2500',
      singleEvents: 'true',
      showDeleted: 'true'
    });
    if (syncToken) {
      params.set('syncToken', syncToken);
    } else {
      params.set('orderBy', 'startTime');
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const end = new Date();
      end.setDate(end.getDate() + 180);
      params.set('timeMin', start.toISOString());
      params.set('timeMax', end.toISOString());
    }
    if (pageToken) params.set('pageToken', pageToken);
    let body;
    try {
      body = await googleCalendarRequest(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params}`,
        { token }
      );
    } catch (error) {
      if (error.status === 410 && syncToken && !retrying) {
        return syncOneCalendar(calendar, token, allEvents.filter((event) => event.calendarId !== calendar.id), null, true);
      }
      throw error;
    }
    for (const rawEvent of body.items || []) {
      const event = normalizeCalendarEvent({
        ...rawEvent,
        calendarId: calendar.id,
        calendarName: calendar.name,
        calendarColor: calendar.backgroundColor
      });
      changedEvents.push(event);
      if (event.status === 'cancelled') eventMap.delete(event.id);
      else eventMap.set(event.id, event);
    }
    pageToken = body.nextPageToken || '';
    nextSyncToken = body.nextSyncToken || nextSyncToken;
  } while (pageToken);

  return {
    calendarEvents: [
      ...allEvents.filter((event) => event.calendarId !== calendar.id),
      ...eventMap.values()
    ],
    changedEvents,
    nextSyncToken
  };
}

async function disconnectCalendar() {
  const token = await getGoogleToken(false).catch(() => null);
  if (token) await chrome.identity.removeCachedAuthToken({ token });
  await chrome.storage.local.set({
    calendarEvents: [],
    calendarList: [],
    calendarSyncTokens: {},
    calendarConnected: false,
    calendarAccount: null,
    calendarLastSyncedAt: null
  });
  return {};
}

async function createCalendarEventForBlock(message) {
  const context = await getWorkBlockContext(message.dateKey, message.id);
  const calendarId = cleanText(message.calendarId, 500)
    || context.block.calendar.calendarId
    || context.settings.calendarDefaultId
    || 'primary';
  const token = await getGoogleToken(Boolean(message.interactive));
  const eventId = await deterministicCalendarEventId(context.block.id);
  const payload = calendarPayloadForBlock(context, eventId);
  let event;
  try {
    event = await googleCalendarRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      { token, method: 'POST', body: payload }
    );
  } catch (error) {
    if (error.status !== 409) {
      await setBlockCalendarSyncState(message.dateKey, message.id, 'error', error.message);
      throw error;
    }
    event = await googleCalendarRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { token }
    );
  }
  const block = await linkBlockToCalendarEvent(message.dateKey, message.id, calendarId, event);
  await upsertCachedCalendarEvent(event, calendarId);
  return { block, event: normalizeCalendarEvent({ ...event, calendarId }) };
}

async function updateCalendarEventForBlock(message) {
  const context = await getWorkBlockContext(message.dateKey, message.id);
  const calendar = context.block.calendar;
  if (!calendar.eventId || !calendar.calendarId) {
    return createCalendarEventForBlock(message);
  }
  const token = await getGoogleToken(Boolean(message.interactive));
  try {
    const event = await googleCalendarRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.calendarId)}/events/${encodeURIComponent(calendar.eventId)}`,
      {
        token,
        method: 'PATCH',
        body: calendarPayloadForBlock(context),
        headers: calendar.etag ? { 'If-Match': calendar.etag } : {}
      }
    );
    const block = await linkBlockToCalendarEvent(message.dateKey, message.id, calendar.calendarId, event);
    await upsertCachedCalendarEvent(event, calendar.calendarId);
    return { block, event: normalizeCalendarEvent({ ...event, calendarId: calendar.calendarId }) };
  } catch (error) {
    await setBlockCalendarSyncState(message.dateKey, message.id, error.status === 412 ? 'conflict' : 'error', error.message);
    throw error;
  }
}

async function deleteCalendarEventForBlock(message) {
  const context = await getWorkBlockContext(message.dateKey, message.id);
  const calendar = context.block.calendar;
  if (!calendar.eventId || !calendar.calendarId) return { block: context.block };
  const token = await getGoogleToken(Boolean(message.interactive));
  try {
    await googleCalendarRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.calendarId)}/events/${encodeURIComponent(calendar.eventId)}?sendUpdates=none`,
      { token, method: 'DELETE', emptyResponse: true }
    );
  } catch (error) {
    if (![404, 410].includes(error.status)) throw error;
  }
  const data = await chrome.storage.local.get(['dailyPlans', 'calendarEvents']);
  const dailyPlans = updateBlockInPlans(data.dailyPlans, message.dateKey, message.id, (block) => ({
    ...block,
    calendar: normalizeBlockCalendar(null),
    updatedAt: Date.now()
  }));
  const calendarEvents = (data.calendarEvents || []).filter((event) => (
    event.id !== calendar.eventId || event.calendarId !== calendar.calendarId
  ));
  await chrome.storage.local.set({ dailyPlans, calendarEvents });
  return { block: dailyPlans[message.dateKey].find((block) => block.id === message.id) };
}

async function googleCalendarRequest(url, options = {}) {
  const headers = {
    Authorization: `Bearer ${options.token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (response.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token: options.token });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.error && body.error.message
      ? body.error.message
      : response.status === 401
        ? 'Google authorization expired. Connect Calendar again.'
        : 'Google Calendar could not complete the request.');
    error.status = response.status;
    throw error;
  }
  if (options.emptyResponse || response.status === 204) return {};
  return response.json();
}

async function getWorkBlockContext(dateKeyValue, blockId) {
  await ensureInitialized();
  const dateKey = normalizeDate(dateKeyValue);
  const data = await chrome.storage.local.get([
    'dailyPlans',
    'settings',
    'projects',
    'tasks',
    'calendarList'
  ]);
  const block = dateKey && (data.dailyPlans[dateKey] || []).find((entry) => entry.id === blockId);
  if (!block) throw new Error('Work block not found.');
  return {
    dateKey,
    block,
    settings: data.settings || DEFAULTS.settings,
    project: (data.projects || []).find((entry) => entry.id === block.projectId) || null,
    task: (data.tasks || []).find((entry) => entry.id === block.taskId) || null,
    calendarList: data.calendarList || []
  };
}

function calendarPayloadForBlock(context, eventId = null) {
  const start = workBlockDateTime(context.dateKey, context.block.time);
  const end = new Date(start.getTime() + Number(context.block.duration || 0) * 60000);
  const projectLine = context.project ? `Project: ${context.project.name}` : '';
  const taskLine = context.task ? `Task: ${context.task.title}` : '';
  const description = [
    cleanLongText(context.block.description, 4000),
    projectLine,
    taskLine,
    'Created by Focus Desk'
  ].filter(Boolean).join('\n\n');
  const payload = {
    summary: context.block.title,
    description,
    start: {
      dateTime: start.toISOString(),
      timeZone: context.block.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: context.block.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    transparency: 'opaque',
    reminders: context.block.calendar.reminderEnabled
      ? {
          useDefault: false,
          overrides: [{
            method: 'popup',
            minutes: clampNumber(
              context.block.calendar.reminderMinutes,
              0,
              40320,
              context.settings.calendarReminderMinutes
            )
          }]
        }
      : { useDefault: false, overrides: [] },
    extendedProperties: {
      private: {
        focusDeskBlockId: context.block.id,
        focusDeskSchema: String(STORAGE_VERSION)
      }
    }
  };
  if (eventId) payload.id = eventId;
  return payload;
}

function workBlockDateTime(dateKey, time) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

async function deterministicCalendarEventId(blockId) {
  const bytes = new TextEncoder().encode(`focus-desk:${blockId}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return `fd${Array.from(new Uint8Array(hash)).slice(0, 20)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

async function linkBlockToCalendarEvent(dateKey, blockId, calendarId, rawEvent) {
  const data = await chrome.storage.local.get('dailyPlans');
  const existing = (data.dailyPlans[dateKey] || []).find((block) => block.id === blockId);
  const calendar = normalizeBlockCalendar({
    ...(existing && existing.calendar || {}),
    calendarId,
    eventId: rawEvent.id,
    etag: rawEvent.etag,
    htmlLink: rawEvent.htmlLink,
    syncState: 'synced',
    lastSyncedAt: Date.now(),
    lastError: ''
  });
  const dailyPlans = updateBlockInPlans(data.dailyPlans, dateKey, blockId, (block) => ({
    ...block,
    calendar,
    updatedAt: Date.now()
  }));
  await chrome.storage.local.set({ dailyPlans });
  return dailyPlans[dateKey].find((block) => block.id === blockId);
}

async function setBlockCalendarSyncState(dateKey, blockId, syncState, lastError = '') {
  const data = await chrome.storage.local.get('dailyPlans');
  const dailyPlans = updateBlockInPlans(data.dailyPlans, dateKey, blockId, (block) => ({
    ...block,
    calendar: normalizeBlockCalendar({
      ...block.calendar,
      syncState,
      lastError,
      lastSyncedAt: syncState === 'synced' ? Date.now() : block.calendar.lastSyncedAt
    }),
    updatedAt: Date.now()
  }));
  await chrome.storage.local.set({ dailyPlans });
}

function updateBlockInPlans(dailyPlans, dateKey, blockId, updater) {
  return {
    ...(dailyPlans || {}),
    [dateKey]: ((dailyPlans && dailyPlans[dateKey]) || [])
      .map((block) => block.id === blockId ? updater(block) : block)
  };
}

async function upsertCachedCalendarEvent(rawEvent, calendarId) {
  const data = await chrome.storage.local.get(['calendarEvents', 'calendarList']);
  const calendar = (data.calendarList || []).find((entry) => entry.id === calendarId);
  const event = normalizeCalendarEvent({
    ...rawEvent,
    calendarId,
    calendarName: calendar && calendar.name,
    calendarColor: calendar && calendar.backgroundColor
  });
  const calendarEvents = [
    ...(data.calendarEvents || []).filter((entry) => (
      entry.id !== event.id || entry.calendarId !== event.calendarId
    )),
    event
  ];
  await chrome.storage.local.set({ calendarEvents });
}

function applyCalendarChangesToPlans(dailyPlans, changedEvents) {
  let nextPlans = { ...(dailyPlans || {}) };
  for (const event of changedEvents || []) {
    if (!event.focusDeskBlockId) continue;
    let sourceDate = null;
    let sourceBlock = null;
    for (const [dateKey, blocks] of Object.entries(nextPlans)) {
      const found = (blocks || []).find((block) => block.id === event.focusDeskBlockId);
      if (found) {
        sourceDate = dateKey;
        sourceBlock = found;
        break;
      }
    }
    if (!sourceBlock) continue;
    if (event.status === 'cancelled') {
      nextPlans = updateBlockInPlans(nextPlans, sourceDate, sourceBlock.id, (block) => ({
        ...block,
        status: 'cancelled',
        calendar: normalizeBlockCalendar({ ...block.calendar, syncState: 'synced', lastSyncedAt: Date.now() }),
        updatedAt: Date.now()
      }));
      continue;
    }
    if (!event.start || String(event.start).length === 10) continue;
    const start = new Date(event.start);
    const end = event.end ? new Date(event.end) : new Date(start.getTime() + sourceBlock.duration * 60000);
    const targetDate = localDateKey(start);
    const updated = normalizeWorkBlock({
      ...sourceBlock,
      title: event.title || sourceBlock.title,
      time: `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
      duration: Math.max(5, Math.round((end.getTime() - start.getTime()) / 60000)),
      calendar: {
        ...sourceBlock.calendar,
        calendarId: event.calendarId,
        eventId: event.id,
        etag: event.etag,
        htmlLink: event.htmlLink,
        syncState: 'synced',
        lastSyncedAt: Date.now(),
        lastError: ''
      },
      updatedAt: Date.now()
    }, 0);
    nextPlans[sourceDate] = (nextPlans[sourceDate] || []).filter((block) => block.id !== sourceBlock.id);
    nextPlans[targetDate] = [...(nextPlans[targetDate] || []), updated];
  }
  return nextPlans;
}

function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function getGoogleToken(interactive) {
  if (!hasGoogleOAuthClientId()) {
    return Promise.reject(new Error('Google Calendar needs a valid OAuth client ID in manifest.json.'));
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, enableGranularPermissions: true }, (result) => {
      const token = typeof result === 'string' ? result : result && result.token;
      if (chrome.runtime.lastError || !token) {
        const rawMessage = chrome.runtime.lastError && chrome.runtime.lastError.message;
        const message = rawMessage && rawMessage.includes('OAuth2')
          ? 'Google Calendar needs a valid OAuth client ID in manifest.json.'
          : rawMessage || 'Google Calendar was not connected.';
        reject(new Error(message));
        return;
      }
      resolve(token);
    });
  });
}

function getGoogleProfile() {
  return new Promise((resolve) => {
    chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (profile) => {
      if (chrome.runtime.lastError || !profile) {
        resolve(null);
        return;
      }
      const email = cleanText(profile.email, 320);
      const id = cleanText(profile.id, 200);
      resolve(email || id ? { email, id } : null);
    });
  });
}

function hasGoogleOAuthClientId() {
  const oauth = chrome.runtime.getManifest().oauth2 || {};
  return typeof oauth.client_id === 'string'
    && oauth.client_id.endsWith('.apps.googleusercontent.com')
    && !oauth.client_id.includes('placeholder');
}

function isCalendarSetupError(error) {
  return Boolean(error && error.message === 'Google Calendar needs a valid OAuth client ID in manifest.json.');
}

function updateBlockRule() {
  const nextUpdate = blockRuleUpdateQueue
    .catch(() => {})
    .then(applyBlockRuleUpdate);
  blockRuleUpdateQueue = nextUpdate;
  return nextUpdate;
}

async function applyBlockRuleUpdate() {
  const data = await chrome.storage.local.get([
    'focus',
    'workspaces',
    'activeWorkspaceId',
    'temporaryAccess'
  ]);
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  let desiredRule = null;

  if (data.focus && data.focus.active && data.focus.endAt > Date.now()) {
    const workspace = (data.workspaces || []).find((item) => item.id === data.activeWorkspaceId);
    const activeTemporaryDomains = Object.entries(data.temporaryAccess || {})
      .filter(([, expiresAt]) => expiresAt > Date.now())
      .map(([domain]) => domain);
    const excludedRequestDomains = Array.from(new Set([
      ...SYSTEM_ALLOWLIST,
      ...((workspace && workspace.domains) || []).map(cleanDomain).filter(validateDomain),
      ...activeTemporaryDomains.map(cleanDomain).filter(validateDomain)
    ]));

    desiredRule = {
      priority: 1,
      action: {
        type: 'redirect',
        redirect: {
          regexSubstitution: `${chrome.runtime.getURL('blocked.html')}?url=\\1`
        }
      },
      condition: {
        regexFilter: '^(https?://.*)$',
        resourceTypes: ['main_frame'],
        excludedRequestDomains
      }
    };
  }

  if (!desiredRule && !oldRules.length) return;
  if (desiredRule && oldRules.length === 1 && rulesHaveSameBehavior(oldRules[0], desiredRule)) return;

  const removeRuleIds = oldRules.map((rule) => rule.id);
  const occupiedIds = new Set(removeRuleIds);
  const nextRuleId = BLOCK_RULE_IDS.find((id) => !occupiedIds.has(id))
    || Math.max(0, ...removeRuleIds) + 1;
  const addRules = desiredRule ? [{ id: nextRuleId, ...desiredRule }] : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

function rulesHaveSameBehavior(currentRule, desiredRule) {
  return JSON.stringify({
    priority: currentRule.priority,
    action: currentRule.action,
    condition: currentRule.condition
  }) === JSON.stringify(desiredRule);
}

function removeExpiredAccess(temporaryAccess) {
  return Object.fromEntries(
    Object.entries(temporaryAccess || {}).filter(([, expiresAt]) => expiresAt > Date.now())
  );
}

async function restoreTemporaryAccessAlarms(temporaryAccess) {
  for (const [domain, expiresAt] of Object.entries(temporaryAccess || {})) {
    chrome.alarms.create(`${TEMP_ACCESS_PREFIX}${domain}`, { when: expiresAt });
  }
}

function syncWorkBlockAlarms() {
  const nextSync = workBlockAlarmSyncQueue
    .catch(() => {})
    .then(applyWorkBlockAlarmSync);
  workBlockAlarmSyncQueue = nextSync;
  return nextSync;
}

async function applyWorkBlockAlarmSync() {
  const [{ dailyPlans = {} }, alarms] = await Promise.all([
    chrome.storage.local.get('dailyPlans'),
    chrome.alarms.getAll()
  ]);
  const desiredAlarms = new Map();

  for (const [dateKey, blocks] of Object.entries(dailyPlans)) {
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || block.status !== 'planned') continue;
      const startAt = workBlockStartAt(dateKey, block && block.time);
      if (!startAt || startAt <= Date.now() || !block.id) continue;
      desiredAlarms.set(workBlockAlarmName(dateKey, block.id), startAt);
      const reminderMinutes = clampNumber(
        block.calendar && block.calendar.reminderMinutes,
        0,
        40320,
        10
      );
      const reminderAt = startAt - reminderMinutes * 60000;
      if (block.calendar && block.calendar.reminderEnabled && reminderMinutes > 0 && reminderAt > Date.now()) {
        desiredAlarms.set(workBlockReminderAlarmName(dateKey, block.id), reminderAt);
      }
    }
  }

  const currentAlarms = alarms.filter((alarm) => (
    alarm.name.startsWith(WORK_BLOCK_ALARM_PREFIX)
    || alarm.name.startsWith(WORK_BLOCK_REMINDER_ALARM_PREFIX)
  ));
  await Promise.all(currentAlarms.map(async (alarm) => {
    const desiredTime = desiredAlarms.get(alarm.name);
    if (desiredTime && Math.abs(desiredTime - alarm.scheduledTime) < 1000) {
      desiredAlarms.delete(alarm.name);
      return;
    }
    await chrome.alarms.clear(alarm.name);
  }));

  for (const [name, when] of desiredAlarms) {
    await chrome.alarms.create(name, { when });
  }
}

function syncStandaloneReminderAlarms() {
  const nextSync = standaloneReminderAlarmSyncQueue
    .catch(() => {})
    .then(applyStandaloneReminderAlarmSync);
  standaloneReminderAlarmSyncQueue = nextSync;
  return nextSync;
}

async function applyStandaloneReminderAlarmSync() {
  const [{ reminders = [] }, alarms] = await Promise.all([
    chrome.storage.local.get('reminders'),
    chrome.alarms.getAll()
  ]);
  const desiredAlarms = new Map();

  for (const reminder of reminders) {
    if (!reminder || reminder.status !== 'scheduled' || reminder.notifiedAt || !reminder.id) continue;
    const reminderAt = standaloneReminderAt(reminder);
    if (reminderAt && reminderAt > Date.now()) {
      desiredAlarms.set(standaloneReminderAlarmName(reminder.id), reminderAt);
    }
  }

  const currentAlarms = alarms.filter((alarm) => alarm.name.startsWith(STANDALONE_REMINDER_ALARM_PREFIX));
  await Promise.all(currentAlarms.map(async (alarm) => {
    const desiredTime = desiredAlarms.get(alarm.name);
    if (desiredTime && Math.abs(desiredTime - alarm.scheduledTime) < 1000) {
      desiredAlarms.delete(alarm.name);
      return;
    }
    await chrome.alarms.clear(alarm.name);
  }));

  for (const [name, when] of desiredAlarms) {
    await chrome.alarms.create(name, { when });
  }
}

async function notifyStandaloneReminder(alarm) {
  const { reminders = [] } = await chrome.storage.local.get('reminders');
  const reminder = reminders.find((entry) => (
    entry
    && entry.status === 'scheduled'
    && !entry.notifiedAt
    && standaloneReminderAlarmName(entry.id) === alarm.name
  ));
  if (!reminder) return;
  const reminderAt = standaloneReminderAt(reminder);
  if (!reminderAt || alarm.scheduledTime && Math.abs(alarm.scheduledTime - reminderAt) >= 1000) return;

  const notificationId = `${STANDALONE_REMINDER_NOTIFICATION_PREFIX}${encodeURIComponent(reminder.id)}`;
  await chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL(WORK_BLOCK_ICON),
    title: cleanText(reminder.title, 500) || 'Reminder',
    message: cleanLongText(reminder.notes, 4000) || `Scheduled for ${reminder.time}`,
    contextMessage: `${reminder.date} · ${reminder.time}`,
    eventTime: reminderAt,
    priority: 2,
    requireInteraction: true,
    silent: false,
    buttons: [{ title: 'Open Focus Desk' }]
  });

  const notifiedAt = Date.now();
  await chrome.storage.local.set({
    reminders: reminders.map((entry) => entry.id === reminder.id
      ? { ...entry, notifiedAt, updatedAt: notifiedAt }
      : entry)
  });
  chrome.runtime.sendMessage({
    type: 'standaloneReminderDue',
    reminder: {
      id: reminder.id,
      title: cleanText(reminder.title, 500),
      date: reminder.date,
      time: reminder.time
    }
  }).catch(() => {});
}

async function reconcileDueStandaloneReminders() {
  const { reminders = [] } = await chrome.storage.local.get('reminders');
  const now = Date.now();
  const due = reminders
    .filter((reminder) => {
      const reminderAt = standaloneReminderAt(reminder);
      return reminder
        && reminder.status === 'scheduled'
        && !reminder.notifiedAt
        && reminderAt
        && reminderAt <= now
        && now - reminderAt <= 24 * 60 * 60000;
    })
    .sort((a, b) => standaloneReminderAt(a) - standaloneReminderAt(b));
  for (const reminder of due) {
    await notifyStandaloneReminder({
      name: standaloneReminderAlarmName(reminder.id),
      scheduledTime: standaloneReminderAt(reminder)
    });
  }
}

async function completeStandaloneReminder(reminderId) {
  const id = cleanText(reminderId, 120);
  if (!id) throw new Error('Reminder not found.');
  const { reminders = [] } = await chrome.storage.local.get('reminders');
  const existing = reminders.find((reminder) => reminder.id === id);
  if (!existing) throw new Error('Reminder not found.');
  const completedAt = Date.now();
  const nextReminders = reminders.map((reminder) => reminder.id === id
    ? {
        ...reminder,
        status: 'completed',
        completedAt,
        updatedAt: completedAt
      }
    : reminder);
  await chrome.storage.local.set({ reminders: nextReminders });
  await chrome.alarms.clear(standaloneReminderAlarmName(id));
  return { reminder: nextReminders.find((reminder) => reminder.id === id) };
}

async function notifyUpcomingWorkBlock(alarm) {
  const { dailyPlans = {} } = await chrome.storage.local.get('dailyPlans');
  const scheduled = findWorkBlockForNamedAlarm(
    dailyPlans,
    alarm.name,
    workBlockReminderAlarmName
  );
  if (!scheduled) return;
  const reminderMinutes = clampNumber(
    scheduled.block.calendar && scheduled.block.calendar.reminderMinutes,
    1,
    40320,
    10
  );
  const reminderAt = scheduled.startAt - reminderMinutes * 60000;
  if (alarm.scheduledTime && Math.abs(alarm.scheduledTime - reminderAt) >= 1000) return;
  await createWorkBlockNotification({
    id: `reminder:${scheduled.dateKey}:${scheduled.block.id}`,
    title: `Work block in ${reminderMinutes} minute${reminderMinutes === 1 ? '' : 's'}`,
    message: cleanText(scheduled.block.title, 500) || 'A planned work block is coming up.',
    contextMessage: `${scheduled.block.time} · ${clampNumber(scheduled.block.duration, 5, 480, 60)} minutes`,
    eventTime: reminderAt,
    requireInteraction: false
  });
  chrome.runtime.sendMessage({
    type: 'workBlockReminder',
    block: {
      title: cleanText(scheduled.block.title, 500),
      time: scheduled.block.time,
      reminderMinutes
    }
  }).catch(() => {});
}

async function triggerScheduledWorkBlock(alarm) {
  const data = await chrome.storage.local.get(['dailyPlans', 'settings']);
  const dailyPlans = data.dailyPlans || {};
  const scheduled = findWorkBlockForAlarm(dailyPlans, alarm.name);
  if (!scheduled) return;
  if (alarm.scheduledTime && Math.abs(alarm.scheduledTime - scheduled.startAt) >= 1000) return;

  const duration = clampNumber(scheduled.block.duration, 5, 480, 60);
  const settings = { ...DEFAULTS.settings, ...(data.settings || {}) };
  const lateBy = Math.max(0, Date.now() - scheduled.startAt);
  const withinGrace = lateBy <= settings.autoStartGraceMinutes * 60000;
  const autoStart = settings.autoStartBlocks !== false && scheduled.block.autoStart !== false;

  if (autoStart && withinGrace) {
    await startWorkBlock({
      dateKey: scheduled.dateKey,
      id: scheduled.block.id,
      openTabs: settings.autoOpenWorkspaceTabs
    });
    await createWorkBlockNotification({
      id: `${scheduled.dateKey}:${scheduled.block.id}`,
      title: 'Work block started',
      message: cleanText(scheduled.block.title, 500) || 'Your next work block is active.',
      contextMessage: `${duration} minutes · Focus mode is on`,
      eventTime: scheduled.startAt,
      requireInteraction: false
    });
  } else if (withinGrace) {
    await createWorkBlockNotification({
      id: `${scheduled.dateKey}:${scheduled.block.id}`,
      title: 'Work block starting',
      message: cleanText(scheduled.block.title, 500) || 'Your next work block starts now.',
      contextMessage: `${duration} minutes · ${scheduled.block.time}`,
      eventTime: scheduled.startAt,
      requireInteraction: true
    });
  } else {
    const nextPlans = updateBlockInPlans(dailyPlans, scheduled.dateKey, scheduled.block.id, (block) => ({
      ...block,
      status: 'missed',
      updatedAt: Date.now()
    }));
    await chrome.storage.local.set({ dailyPlans: nextPlans });
    await createWorkBlockNotification({
      id: `${scheduled.dateKey}:${scheduled.block.id}`,
      title: 'Work block missed',
      message: cleanText(scheduled.block.title, 500) || 'A planned work block did not start.',
      contextMessage: 'Open Focus Desk to reschedule',
      eventTime: scheduled.startAt,
      requireInteraction: true
    });
  }

  chrome.runtime.sendMessage({
    type: autoStart && withinGrace ? 'workBlockStarted' : withinGrace ? 'workBlockDue' : 'workBlockMissed',
    block: {
      title: cleanText(scheduled.block.title, 500),
      duration,
      time: scheduled.block.time,
      autoStarted: autoStart && withinGrace
    }
  }).catch(() => {});
}

async function createWorkBlockNotification({
  id,
  title,
  message,
  contextMessage,
  eventTime = Date.now(),
  requireInteraction = false
}) {
  const notificationId = `${WORK_BLOCK_NOTIFICATION_PREFIX}${encodeURIComponent(id)}`;
  await chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL(WORK_BLOCK_ICON),
    title,
    message,
    contextMessage,
    eventTime,
    priority: 2,
    requireInteraction,
    silent: false,
    buttons: [{ title: 'Open Focus Desk' }]
  });
}

async function reconcileScheduledWorkBlocks() {
  const { dailyPlans = {}, settings = DEFAULTS.settings } =
    await chrome.storage.local.get(['dailyPlans', 'settings']);
  const now = Date.now();
  const grace = clampNumber(settings.autoStartGraceMinutes, 0, 60, 10) * 60000;
  const candidates = [];

  for (const [dateKey, blocks] of Object.entries(dailyPlans)) {
    for (const block of blocks || []) {
      if (!block || block.status !== 'planned') continue;
      const startAt = workBlockStartAt(dateKey, block.time);
      if (startAt && startAt <= now) candidates.push({ dateKey, block, startAt });
    }
  }
  candidates.sort((a, b) => a.startAt - b.startAt);

  for (const candidate of candidates) {
    const alarm = {
      name: workBlockAlarmName(candidate.dateKey, candidate.block.id),
      scheduledTime: candidate.startAt
    };
    if (now - candidate.startAt <= grace || candidate.startAt >= now - 24 * 60 * 60000) {
      await triggerScheduledWorkBlock(alarm);
    } else {
      const current = await chrome.storage.local.get('dailyPlans');
      const nextPlans = updateBlockInPlans(current.dailyPlans, candidate.dateKey, candidate.block.id, (block) => ({
        ...block,
        status: 'missed',
        updatedAt: now
      }));
      await chrome.storage.local.set({ dailyPlans: nextPlans });
    }
  }
}

async function openFocusDeskNotification(notificationId) {
  if (!notificationId.startsWith(WORK_BLOCK_NOTIFICATION_PREFIX)
    && !notificationId.startsWith(STANDALONE_REMINDER_NOTIFICATION_PREFIX)) return;
  await chrome.tabs.create({ url: chrome.runtime.getURL('newtab.html') });
  await chrome.notifications.clear(notificationId);
}

function findWorkBlockForAlarm(dailyPlans, alarmName) {
  return findWorkBlockForNamedAlarm(dailyPlans, alarmName, workBlockAlarmName);
}

function findWorkBlockForNamedAlarm(dailyPlans, alarmName, nameFactory) {
  for (const [dateKey, blocks] of Object.entries(dailyPlans || {})) {
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || block.status !== 'planned') continue;
      if (nameFactory(dateKey, block.id) !== alarmName) continue;
      const startAt = workBlockStartAt(dateKey, block.time);
      return startAt ? { block, dateKey, startAt } : null;
    }
  }
  return null;
}

function workBlockAlarmName(dateKey, blockId) {
  return `${WORK_BLOCK_ALARM_PREFIX}${encodeURIComponent(dateKey)}:${encodeURIComponent(String(blockId || ''))}`;
}

function workBlockReminderAlarmName(dateKey, blockId) {
  return `${WORK_BLOCK_REMINDER_ALARM_PREFIX}${encodeURIComponent(dateKey)}:${encodeURIComponent(String(blockId || ''))}`;
}

function standaloneReminderAlarmName(reminderId) {
  return `${STANDALONE_REMINDER_ALARM_PREFIX}${encodeURIComponent(String(reminderId || ''))}`;
}

function standaloneReminderAt(reminder) {
  if (!reminder || !normalizeDate(reminder.date) || !cleanWorkTime(reminder.time)) return null;
  return workBlockDateTime(reminder.date, reminder.time).getTime();
}

function workBlockStartAt(dateKey, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(time || '')) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  if (date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hours
    || date.getMinutes() !== minutes) return null;
  return date.getTime();
}

function cleanDomain(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
}

function normalizeSettings(settings) {
  return {
    ...settings,
    dashboardWidgets: normalizeDashboardWidgets(settings.dashboardWidgets),
    dashboardShowTaskBank: settings.dashboardShowTaskBank !== false,
    dashboardBackground: settings.dashboardBackground === 'library' ? 'library' : 'none',
    dashboardOverlay: clampNumber(settings.dashboardOverlay, 0, 90, 55),
    dashboardPanelTransparency: clampNumber(settings.dashboardPanelTransparency, 0, 85, 30)
  };
}

function normalizeDashboardWidgets(value) {
  const widgets = [];
  const seen = new Set();
  for (const entry of Array.isArray(value) ? value : []) {
    const id = entry && typeof entry === 'object' ? entry.id : entry;
    if (!DASHBOARD_WIDGET_IDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    const fallback = DEFAULT_DASHBOARD_WIDGETS.find((widget) => widget.id === id);
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

function normalizeDailyPlans(value, fallbackWorkspaceId = 'default') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([dateKey, blocks]) => normalizeDate(dateKey) && Array.isArray(blocks))
    .map(([dateKey, blocks]) => [
      dateKey,
      blocks.filter(Boolean).map((block, index) => normalizeWorkBlock({
        workspaceId: fallbackWorkspaceId,
        ...block
      }, index))
    ]));
}

function normalizeStandaloneReminder(reminder, reminderIndex) {
  const createdAt = Number(reminder && reminder.createdAt) || Date.now();
  const status = reminder && reminder.status === 'completed' ? 'completed' : 'scheduled';
  return {
    ...reminder,
    id: cleanText(reminder && reminder.id, 120) || `reminder-${reminderIndex}`,
    title: cleanText(reminder && reminder.title, 500) || `Reminder ${reminderIndex + 1}`,
    notes: cleanLongText(reminder && reminder.notes, 4000),
    date: normalizeDate(reminder && reminder.date) || localDateKey(new Date()),
    time: cleanWorkTime(reminder && reminder.time) || '09:00',
    status,
    notifiedAt: Number(reminder && reminder.notifiedAt) || null,
    completedAt: status === 'completed'
      ? Number(reminder && reminder.completedAt) || createdAt
      : null,
    createdAt,
    updatedAt: Number(reminder && reminder.updatedAt) || createdAt
  };
}

function normalizeWorkBlock(block, blockIndex) {
  const createdAt = Number(block && block.createdAt) || Date.now();
  const status = [
    'planned',
    'active',
    'needs-review',
    'completed',
    'skipped',
    'missed',
    'interrupted',
    'cancelled'
  ].includes(block && block.status)
    ? block.status
    : 'planned';
  const source = ['manual', 'task', 'auto', 'rollover'].includes(block && block.source)
    ? block.source
    : 'manual';
  return {
    ...block,
    id: cleanText(block && block.id, 120) || `block-${blockIndex}`,
    time: cleanWorkTime(block && block.time) || '09:00',
    title: cleanText(block && block.title, 500) || `Work block ${blockIndex + 1}`,
    description: cleanLongText(block && block.description, 4000),
    duration: clampNumber(block && block.duration, 5, 480, 60),
    workspaceId: cleanText(block && block.workspaceId, 120) || 'default',
    projectId: cleanText(block && block.projectId, 120) || null,
    taskId: cleanText(block && block.taskId, 120) || null,
    status,
    source,
    autoStart: block && typeof block.autoStart === 'boolean' ? block.autoStart : true,
    timeZone: cleanText(block && block.timeZone, 100)
      || Intl.DateTimeFormat().resolvedOptions().timeZone,
    calendar: normalizeBlockCalendar(block && block.calendar),
    startedAt: status === 'active' ? Number(block && block.startedAt) || createdAt : null,
    completedAt: status === 'completed' ? Number(block && block.completedAt) || createdAt : null,
    interruptedAt: status === 'interrupted' ? Number(block && block.interruptedAt) || createdAt : null,
    createdAt,
    updatedAt: Number(block && block.updatedAt) || createdAt
  };
}

function cleanWorkTime(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? value : null;
}

function normalizeWorkspace(workspace, workspaceIndex) {
  const id = cleanText(workspace && workspace.id, 120) || `workspace-${workspaceIndex}`;
  return {
    ...workspace,
    id,
    name: cleanText(workspace && workspace.name, 60) || `Workspace ${workspaceIndex + 1}`,
    color: '#E4002B',
    domains: Array.isArray(workspace && workspace.domains)
      ? workspace.domains.map(cleanDomain).filter(validateDomain)
      : [],
    tabs: Array.isArray(workspace && workspace.tabs)
      ? workspace.tabs.filter((tab) => tab && /^https?:\/\//.test(tab.url || '')).map((tab) => ({
          title: cleanText(tab.title, 200) || cleanDomain(tab.url),
          url: tab.url
        }))
      : [],
    favorites: Array.isArray(workspace && workspace.favorites)
      ? workspace.favorites.filter((favorite) => favorite && /^https?:\/\//.test(favorite.url || '')).map((favorite, favoriteIndex) => ({
          id: cleanText(favorite.id, 120) || `favorite-${workspaceIndex}-${favoriteIndex}`,
          title: cleanText(favorite.title, 160) || cleanDomain(favorite.url),
          url: favorite.url,
          createdAt: Number(favorite.createdAt) || Date.now()
        }))
      : []
  };
}

function normalizeProject(project, projectIndex) {
  const now = Date.now();
  const status = ['idea', 'active', 'paused', 'completed'].includes(project && project.status)
    ? project.status
    : 'active';
  const priority = ['low', 'medium', 'high'].includes(project && project.priority)
    ? project.priority
    : 'medium';
  const archived = Boolean(project && project.archived);
  const color = project && /^#[0-9a-f]{6}$/i.test(project.color || '')
    ? project.color.toUpperCase()
    : '#E4002B';

  return {
    ...project,
    id: cleanText(project && project.id, 120) || `project-${projectIndex}`,
    workspaceId: cleanText(project && project.workspaceId, 120) || 'default',
    name: cleanText(project && project.name, 120) || `Project ${projectIndex + 1}`,
    description: cleanLongText(project && project.description, 4000),
    outcome: cleanLongText(project && project.outcome, 1000),
    color,
    status,
    priority,
    dueDate: normalizeDate(project && project.dueDate),
    links: Array.isArray(project && project.links)
      ? project.links.filter((link) => link && /^https?:\/\//.test(link.url || '')).map((link, linkIndex) => ({
          id: cleanText(link.id, 120) || `project-link-${projectIndex}-${linkIndex}`,
          title: cleanText(link.title, 200),
          url: link.url,
          createdAt: Number(link.createdAt) || now
        }))
      : [],
    archived,
    createdAt: Number(project && project.createdAt) || now,
    updatedAt: Number(project && project.updatedAt) || now,
    archivedAt: archived ? Number(project && project.archivedAt) || now : null
  };
}

function normalizeProjectGroup(group, groupIndex) {
  return {
    ...group,
    id: cleanText(group && group.id, 120) || `project-group-${groupIndex}`,
    projectId: cleanText(group && group.projectId, 120),
    name: cleanText(group && group.name, 100) || `Group ${groupIndex + 1}`,
    order: clampNumber(group && group.order, 0, 1000, groupIndex),
    createdAt: Number(group && group.createdAt) || Date.now()
  };
}

function normalizeTask(task, taskIndex) {
  const completed = Boolean(task && task.completed);
  const fallbackStatus = completed ? 'done' : task && task.plannedDate ? 'planned' : 'backlog';
  const status = ['backlog', 'planned', 'in-progress', 'waiting', 'done'].includes(task && task.status)
    ? task.status
    : fallbackStatus;
  const priority = ['low', 'medium', 'high'].includes(task && task.priority)
    ? task.priority
    : 'medium';

  return {
    ...task,
    id: cleanText(task && task.id, 120) || `task-${taskIndex}`,
    title: cleanText(task && task.title, 500) || `Task ${taskIndex + 1}`,
    description: cleanLongText(task && task.description, 12000),
    workspaceId: cleanText(task && task.workspaceId, 120) || 'default',
    projectId: cleanText(task && task.projectId, 120) || null,
    groupId: cleanText(task && task.groupId, 120) || null,
    status,
    priority,
    dueDate: normalizeDate(task && task.dueDate),
    plannedDate: normalizeDate(task && task.plannedDate),
    estimateMinutes: clampNumber(task && task.estimateMinutes, 0, 1440, 0),
    labels: Array.isArray(task && task.labels)
      ? task.labels.map((label) => cleanText(label, 40)).filter(Boolean).slice(0, 12)
      : [],
    subtasks: Array.isArray(task && task.subtasks)
      ? task.subtasks.filter(Boolean).map((subtask, subtaskIndex) => ({
          id: cleanText(subtask.id, 120) || `subtask-${taskIndex}-${subtaskIndex}`,
          title: cleanText(subtask.title, 300),
          completed: Boolean(subtask.completed)
        })).filter((subtask) => subtask.title)
      : [],
    completed: status === 'done',
    createdAt: Number(task && task.createdAt) || Date.now(),
    updatedAt: Number(task && task.updatedAt) || Number(task && task.createdAt) || Date.now()
  };
}

function normalizeNote(note, noteIndex) {
  return {
    ...note,
    id: cleanText(note && note.id, 120) || `note-${noteIndex}`,
    title: cleanText(note && note.title, 180) || 'Untitled note',
    body: cleanLongText(note && note.body, 100000),
    workspaceId: cleanText(note && note.workspaceId, 120) || 'default',
    projectId: cleanText(note && note.projectId, 120) || null,
    createdAt: Number(note && note.createdAt) || Date.now(),
    updatedAt: Number(note && note.updatedAt) || Number(note && note.createdAt) || Date.now()
  };
}

function normalizeInboxItem(item, itemIndex) {
  const createdAt = Number(item && item.createdAt) || Date.now();
  const type = ['task', 'note', 'link', 'idea'].includes(item && item.type)
    ? item.type
    : 'idea';
  const status = item && item.status === 'processed' ? 'processed' : 'open';
  const processedAs = ['task', 'note', 'link'].includes(item && item.processedAs)
    ? item.processedAs
    : null;
  const url = cleanHttpUrl(item && item.url);
  const sourceUrl = cleanHttpUrl(item && item.sourceUrl);

  return {
    ...item,
    id: cleanText(item && item.id, 120) || `inbox-${itemIndex}`,
    type,
    title: cleanText(item && item.title, 500)
      || hostnameFromHttpUrl(url || sourceUrl)
      || `Capture ${itemIndex + 1}`,
    body: cleanLongText(item && item.body, 12000),
    url,
    sourceTitle: cleanText(item && item.sourceTitle, 500),
    sourceUrl,
    workspaceId: cleanText(item && item.workspaceId, 120) || 'default',
    projectId: cleanText(item && item.projectId, 120) || null,
    status,
    createdAt,
    updatedAt: Number(item && item.updatedAt) || createdAt,
    processedAt: status === 'processed' ? Number(item && item.processedAt) || createdAt : null,
    processedAs: status === 'processed' ? processedAs : null
  };
}

function normalizeBlockCalendar(value) {
  const calendar = value && typeof value === 'object' ? value : {};
  return {
    calendarId: cleanText(calendar.calendarId, 500) || null,
    eventId: cleanText(calendar.eventId, 1024) || null,
    etag: cleanText(calendar.etag, 500) || null,
    htmlLink: cleanHttpUrl(calendar.htmlLink),
    reminderEnabled: typeof calendar.reminderEnabled === 'boolean'
      ? calendar.reminderEnabled
      : false,
    reminderMinutes: clampNumber(calendar.reminderMinutes, 0, 40320, 10),
    syncState: ['local', 'pending', 'synced', 'conflict', 'error'].includes(calendar.syncState)
      ? calendar.syncState
      : 'local',
    lastSyncedAt: Number(calendar.lastSyncedAt) || null,
    lastError: cleanText(calendar.lastError, 1000)
  };
}

function normalizeCalendarListEntry(calendar, calendarIndex) {
  const accessRole = ['freeBusyReader', 'reader', 'writer', 'owner'].includes(calendar && calendar.accessRole)
    ? calendar.accessRole
    : 'reader';
  return {
    id: cleanText(calendar && calendar.id, 500) || `calendar-${calendarIndex}`,
    name: cleanText(calendar && (calendar.name || calendar.summaryOverride || calendar.summary), 300)
      || `Calendar ${calendarIndex + 1}`,
    description: cleanLongText(calendar && calendar.description, 1000),
    timeZone: cleanText(calendar && calendar.timeZone, 100),
    backgroundColor: calendar && /^#[0-9a-f]{6}$/i.test(calendar.backgroundColor || '')
      ? calendar.backgroundColor
      : '#4285F4',
    foregroundColor: calendar && /^#[0-9a-f]{6}$/i.test(calendar.foregroundColor || '')
      ? calendar.foregroundColor
      : '#FFFFFF',
    accessRole,
    writable: ['writer', 'owner'].includes(accessRole),
    primary: Boolean(calendar && calendar.primary),
    selected: calendar && typeof calendar.selected === 'boolean' ? calendar.selected : true
  };
}

function normalizeCalendarEvent(event, eventIndex) {
  const start = event && event.start && typeof event.start === 'object'
    ? event.start.dateTime || event.start.date
    : event && event.start;
  const end = event && event.end && typeof event.end === 'object'
    ? event.end.dateTime || event.end.date
    : event && event.end;
  const privateProperties = event && event.extendedProperties && event.extendedProperties.private || {};
  return {
    id: cleanText(event && event.id, 1024) || `calendar-event-${eventIndex}`,
    calendarId: cleanText(event && event.calendarId, 500) || 'primary',
    calendarName: cleanText(event && event.calendarName, 300),
    calendarColor: event && /^#[0-9a-f]{6}$/i.test(event.calendarColor || '')
      ? event.calendarColor
      : '#4285F4',
    title: cleanText(event && (event.title || event.summary), 500) || 'Untitled event',
    description: cleanLongText(event && event.description, 4000),
    start: cleanText(start, 100),
    end: cleanText(end, 100),
    allDay: Boolean(start && String(start).length === 10),
    htmlLink: cleanHttpUrl(event && event.htmlLink),
    location: cleanText(event && event.location, 300),
    status: event && event.status === 'cancelled' ? 'cancelled' : 'confirmed',
    etag: cleanText(event && event.etag, 500),
    updated: cleanText(event && event.updated, 100),
    transparency: event && event.transparency === 'transparent' ? 'transparent' : 'opaque',
    focusDeskBlockId: cleanText(
      event && (event.focusDeskBlockId || privateProperties.focusDeskBlockId),
      120
    ) || null
  };
}

function validateDomain(value) {
  return typeof value === 'string'
    && value.length <= 253
    && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function cleanText(value, length) {
  return typeof value === 'string' ? value.trim().slice(0, length) : '';
}

function cleanLongText(value, length) {
  return typeof value === 'string' ? value.trim().slice(0, length) : '';
}

function cleanHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value.trim())
      ? value.trim()
      : `https://${value.trim()}`;
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function hostnameFromHttpUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function createBackgroundId(prefix) {
  const random = globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function normalizeDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function slug(value) {
  return String(value || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function chromeGroupColor(color) {
  const map = {
    '#E4002B': 'red',
    '#002FA7': 'blue',
    '#FF4F00': 'orange',
    '#188038': 'green',
    '#7E57C2': 'purple'
  };
  return map[color] || 'grey';
}

ensureInitialized().catch(console.error);
