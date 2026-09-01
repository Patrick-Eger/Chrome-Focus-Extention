let state = null;
let selectedMinutes = 25;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

document.addEventListener('DOMContentLoaded', async () => {
  $$('.segmented button').forEach((button) => button.addEventListener('click', () => {
    selectedMinutes = Number(button.dataset.minutes);
    render();
  }));
  $('#popupWorkspace').addEventListener('change', async (event) => {
    await chrome.storage.local.set({ activeWorkspaceId: event.target.value });
    state.activeWorkspaceId = event.target.value;
    render();
  });
  $('#popupFocusToggle').addEventListener('click', toggleFocus);
  $('#allowCurrentSite').addEventListener('click', allowCurrentSite);
  $('#favoriteCurrentSite').addEventListener('click', favoriteCurrentSite);
  $('#captureCurrentSite').addEventListener('click', captureCurrentSite);
  $('#openSidePanel').addEventListener('click', openSidePanel);
  $('#openDashboard').addEventListener('click', async () => {
    await send('openDashboard');
    window.close();
  });
  await loadState();
  setInterval(updateTimer, 1000);
});

function send(type, payload = {}) {
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
    if (state.focus.active) selectedMinutes = state.focus.durationMinutes;
    render();
  } catch (error) {
    showMessage(error.message);
  }
}

function render() {
  if (!state) return;
  document.documentElement.dataset.palette = ['signal', 'cobalt', 'forest', 'orange'].includes(state.settings.palette)
    ? state.settings.palette
    : 'signal';
  document.documentElement.dataset.theme = ['system', 'light', 'dark'].includes(state.settings.colorMode)
    ? state.settings.colorMode
    : 'system';
  const select = $('#popupWorkspace');
  select.innerHTML = state.workspaces.map((workspace) => `<option value="${workspace.id}">${escapeHtml(workspace.name)}</option>`).join('');
  select.value = state.activeWorkspaceId;
  select.disabled = state.focus.active;
  $$('.segmented button').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.minutes) === selectedMinutes);
    button.disabled = state.focus.active;
  });
  $('#popupFocusToggle').textContent = state.focus.active ? 'End session' : 'Start focus';
  $('#popupFocusToggle').classList.toggle('running', state.focus.active);
  const blocking = state.settings.focusBlocksSites !== false;
  $('#popupStatus').textContent = state.focus.active
    ? blocking ? 'Focused' : 'Focused · not blocking'
    : 'Ready';
  // Allowing a site is pointless while nothing is being blocked.
  $('#allowCurrentSite').disabled = !blocking;
  $('#allowCurrentSite').title = blocking ? '' : 'Site blocking is switched off in Settings.';
  updateTimer();
}

function updateTimer() {
  if (!state) return;
  const milliseconds = state.focus.active
    ? Math.max(0, state.focus.endAt - Date.now())
    : selectedMinutes * 60000;
  const totalSeconds = Math.ceil(milliseconds / 1000);
  $('#popupTimer').textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
  if (state.focus.active && totalSeconds === 0) loadState();
}

async function toggleFocus() {
  try {
    if (state.focus.active) await send('stopFocus');
    else await send('startFocus', { minutes: selectedMinutes, mode: selectedMinutes === 90 ? 'deep' : 'pomodoro' });
    await loadState();
  } catch (error) {
    showMessage(error.message);
  }
}

async function allowCurrentSite() {
  try {
    const page = await getCurrentPage();
    const workspaces = state.workspaces.map((workspace) => workspace.id === state.activeWorkspaceId
      ? { ...workspace, domains: Array.from(new Set([...workspace.domains, page.domain])), updatedAt: Date.now() }
      : workspace);
    await chrome.storage.local.set({ workspaces });
    state.workspaces = workspaces;
    showMessage(`${page.domain} added to this workspace.`);
  } catch (_) {
    showMessage('This page does not have a website domain.');
  }
}

async function favoriteCurrentSite() {
  try {
    const page = await getCurrentPage();
    const active = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    if ((active.favorites || []).some((favorite) => favorite.url === page.url)) {
      showMessage(`${page.domain} is already a favorite.`);
      return;
    }
    const favorite = {
      id: `favorite-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
      title: page.title,
      url: page.url,
      createdAt: Date.now()
    };
    const workspaces = state.workspaces.map((workspace) => workspace.id === state.activeWorkspaceId
      ? { ...workspace, favorites: [...(workspace.favorites || []), favorite], updatedAt: Date.now() }
      : workspace);
    await chrome.storage.local.set({ workspaces });
    state.workspaces = workspaces;
    showMessage(`${page.domain} added to favorites.`);
  } catch (_) {
    showMessage('This page cannot be added as a favorite.');
  }
}

async function captureCurrentSite() {
  try {
    const page = await getCurrentPage();
    await send('captureInboxItem', {
      item: {
        type: 'link',
        title: page.title,
        url: page.url,
        workspaceId: state.activeWorkspaceId
      },
      source: { title: page.title, url: page.url }
    });
    showMessage(`${page.domain} saved to Inbox.`);
  } catch (_) {
    showMessage('This page cannot be saved to Inbox.');
  }
}

async function openSidePanel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab.');
    await chrome.sidePanel.open({ windowId: tab.windowId });
    window.close();
  } catch (error) {
    showMessage(error.message);
  }
}

async function getCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let originalUrl = tab && tab.url || '';
  let title = tab && tab.title || '';
  const marker = '?url=';
  if (originalUrl.startsWith(chrome.runtime.getURL('blocked.html')) && originalUrl.includes(marker)) {
    originalUrl = originalUrl.slice(originalUrl.indexOf(marker) + marker.length);
    title = '';
  }
  const url = new URL(originalUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported page.');
  const domain = url.hostname.toLowerCase().replace(/^www\./, '');
  return { url: url.href, domain, title: title.trim() || domain };
}

function showMessage(message) {
  $('#popupMessage').textContent = message;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
