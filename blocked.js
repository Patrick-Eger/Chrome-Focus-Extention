let state = null;
let blockedUrl = '';
let blockedDomain = '';
let mathAnswer = null;
let flashcardQueue = [];
let flashcardIndex = 0;
let reviewedCards = 0;

const $ = (selector) => document.querySelector(selector);

document.addEventListener('DOMContentLoaded', async () => {
  blockedUrl = parseBlockedUrl();
  try {
    blockedDomain = blockedUrl ? new URL(blockedUrl).hostname.replace(/^www\./, '') : '';
  } catch (_) {
    blockedDomain = '';
  }
  $('#blockedDomain').textContent = blockedDomain || 'This site is blocked.';
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
    document.documentElement.dataset.palette = ['signal', 'cobalt', 'forest', 'orange'].includes(state.settings.palette)
      ? state.settings.palette
      : 'signal';
    document.documentElement.dataset.theme = ['system', 'light', 'dark'].includes(state.settings.colorMode)
      ? state.settings.colorMode
      : 'system';
    const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId) || state.workspaces[0];
    $('#blockedContext').textContent = `${workspace.name} is active. Complete the focus gate to open this site temporarily.`;
    $('#accessNote').textContent = state.settings.gateType === 'hard'
      ? 'Temporary access is disabled.'
      : `Access lasts ${state.settings.unlockMinutes} minutes.`;
    updateTimer();
    renderGate();
  } catch (error) {
    showError(error.message);
  }
}

function updateTimer() {
  if (!state || !state.focus.active || !state.focus.endAt) {
    $('#focusRemaining').textContent = 'Session ended';
    return;
  }
  const totalSeconds = Math.max(0, Math.ceil((state.focus.endAt - Date.now()) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  $('#focusRemaining').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  if (totalSeconds === 0 && blockedUrl) window.location.replace(blockedUrl);
}

function renderGate() {
  const type = state.settings.gateType;
  if (type === 'math') return renderMathGate();
  if (type === 'flashcards') return renderFlashcardGate();
  if (type === 'intent') return renderIntentGate();
  if (type === 'task') return renderTaskGate();
  renderHardGate();
}

function renderHardGate() {
  $('#gateContent').innerHTML = `
    <h2>Stay with the session</h2>
    <p>This workspace uses a hard block. The site will remain unavailable until focus mode ends or you stop it from the dashboard.</p>`;
}

function renderMathGate() {
  const left = randomBetween(12, 39);
  const right = randomBetween(7, 28);
  const multiplier = randomBetween(2, 6);
  mathAnswer = left + right * multiplier;
  $('#gateContent').innerHTML = `
    <h2>Solve one problem</h2>
    <p>Pause, solve the problem, then decide whether this site is still needed.</p>
    <form id="mathForm" class="gate-form">
      <input id="mathInput" type="number" inputmode="numeric" placeholder="${left} + ${right} × ${multiplier} =" aria-label="Answer" required autofocus>
      <button class="button primary" type="submit">Check and open</button>
    </form>`;
  $('#mathForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (Number($('#mathInput').value) !== mathAnswer) {
      showError('That answer is not correct. Take another look.');
      return;
    }
    await unlock();
  });
}

function renderIntentGate() {
  $('#gateContent').innerHTML = `
    <h2>Name the reason</h2>
    <p>Write a concrete reason for opening ${escapeHtml(blockedDomain)} during this session.</p>
    <form id="intentForm" class="gate-form vertical">
      <textarea id="intentInput" minlength="12" maxlength="240" placeholder="I need this site to…" required></textarea>
      <button class="button primary" type="submit">Open temporarily</button>
    </form>`;
  $('#intentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('#intentInput').value.trim().length < 12) return showError('Make the intention a little more specific.');
    await unlock();
  });
}

function renderFlashcardGate() {
  if (state.flashcards.length < 3) {
    $('#gateContent').innerHTML = `
      <h2>Three flashcards required</h2>
      <p>You have ${state.flashcards.length} saved. Create at least three flashcards from your notes before using this gate.</p>`;
    return;
  }
  flashcardQueue = shuffle([...state.flashcards]).slice(0, 3);
  flashcardIndex = 0;
  reviewedCards = 0;
  showFlashcard(false);
}

function showFlashcard(revealed) {
  const card = flashcardQueue[flashcardIndex];
  $('#gateContent').innerHTML = `
    <h2>Review three flashcards</h2>
    <p class="flashcard-progress">Card ${flashcardIndex + 1} of 3</p>
    <div class="flashcard">
      <p class="question">${escapeHtml(card.question)}</p>
      ${revealed ? `<p class="answer">${escapeHtml(card.answer)}</p><button id="nextCard" class="button primary">I reviewed this</button>` : '<button id="revealCard" class="button secondary">Reveal answer</button>'}
    </div>`;
  if (!revealed) $('#revealCard').addEventListener('click', () => showFlashcard(true));
  else $('#nextCard').addEventListener('click', async () => {
    reviewedCards += 1;
    if (reviewedCards >= 3) return unlock();
    flashcardIndex += 1;
    showFlashcard(false);
  });
}

function renderTaskGate() {
  const openTasks = state.tasks.filter((task) => !task.completed).slice(0, 8);
  if (!openTasks.length) {
    $('#gateContent').innerHTML = '<h2>Complete a task</h2><p>There are no open tasks. Add one from the dashboard or choose a different focus gate.</p>';
    return;
  }
  $('#gateContent').innerHTML = `
    <h2>Complete one task</h2>
    <p>Choose a real task to finish before opening this site.</p>
    <form id="taskGateForm">
      <div class="task-options">${openTasks.map((task) => `<label class="task-option"><input type="radio" name="gateTask" value="${task.id}"><span>${escapeHtml(task.title)}</span></label>`).join('')}</div>
      <button class="button primary" type="submit">Mark complete and open</button>
    </form>`;
  $('#taskGateForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const selected = $('input[name="gateTask"]:checked');
    if (!selected) return showError('Choose the task you completed.');
    // The worker owns this write: it sets status alongside completed, and touches
    // only the one task instead of rewriting the whole array from a page-load snapshot.
    try {
      await send('completeTask', { id: selected.value });
    } catch (error) {
      return showError(error.message);
    }
    await unlock();
  });
}

async function unlock() {
  if (!blockedDomain || !blockedUrl) return showError('The original site address is missing.');
  try {
    showError('');
    await send('grantTemporaryAccess', { domain: blockedDomain, minutes: state.settings.unlockMinutes });
    window.location.replace(blockedUrl);
  } catch (error) {
    showError(error.message);
  }
}

function parseBlockedUrl() {
  const marker = '?url=';
  const index = window.location.href.indexOf(marker);
  return index === -1 ? '' : window.location.href.slice(index + marker.length);
}

function showError(message) {
  $('#gateError').textContent = message;
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
  return items;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}
