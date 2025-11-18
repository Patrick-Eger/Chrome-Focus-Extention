// background.js - Enhanced with notifications and data validation

let lists = { "Default": [] };
let todos = { "Default": [] };
let activeList = "Default";
let enabled = false;
let timerEnd = null;
let pomodoroMode = false;
let pomodoroWork = 25;
let pomodoroBreak = 5;
let pomodoroLongBreak = 15;
let currentCycle = 0; // 0 = work, 1 = break
let pomodoroCount = 0; // Completed work cycles

// Data validation helper
function validateDomain(domain) {
  if (!domain || typeof domain !== 'string') return false;
  const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
  return domainRegex.test(domain) && domain.length <= 253;
}

function validateLists(lists) {
  if (!lists || typeof lists !== 'object') return { "Default": [] };
  const validated = {};
  for (const [listName, domains] of Object.entries(lists)) {
    if (typeof listName === 'string' && Array.isArray(domains)) {
      validated[listName] = domains.filter(d => validateDomain(d));
    }
  }
  return Object.keys(validated).length > 0 ? validated : { "Default": [] };
}

function validateTodos(todos) {
  if (!todos || typeof todos !== 'object') return { "Default": [] };
  const validated = {};
  for (const [listName, todoArray] of Object.entries(todos)) {
    if (typeof listName === 'string' && Array.isArray(todoArray)) {
      validated[listName] = todoArray.filter(todo => 
        todo && typeof todo === 'object' && 
        typeof todo.text === 'string' && 
        typeof todo.done === 'boolean'
      );
    }
  }
  return Object.keys(validated).length > 0 ? validated : { "Default": [] };
}

// Load and validate initial data
chrome.storage.sync.get([
  'lists', 'todos', 'activeList', 'enabled', 'timerEnd', 
  'pomodoroMode', 'pomodoroWork', 'pomodoroBreak', 'pomodoroLongBreak', 
  'currentCycle', 'pomodoroCount'
], (data) => {
  try {
    lists = validateLists(data.lists);
    todos = validateTodos(data.todos);
    activeList = (typeof data.activeList === 'string' && lists[data.activeList]) 
      ? data.activeList : "Default";
    enabled = data.enabled !== false;
    timerEnd = (typeof data.timerEnd === 'number' && data.timerEnd > Date.now()) 
      ? data.timerEnd : null;
    pomodoroMode = data.pomodoroMode || false;
    pomodoroWork = (data.pomodoroWork >= 1 && data.pomodoroWork <= 120) ? data.pomodoroWork : 25;
    pomodoroBreak = (data.pomodoroBreak >= 1 && data.pomodoroBreak <= 60) ? data.pomodoroBreak : 5;
    pomodoroLongBreak = (data.pomodoroLongBreak >= 1 && data.pomodoroLongBreak <= 60) ? data.pomodoroLongBreak : 15;
    currentCycle = data.currentCycle || 0;
    pomodoroCount = data.pomodoroCount || 0;
    
    updateBlockRule();
    if (timerEnd && timerEnd > Date.now()) {
      setAlarm((timerEnd - Date.now()) / 60000);
    }
  } catch (error) {
    console.error('Error loading data:', error);
    // Reset to defaults on error
    chrome.storage.sync.set({
      lists: { "Default": [] },
      todos: { "Default": [] },
      activeList: "Default"
    });
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.lists) lists = validateLists(changes.lists.newValue);
  if (changes.todos) todos = validateTodos(changes.todos.newValue);
  if (changes.activeList && lists[changes.activeList.newValue]) {
    activeList = changes.activeList.newValue;
  }
  if (changes.enabled) enabled = changes.enabled.newValue;
  if (changes.pomodoroMode) pomodoroMode = changes.pomodoroMode.newValue;
  if (changes.pomodoroWork) pomodoroWork = changes.pomodoroWork.newValue;
  if (changes.pomodoroBreak) pomodoroBreak = changes.pomodoroBreak.newValue;
  if (changes.pomodoroLongBreak) pomodoroLongBreak = changes.pomodoroLongBreak.newValue;
  if (changes.currentCycle) currentCycle = changes.currentCycle.newValue;
  if (changes.pomodoroCount) pomodoroCount = changes.pomodoroCount.newValue;
  
  updateBlockRule();
  chrome.runtime.sendMessage({ type: 'stateUpdate' }).catch(() => {});
});

// Enhanced alarm handler with notifications
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'timerExpire') {
    if (pomodoroMode) {
      // Pomodoro cycle transitions
      if (currentCycle === 0) { // End of work session
        pomodoroCount++;
        currentCycle = 1; // Switch to break
        const breakMin = (pomodoroCount % 4 === 0) ? pomodoroLongBreak : pomodoroBreak;
        const isLongBreak = pomodoroCount % 4 === 0;
        
        // Show notification
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon.png', // Add your icon
          title: 'Work Session Complete! 🎉',
          message: isLongBreak 
            ? `Great job! Take a ${pomodoroLongBreak} minute long break.`
            : `Time for a ${pomodoroBreak} minute break.`,
          priority: 2
        });
        
        startTimer(breakMin, false); // Pause blocking during break
      } else { // End of break
        currentCycle = 0; // Back to work
        
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'Break Over - Time to Focus! 💪',
          message: `Starting work session ${pomodoroCount + 1}`,
          priority: 2
        });
        
        startTimer(pomodoroWork, true); // Resume blocking
      }
      chrome.storage.sync.set({ currentCycle, pomodoroCount });
    } else {
      // Regular timer expired
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'Focus Timer Complete! ✓',
        message: 'Your focus session has ended.',
        priority: 2
      });
      
      chrome.storage.sync.set({ enabled: false, timerEnd: null });
    }
    chrome.runtime.sendMessage({ type: 'stateUpdate' }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getState') {
    sendResponse({ 
      enabled, timerEnd, activeList, lists, todos, 
      pomodoroMode, pomodoroWork, pomodoroBreak, pomodoroLongBreak, 
      currentCycle, pomodoroCount 
    });
  } else if (message.type === 'startTimer') {
    const minutes = message.minutes;
    const isPomodoroStart = pomodoroMode && !enabled;
    if (isPomodoroStart) {
      pomodoroCount = 0;
      currentCycle = 0;
      chrome.storage.sync.set({ pomodoroCount, currentCycle });
    }
    startTimer(minutes, true);
    sendResponse({ success: true });
  } else if (message.type === 'stopTimer') {
    stopTimer();
    sendResponse({ success: true });
  } else if (message.type === 'updateTodo') {
    const { action, index, value } = message;
    let listTodos = todos[activeList] || [];
    
    try {
      if (action === 'add' && typeof value === 'string') {
        const trimmed = value.trim().substring(0, 500);
        if (trimmed) {
          listTodos.push({ text: trimmed, done: false });
        }
      } else if (action === 'toggle' && typeof index === 'number' && listTodos[index]) {
        listTodos[index].done = !listTodos[index].done;
      } else if (action === 'edit' && typeof index === 'number' && listTodos[index]) {
        const trimmed = value.trim().substring(0, 500);
        if (trimmed) {
          listTodos[index].text = trimmed;
        }
      } else if (action === 'delete' && typeof index === 'number') {
        listTodos.splice(index, 1);
      }
      
      todos[activeList] = listTodos;
      chrome.storage.sync.set({ todos }, () => {
        sendResponse({ success: true });
      });
    } catch (error) {
      console.error('Error updating todo:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  } else if (message.type === 'setPomodoro') {
    try {
      pomodoroMode = message.mode;
      pomodoroWork = (message.work >= 1 && message.work <= 120) ? message.work : pomodoroWork;
      pomodoroBreak = (message.break >= 1 && message.break <= 60) ? message.break : pomodoroBreak;
      pomodoroLongBreak = (message.longBreak >= 1 && message.longBreak <= 60) ? message.longBreak : pomodoroLongBreak;
      chrome.storage.sync.set({ pomodoroMode, pomodoroWork, pomodoroBreak, pomodoroLongBreak });
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }
  return true;
});

function startTimer(minutes, enableBlocking) {
  enabled = enableBlocking;
  const endTime = minutes > 0 ? Date.now() + minutes * 60000 : null;
  chrome.storage.sync.set({ enabled, timerEnd: endTime });
  if (minutes > 0) setAlarm(minutes);
  else chrome.alarms.clear('timerExpire');
  updateBlockRule();
}

function stopTimer() {
  enabled = false;
  currentCycle = 0;
  pomodoroCount = 0;
  chrome.storage.sync.set({ enabled, timerEnd: null, currentCycle, pomodoroCount });
  chrome.alarms.clear('timerExpire');
  updateBlockRule();
}

async function updateBlockRule() {
  const ruleId = 1;
  try {
    const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = oldRules.map(rule => rule.id);

    const newRules = [];
    const whitelist = lists[activeList] || [];

    if (enabled && whitelist.length > 0) {
      newRules.push({
        id: ruleId,
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
          excludedRequestDomains: whitelist
        }
      });
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules: newRules
    });
  } catch (error) {
    console.error('Error updating block rule:', error);
  }
}

function setAlarm(minutes) {
  if (minutes > 0) {
    chrome.alarms.create('timerExpire', { delayInMinutes: minutes });
    const endTime = Date.now() + minutes * 60000;
    chrome.storage.sync.set({ timerEnd: endTime });
  }
}
