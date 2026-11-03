'use strict';
// Remplit seulement la version ; ne fait rien hors extension.
try {
  const el = document.getElementById('version');
  if (el && typeof chrome !== 'undefined' && chrome.runtime) {
    el.textContent = chrome.runtime.getManifest().version;
  }
} catch (e) { /* hors extension */ }
