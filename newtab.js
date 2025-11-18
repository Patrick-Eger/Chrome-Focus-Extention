let interval;
let state = { 
  enabled: false, 
  timerEnd: null, 
  activeList: 'Default', 
  lists: { 'Default': [] }, 
  todos: { 'Default': [] }, 
  pomodoroMode: false, 
  pomodoroWork: 25, 
  pomodoroBreak: 5, 
  pomodoroLongBreak: 15, 
  currentCycle: 0, 
  pomodoroCount: 0 
};

const quotes = [
  { text: "Everything you've ever wanted is sitting on the other side of fear.", author: "George Addair" },
  { text: "The question isn't who is going to let me; it's who is going to stop me.", author: "Ayn Rand" },
  { text: "I didn't get there by wishing for it or hoping for it, but by working for it.", author: "Estée Lauder" },
  { text: "When we strive to become better than we are, everything around us becomes better too.", author: "Paulo Coelho" },
  { text: "Just one small positive thought in the morning can change your whole day.", author: "Dalai Lama" },
  { text: "You have to believe in yourself when no one else does.", author: "Serena Williams" },
  { text: "When you have a dream, you've got to grab it and never let go.", author: "Carol Burnett" },
  { text: "When something is important enough, you do it even if the odds are not in your favor.", author: "Elon Musk" },
  { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
  { text: "Life is about making an impact, not making an income.", author: "Kevin Kruse" },
  { text: "Whatever the mind of man can conceive and believe, it can achieve.", author: "Napoleon Hill" },
  { text: "You see, in life, lots of people know what to do, but few actually do what they know. Knowing is not enough! You must take action.", author: "Tony Robbins" },
  { text: "Nothing will work unless you do.", author: "Maya Angelou" },
  { text: "I find that the harder I work, the more luck I seem to have.", author: "Thomas Jefferson" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Success is not final, failure is not fatal: It is the courage to continue that counts.", author: "Winston Churchill" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "Act as if what you do makes a difference. It does.", author: "William James" },
  { text: "Keep your face always toward the sunshine—and shadows will fall behind you.", author: "Walt Whitman" }
];

function updateState() {
  chrome.runtime.sendMessage({ type: 'getState' }, (response) => {
    if (!response) {
      console.warn('getState returned no response', chrome.runtime.lastError);
      return;
    }
    state = response;
    updateUI();
  });
}

function updateUI() {
  document.getElementById('activeListName').textContent = state.activeList;
  const domainList = document.getElementById('domainList');
  domainList.innerHTML = '';
  (state.lists[state.activeList] || []).forEach(domain => {
    const li = document.createElement('li');
    li.textContent = domain;
    domainList.appendChild(li);
  });

  document.getElementById('todoListName').textContent = state.activeList;
  updateTodoList();

  const listSelect = document.getElementById('list-select'); // FIXED: was 'listSelect'
  listSelect.innerHTML = '';
  Object.keys(state.lists).forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    if (name === state.activeList) option.selected = true;
    listSelect.appendChild(option);
  });

  document.getElementById('pomodoro-toggle').checked = state.pomodoroMode; // FIXED: was 'pomodoroToggle'
  document.getElementById('pomodoro-config').classList.toggle('hidden', !state.pomodoroMode); // FIXED: was 'pomodoroOptions'
  document.getElementById('pomo-work').value = state.pomodoroWork; // FIXED: was 'pomodoroWork'
  document.getElementById('pomo-break').value = state.pomodoroBreak; // FIXED: was 'pomodoroBreak'
  document.getElementById('pomo-long').value = state.pomodoroLongBreak; // FIXED: was 'pomodoroLongBreak'

  updateTimerDisplay();

  // Update start button if it exists
  const startButton = document.getElementById('startButton');
  if (startButton) {
    startButton.textContent = state.enabled ? 'Pause' : 'Start';
  }

  const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
  document.getElementById('quoteText').textContent = `"${randomQuote.text}"`;
  document.getElementById('quoteAuthor').textContent = randomQuote.author ? `— ${randomQuote.author}` : '';
}

function renderTimer() {
  const timerSection = document.getElementById('timer');
  timerSection.innerHTML = `
    <div class="timer-display" id="timerDisplay">00:00</div>
    <div class="cycle-info" id="cycleInfo"></div>
    <div class="timer-controls">
      <input type="number" id="timerInput" placeholder="Timer (minutes)" min="0" value="25" />
      <button id="startButton" class="btn btn-primary">Start</button>
    </div>
  `;
}

function updateTimerDisplay() {
  const timerDisplayEl = document.getElementById('timerDisplay');
  const cycleInfoEl = document.getElementById('cycleInfo');
  
  if (!timerDisplayEl || !cycleInfoEl) return;

  let display = '00:00';
  let cycleText = '';
  
  if (state.enabled && state.timerEnd) {
    const remaining = Math.max(0, state.timerEnd - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0');
    display = `${minutes}:${seconds}`;
  }
  
  if (state.pomodoroMode) {
    cycleText = state.currentCycle === 0 
      ? `Work ${state.pomodoroCount + 1}/4` 
      : `Break (${state.pomodoroCount % 4 === 0 ? 'Long' : 'Short'})`;
  }
  
  timerDisplayEl.textContent = display;
  cycleInfoEl.textContent = cycleText;
}

function updateClock() {
  const now = new Date();
  document.getElementById('currentTime').textContent = now.toLocaleTimeString('de-DE', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit', 
    hour12: false 
  });
  document.getElementById('currentDate').textContent = now.toLocaleDateString('de-DE', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  document.getElementById('headerClock').textContent = now.toLocaleTimeString('de-DE', { 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false 
  });
}

function updateTodoList() {
  const todoList = document.getElementById('todo-list'); // FIXED: was 'todoList'
  todoList.innerHTML = '';
  (state.todos[state.activeList] || []).forEach((todo, index) => {
    const li = document.createElement('li');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = todo.done;
    checkbox.onchange = () => {
      chrome.runtime.sendMessage({ type: 'updateTodo', action: 'toggle', index }, (resp) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to toggle todo:', chrome.runtime.lastError);
          return;
        }
        updateState();
      });
    };
    const textSpan = document.createElement('span');
    textSpan.className = 'todo-text';
    textSpan.textContent = todo.text;
    textSpan.style.textDecoration = todo.done ? 'line-through' : 'none';
    textSpan.ondblclick = () => {
      const input = document.createElement('input');
      input.className = 'edit-input';
      input.value = todo.text;
      input.onblur = () => {
        if (input.value.trim()) {
          chrome.runtime.sendMessage({ 
            type: 'updateTodo', 
            action: 'edit', 
            index, 
            value: input.value.trim() 
          }, (resp) => {
            if (chrome.runtime.lastError) {
              console.error('Failed to edit todo:', chrome.runtime.lastError);
              return;
            }
            updateState();
          });
        } else {
          textSpan.style.display = 'inline';
          input.remove();
        }
      };
      li.replaceChild(input, textSpan);
      input.focus();
    };
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️';
    deleteBtn.className = 'btn-delete';
    deleteBtn.onclick = () => {
      chrome.runtime.sendMessage({ type: 'updateTodo', action: 'delete', index }, (resp) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to delete todo:', chrome.runtime.lastError);
          return;
        }
        updateState();
      });
    };
    li.append(checkbox, textSpan, deleteBtn);
    todoList.appendChild(li);
  });
}

// Add domain list update function
function updateDomainList() {
  const domainListEl = document.getElementById('domain-list');
  domainListEl.innerHTML = '';
  (state.lists[state.activeList] || []).forEach((domain, index) => {
    const li = document.createElement('li');
    li.textContent = domain;
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '✕';
    deleteBtn.className = 'btn-small';
    deleteBtn.onclick = () => {
      chrome.runtime.sendMessage({ 
        type: 'removeDomain', 
        list: state.activeList, 
        domain 
      }, () => {
        updateState();
      });
    };
    li.appendChild(deleteBtn);
    domainListEl.appendChild(li);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Render timer initially
  renderTimer();
  
  updateState();
  interval = setInterval(() => {
    updateTimerDisplay();
    updateClock();
  }, 1000);

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'stateUpdate') {
      updateState();
    }
  });

  // Timer controls - use event delegation
  document.getElementById('timer').addEventListener('click', (e) => {
    if (e.target.id === 'startButton') {
      if (state.enabled) {
        chrome.runtime.sendMessage({ type: 'stopTimer' }, (resp) => {
          if (chrome.runtime.lastError) {
            console.error('Failed to stop timer:', chrome.runtime.lastError);
            return;
          }
          updateState();
        });
      } else {
        const minutes = state.pomodoroMode 
          ? state.pomodoroWork 
          : (parseInt(document.getElementById('timerInput').value) || 0);
        chrome.runtime.sendMessage({ type: 'startTimer', minutes }, (resp) => {
          if (chrome.runtime.lastError) {
            console.error('Failed to start timer:', chrome.runtime.lastError);
            return;
          }
          updateState();
        });
      }
    }
  });

  document.getElementById('addTodoButton').onclick = () => {
    const input = document.getElementById('newTodoInput');
    const text = input.value.trim();
    if (text) {
      chrome.runtime.sendMessage({ type: 'updateTodo', action: 'add', value: text }, (resp) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to add todo:', chrome.runtime.lastError);
          return;
        }
        input.value = '';
        updateState();
      });
    }
  };

  // Allow adding todo with Enter key
  document.getElementById('newTodoInput').onkeypress = (e) => {
    if (e.key === 'Enter') {
      document.getElementById('addTodoButton').click();
    }
  };

  // Pomodoro toggle
  document.getElementById('pomodoro-toggle').onchange = (e) => {
    document.getElementById('pomodoro-config').classList.toggle('hidden', !e.target.checked);
  };

  // Save Pomodoro settings
  document.getElementById('save-pomo').onclick = () => {
    const pomodoroMode = document.getElementById('pomodoro-toggle').checked;
    const pomodoroWork = parseInt(document.getElementById('pomo-work').value) || 25;
    const pomodoroBreak = parseInt(document.getElementById('pomo-break').value) || 5;
    const pomodoroLongBreak = parseInt(document.getElementById('pomo-long').value) || 15;
    
    chrome.runtime.sendMessage({ 
      type: 'setPomodoro', 
      mode: pomodoroMode, 
      work: pomodoroWork, 
      break: pomodoroBreak, 
      longBreak: pomodoroLongBreak 
    }, (resp) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to set Pomodoro:', chrome.runtime.lastError);
        return;
      }
      updateState();
      alert('Pomodoro settings saved!');
    });
  };

  // List selection change
  document.getElementById('list-select').onchange = (e) => {
    const newActiveList = e.target.value;
    chrome.storage.sync.set({ activeList: newActiveList }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to set activeList:', chrome.runtime.lastError);
        return;
      }
      updateState();
    });
  };

  // New list button
  document.getElementById('new-list').onclick = () => {
    const listName = prompt('Enter new list name:');
    if (listName && listName.trim()) {
      chrome.runtime.sendMessage({ type: 'createList', name: listName.trim() }, () => {
        updateState();
      });
    }
  };

  // Add domain button
  document.getElementById('add-domain').onclick = () => {
    const domainInput = document.getElementById('domain-input');
    const domain = domainInput.value.trim();
    if (domain) {
      chrome.runtime.sendMessage({ 
        type: 'addDomain', 
        list: state.activeList, 
        domain 
      }, () => {
        domainInput.value = '';
        updateState();
      });
    }
  };

  // Tab switching
  const tabs = {
    clock: document.getElementById('clockDisplay'),
    focus: document.querySelector('.timer-container'),
    todo: document.getElementById('todoDisplay'),
    settings: document.getElementById('settingsPanel')
  };
  const buttons = {
    clock: document.getElementById('clockTab'),
    focus: document.getElementById('focusTab'),
    todo: document.getElementById('todoTab'),
    settings: document.getElementById('settingsTab')
  };

  function switchTab(tabName) {
    Object.values(tabs).forEach(el => el.classList.add('hidden'));
    tabs[tabName].classList.remove('hidden');
    Object.values(buttons).forEach(btn => btn.classList.remove('active'));
    buttons[tabName].classList.add('active');
    document.getElementById('whitelistDisplay').classList.toggle('hidden', tabName !== 'focus');
  }

  buttons.clock.onclick = () => switchTab('clock');
  buttons.focus.onclick = () => switchTab('focus');
  buttons.todo.onclick = () => switchTab('todo');
  buttons.settings.onclick = () => switchTab('settings');

  switchTab('focus'); // Default
});
