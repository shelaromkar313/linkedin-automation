/**
 * LinkedIn AI Connect Assistant - Popup Script
 * Manifest V3, Vanilla JS
 * Auto-detects compatible Gemini models & falls back seamlessly
 */

const DEFAULT_PITCH = 'Unified Enterprise - IT technology solutions, telecommunications, and custom automation infrastructure';
const CANDIDATE_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-002',
  'gemini-1.5-flash-001',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro'
];

// State
let currentProfile = {
  name: '',
  headline: '',
  company: '',
  isProfilePage: false
};

// DOM Elements
const connectionBadge = document.getElementById('connectionBadge');
const targetNameEl = document.getElementById('targetName');
const targetHeadlineEl = document.getElementById('targetHeadline');
const targetCompanyEl = document.getElementById('targetCompanyText');
const btnRefreshProfile = document.getElementById('btnRefreshProfile');

const toggleSettings = document.getElementById('toggleSettings');
const settingsBody = document.getElementById('settingsBody');
const settingsArrow = document.getElementById('settingsArrow');

const apiKeyInput = document.getElementById('apiKey');
const toggleKeyVisBtn = document.getElementById('toggleKeyVisibility');
const pitchProfileInput = document.getElementById('pitchProfile');
const modelSelector = document.getElementById('modelSelector');
const btnDetectModels = document.getElementById('btnDetectModels');

// Autopilot DOM Elements
const autopilotKeywordInput = document.getElementById('autopilotKeyword');
const autopilotLimitInput = document.getElementById('autopilotLimit');
const btnStartAutopilot = document.getElementById('btnStartAutopilot');
const btnAutopilotSpinner = document.getElementById('btnAutopilotSpinner');
const btnAutopilotText = document.getElementById('btnAutopilotText');

const generatedNoteEl = document.getElementById('generatedNote');
const charCounterEl = document.getElementById('charCounter');
const btnCopyNote = document.getElementById('btnCopyNote');

const btnGenerate = document.getElementById('btnGenerate');
const btnGenSpinner = document.getElementById('btnGenSpinner');
const btnGenText = document.getElementById('btnGenText');

const btnAutoConnectCurrent = document.getElementById('btnAutoConnectCurrent');
const btnAutoConnectSpinner = document.getElementById('btnAutoConnectSpinner');
const btnAutoConnectText = document.getElementById('btnAutoConnectText');

const btnInsert = document.getElementById('btnInsert');
const statusBox = document.getElementById('statusBox');
const statusIcon = document.getElementById('statusIcon');
const statusMessage = document.getElementById('statusMessage');

const chkAutoConnectOnVisit = document.getElementById('chkAutoConnectOnVisit');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadSavedSettings();
  setupEventListeners();
  await checkActiveTabAndLoadProfile();
  await loadOutreachTracker();
});

// Load settings from chrome.storage.local
async function loadSavedSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      'geminiApiKey',
      'pitchProfile',
      'lastNote',
      'selectedModel',
      'cachedModels',
      'autoConnectOnVisit',
      'dailyScheduleActive',
      'autopilotKeyword',
      'autopilotMinEmp',
      'autopilotLimit'
    ], (result) => {
      if (result.geminiApiKey) {
        apiKeyInput.value = result.geminiApiKey;
      }
      pitchProfileInput.value = result.pitchProfile || DEFAULT_PITCH;
      if (result.lastNote) {
        generatedNoteEl.value = result.lastNote;
        updateCharCounter();
      }
      if (result.cachedModels && Array.isArray(result.cachedModels)) {
        populateModelDropdown(result.cachedModels);
      }
      if (result.selectedModel) {
        modelSelector.value = result.selectedModel;
      }
      if (chkAutoConnectOnVisit) {
        chkAutoConnectOnVisit.checked = result.autoConnectOnVisit !== false;
      }
      const chkDaily8AM = document.getElementById('chkDaily8AM');
      if (chkDaily8AM) {
        chkDaily8AM.checked = result.dailyScheduleActive !== false;
      }
      if (autopilotKeywordInput && result.autopilotKeyword) {
        autopilotKeywordInput.value = result.autopilotKeyword;
      }
      const minEmpEl = document.getElementById('autopilotMinEmp');
      if (minEmpEl && result.autopilotMinEmp) {
        minEmpEl.value = result.autopilotMinEmp;
      }
      if (autopilotLimitInput && result.autopilotLimit) {
        autopilotLimitInput.value = result.autopilotLimit;
      }
      resolve();
    });
  });
}

// Setup Event Listeners
function setupEventListeners() {
  // Auto-connect on visit toggle
  if (chkAutoConnectOnVisit) {
    chkAutoConnectOnVisit.addEventListener('change', () => {
      chrome.storage.local.set({ autoConnectOnVisit: chkAutoConnectOnVisit.checked });
      showStatus(
        chkAutoConnectOnVisit.checked ? 'Zero-Click Auto-Connect enabled!' : 'Auto-Connect on visit disabled.',
        'info'
      );
    });
  }

  // Settings collapse toggle
  toggleSettings.addEventListener('click', () => {
    const isHidden = settingsBody.style.display === 'none';
    settingsBody.style.display = isHidden ? 'flex' : 'none';
    settingsArrow.textContent = isHidden ? '▼' : '►';
  });

  // Toggle API key visibility
  toggleKeyVisBtn.addEventListener('click', () => {
    const isPassword = apiKeyInput.type === 'password';
    apiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyVisBtn.textContent = isPassword ? '🔒' : '👁';
  });

  // Auto-save settings on input
  apiKeyInput.addEventListener('input', () => {
    chrome.storage.local.set({ geminiApiKey: apiKeyInput.value.trim() });
  });

  pitchProfileInput.addEventListener('input', () => {
    chrome.storage.local.set({ pitchProfile: pitchProfileInput.value.trim() });
  });

  modelSelector.addEventListener('change', () => {
    chrome.storage.local.set({ selectedModel: modelSelector.value });
  });

  // Auto-save autopilot inputs
  if (autopilotKeywordInput) {
    autopilotKeywordInput.addEventListener('input', () => {
      chrome.storage.local.set({ autopilotKeyword: autopilotKeywordInput.value.trim() });
    });
  }
  const minEmpEl = document.getElementById('autopilotMinEmp');
  if (minEmpEl) {
    minEmpEl.addEventListener('input', () => {
      chrome.storage.local.set({ autopilotMinEmp: parseInt(minEmpEl.value, 10) || 150 });
    });
  }
  if (autopilotLimitInput) {
    autopilotLimitInput.addEventListener('input', () => {
      chrome.storage.local.set({ autopilotLimit: parseInt(autopilotLimitInput.value, 10) || 15 });
    });
  }

  // Scan Key's Models button
  btnDetectModels.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus('Please enter your Gemini API Key first.', 'error');
      return;
    }
    if (!apiKey.startsWith('AIzaSy')) {
      showStatus("Gemini API keys begin with 'AIzaSy'. Get your free key at aistudio.google.com/app/apikey", 'error');
      return;
    }
    btnDetectModels.disabled = true;
    btnDetectModels.textContent = 'Scanning...';
    showStatus('Scanning Google API for models supported by your key...', 'info');

    try {
      const models = await fetchAvailableModels(apiKey);
      if (models.length > 0) {
        populateModelDropdown(models);
        // Auto select best flash model
        const bestModel = pickBestModel(models);
        if (bestModel) {
          modelSelector.value = bestModel;
          chrome.storage.local.set({ selectedModel: bestModel });
        }
        showStatus(`Found ${models.length} compatible models! Selected: ${modelSelector.value}`, 'success');
      } else {
        showStatus('No models returned. Please check if your API key is valid.', 'error');
      }
    } catch (err) {
      showStatus('Scan failed: ' + err.message, 'error');
    } finally {
      btnDetectModels.disabled = false;
      btnDetectModels.textContent = "Scan Key's Models";
    }
  });

  // Live character counter & save last note
  generatedNoteEl.addEventListener('input', () => {
    updateCharCounter();
    chrome.storage.local.set({ lastNote: generatedNoteEl.value });
  });

  // Copy note button
  btnCopyNote.addEventListener('click', async () => {
    const note = generatedNoteEl.value.trim();
    if (!note) {
      showStatus('Nothing to copy.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(note);
      showStatus('Copied note to clipboard!', 'success');
    } catch (err) {
      showStatus('Failed to copy: ' + err.message, 'error');
    }
  });

  // Refresh profile button
  btnRefreshProfile.addEventListener('click', async () => {
    await checkActiveTabAndLoadProfile();
  });

  // Generate note button
  btnGenerate.addEventListener('click', handleGenerateNote);

  // 1-Click Connect & Send Note button
  if (btnAutoConnectCurrent) {
    btnAutoConnectCurrent.addEventListener('click', handleAutoConnectCurrent);
  }

  // Insert note button
  btnInsert.addEventListener('click', handleInsertNote);

  // Autopilot button
  if (btnStartAutopilot) {
    btnStartAutopilot.addEventListener('click', handleStartAutopilot);
  }

  // Daily 8:00 AM Scheduler Toggle
  const chkDaily8AM = document.getElementById('chkDaily8AM');
  if (chkDaily8AM) {
    chkDaily8AM.addEventListener('change', () => {
      chrome.runtime.sendMessage({ action: 'toggle_daily_schedule', enabled: chkDaily8AM.checked });
      showStatus(chkDaily8AM.checked ? '⏰ 8:00 AM Daily Outreach is ACTIVE!' : 'Daily schedule paused.', 'info');
    });
  }

  // Tracker Action Buttons
  const btnExportCSV = document.getElementById('btnExportCSV');
  if (btnExportCSV) {
    btnExportCSV.addEventListener('click', downloadOutreachCSV);
  }

  const btnCheckAccepted = document.getElementById('btnCheckAccepted');
  if (btnCheckAccepted) {
    btnCheckAccepted.addEventListener('click', handleCheckAccepted);
  }

  const btnRefreshTracker = document.getElementById('btnRefreshTracker');
  if (btnRefreshTracker) {
    btnRefreshTracker.addEventListener('click', loadOutreachTracker);
  }
}

// Start Autopilot Search & Connect Campaign (Pune CEOs, 150+ Employees)
async function handleStartAutopilot() {
  const apiKey = apiKeyInput.value.trim();
  if (apiKey && !apiKey.startsWith('AIzaSy') && !apiKey.startsWith('gsk_') && !apiKey.startsWith('sk-')) {
    showStatus('Notice: Gemini keys begin with "AIzaSy". Using smart personalized templates.', 'info');
  }

  const keyword = (autopilotKeywordInput?.value || 'CEO').trim();
  const minEmp = parseInt(document.getElementById('autopilotMinEmp')?.value, 10) || 150;
  const limit = parseInt(autopilotLimitInput?.value, 10) || 15;
  const pitch = pitchProfileInput.value.trim() || DEFAULT_PITCH;
  const model = modelSelector.value;

  const config = {
    keyword,
    limit,
    minEmployees: minEmp,
    targetLocation: 'Pune',
    apiKey,
    pitch,
    model
  };

  btnStartAutopilot.disabled = true;
  if (btnAutopilotSpinner) btnAutopilotSpinner.style.display = 'inline-block';
  if (btnAutopilotText) btnAutopilotText.textContent = 'Launching Pune CEOs...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No active browser tab found.');
    }

    // Pune Geographic URN: 103644278
    const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keyword)}&geoUrn=%5B%22103644278%22%5D&origin=GLOBAL_SEARCH_HEADER`;

    // Save active state to storage so content script activates automatically
    await new Promise((resolve) => {
      chrome.storage.local.set({
        autopilotActive: true,
        autopilotConfig: config,
        autopilotQueue: [],
        autopilotIndex: 0,
        autopilotSentCount: 0,
        autopilotFollowedCount: 0,
        autopilotSkippedCount: 0
      }, resolve);
    });

    if (tab.url && tab.url.includes('/search/results/people')) {
      sendTabMessage(tab.id, { action: 'start_autopilot', config }).catch(() => {});
      showStatus('🚀 Autopilot started on Pune CEO search results!', 'success');
    } else if (tab.url && tab.url.includes('/in/')) {
      await new Promise((resolve) => {
        chrome.storage.local.set({
          autopilotQueue: [tab.url.split('?')[0].split('#')[0]],
          autopilotIndex: 0,
          autopilotSentCount: 0,
          autopilotFollowedCount: 0,
          autopilotSkippedCount: 0
        }, resolve);
      });
      sendTabMessage(tab.id, { action: 'start_autopilot', config }).catch(() => {});
      showStatus('🚀 Autopilot connecting to this profile now! Look at page.', 'success');
    } else {
      chrome.tabs.update(tab.id, { url: searchUrl });
      showStatus('🚀 Opening Pune CEO search results! Autopilot starting...', 'success');
    }

    setTimeout(() => {
      window.close();
    }, 1800);
  } catch (err) {
    showStatus('Autopilot error: ' + err.message, 'error');
    btnStartAutopilot.disabled = false;
    if (btnAutopilotSpinner) btnAutopilotSpinner.style.display = 'none';
    if (btnAutopilotText) btnAutopilotText.textContent = '🚀 Start Autopilot';
  }
}

// Update Character Counter
function updateCharCounter() {
  const len = generatedNoteEl.value.length;
  charCounterEl.textContent = `${len} / 240 chars`;

  charCounterEl.className = 'char-counter';
  if (len > 300) {
    charCounterEl.classList.add('danger');
    charCounterEl.textContent = `${len} / 300 chars (Too long for LinkedIn!)`;
  } else if (len > 240) {
    charCounterEl.classList.add('warning');
  }
}

// Display status message
function showStatus(message, type = 'info') {
  statusBox.className = `status-box show ${type}`;
  statusMessage.textContent = message;

  if (type === 'success') {
    statusIcon.textContent = '✅';
  } else if (type === 'error') {
    statusIcon.textContent = '⚠️';
  } else {
    statusIcon.textContent = 'ℹ️';
  }
}

// Active Tab & Profile Detection
async function checkActiveTabAndLoadProfile() {
  connectionBadge.className = 'badge-status';
  connectionBadge.textContent = 'Scanning...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url) {
      setConnectionStatus(false, 'No Tab Found');
      return;
    }

    const isLinkedIn = tab.url.includes('linkedin.com');
    const isProfile = tab.url.includes('linkedin.com/in/');

    if (!isLinkedIn) {
      currentProfile.isProfilePage = false;
      setConnectionStatus(false, 'Not LinkedIn');
      targetNameEl.textContent = 'Not on LinkedIn';
      targetHeadlineEl.textContent = 'Please open a target LinkedIn profile page (e.g. linkedin.com/in/...).';
      targetCompanyEl.textContent = 'Company: -';
      return;
    }

    if (!isProfile) {
      currentProfile.isProfilePage = false;
      setConnectionStatus(true, 'LinkedIn Feed', 'warning');
      targetNameEl.textContent = 'Not a Profile Page';
      targetHeadlineEl.textContent = 'Open an individual profile (linkedin.com/in/...) to craft notes.';
      targetCompanyEl.textContent = 'Company: -';
      return;
    }

    currentProfile.isProfilePage = true;

    // Try communicating with content script
    try {
      const response = await sendTabMessage(tab.id, { action: 'get_profile_data' });
      applyProfileData(response);
    } catch (e) {
      console.log('Content script not responsive, attempting dynamic injection...', e);
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await new Promise((r) => setTimeout(r, 200));
        const retryResponse = await sendTabMessage(tab.id, { action: 'get_profile_data' });
        applyProfileData(retryResponse);
      } catch (injectionError) {
        console.error('Failed to inject or reach content script:', injectionError);
        setConnectionStatus(true, 'Script Error', 'warning');
        showStatus('Could not read LinkedIn page. Please reload the LinkedIn profile tab.', 'error');
      }
    }
  } catch (err) {
    console.error('Error checking tab:', err);
    setConnectionStatus(false, 'Tab Error');
  }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

function applyProfileData(data) {
  if (data && data.success && data.profile) {
    currentProfile = data.profile;
    targetNameEl.textContent = currentProfile.name || 'Name not detected';
    targetHeadlineEl.textContent = currentProfile.headline || 'Headline not detected';
    targetCompanyEl.textContent = currentProfile.company
      ? `Company: ${currentProfile.company}`
      : 'Company: Not detected (will infer from headline)';

    setConnectionStatus(true, 'Profile Ready', 'active');
    showStatus('Profile captured. Ready to generate connection note.', 'info');
  } else {
    targetNameEl.textContent = 'Profile Loading...';
    targetHeadlineEl.textContent = 'Profile elements still rendering or not fully loaded.';
    setConnectionStatus(true, 'Waiting for DOM', 'warning');
  }
}

function setConnectionStatus(isConnected, text, stateClass = '') {
  connectionBadge.className = 'badge-status ' + stateClass;
  connectionBadge.textContent = text;
}

function isEligibleTextModel(name) {
  const lower = name.toLowerCase();
  // Filter out audio, speech, TTS, embeddings, image, robotics models
  if (
    lower.includes('tts') ||
    lower.includes('audio') ||
    lower.includes('speech') ||
    lower.includes('embed') ||
    lower.includes('imagen') ||
    lower.includes('aqa') ||
    lower.includes('deep-research') ||
    lower.includes('robotics')
  ) {
    return false;
  }
  return true;
}

/**
 * Fetch available models from Google API for the given key
 */
async function fetchAvailableModels(apiKey) {
  if (!apiKey || !apiKey.startsWith('AIzaSy')) {
    throw new Error("Invalid Gemini API Key format. Keys from Google AI Studio begin with 'AIzaSy'.");
  }
  const versions = ['v1beta', 'v1'];
  let lastErr = null;

  for (const ver of versions) {
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models?key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const models = (data.models || [])
          .filter(
            (m) =>
              m.supportedGenerationMethods &&
              m.supportedGenerationMethods.includes('generateContent') &&
              isEligibleTextModel(m.name)
          )
          .map((m) => m.name.replace(/^models\//, ''));

        if (models.length > 0) {
          chrome.storage.local.set({ cachedModels: models });
          return models;
        }
      } else {
        const err = await resp.json().catch(() => ({}));
        lastErr = new Error(err.error?.message || `HTTP ${resp.status}`);
      }
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error('No models found.');
}

function populateModelDropdown(models) {
  const currentVal = modelSelector.value;
  modelSelector.innerHTML = '<option value="auto">Auto-Detect & Fallback (Recommended)</option>';

  // Sort models: Gemini Flash first, then other Gemini, then rest
  models.sort((a, b) => {
    const score = (name) => {
      const lower = name.toLowerCase();
      if (lower.includes('gemini') && lower.includes('2.0') && lower.includes('flash')) return 1;
      if (lower.includes('gemini') && lower.includes('flash')) return 2;
      if (lower.includes('gemini') && lower.includes('pro')) return 3;
      if (lower.includes('gemini')) return 4;
      return 5;
    };
    return score(a) - score(b) || a.localeCompare(b);
  });

  models.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    modelSelector.appendChild(opt);
  });

  if (models.includes(currentVal)) {
    modelSelector.value = currentVal;
  }
}

function pickBestModel(models) {
  // Filter out any non-text models
  const textModels = models.filter(isEligibleTextModel);
  // 1. Gemini 2.0 Flash or Gemini 1.5 Flash
  const flash = textModels.find((m) => m.includes('gemini') && m.includes('flash'));
  if (flash) return flash;
  // 2. Any Gemini model
  const anyGem = textModels.find((m) => m.includes('gemini'));
  if (anyGem) return anyGem;
  return textModels[0] || 'gemini-2.0-flash';
}

/**
 * Call Gemini generateContent API with multi-version fallback (v1beta & v1)
 */
async function callGeminiGenerate(apiKey, modelName, prompt) {
  if (!apiKey || !apiKey.startsWith('AIzaSy')) {
    throw new Error("Invalid Gemini API Key format. Keys from Google AI Studio begin with 'AIzaSy'.");
  }
  const versions = ['v1beta', 'v1'];
  let lastErr = null;

  for (const ver of versions) {
    try {
      const url = `https://generativelanguage.googleapis.com/${ver}/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const requestBody = {
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 60
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const err = new Error(errData.error?.message || `HTTP ${response.status} ${response.statusText}`);
        err.status = response.status;
        err.errorDetails = errData;
        lastErr = err;
        continue;
      }

      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr;
}

// Generate Connection Note with Intelligent Model Auto-Fallback
async function handleGenerateNote() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    settingsBody.style.display = 'flex';
    settingsArrow.textContent = '▼';
    apiKeyInput.focus();
    showStatus('Please provide your free Google Gemini API Key first.', 'error');
    return;
  }

  if (!currentProfile.isProfilePage) {
    showStatus("You are currently on the LinkedIn Feed. Please navigate to an individual's profile (e.g. linkedin.com/in/...) to generate a tailored note.", 'error');
    return;
  }

  const pitch = pitchProfileInput.value.trim() || DEFAULT_PITCH;
  const name = currentProfile.name && currentProfile.name !== 'No Profile Detected'
    ? currentProfile.name
    : 'Professional Colleague';
  const headline = currentProfile.headline || 'Executive / Industry Leader';

  // Direct, concise prompt formulation that prevents instruction-echoing
  const prompt = `Draft a personalized 1-2 sentence LinkedIn connection request note for ${name} (${headline}).
My context: ${pitch}
Directives:
- Strictly under 220 characters total.
- Highlight synergy or shared professional interest. Do not pitch products directly.
- Output ONLY the ready-to-send message text. Do not output rules, bullets, quotes, or preambles.`;

  setGeneratingLoading(true);
  showStatus('Consulting AI engine...', 'info');

  let generatedText = '';
  let successfulModel = '';
  let lastError = null;

  // 1. Groq Cloud (Free Llama 3.3)
  if (apiKey.startsWith('gsk_')) {
    try {
      showStatus('Connecting to Groq (Llama 3.3)...', 'info');
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 60,
          temperature: 0.5
        })
      });
      if (res.ok) {
        const data = await res.json();
        generatedText = data.choices?.[0]?.message?.content || '';
        successfulModel = 'Groq Llama 3.3';
      }
    } catch (e) {}
  }

  // 2. OpenRouter / OpenAI
  if (!generatedText && apiKey.startsWith('sk-')) {
    try {
      showStatus('Connecting to OpenAI / OpenRouter...', 'info');
      const endpoint = apiKey.startsWith('sk-or-')
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const model = apiKey.startsWith('sk-or-') ? 'meta-llama/llama-3.1-8b-instruct:free' : 'gpt-4o-mini';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 60,
          temperature: 0.5
        })
      });
      if (res.ok) {
        const data = await res.json();
        generatedText = data.choices?.[0]?.message?.content || '';
        successfulModel = model;
      }
    } catch (e) {}
  }

  // 3. Google Gemini (AI Studio) - strictly require AIzaSy to prevent 404 network errors
  if (!generatedText && apiKey.startsWith('AIzaSy')) {
    const selectedModelSetting = modelSelector.value;
    let modelsToTry = [];

    if (selectedModelSetting !== 'auto') {
      modelsToTry.push(selectedModelSetting);
    }
    CANDIDATE_MODELS.forEach((m) => {
      if (!modelsToTry.includes(m)) modelsToTry.push(m);
    });

    for (const model of modelsToTry) {
      try {
        showStatus(`Connecting to ${model}...`, 'info');
        generatedText = await callGeminiGenerate(apiKey, model, prompt);
        successfulModel = model;
        break;
      } catch (err) {
        console.log(`Model ${model} trial note:`, err.message);
        lastError = err;
        if (err.message.includes('API_KEY_INVALID') || err.message.includes('API key not valid')) {
          break;
        }
      }
    }

    if (!generatedText && (!lastError || !lastError.message.includes('API_KEY_INVALID'))) {
      try {
        showStatus('Scanning your key for active models...', 'info');
        const liveModels = await fetchAvailableModels(apiKey);
        if (liveModels.length > 0) {
          populateModelDropdown(liveModels);
          for (const model of liveModels) {
            if (!modelsToTry.includes(model)) {
              try {
                showStatus(`Trying available model: ${model}...`, 'info');
                generatedText = await callGeminiGenerate(apiKey, model, prompt);
                successfulModel = model;
                break;
              } catch (innerErr) {
                lastError = innerErr;
              }
            }
          }
        }
      } catch (scanErr) {
        console.log('Model scan info:', scanErr.message);
      }
    }
  }

  // Fallback: If no API responded, use high-converting personalized template
  if (!generatedText) {
    const firstName = name.split(' ')[0] || 'there';
    const cleanHeadline = (headline || 'hardware manufacturing').replace(/[\r\n\t]+/g, ' ').slice(0, 35).trim();
    generatedText = `Hi ${firstName}, saw your leadership work in ${cleanHeadline}. Would love to connect and share industry insights!`;
    successfulModel = 'Smart Template';
  }

  setGeneratingLoading(false);

  generatedText = cleanGeneratedNote(generatedText);
  generatedNoteEl.value = generatedText;
  updateCharCounter();
  chrome.storage.local.set({ lastNote: generatedText });

  showStatus(`Generated note via ${successfulModel}! Ready to insert or send.`, 'success');
}

// Clean generated text to remove accidental enclosing quotes, instruction echo, and enforce <= 240 chars
function cleanGeneratedNote(text) {
  if (!text) return '';

  // 1. Split lines and filter out constraint echos, rules, or system reasoning
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      // Filter lines matching rules or constraints
      if (/^(\*|-|\d+\.)?\s*(constraint|rule|rules|directives|here is|here's|note:)/i.test(l)) return false;
      if (/^(under 240|strictly under|highlight synergy|no quotes|ready to send)/i.test(l)) return false;
      return true;
    });

  let cleaned = lines.join(' ').trim();

  // 2. Strip wrapping quotes or markdown backticks
  cleaned = cleaned.replace(/^["'`*]+|["'`*]+$/g, '').trim();

  // 3. Remove common accidental placeholders like "[Your Name]", "[Name]", etc.
  cleaned = cleaned.replace(/\[(?:Your Name|Name|My Name)\]/gi, '').trim();

  // 4. Strict ceiling: Enforce <= 240 characters
  if (cleaned.length > 240) {
    // Find the last period, exclamation, or question mark before 235 chars
    const lastPunctuation = Math.max(
      cleaned.lastIndexOf('.', 238),
      cleaned.lastIndexOf('!', 238),
      cleaned.lastIndexOf('?', 238)
    );

    if (lastPunctuation > 110) {
      cleaned = cleaned.substring(0, lastPunctuation + 1);
    } else {
      const lastSpace = cleaned.lastIndexOf(' ', 234);
      cleaned = (lastSpace > 0 ? cleaned.substring(0, lastSpace) : cleaned.substring(0, 234)) + '.';
    }
  }

  return cleaned.trim();
}

function setGeneratingLoading(isLoading) {
  btnGenerate.disabled = isLoading;
  btnGenSpinner.style.display = isLoading ? 'inline-block' : 'none';
  btnGenText.textContent = isLoading ? 'Crafting note...' : '✨ Generate AI Connection Note';
}

// Insert into LinkedIn Connect Modal
async function handleInsertNote() {
  const note = generatedNoteEl.value.trim();
  if (!note) {
    showStatus('Please generate or enter a note before inserting.', 'error');
    return;
  }

  if (note.length > 300) {
    showStatus(`Note is ${note.length} characters. LinkedIn maximum limit is 300. Please shorten it.`, 'error');
    return;
  }

  btnInsert.disabled = true;
  showStatus('Locating LinkedIn Connect button and modal...', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No active LinkedIn tab found.');
    }

    const response = await sendTabMessage(tab.id, {
      action: 'insert_connect_note',
      note: note
    });

    if (response && response.success) {
      showStatus(response.message || 'Note inserted into modal! Ready for your review.', 'success');
    } else {
      showStatus(response?.message || 'Failed to insert note into LinkedIn modal.', 'error');
    }
  } catch (err) {
    console.error('Insert Error:', err);
    showStatus('Error communicating with LinkedIn tab: ' + err.message, 'error');
  } finally {
    btnInsert.disabled = false;
  }
}

// 1-Click Connect & Send Note on Current Profile Tab
async function handleAutoConnectCurrent() {
  let note = generatedNoteEl.value.trim();
  if (!note) {
    showStatus('Composing personalized note...', 'info');
    await handleGenerateNote();
    note = generatedNoteEl.value.trim();
  }

  if (!note) {
    const firstName = currentProfile.name ? currentProfile.name.split(' ')[0] : 'there';
    const cleanHeadline = (currentProfile.headline || 'Industry Leader').replace(/[\r\n\t]+/g, ' ').slice(0, 35).trim();
    note = `Hi ${firstName}, saw your leadership work in ${cleanHeadline}. Would love to connect and share industry insights!`;
    generatedNoteEl.value = note;
    updateCharCounter();
  }

  setAutoConnectLoading(true);
  showStatus('Connecting to candidate & sending personalized note...', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No active LinkedIn tab found.');
    }

    const response = await sendTabMessage(tab.id, {
      action: 'auto_connect_and_send',
      note: note
    });

    if (response && response.success) {
      showStatus(response.message || '✅ Connection invitation with note sent successfully!', 'success');
    } else {
      showStatus(response?.message || 'Could not send invitation. Check profile tab.', 'error');
    }
  } catch (err) {
    console.error('AutoConnect Error:', err);
    showStatus('Error communicating with LinkedIn tab: ' + err.message, 'error');
  } finally {
    setAutoConnectLoading(false);
  }
}

function setAutoConnectLoading(isLoading) {
  if (!btnAutoConnectCurrent) return;
  btnAutoConnectCurrent.disabled = isLoading;
  if (btnAutoConnectSpinner) btnAutoConnectSpinner.style.display = isLoading ? 'inline-block' : 'none';
  if (btnAutoConnectText) btnAutoConnectText.textContent = isLoading ? 'Connecting & Sending...' : '⚡ Connect & Send Note (1-Click)';
}

// ============================================================
// OUTREACH CRM TRACKER & CSV EXPORT (100% FREE TRACKING)
// ============================================================

async function loadOutreachTracker() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['outreachHistory'], (res) => {
      const history = res.outreachHistory || [];

      const statTotalSent = document.getElementById('statTotalSent');
      const statPending = document.getElementById('statPending');
      const statAccepted = document.getElementById('statAccepted');
      const statMessaged = document.getElementById('statMessaged');
      const trackerList = document.getElementById('trackerList');

      const totalSent = history.length;
      const acceptedCount = history.filter((h) => h.status === 'Accepted' || !!h.acceptedDate).length;
      const messagedCount = history.filter((h) => !!h.followUpSent).length;
      const pendingCount = totalSent - acceptedCount;

      if (statTotalSent) statTotalSent.textContent = totalSent;
      if (statPending) statPending.textContent = Math.max(0, pendingCount);
      if (statAccepted) statAccepted.textContent = acceptedCount;
      if (statMessaged) statMessaged.textContent = messagedCount;

      if (!trackerList) {
        resolve();
        return;
      }

      if (history.length === 0) {
        trackerList.innerHTML = '<div style="padding: 8px; color: #94a3b8; text-align: center;">No outreach logged yet. Start outreach above!</div>';
        resolve();
        return;
      }

      let html = '';
      history.slice(0, 50).forEach((item) => {
        const isAccepted = item.status === 'Accepted' || !!item.acceptedDate;
        const statusBadge = isAccepted
          ? '<span style="color: #059669; font-weight: 700; background: #ecfdf5; padding: 2px 4px; border-radius: 3px;">Accepted</span>'
          : '<span style="color: #d97706; font-weight: 600; background: #fffbeb; padding: 2px 4px; border-radius: 3px;">Pending</span>';

        const messagedBadge = item.followUpSent
          ? ' <span style="color: #2563eb; font-size: 9px; background: #eff6ff; padding: 1px 3px; border-radius: 3px;">Messaged</span>'
          : '';

        html += `
          <div style="padding: 5px 8px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; gap: 4px;">
            <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <a href="${escapeHtml(item.url || '#')}" target="_blank" style="color: #0a66c2; font-weight: 600; text-decoration: none;">
                ${escapeHtml(item.name || 'Candidate')}
              </a>
              <div style="color: #64748b; font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${escapeHtml(item.headline || item.company || 'CEO in Pune')}
              </div>
            </div>
            <div style="text-align: right; flex-shrink: 0; font-size: 9.5px;">
              ${statusBadge}${messagedBadge}
              <div style="color: #94a3b8; font-size: 8.5px; margin-top: 2px;">${escapeHtml(item.dateSent ? item.dateSent.split(',')[0] : '')}</div>
            </div>
          </div>
        `;
      });

      trackerList.innerHTML = html;
      resolve();
    });
  });
}

function downloadOutreachCSV() {
  chrome.storage.local.get(['outreachHistory'], (res) => {
    const history = res.outreachHistory || [];
    if (history.length === 0) {
      showStatus('No outreach leads recorded yet to export.', 'error');
      return;
    }

    const headers = ['Name', 'Headline / Role', 'Company', 'Location', 'Profile URL', 'Date Sent', 'Status', 'Accepted Date', 'FollowUp Sent', 'Connection Note'];
    const rows = history.map((h) => [
      `"${(h.name || '').replace(/"/g, '""')}"`,
      `"${(h.headline || '').replace(/"/g, '""')}"`,
      `"${(h.company || '').replace(/"/g, '""')}"`,
      `"${(h.location || 'Pune').replace(/"/g, '""')}"`,
      `"${(h.url || '').replace(/"/g, '""')}"`,
      `"${(h.dateSent || '').replace(/"/g, '""')}"`,
      `"${(h.status || 'Pending').replace(/"/g, '""')}"`,
      `"${(h.acceptedDate || '').replace(/"/g, '""')}"`,
      `"${h.followUpSent ? 'Yes' : 'No'}"`,
      `"${(h.note || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = url;
    downloadAnchor.setAttribute('download', `linkedin_ceo_pune_outreach_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    document.body.removeChild(downloadAnchor);
    URL.revokeObjectURL(url);

    showStatus(`Exported ${history.length} leads to CSV report for your boss!`, 'success');
  });
}

function handleCheckAccepted() {
  showStatus('Opening LinkedIn connections to check acceptances and send follow-ups...', 'info');
  chrome.runtime.sendMessage({ action: 'check_accepted_connections' }, (response) => {
    if (chrome.runtime.lastError) {
      chrome.tabs.create({ url: 'https://www.linkedin.com/mynetwork/invite-connect/connections/', active: true });
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


