const KEY='solara-save-v2';
export function saveGame(state){try{localStorage.setItem(KEY,JSON.stringify({...state,savedAt:Date.now()}));return true;}catch{return false;}}
export function loadGame(){try{const value=JSON.parse(localStorage.getItem(KEY)||'null');return value&&typeof value==='object'?value:null;}catch{return null;}}
export function clearSave(){try{localStorage.removeItem(KEY);}catch{}}
export function saveSettings(settings){try{localStorage.setItem(KEY+'-settings',JSON.stringify(settings));}catch{}}
export function loadSettings(){try{return JSON.parse(localStorage.getItem(KEY+'-settings')||'{}');}catch{return {};}}
