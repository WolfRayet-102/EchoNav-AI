// sidepanel.js
// The brain of the extension — handles voice, AI calls, and all browser actions.

document.addEventListener('DOMContentLoaded', () => {

  // ══════════════════════════════════════════════════════════════════════
  // 1. STATE
  // ══════════════════════════════════════════════════════════════════════

  let settings     = {};
  let isListening  = false;
  let recognition  = null;
  let lastResponse = '';
  let chatHistory  = [];


  // ══════════════════════════════════════════════════════════════════════
  // 2. DOM ELEMENTS
  // ══════════════════════════════════════════════════════════════════════

  const chat        = document.getElementById('chat-container');
  const input       = document.getElementById('user-input');
  const micBtn      = document.getElementById('btn-mic');
  const sendBtn     = document.getElementById('btn-send');
  const settingsBtn = document.getElementById('btn-settings');
  const modeLabel   = document.getElementById('mode-label');


  // ══════════════════════════════════════════════════════════════════════
  // 3. INITIALISATION
  // ══════════════════════════════════════════════════════════════════════

  chrome.storage.sync.get({
    useLocalAI:    false,
    cloudProvider: 'gemini',       // FIX #5: was 'mistral' here, 'gemini' in settings.js — now unified
    geminiKey:     '',
    geminiModel:   'gemini-2.0-flash',
    mistralKey:    '',
    mistralModel:  'mistral-small-latest',
    ollamaUrl:     'http://localhost:11434',
    ollamaModel:   'gemma3:4b',
    voiceSpeed:    1.1,
  }, (loaded) => {
    settings = loaded;
    modeLabel.textContent = settings.useLocalAI ? 'Local AI' : 'Cloud AI';

    const hasKey = settings.useLocalAI
      ? !!settings.ollamaUrl
      : (settings.cloudProvider === 'mistral' ? !!settings.mistralKey : !!settings.geminiKey);

    if (!hasKey) {
      log('⚙️ No API key found. Click Settings to add your Mistral or Gemini key.', 'system');
    } else {
      log(`Ready. Using ${settings.cloudProvider}. Click the mic or press Alt+Shift+2.`, 'system');
    }
  });


  // ══════════════════════════════════════════════════════════════════════
  // 4. LOGGING
  // ══════════════════════════════════════════════════════════════════════

  function log(text, type, imageSrc = null) {
    const div = document.createElement('div');
    div.className = `message ${type}`;
    div.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    if (imageSrc) {
      const img = document.createElement('img');
      img.src = imageSrc;
      div.appendChild(img);
    }

    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }


  // ══════════════════════════════════════════════════════════════════════
  // 5. TEXT TO SPEECH
  // ══════════════════════════════════════════════════════════════════════

  function speak(text) {
    if (!text) return;
    window.speechSynthesis.cancel();

    const cleanText = text
      .replace(/[*#_`]/g, '')
      .replace(/```[\s\S]*?```/g, 'code block')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang  = 'en-US';
    utterance.rate  = settings.voiceSpeed || 1.1;
    window.speechSynthesis.speak(utterance);
  }


  // ══════════════════════════════════════════════════════════════════════
  // 6. AI — CORE FUNCTION
  // FIX #3: Added full Mistral support in the cloud path.
  // Previously the else branch only ever called Gemini regardless of
  // the cloudProvider setting.
  // ══════════════════════════════════════════════════════════════════════

  async function callAI(userMessage) {
    chatHistory.push({ role: 'user', content: userMessage });

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message ai';
    loadingDiv.textContent = '...';
    chat.appendChild(loadingDiv);
    chat.scrollTop = chat.scrollHeight;

    const SYSTEM_PROMPT = `You are A-Eye, an accessibility voice assistant built 
    into the Chrome browser for blind and visually impaired users. 
    You help users navigate the web, read page content, and perform 
    browser actions entirely by voice. Be concise, warm, and clear. 
    Never use visual language like "as you can see" or "look at this".`;

    try {
      let responseText = '';

      if (settings.useLocalAI) {

        // ── LOCAL PATH: Ollama ────────────────────────────────────────
        const response = await fetch(`${settings.ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: settings.ollamaModel,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              ...chatHistory
            ],
            stream: false
          })
        });

        const data = await response.json();
        responseText = data.message.content;

      } else if (settings.cloudProvider === 'mistral') {

        // ── CLOUD PATH: Mistral ───────────────────────────────────────
        // FIX #3: This entire branch was missing. Mistral uses an
        // OpenAI-compatible messages format with a system role message.
        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.mistralKey}`
          },
          body: JSON.stringify({
            model: settings.mistralModel,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              ...chatHistory
            ]
          })
        });

        const data = await response.json();

        if (!data.choices || !data.choices[0]) {
          throw new Error(data.error?.message || 'No response from Mistral.');
        }

        responseText = data.choices[0].message.content;

      } else {

        // ── CLOUD PATH: Gemini ────────────────────────────────────────
        const geminiMessages = chatHistory.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }));

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent?key=${settings.geminiKey}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: {
              parts: [{ text: SYSTEM_PROMPT }]
            },
            contents: geminiMessages
          })
        });

        const data = await response.json();

        if (!data.candidates || !data.candidates[0]) {
          throw new Error(data.error?.message || 'No response from Gemini.');
        }

        responseText = data.candidates[0].content.parts[0].text;
      }

      loadingDiv.remove();
      chatHistory.push({ role: 'assistant', content: responseText });
      lastResponse = responseText;
      return responseText;

    } catch (err) {
      loadingDiv.remove();
      const msg = `Error: ${err.message}`;
      log(msg, 'system');
      speak('There was an error. Please check your settings.');
      return null;
    }
  }


  // ══════════════════════════════════════════════════════════════════════
  // 7. INTENT CLASSIFIER
  // FIX #1 + #2: classifyIntent is now a single, top-level function.
  // Previously it was (a) defined twice and (b) the local regex version
  // was nested inside processVoiceInput, which was itself nested inside
  // an outer processVoiceInput — causing nothing to work.
  //
  // Using fast local regex classification (no API call needed).
  // ══════════════════════════════════════════════════════════════════════

  function classifyIntent(text) {
    const t = text.toLowerCase().trim();

    if (/^(go to|open|navigate to|take me to)\s+\S+/.test(t)) {
      const target = t.replace(/^(go to|open|navigate to|take me to)\s+/, '').trim();
      return { action: 'navigate', target };
    }

    if (/^search (for |up )?/.test(t)) {
      const target = t.replace(/^search (for |up )?/, '').trim();
      return { action: 'navigate', target };
    }

    if (/read (this |the )?(page|article|content)|summari[sz]e|what('s| is) on this page|read page/.test(t)) {
      return { action: 'read_page' };
    }

    if (/capture|screenshot|describe (the |this )?screen|what('s| is) on (the |this )?screen|what do you see/.test(t)) {
      return { action: 'screenshot' };
    }

    if (/scroll (down|up|to top|to bottom)/.test(t)) {
      const dir = t.includes('up') || t.includes('top') ? 'up' : 'down';
      return { action: 'scroll', target: dir };
    }

    if (/^(click|press|select|tap|choose)\s+/.test(t)) {
      const target = t.replace(/^(click|press|select|tap|choose)\s+/, '').trim();
      return { action: 'click', target };
    }

    if (/fill (in |out )?|type .+ in|enter .+ in|submit (the )?form/.test(t)) {
      return { action: 'fill_form' };
    }

    if (/find .+ on (this |the )?page|search on page/.test(t)) {
      const target = t.replace(/find (.+) on (this |the )?page/, '$1').trim();
      return { action: 'search', target };
    }

    return { action: 'chat', query: t };
  }


  // ══════════════════════════════════════════════════════════════════════
  // 8. PROCESS VOICE INPUT
  // FIX #1: Now a single, clean top-level function. Previously this was
  // defined twice — once wrapping the other — so the switch/case logic
  // for actions (navigate, click, scroll, etc.) was inside an inner
  // copy that was never actually called, making all buttons silent.
  // ══════════════════════════════════════════════════════════════════════

  async function processVoiceInput(rawText) {
    if (!rawText || !rawText.trim()) return;

    log(`You: ${rawText}`, 'user');

    // Reload settings fresh from storage every time
    await new Promise((resolve) => {
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
      }, (loaded) => {
        settings = loaded;
        resolve();
      });
    });

    const hasKey = settings.useLocalAI
      ? !!settings.ollamaUrl
      : (settings.cloudProvider === 'mistral'
          ? !!settings.mistralKey
          : !!settings.geminiKey);

    if (!hasKey) {
      speak('Please open settings and add your API key first.');
      log('⚙️ Open Settings to add your API key.', 'system');
      return;
    }

    const intent = classifyIntent(rawText);
    console.log('Intent:', intent.action, '| Text:', rawText);

    switch (intent.action) {
      case 'navigate':
        await handleNavigate(intent.target || rawText);
        break;
      case 'read_page':
        await handleReadPage();
        break;
      case 'screenshot':
        await handleScreenshot(rawText);
        break;
      case 'click':
        await handleClick(intent.target || rawText);
        break;
      case 'scroll':
        await handleScroll(intent.target || 'down');
        break;
      case 'fill_form':
        await handleFillForm(rawText);
        break;
      case 'search':
        await handleSearch(intent.target || rawText);
        break;
      case 'chat':
      default: {
        const response = await callAI(rawText);
        if (response) {
          log(response, 'ai');
          speak(response);
        }
        break;
      }
    }
  }


  // ══════════════════════════════════════════════════════════════════════
  // 9. ACTION HANDLERS
  // ══════════════════════════════════════════════════════════════════════

  // ── NAVIGATE ──────────────────────────────────────────────────────────
  async function handleNavigate(target) {
    const isUrl = target.includes('.com') || target.includes('.org')
                  || target.includes('.net') || target.includes('http');

    const url = isUrl
      ? (target.startsWith('http') ? target : 'https://' + target)
      : `https://www.google.com/search?q=${encodeURIComponent(target)}`;

    speak(`Navigating to ${target}`);
    log(`Navigating to: ${target}`, 'system');
    await chrome.tabs.create({ url });
  }


  // ── READ PAGE ─────────────────────────────────────────────────────────
  async function handleReadPage() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || tab.url.startsWith('chrome://')) {
      speak('I cannot read system pages.');
      return;
    }

    speak('Reading the page...');

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const noise = document.querySelectorAll(
            'nav, header, footer, aside, script, style, .ad, [aria-hidden="true"]'
          );
          noise.forEach(el => el.remove());

          const headings   = Array.from(document.querySelectorAll('h1, h2, h3'))
                               .map(h => h.innerText.trim())
                               .filter(Boolean)
                               .join('. ');

          const paragraphs = Array.from(document.querySelectorAll('p'))
                               .slice(0, 8)
                               .map(p => p.innerText.trim())
                               .filter(Boolean)
                               .join(' ');

          return `Page title: ${document.title}. Headings: ${headings}. Content: ${paragraphs}`;
        }
      });

      const pageText = results[0].result.substring(0, 5000);
      const summary  = await callAI(
        `Please summarise this webpage content clearly and concisely for a 
         blind user. Focus on the main topic and key points:\n\n${pageText}`
      );

      if (summary) {
        log(summary, 'ai');
        speak(summary);
      }

    } catch (e) {
      speak('Sorry, I could not read that page.');
      log(`Read error: ${e.message}`, 'system');
    }
  }


  // ── SCREENSHOT ────────────────────────────────────────────────────────
  async function handleScreenshot(prompt) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab.url.startsWith('chrome://')) {
      speak('I cannot capture system pages.');
      return;
    }

    speak('Capturing the screen...');

    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(
        tab.windowId,
        { format: 'jpeg', quality: 70 }
      );

      log('Screenshot captured.', 'system', dataUrl);

      if (settings.useLocalAI) {
        speak('Screenshot analysis requires Cloud AI. Please switch to Gemini in settings.');
        return;
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent?key=${settings.geminiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `Describe this screenshot for a blind user. ${prompt}` },
              { inline_data: { mime_type: 'image/jpeg', data: dataUrl.split(',')[1] } }
            ]
          }]
        })
      });

      const data   = await response.json();
      const aiText = data.candidates[0].content.parts[0].text;
      lastResponse = aiText;

      log(aiText, 'ai');
      speak(aiText);

    } catch (e) {
      speak('Error capturing screen.');
      log(`Screenshot error: ${e.message}`, 'system');
    }
  }


  // ── CLICK ─────────────────────────────────────────────────────────────
  async function handleClick(targetText) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url || tab.url.startsWith('chrome://')) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (searchText) => {
        const search   = searchText.toLowerCase().trim();
        const elements = Array.from(document.querySelectorAll(
          'a, button, input[type="submit"], [role="button"], h3'
        ));

        let bestMatch = null;
        let topScore  = 0;

        elements.forEach(el => {
          if (el.getBoundingClientRect().width === 0) return;

          const elText = (el.innerText || '').toLowerCase();
          const aria   = (el.getAttribute('aria-label') || '').toLowerCase();

          if (el.tagName === 'H3') {
            const parent = el.closest('a');
            if (parent && elText.includes(search)) {
              bestMatch = parent;
              topScore  = 999;
              return;
            }
          }

          let score = 0;
          if (elText === search || aria === search) score = 100;
          else if (elText.includes(search) || aria.includes(search)) score = 60;

          if (score > topScore) {
            topScore  = score;
            bestMatch = el;
          }
        });

        if (bestMatch) {
          bestMatch.style.outline = '4px solid yellow';
          bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => bestMatch.click(), 500);
          return true;
        }

        return false;
      },
      args: [targetText]
    });

    const found = results?.[0]?.result;
    if (found) {
      speak(`Clicking ${targetText}`);
      log(`Clicked: ${targetText}`, 'system');
    } else {
      speak(`I couldn't find a button or link called ${targetText}`);
      log(`Could not find: ${targetText}`, 'system');
    }
  }


  // ── SCROLL ────────────────────────────────────────────────────────────
  async function handleScroll(direction) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const amount = direction.includes('up') ? -600 : 600;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (px) => window.scrollBy({ top: px, behavior: 'smooth' }),
      args: [amount]
    });

    speak(`Scrolling ${direction}`);
  }


  // ── FILL FORM ─────────────────────────────────────────────────────────
  async function handleFillForm(instruction) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url || tab.url.startsWith('chrome://')) return;

    speak('Looking at the form...');

    try {
      const scanResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return Array.from(document.querySelectorAll('input, textarea, select'))
            .filter(f => f.type !== 'hidden' && f.getBoundingClientRect().width > 0)
            .map(f => ({
              name:        f.name        || '',
              placeholder: f.placeholder || '',
              type:        f.type        || 'text',
              id:          f.id          || '',
            }));
        }
      });

      const fields = scanResults[0].result;

      if (!fields.length) {
        speak('I could not find any form fields on this page.');
        return;
      }

      const fieldList  = fields.map(f =>
        `name="${f.name}" placeholder="${f.placeholder}" type="${f.type}"`
      ).join('\n');

      const aiResponse = await callAI(
        `The user said: "${instruction}"
         
         These form fields exist on the page:
         ${fieldList}
         
         Reply ONLY with a JSON array of fill instructions, like:
         [{"selector": "input[name='email']", "value": "user@example.com"}]
         
         Only include fields that the user's instruction mentions.
         Use CSS attribute selectors like input[name='x'] or input[placeholder='y'].`
      );

      if (!aiResponse) return;

      const cleaned          = aiResponse.replace(/```json|```/g, '').trim();
      const fillInstructions = JSON.parse(cleaned);

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (instructions) => {
          instructions.forEach(({ selector, value }) => {
            const el = document.querySelector(selector);
            if (el) {
              el.value = value;
              el.dispatchEvent(new Event('input',  { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });
        },
        args: [fillInstructions]
      });

      speak('I have filled in the form. Please confirm before submitting.');
      log('Form filled. Review the fields and say "submit" to confirm.', 'system');

    } catch (e) {
      speak('I had trouble filling the form.');
      log(`Form error: ${e.message}`, 'system');
    }
  }


  // ── SEARCH ON PAGE ────────────────────────────────────────────────────
  async function handleSearch(query) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (q) => window.find(q, false, false, true),
      args: [query]
    });

    speak(`Searching for ${query} on this page`);
  }


  // ══════════════════════════════════════════════════════════════════════
  // 10. VOICE INPUT — WEB SPEECH API
  // ══════════════════════════════════════════════════════════════════════

  function startListening() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      log('Voice input is not supported in this browser.', 'system');
      return;
    }

    try {
      recognition                = new SpeechRecognition();
      recognition.lang           = 'en-US';
      recognition.continuous     = true;
      recognition.interimResults = false;

      recognition.onstart = () => {
        isListening             = true;
        micBtn.textContent      = '🛑 Stop Listening';
        micBtn.style.background = '#dc3545';
        log('Listening...', 'system');
      };

      recognition.onresult = (event) => {
        const latest = event.results[event.results.length - 1];
        const text   = latest[0].transcript.trim();

        if (text) {
          input.value = text;
          processVoiceInput(text);
        }
      };

      recognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
          stopListening();
          chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
        }
      };

      recognition.onend = () => {
        if (isListening) {
          recognition.start();
        } else {
          micBtn.textContent      = '🎤 Speak Command';
          micBtn.style.background = '#d63384';
        }
      };

      recognition.start();

    } catch (e) {
      chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
    }
  }

  function stopListening() {
    isListening = false;
    if (recognition) recognition.stop();
    log('Stopped listening.', 'system');
  }

  function toggleListening() {
    if (isListening) stopListening();
    else startListening();
  }


  // ══════════════════════════════════════════════════════════════════════
  // 11. AI MODE TOGGLE
  // ══════════════════════════════════════════════════════════════════════

  function toggleAIMode() {
    settings.useLocalAI = !settings.useLocalAI;
    chrome.storage.sync.set({ useLocalAI: settings.useLocalAI });

    const mode            = settings.useLocalAI ? 'Local AI (Ollama)' : 'Cloud AI';
    modeLabel.textContent = settings.useLocalAI ? 'Local AI' : 'Cloud AI';

    log(`Switched to ${mode}`, 'system');
    speak(`Switched to ${mode}`);
  }


  // ══════════════════════════════════════════════════════════════════════
  // 12. EVENT LISTENERS
  // ══════════════════════════════════════════════════════════════════════

  micBtn.addEventListener('click', toggleListening);

  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (text) {
      processVoiceInput(text);
      input.value = '';
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (text) {
        processVoiceInput(text);
        input.value = '';
      }
    }
  });

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-voice')    toggleListening();
    if (command === 'repeat-response') speak(lastResponse);
    if (command === 'toggle-ai-mode')  toggleAIMode();
  });

});
