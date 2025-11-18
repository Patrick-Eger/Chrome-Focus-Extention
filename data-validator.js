// data-validator.js - Utility for validating and sanitizing storage data

const DataValidator = {
  // Validate lists structure
  validateLists(lists) {
    if (!lists || typeof lists !== 'object') {
      console.warn('Invalid lists structure, resetting to default');
      return { "Default": [] };
    }
    
    const validated = {};
    for (const [listName, domains] of Object.entries(lists)) {
      if (typeof listName === 'string' && Array.isArray(domains)) {
        validated[listName] = domains.filter(d => 
          typeof d === 'string' && this.isValidDomain(d)
        );
      }
    }
    
    // Ensure at least one list exists
    if (Object.keys(validated).length === 0) {
      validated["Default"] = [];
    }
    
    return validated;
  },
  
  // Validate todos structure
  validateTodos(todos) {
    if (!todos || typeof todos !== 'object') {
      return { "Default": [] };
    }
    
    const validated = {};
    for (const [listName, todoArray] of Object.entries(todos)) {
      if (typeof listName === 'string' && Array.isArray(todoArray)) {
        validated[listName] = todoArray.filter(todo => 
          todo && typeof todo === 'object' && 
          typeof todo.text === 'string' && 
          typeof todo.done === 'boolean'
        ).map(todo => ({
          text: todo.text.substring(0, 500), // Limit text length
          done: todo.done
        }));
      }
    }
    
    if (Object.keys(validated).length === 0) {
      validated["Default"] = [];
    }
    
    return validated;
  },
  
  // Validate domain format
  isValidDomain(domain) {
    if (!domain || typeof domain !== 'string') return false;
    
    // Basic domain validation (not exhaustive)
    const domainRegex = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i;
    return domainRegex.test(domain) && domain.length <= 253;
  },
  
  // Validate active list name
  validateActiveList(activeList, lists) {
    if (typeof activeList === 'string' && lists[activeList]) {
      return activeList;
    }
    return Object.keys(lists)[0] || "Default";
  },
  
  // Validate timer end time
  validateTimerEnd(timerEnd) {
    if (typeof timerEnd === 'number' && timerEnd > Date.now()) {
      return timerEnd;
    }
    return null;
  },
  
  // Validate Pomodoro settings
  validatePomodoroSettings(work, break_, longBreak) {
    const validateMinutes = (val) => {
      const num = parseInt(val);
      return (num >= 1 && num <= 120) ? num : null;
    };
    
    return {
      work: validateMinutes(work) || 25,
      break: validateMinutes(break_) || 5,
      longBreak: validateMinutes(longBreak) || 15
    };
  }
};

// Make available globally
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DataValidator;
}
