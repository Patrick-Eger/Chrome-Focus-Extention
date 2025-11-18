document.addEventListener('DOMContentLoaded', () => {
  const siteInput = document.getElementById('siteInput');
  const addButton = document.getElementById('addButton');
  const addCurrent = document.getElementById('addCurrent');
  const whitelistList = document.getElementById('whitelistList');
  const enableToggle = document.getElementById('enableToggle');
  const timerInput = document.getElementById('timerInput');
  const activeListSelect = document.getElementById('activeListSelect');
  const newListName = document.getElementById('newListName');
  const createList = document.getElementById('createList');
  const renameList = document.getElementById('renameList');
  const deleteList = document.getElementById('deleteList');

  let lists = { "Default": [] };
  let activeList = "Default";

  // Load initial data
  function loadData() {
    chrome.storage.sync.get(['lists', 'activeList', 'enabled', 'timerEnd'], (data) => {
      lists = data.lists || { "Default": [] };
      activeList = data.activeList || "Default";
      enableToggle.checked = data.enabled !== false;

      // Populate list selector
      activeListSelect.innerHTML = '';
      Object.keys(lists).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        if (name === activeList) option.selected = true;
        activeListSelect.appendChild(option);
      });

      loadWhitelist();
    });
  }

  // Toggle enable (and set timer)
  enableToggle.onchange = () => {
    const minutes = parseInt(timerInput.value) || 0;
    chrome.storage.sync.set({ enabled: enableToggle.checked });
    if (enableToggle.checked && minutes > 0) {
      const endTime = Date.now() + minutes * 60000;
      chrome.storage.sync.set({ timerEnd: endTime });
      // Alarm set in background
    } else {
      chrome.storage.sync.set({ timerEnd: null });
      chrome.alarms.clear('timerExpire');
    }
  };

  // Change active list
  activeListSelect.onchange = () => {
    activeList = activeListSelect.value;
    chrome.storage.sync.set({ activeList });
    loadWhitelist();
  };

  // Create new list
  createList.onclick = () => {
    const name = newListName.value.trim();
    if (name && !lists[name]) {
      lists[name] = [];
      chrome.storage.sync.set({ lists });
      newListName.value = '';
      loadData();
    }
  };

  // Rename list
  renameList.onclick = () => {
    const newName = newListName.value.trim();
    if (newName && newName !== activeList && !lists[newName]) {
      lists[newName] = lists[activeList];
      delete lists[activeList];
      activeList = newName;
      chrome.storage.sync.set({ lists, activeList });
      newListName.value = '';
      loadData();
    }
  };

  // Delete list
  deleteList.onclick = () => {
    if (Object.keys(lists).length > 1 && confirm(`Delete "${activeList}"?`)) {
      delete lists[activeList];
      activeList = Object.keys(lists)[0];
      chrome.storage.sync.set({ lists, activeList });
      loadData();
    }
  };

  // Load and display current whitelist
  function loadWhitelist() {
    const whitelist = lists[activeList] || [];
    whitelistList.innerHTML = '';
    whitelist.forEach((site) => {
      const li = document.createElement('li');
      li.textContent = site;
      const remove = document.createElement('span');
      remove.textContent = ' [Remove]';
      remove.className = 'remove';
      remove.onclick = () => removeSite(site);
      li.appendChild(remove);
      whitelistList.appendChild(li);
    });
  }

  // Add manually
  addButton.onclick = () => {
    let site = siteInput.value.trim().toLowerCase();
    if (site) {
      site = site.replace(/^www\./, '');
      addToWhitelist(site);
      siteInput.value = '';
    }
  };

  // Add current site's domain
  addCurrent.onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      let tabUrl = tabs[0].url;
      if (tabUrl.startsWith(chrome.runtime.getURL(''))) {
        const params = new URLSearchParams(new URL(tabUrl).search);
        const original = params.get('url');
        if (original) tabUrl = original;
      }
      try {
        const url = new URL(tabUrl);
        let domain = url.hostname.toLowerCase();
        domain = domain.replace(/^www\./, '');
        addToWhitelist(domain);
      } catch (e) {
        alert('Cannot add this site (invalid URL).');
      }
    });
  };

  // Helper to add domain if not already in current list
  function addToWhitelist(domain) {
    let whitelist = lists[activeList] || [];
    if (!whitelist.includes(domain)) {
      whitelist.push(domain);
      lists[activeList] = whitelist;
      chrome.storage.sync.set({ lists });
      loadWhitelist();
    }
  }

  // Remove site
  function removeSite(site) {
    let whitelist = lists[activeList] || [];
    whitelist = whitelist.filter(s => s !== site);
    lists[activeList] = whitelist;
    chrome.storage.sync.set({ lists });
    loadWhitelist();
  }

  loadData();
});