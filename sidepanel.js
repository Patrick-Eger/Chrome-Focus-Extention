let state = null;
let currentPage = { title: '', url: '', domain: '' };
let captureDestination = 'inbox';
let selectedFocusMinutes = 25;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener('DOMContentLoaded', async () => {
  bindCapture();
  bindFocus();
  $('#pageFavicon').addEventListener('error', () => {
    $('#pageFavicon').src = 'images/focus-desk-icon.png';
  });
  $('#openDashboard').addEventListener('click', () => send('openDashboard').catch(showError));
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') loadState();
  });
  chrome.tabs.onActivated.addListener(refreshCurrentPage);
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (tab.active && (changeInfo.url || changeInfo.title || changeInfo.status === 'complete')) {
      refreshCurrentPage();
    }
  });
  setInterval(renderFocusTimer, 1000);
  await Promise.all([loadState(), refreshCurrentPage()]);
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
    state.projects = Array.isArray(state.projects) ? state.projects : [];
    state.inboxItems = Array.isArray(state.inboxItems) ? state.inboxItems : [];
    selectedFocusMinutes = state.focus.active
      ? state.focus.durationMinutes
      : selectedFocusMinutes || state.settings.defaultFocusMinutes;
    applyAppearance();
    renderDestinations();
    renderRecentInbox();
    renderFocus();
  } catch (error) {
    showError(error);
  }
}

async function refreshCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const url = unwrapBlockedUrl(tab.url);
    const validUrl = normalizeHttpUrl(url);
    currentPage = {
      title: tab.title || (validUrl ? hostnameFromUrl(validUrl) : 'Current page'),
      url: validUrl || '',
      domain: validUrl ? hostnameFromUrl(validUrl) : 'Browser page'
    };
    $('#pageTitle').textContent = currentPage.title;
    $('#pageDomain').textContent = currentPage.domain;
    $('#pageFavicon').src = validUrl ? faviconUrl(validUrl) : 'images/focus-desk-icon.png';
    $('#captureTitle').value = currentPage.title;
    $('#captureType').value = validUrl ? 'link' : 'idea';
  } catch (error) {
    showError(error);
  }
}

function bindCapture() {
  $$('.destination-switch [data-destination]').forEach((button) => {
    button.addEventListener('click', () => {
      captureDestination = button.dataset.destination;
      renderDestinations();
    });
  });
  $('#captureWorkspace').addEventListener('change', renderProjectOptions);
  $('#captureForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('#saveCapture');
    submit.disabled = true;
    setStatus('Saving...');
    try {
      const type = $('#captureType').value;
      const projectId = $('#captureProject').value || null;
      if (captureDestination === 'project' && !projectId) {
        throw new Error('Choose a project for this capture.');
      }
      const response = await send('captureInboxItem', {
        item: {
          type,
          title: $('#captureTitle').value,
          body: $('#captureBody').value,
          url: currentPage.url,
          workspaceId: $('#captureWorkspace').value,
          projectId
        },
        source: { title: currentPage.title, url: currentPage.url }
      });
      if (captureDestination === 'project') {
        await send('processInboxItem', {
          id: response.item.id,
          targetType: type === 'idea' ? 'note' : type,
          workspaceId: $('#captureWorkspace').value,
          projectId
        });
      }
      $('#captureBody').value = '';
      setStatus(captureDestination === 'project' ? 'Saved to project.' : 'Saved to Inbox.');
      await loadState();
    } catch (error) {
      showError(error);
    } finally {
      submit.disabled = false;
    }
  });
}

function renderDestinations() {
  if (!state) return;
  $$('.destination-switch [data-destination]').forEach((button) => {
    button.classList.toggle('active', button.dataset.destination === captureDestination);
  });
  $('#projectDestination').classList.toggle('hidden', captureDestination !== 'project');
  $('#saveCapture').textContent = captureDestination === 'project' ? 'Save to project' : 'Save to Inbox';

  const workspaceSelect = $('#captureWorkspace');
  const previousWorkspace = workspaceSelect.value || state.activeWorkspaceId;
  workspaceSelect.innerHTML = state.workspaces.map((workspace) => `
    <option value="${escapeHtml(workspace.id)}">${escapeHtml(workspace.name)}</option>
  `).join('');
  workspaceSelect.value = state.workspaces.some((workspace) => workspace.id === previousWorkspace)
    ? previousWorkspace
    : state.activeWorkspaceId;
  renderProjectOptions();
}

function renderProjectOptions() {
  if (!state) return;
  const select = $('#captureProject');
  const previous = select.value;
  const projects = state.projects.filter((project) => (
    project.workspaceId === $('#captureWorkspace').value && !project.archived
  ));
  select.innerHTML = `<option value="">Choose project</option>${projects.map((project) => `
    <option value="${escapeHtml(project.id)}">${escapeHtml(project.name)}</option>
  `).join('')}`;
  select.value = projects.some((project) => project.id === previous) ? previous : '';
}

function renderRecentInbox() {
  const items = state.inboxItems
    .filter((item) => item.status === 'open')
    .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
  $('#openInboxCount').textContent = items.length;
  $('#recentInbox').innerHTML = items.length ? items.slice(0, 5).map((item) => `
    <button class="recent-item" data-open-inbox type="button">
      <span>${escapeHtml(item.type)}</span>
      <span><strong>${escapeHtml(item.title)}</strong><small>${formatTime(item.updatedAt)}</small></span>
    </button>
  `).join('') : '<p class="empty-state">Nothing is waiting. The desk is clear.</p>';
  $$('[data-open-inbox]').forEach((button) => {
    button.addEventListener('click', () => send('openDashboard').catch(showError));
  });
}

function bindFocus() {
  $$('[data-focus-minutes]').forEach((button) => {
    button.addEventListener('click', () => {
      if (state && state.focus.active) return;
      selectedFocusMinutes = Number(button.dataset.focusMinutes);
      renderFocus();
    });
  });
  $('#focusToggle').addEventListener('click', async () => {
    try {
      if (state.focus.active) await send('stopFocus');
      else await send('startFocus', {
        minutes: selectedFocusMinutes,
        mode: selectedFocusMinutes === 90 ? 'deep' : 'pomodoro'
      });
      await loadState();
    } catch (error) {
      showError(error);
    }
  });
}

function renderFocus() {
  if (!state) return;
  $$('[data-focus-minutes]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.focusMinutes) === selectedFocusMinutes);
    button.disabled = state.focus.active;
  });
  $('#focusToggle').textContent = state.focus.active ? 'End' : 'Start';
  $('#focusToggle').classList.toggle('running', state.focus.active);
  renderFocusTimer();
}

function renderFocusTimer() {
  if (!state) return;
  const remaining = state.focus.active && state.focus.endAt > Date.now()
    ? Math.max(0, state.focus.endAt - Date.now())
    : selectedFocusMinutes * 60000;
  const seconds = Math.ceil(remaining / 1000);
  $('#focusTimer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  if (state.focus.active && remaining <= 0) loadState();
}

function applyAppearance() {
  document.documentElement.dataset.palette = state.settings.palette || 'signal';
  document.documentElement.dataset.theme = state.settings.colorMode || 'system';
}

function unwrapBlockedUrl(value) {
  try {
    const url = new URL(value || '');
    if (url.pathname.endsWith('/blocked.html')) return url.searchParams.get('url') || value;
  } catch (_) {}
  return value;
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(value || '');
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

function faviconUrl(value) {
  return `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(value)}&size=64`;
}

function formatTime(value) {
  return new Date(Number(value) || Date.now()).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function setStatus(message, isError = false) {
  $('#captureStatus').textContent = message;
  $('#captureStatus').classList.toggle('error', isError);
}

function showError(error) {
  setStatus(error && error.message ? error.message : String(error), true);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[character]));
}
