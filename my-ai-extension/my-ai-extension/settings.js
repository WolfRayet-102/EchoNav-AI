// settings.js
// Handles saving and loading all settings from Chrome's storage.
// chrome.storage.sync stores data tied to the user's Google account —
// it syncs across all their Chrome browsers automatically.

// ── Get references to every element we need ───────────────────────────────
const toggleLocal  = document.getElementById('toggle-local');
const cloudSection = document.getElementById('cloud-section');
const localSection = document.getElementById('local-section');
const geminiKey    = document.getElementById('gemini-key');
const geminiModel  = document.getElementById('gemini-model');
const ollamaUrl    = document.getElementById('ollama-url');
const ollamaModel  = document.getElementById('ollama-model');
const voiceSpeed   = document.getElementById('voice-speed');
const speedDisplay = document.getElementById('speed-display');
const btnSave      = document.getElementById('btn-save');
const statusEl     = document.getElementById('status');


// ── Show / hide the right AI section based on the toggle ─────────────────
// This runs every time the toggle changes, and also on page load.
function updateSections() {
  if (toggleLocal.checked) {
    // User wants local AI — show Ollama fields, hide Gemini fields
    localSection.style.display = 'block';
    cloudSection.style.display = 'none';
  } else {
    // User wants cloud AI — show Gemini fields, hide Ollama fields
    cloudSection.style.display = 'block';
    localSection.style.display = 'none';
  }
}

toggleLocal.addEventListener('change', updateSections);


// ── Update the speed number as the slider moves ───────────────────────────
// This gives the user live feedback while dragging the slider.
voiceSpeed.addEventListener('input', () => {
  speedDisplay.textContent = parseFloat(voiceSpeed.value).toFixed(1) + 'x';
});


// ── LOAD saved settings when the page opens ───────────────────────────────
// chrome.storage.sync.get() reads from storage.
// The object passed in provides DEFAULT values if nothing is saved yet.
// This means first-time users get sensible defaults automatically.
chrome.storage.sync.get({
  useLocalAI:   false,
  geminiKey:    '',
  geminiModel:  'gemini-2.0-flash',
  ollamaUrl:    'http://localhost:11434',
  ollamaModel:  'gemma3:4b',
  voiceSpeed:   1.1,
}, (settings) => {
  // Populate every field with whatever was saved
  toggleLocal.checked      = settings.useLocalAI;
  geminiKey.value          = settings.geminiKey;
  geminiModel.value        = settings.geminiModel;
  ollamaUrl.value          = settings.ollamaUrl;
  ollamaModel.value        = settings.ollamaModel;
  voiceSpeed.value         = settings.voiceSpeed;
  speedDisplay.textContent = parseFloat(settings.voiceSpeed).toFixed(1) + 'x';

  // Update which section is visible based on loaded setting
  updateSections();
});


// ── SAVE settings when the button is clicked ──────────────────────────────
btnSave.addEventListener('click', () => {

  // Basic validation — make sure the right key is filled in
  if (!toggleLocal.checked && !geminiKey.value.trim()) {
    showStatus('Please enter your Gemini API key.', 'err');
    return;
  }

  if (toggleLocal.checked && !ollamaUrl.value.trim()) {
    showStatus('Please enter your Ollama server URL.', 'err');
    return;
  }

  // Build the settings object to save
  const settings = {
    useLocalAI:  toggleLocal.checked,
    geminiKey:   geminiKey.value.trim(),
    geminiModel: geminiModel.value,
    ollamaUrl:   ollamaUrl.value.trim(),
    ollamaModel: ollamaModel.value.trim(),
    voiceSpeed:  parseFloat(voiceSpeed.value),
  };

  // chrome.storage.sync.set() writes to storage.
  // The callback runs after the save is confirmed complete.
  chrome.storage.sync.set(settings, () => {
    showStatus('Settings saved!', 'ok');
  });
});


// ── Helper: show a status message that fades out ──────────────────────────
// This is a small reusable function — instead of repeating the same
// 4 lines every time you want to show a message, you call this once.
function showStatus(message, type) {
  statusEl.textContent  = message;
  statusEl.className    = type === 'ok' ? 'status-ok' : 'status-err';

  // After 3 seconds, clear the message
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className   = '';
  }, 3000);
}