// sidepanel.js
// The brain of the extension — handles voice, AI calls, and all browser actions.

document.addEventListener('DOMContentLoaded', () => {

  // ══════════════════════════════════════════════════════════════════════
  // 1. STATE
  // These variables hold the "memory" of the extension while it's open.
  // They live in RAM — they reset every time the side panel is closed.
  // ══════════════════════════════════════════════════════════════════════

  let settings     = {};    // Loaded from chrome.storage — API keys, preferences
  let isListening  = false; // Is the mic currently active?
  let recognition  = null;  // The Web Speech API recognition object
  let lastResponse = '';    // The last thing the AI said (for the repeat shortcut)
  let chatHistory  = [];    // Full conversation history sent to the AI every turn


  // ══════════════════════════════════════════════════════════════════════
  // 2. DOM ELEMENTS
  // Getting references to HTML elements once at the top is better than
  // calling document.getElementById() repeatedly throughout the code.
  // ══════════════════════════════════════════════════════════════════════

  const chat        = document.getElementById('chat-container');
  const input       = document.getElementById('user-input');
  const micBtn      = document.getElementById('btn-mic');
  const sendBtn     = document.getElementById('btn-send');
  const settingsBtn = document.getElementById('btn-settings');
  const modeLabel   = document.getElementById('mode-label');


  // ══════════════════════════════════════════════════════════════════════
  // 3. INITIALISATION
  // The first thing that runs. Loads settings from storage before
  // allowing anything else to happen. Everything that depends on
  // settings lives inside this callback.
  // ══════════════════════════════════════════════════════════════════════

  chrome.storage.sync.get({
    // These are the DEFAULT values used if nothing has been saved yet.
    // A first-time user will get these automatically.
    useLocalAI:  false,
    geminiKey:   '',
    geminiModel: 'gemini-2.0-flash',
    ollamaUrl:   'http://localhost:11434',
    ollamaModel: 'gemma3:4b',
    voiceSpeed:  1.1,
  }, (loaded) => {
    settings = loaded;

    // Update the mode label in the settings button
    modeLabel.textContent = settings.useLocalAI ? 'Local AI' : 'Cloud AI';

    // Warn the user if no API key has been set yet
    const hasKey = settings.useLocalAI || settings.geminiKey || settings.mistralKey;

    if (!hasKey) {
        log('⚙️ No API key found. Click Settings to add your Mistral or Gemini key.', 'system');
    } else {
        log('Ready. Click the mic button or press Alt+Shift+2 to speak.', 'system');
    }


  // ══════════════════════════════════════════════════════════════════════
  // 4. LOGGING
  // Adds a message bubble to the chat window.
  // type can be: 'user', 'ai', or 'system'
  // imageSrc is optional — pass a base64 image to show a screenshot
  // ══════════════════════════════════════════════════════════════════════

  function log(text, type, imageSrc = null) {
    const div = document.createElement('div');
    div.className = `message ${type}`;

    // Convert **bold** markdown to real HTML bold tags
    div.innerHTML = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

    // If an image was passed in, attach it below the text
    if (imageSrc) {
      const img = document.createElement('img');
      img.src = imageSrc;
      div.appendChild(img);
    }

    chat.appendChild(div);

    // Auto-scroll to the bottom so the latest message is always visible
    chat.scrollTop = chat.scrollHeight;
  }


  // ══════════════════════════════════════════════════════════════════════
  // 5. TEXT TO SPEECH
  // Converts text to spoken audio using the browser's built-in
  // Web Speech Synthesis API. No external service needed.
  // ══════════════════════════════════════════════════════════════════════

  function speak(text) {
    if (!text) return;

    // Cancel anything currently being spoken before starting new speech.
    // Without this, multiple speak() calls would queue up and overlap.
    window.speechSynthesis.cancel();

    // Remove markdown symbols that would sound weird when read aloud.
    // e.g. "**hello**" becomes "hello", backticks are removed etc.
    const cleanText = text
      .replace(/[*#_`]/g, '')
      .replace(/```[\s\S]*?```/g, 'code block')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang  = 'en-US';

    // Use the speed from settings — user can adjust this in the settings page
    utterance.rate  = settings.voiceSpeed || 1.1;

    window.speechSynthesis.speak(utterance);
  }


  // ══════════════════════════════════════════════════════════════════════
  // 6. AI — CORE FUNCTION
  // The single function that handles ALL communication with the AI,
  // whether that's Gemini (cloud) or Ollama (local).
  //
  // It sends the FULL conversation history every time so the AI always
  // has context of what was said before. This is how memory works —
  // AI models are stateless, so you rebuild the context on every call.
  // ══════════════════════════════════════════════════════════════════════

  async function callAI(userMessage) {

    // Add user's message to the history before sending
    chatHistory.push({ role: 'user', content: userMessage });

    // Show a loading indicator while waiting for the response
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message ai';
    loadingDiv.textContent = '...';
    chat.appendChild(loadingDiv);
    chat.scrollTop = chat.scrollHeight;

    try {
      let responseText = '';

      if (settings.useLocalAI) {

        // ── LOCAL PATH: Ollama ────────────────────────────────────────
        // Ollama runs on the user's machine at a local port.
        // It uses an OpenAI-compatible API format.
        // Nothing leaves the user's computer on this path.
        const response = await fetch(`${settings.ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: settings.ollamaModel,
            messages: [
              {
                // The system prompt defines the AI's personality and role.
                // This message is always sent first, before any conversation.
                role: 'system',
                content: `You are A-Eye, an accessibility voice assistant built 
                into the Chrome browser for blind and visually impaired users. 
                You help users navigate the web, read page content, and perform 
                browser actions entirely by voice. Be concise, warm, and clear. 
                Never use visual language like "as you can see" or "look at this".`
              },
              ...chatHistory   // Spread all previous messages after the system prompt
            ],
            stream: false      // Get the full response at once, not chunk by chunk
          })
        });

        const data = await response.json();
        responseText = data.message.content;

      } else {

        // ── CLOUD PATH: Gemini ────────────────────────────────────────
        // Gemini's API format is slightly different from OpenAI's.
        // Roles are "user" and "model" (not "assistant").
        // The system prompt is passed separately, not as a message.
        const geminiMessages = chatHistory.map(msg => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }]
        }));

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.geminiModel}:generateContent?key=${settings.geminiKey}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // System instruction tells Gemini who it is
            system_instruction: {
              parts: [{
                text: `You are A-Eye, an accessibility voice assistant built 
                into the Chrome browser for blind and visually impaired users. 
                You help users navigate the web, read page content, and perform 
                browser actions entirely by voice. Be concise, warm, and clear.
                Never use visual language like "as you can see" or "look at this".`
              }]
            },
            contents: geminiMessages
          })
        });

        const data = await response.json();

        // Check for API errors — wrong key, quota exceeded, etc.
        if (!data.candidates || !data.candidates[0]) {
          throw new Error(data.error?.message || 'No response from Gemini.');
        }

        responseText = data.candidates[0].content.parts[0].text;
      }

      // Remove the "..." loading bubble now that we have a real response
      loadingDiv.remove();

      // Add the AI's response to history for future context
      chatHistory.push({ role: 'assistant', content: responseText });

      // Save the response so the repeat shortcut can re-speak it
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
  // 7. AI — INTENT ROUTER
  // Instead of using brittle if/else keyword matching to decide what
  // the user wants, we ask the AI to classify the intent first.
  // The AI returns a structured JSON object telling us what action to take.
  //
  // This is far more robust — it handles natural variations in language,
  // e.g. "take a look at this page", "what's on screen", "describe this"
  // all correctly map to the same action.
  // ══════════════════════════════════════════════════════════════════════

  async function classifyIntent(text) {

    // We make a SEPARATE lightweight AI call just for classification.
    // We don't add this to chatHistory because it's a behind-the-scenes
    // system call, not part of the user's conversation.

    const prompt = `
You are a browser command classifier. 
Classify this user request into exactly one JSON object.

User said: "${text}"

Reply ONLY with a valid JSON object — no explanation, no markdown, no extra text.
Use this exact format:

{
  "action": "one of: chat | navigate | read_page | screenshot | click | scroll | fill_form | search",
  "target": "the relevant detail (URL, search query, element to click, scroll direction, etc.)",
  "query": "the original text if action is chat or read_page"
}

Action definitions:
- chat: general question or conversation with no browser action needed
- navigate: go to a URL or search for something
- read_page: read, summarise, or describe the current page content
- screenshot: capture and describe what's on screen visually
- click: click a link, button, or element by its label
- scroll: scroll the page up or down
- fill_form: fill in a form field or submit a form
- search: search for something on the current page (Ctrl+F style)
`;

    try {
      // Call the AI with just the classification prompt — no history needed
      const tempHistory = chatHistory;
      chatHistory = [];   // Temporarily clear so callAI sends a clean request

      const raw = await callAI(prompt);

      chatHistory = tempHistory;  // Restore the real history

      if (!raw) return { action: 'chat', query: text };

      // Strip markdown fences if the AI wrapped the JSON in ```
      const cleaned = raw.replace(/```json|```/g, '').trim();
      return JSON.parse(cleaned);

    } catch (e) {
      // If classification fails for any reason, fall back to plain chat
      return { action: 'chat', query: text };
    }
  }


  // ══════════════════════════════════════════════════════════════════════
  // 8. PROCESS VOICE INPUT
  // The main entry point after the user speaks.
  // It classifies intent then routes to the right action function.
  // ══════════════════════════════════════════════════════════════════════

  async function processVoiceInput(rawText) {
    if (!rawText || !rawText.trim()) return;

    log(`You: ${rawText}`, 'user');

    // Check settings are loaded before doing anything
    const hasKey = settings.useLocalAI || settings.geminiKey || settings.mistralKey;

    if (!hasKey) {
        speak('Please open settings and add your API key first.');
        log('⚙️ Open Settings to add your API key.', 'system');
    return;
    }

    // Ask the AI what the user wants to do
    const intent = await classifyIntent(rawText);

    // Route to the right function based on classified intent
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
      default:
        // Plain conversation — send to AI and speak the response
        const response = await callAI(rawText);
        if (response) {
          log(response, 'ai');
          speak(response);
        }
        break;
    }
  }


  // ══════════════════════════════════════════════════════════════════════
  // 9. ACTION HANDLERS
  // Each function below handles one specific type of browser action.
  // They are all async because they involve waiting for browser APIs,
  // network calls, or scripting results.
  // ══════════════════════════════════════════════════════════════════════

  // ── NAVIGATE ──────────────────────────────────────────────────────────
  // Opens a URL directly or performs a Google search
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
  // Extracts text from the current page and asks the AI to summarise it.
  // chrome.scripting.executeScript() injects code directly into the
  // active tab's page — this is how extensions read page content.
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
          // This function runs INSIDE the webpage, not in the extension.
          // It has access to the page's full DOM.

          // Remove elements that are noise — nav, ads, footers etc.
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

          return `Page title: ${document.title}. 
                  Headings: ${headings}. 
                  Content: ${paragraphs}`;
        }
      });

      const pageText = results[0].result.substring(0, 5000);

      // Ask the AI to summarise what it received from the page
      const summary = await callAI(
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
  // Captures a screenshot and sends it to the AI for visual description.
  // Useful for pages that are heavily image-based or have complex layouts.
  async function handleScreenshot(prompt) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab.url.startsWith('chrome://')) {
      speak('I cannot capture system pages.');
      return;
    }

    speak('Capturing the screen...');

    try {
      // captureVisibleTab takes a screenshot of what's currently visible.
      // Returns a base64-encoded JPEG data URL.
      const dataUrl = await chrome.tabs.captureVisibleTab(
        tab.windowId,
        { format: 'jpeg', quality: 70 }
      );

      log('Screenshot captured.', 'system', dataUrl);

      // Screenshots can only be analysed by Gemini (vision model),
      // not by text-only local models
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
              // The image is sent as base64 inline data
              { inline_data: { mime_type: 'image/jpeg', data: dataUrl.split(',')[1] } }
            ]
          }]
        })
      });

      const data     = await response.json();
      const aiText   = data.candidates[0].content.parts[0].text;
      lastResponse   = aiText;

      log(aiText, 'ai');
      speak(aiText);

    } catch (e) {
      speak('Error capturing screen.');
      log(`Screenshot error: ${e.message}`, 'system');
    }
  }


  // ── CLICK ─────────────────────────────────────────────────────────────
  // Finds an element on the page by its text label and clicks it.
  // Uses a scoring system to find the best match.
  async function handleClick(targetText) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url || tab.url.startsWith('chrome://')) return;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (searchText) => {
        const search = searchText.toLowerCase().trim();

        // Get all clickable elements on the page
        const elements = Array.from(document.querySelectorAll(
          'a, button, input[type="submit"], [role="button"], h3'
        ));

        let bestMatch  = null;
        let topScore   = 0;

        elements.forEach(el => {
          // Skip hidden elements — they can't be clicked anyway
          if (el.getBoundingClientRect().width === 0) return;

          const elText = (el.innerText || '').toLowerCase();
          const aria   = (el.getAttribute('aria-label') || '').toLowerCase();

          // Special Google Search result handling —
          // Google wraps result titles in <h3> inside <a> tags
          if (el.tagName === 'H3') {
            const parent = el.closest('a');
            if (parent && elText.includes(search)) {
              bestMatch = parent;
              topScore  = 999;
              return;
            }
          }

          // Scoring: exact match = 100pts, partial match = 60pts
          let score = 0;
          if (elText === search || aria === search) score = 100;
          else if (elText.includes(search) || aria.includes(search)) score = 60;

          if (score > topScore) {
            topScore  = score;
            bestMatch = el;
          }
        });

        if (bestMatch) {
          // Highlight the element so sighted helpers can see what was clicked
          bestMatch.style.outline = '4px solid yellow';
          bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // Small delay before clicking so scroll can settle
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
  // Scrolls the active page up or down
  async function handleScroll(direction) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Negative = scroll up, Positive = scroll down
    const amount = direction.includes('up') ? -600 : 600;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (px) => window.scrollBy({ top: px, behavior: 'smooth' }),
      args: [amount]
    });

    speak(`Scrolling ${direction}`);
  }


  // ── FILL FORM ─────────────────────────────────────────────────────────
  // Finds form fields on the page and fills them.
  // Asks the AI to figure out what field maps to what value.
  async function handleFillForm(instruction) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.url || tab.url.startsWith('chrome://')) return;

    speak('Looking at the form...');

    try {
      // First, scan the page to find what form fields exist
      const scanResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const fields = Array.from(
            document.querySelectorAll('input, textarea, select')
          );

          // Return a description of each visible field
          return fields
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

      // Ask the AI what value goes in which field based on the user's instruction
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

      // Parse the JSON the AI returned
      const cleaned      = aiResponse.replace(/```json|```/g, '').trim();
      const fillInstructions = JSON.parse(cleaned);

      // Execute the fill instructions inside the page
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (instructions) => {
          instructions.forEach(({ selector, value }) => {
            const el = document.querySelector(selector);
            if (el) {
              el.value = value;
              // Trigger input event so the page's JavaScript knows the value changed
              el.dispatchEvent(new Event('input', { bubbles: true }));
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
  // Uses the browser's built-in find-in-page (like Ctrl+F)
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
  // Uses the browser's built-in speech recognition.
  // continuous: true means it keeps listening after each phrase,
  // instead of stopping after one sentence.
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
      recognition.continuous     = true;   // Keep listening after each result
      recognition.interimResults = false;  // Only give us final, confirmed results

      recognition.onstart = () => {
        isListening           = true;
        micBtn.textContent    = '🛑 Stop Listening';
        micBtn.style.background = '#dc3545';
        log('Listening...', 'system');
      };

      recognition.onresult = (event) => {
        // event.results is a list of all results so far this session.
        // We only want the latest one, which is always the last item.
        const latest = event.results[event.results.length - 1];
        const text   = latest[0].transcript.trim();

        if (text) {
          input.value = text;   // Show what was heard in the text box
          processVoiceInput(text);
        }
      };

      recognition.onerror = (event) => {
        // 'not-allowed' means the user denied microphone permission
        if (event.error === 'not-allowed') {
          stopListening();
          chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
        }
        // Other errors (network, no-speech) are temporary — don't stop listening
      };

      recognition.onend = () => {
        // If we're supposed to still be listening, restart automatically.
        // The Web Speech API stops itself after silence — this restarts it.
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
  // Switches between Cloud (Gemini) and Local (Ollama) and saves the
  // preference immediately to storage.
  // ══════════════════════════════════════════════════════════════════════

  function toggleAIMode() {
    settings.useLocalAI = !settings.useLocalAI;
    chrome.storage.sync.set({ useLocalAI: settings.useLocalAI });

    const mode        = settings.useLocalAI ? 'Local AI (Ollama)' : 'Cloud AI (Gemini)';
    modeLabel.textContent = settings.useLocalAI ? 'Local AI' : 'Cloud AI';

    log(`Switched to ${mode}`, 'system');
    speak(`Switched to ${mode}`);
  }


  // ══════════════════════════════════════════════════════════════════════
  // 12. EVENT LISTENERS
  // Connects UI elements and keyboard shortcuts to their functions.
  // All event binding happens here at the bottom, after all functions
  // are defined — this is a clean pattern that avoids hoisting issues.
  // ══════════════════════════════════════════════════════════════════════

  // Mic button click
  micBtn.addEventListener('click', toggleListening);

  // Send button — lets user type a command manually instead of speaking
  sendBtn.addEventListener('click', () => {
    const text = input.value.trim();
    if (text) {
      processVoiceInput(text);
      input.value = '';
    }
  });

  // Enter key in the text box
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = input.value.trim();
      if (text) {
        processVoiceInput(text);
        input.value = '';
      }
    }
  });

  // Settings button — opens the settings page as a new tab
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Keyboard shortcuts defined in manifest.json
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'toggle-voice')    toggleListening();
    if (command === 'repeat-response') speak(lastResponse);
    if (command === 'toggle-ai-mode')  toggleAIMode();
  });

});
})