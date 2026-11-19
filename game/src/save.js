// localStorage persistence for the run (money, mission, health) and the settings menu.
const SAVE_KEY = 'solara-save-v2';
const SETTINGS_KEY = SAVE_KEY + '-settings';

export function saveGame(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  try {
    const parsedState = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    return parsedState && typeof parsedState === 'object' ? parsedState : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {}
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch {
    return {};
  }
}
