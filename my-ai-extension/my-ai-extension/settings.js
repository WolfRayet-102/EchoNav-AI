// settings.js

const toggleLocal    = document.getElementById('toggle-local');
const cloudSection   = document.getElementById('cloud-section');
const localSection   = document.getElementById('local-section');
const cloudProvider  = document.getElementById('cloud-provider');
const geminiFields   = document.getElementById('gemini-fields');
const mistralFields  = document.getElementById('mistral-fields');
const geminiKey      = document.getElementById('gemini-key');
const geminiModel    = document.getElementById('gemini-model');
const mistralKey     = document.getElementById('mistral-key');
const mistralModel   = document.getElementById('mistral-model');
const ollamaUrl      = document.getElementById('ollama-url');
const ollamaModel    = document.getElementById('ollama-model');
const voiceSpeed     = document.getElementById('voice-speed');
const speedDisplay   = document.getElementById('speed-display');
const btnSave        = document.getElementById('btn-save');
const statusEl       = document.getElementById('status');


// ── Show/hide local vs cloud sections ────────────────────────────────────
function updateSections() {
  if (toggleLocal.checked) {
    localSection.style.display = 'block';
    cloudSection.style.display = 'none';
  } else {
    cloudSection.style.display = 'block';
    localSection.style.display = 'none';
  }
}

// ── Show/hide Gemini vs Mistral fields ───────────────────────────────────
// Runs whenever the provider dropdown changes
function updateProviderFields() {
  if (cloudProvider.value === 'mistral') {
    mistralFields.style.display = 'block';
    geminiFields.style.display  = 'none';
  } else {
    geminiFields.style.display  = 'block';
    mistralFields.style.display = 'none';
  }
}

toggleLocal.addEventListener('change', updateSections);
cloudProvider.addEventListener('change', updateProviderFields);


// ── Live speed display ───────────────────────────────────────────────────
voiceSpeed.addEventListener('input', () => {
  speedDisplay.textContent = parseFloat(voiceSpeed.value).toFixed(1) + 'x';
});


// ── LOAD saved settings ──────────────────────────────────────────────────
chrome.storage.sync.get({
  useLocalAI:    false,
  cloudProvider: 'gemini',
  geminiKey:     '',
  geminiModel:   'gemini-2.0-flash',
  mistralKey:    '',
  mistralModel:  'mistral-small-latest',
  ollamaUrl:     'http://localhost:11434',
  ollamaModel:   'gemma3:4b',
  voiceSpeed:    1.1,
}, (s) => {
  toggleLocal.checked    = s.useLocalAI;
  cloudProvider.value    = s.cloudProvider;
  geminiKey.value        = s.geminiKey;
  geminiModel.value      = s.geminiModel;
  mistralKey.value       = s.mistralKey;
  mistralModel.value     = s.mistralModel;
  ollamaUrl.value        = s.ollamaUrl;
  ollamaModel.value      = s.ollamaModel;
  voiceSpeed.value       = s.voiceSpeed;
  speedDisplay.textContent = parseFloat(s.voiceSpeed).toFixed(1) + 'x';

  updateSections();
  updateProviderFields();
});


// ── SAVE settings ────────────────────────────────────────────────────────
btnSave.addEventListener('click', () => {

  // Validate — make sure the right key is filled for the chosen provider
  if (!toggleLocal.checked) {
    if (cloudProvider.value === 'gemini' && !geminiKey.value.trim()) {
      showStatus('Please enter your Gemini API key.', 'err');
      return;
    }
    if (cloudProvider.value === 'mistral' && !mistralKey.value.trim()) {
      showStatus('Please enter your Mistral API key.', 'err');
      return;
    }
  }

  if (toggleLocal.checked && !ollamaUrl.value.trim()) {
    showStatus('Please enter your Ollama server URL.', 'err');
    return;
  }

  const settings = {
    useLocalAI:    toggleLocal.checked,
    cloudProvider: cloudProvider.value,
    geminiKey:     geminiKey.value.trim(),
    geminiModel:   geminiModel.value,
    mistralKey:    mistralKey.value.trim(),
    mistralModel:  mistralModel.value,
    ollamaUrl:     ollamaUrl.value.trim(),
    ollamaModel:   ollamaModel.value.trim(),
    voiceSpeed:    parseFloat(voiceSpeed.value),
  };

  chrome.storage.sync.set(settings, () => {
    showStatus('Settings saved!', 'ok');
  });
});


// ── Status toast ─────────────────────────────────────────────────────────
function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className   = type === 'ok' ? 'status-ok' : 'status-err';
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className   = '';
  }, 3000);
}