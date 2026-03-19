document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const API_KEY = "AIzaSyBR2768gnxoexdTJwxYv3I0UIQkHVkaDkU";
    const MODEL = "gemini-2.0-flash";

    // --- DOM Elements ---
    const chat = document.getElementById('chat-container');
    const input = document.getElementById('user-input');
    const micBtn = document.getElementById('btn-mic');
    
    // --- STATE ---
    let isListening = false;
    let recognition = null;

    // --- 1. VOICE OUTPUT ---
    function speak(text) {
        window.speechSynthesis.cancel();
        // Clean text for speech
        let cleanText = text.replace(/[*#_`]/g, '').replace(/```/g, '');
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'en-US'; 
        utterance.rate = 1.1; 
        window.speechSynthesis.speak(utterance);
    }

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

    // --- 2. COMMAND PROCESSOR ---
    async function processVoiceInput(rawText) {
        let cmd = rawText.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").trim();
        log(`Heard: "${cmd}"`, "user");

        // --- A. SUMMARIZATION (Text Reading) ---
        if (cmd.includes("summarize") || cmd.includes("summary") || cmd.includes("read page") || cmd.includes("headings")) {
            await summarizePageContent();
            return;
        }

        // --- B. SCREEN CAPTURE (Visual Description) ---
        if (cmd.includes("capture") || cmd.includes("describe screen") || cmd.includes("what is on this screen") || cmd.includes("look at this")) {
             await analyzeScreen(rawText);
             return;
        }

        // --- C. NAVIGATION ---
        const navMatch = cmd.match(/^(go to|open|search for|find|search) (.+)/i);
        if (navMatch) {
            let target = navMatch[2].trim();
            if (target === "tab") return; 

            if (target.includes(".com") || target.includes(".org") || target.includes(".net")) {
                speak(`Going to ${target}`);
                await chrome.tabs.create({ url: target.startsWith("http") ? target : "https://" + target });
            } else {
                speak(`Searching ${target}`);
                await chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(target)}` });
            }
            return;
        }

        // --- D. SCROLLING ---
        if (cmd.includes("scroll")) {
            const [t] = await chrome.tabs.query({active:true});
            const dir = cmd.includes("up") ? -700 : 700;
            await chrome.scripting.executeScript({ target: { tabId: t.id }, func: (d) => window.scrollBy({ top: d, behavior: 'smooth' }), args: [dir] });
            return;
        }

        // --- E. CLICKING ---
        const cleanLabel = cmd.replace(/^(click|select|open|access|enter|locate|choose) /, "").trim();
        const success = await clickLinkByText(cleanLabel);
        
        if (success) {
            speak(`Clicking ${cleanLabel}`);
        }
    }

    // --- 3. SUMMARIZATION ENGINE (New Feature) ---
    async function summarizePageContent() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab.url || tab.url.startsWith("chrome://")) {
            speak("I cannot read system pages.");
            return;
        }

        speak("Reading page content...");
        
        try {
            // Extract text from the page
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    // Get Main Headings and Paragraphs
                    const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(h => h.innerText).join(". ");
                    const paragraphs = Array.from(document.querySelectorAll('p')).slice(0, 5).map(p => p.innerText).join(" ");
                    return `HEADINGS: ${headings}\n\nCONTENT: ${paragraphs}`;
                }
            });

            const pageText = results[0].result.substring(0, 4000); // Limit size
            
            // Ask AI to summarize
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
            const contents = { parts: [{ text: `Summarize this website text into 3 bullet points. Focus on the main headings:\n${pageText}` }] };
            
            const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [contents] }) });
            const data = await response.json();
            const aiText = data.candidates[0].content.parts[0].text;
            
            log(aiText, "ai");
            speak(aiText);

        } catch (e) {
            speak("Error reading page text.");
            console.error(e);
        }
    }

    // --- 4. SCREEN CAPTURE ENGINE ---
    async function analyzeScreen(prompt) {
        speak("Capturing screen...");
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (tab.url.startsWith("chrome://")) {
                speak("Cannot capture system pages.");
                return;
            }

            const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
            log("Image captured.", "system", dataUrl);

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
            const contents = { 
                parts: [
                    { text: `User: ${prompt}. Describe the visual layout and main elements briefly.` }, 
                    { inline_data: { mime_type: "image/jpeg", data: dataUrl.split(',')[1] } }
                ] 
            };
            
            const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [contents] }) });
            const data = await res.json();
            const aiText = data.candidates[0].content.parts[0].text;
            
            log(aiText, "ai");
            speak(aiText);
        } catch (e) { 
            speak("Error capturing screen."); 
        }
    }

    // --- 5. CLICK ENGINE ---
    async function clickLinkByText(targetText) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab.url || tab.url.startsWith("chrome://")) return false;

        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (textToFind) => {
                const search = textToFind.toLowerCase().trim();
                const allElements = Array.from(document.querySelectorAll('a, button, input[type="submit"], [role="button"], img, h3'));
                
                let bestMatch = null;
                let highestScore = 0;

                allElements.forEach(el => {
                    if (el.getBoundingClientRect().width === 0) return; // Skip hidden
                    
                    let score = 0;
                    let innerText = (el.innerText || "").toLowerCase();
                    let aria = (el.getAttribute('aria-label') || "").toLowerCase();

                    if (el.tagName === 'H3') { // Google Logic
                        const parent = el.closest('a');
                        if (parent && innerText.includes(search)) { bestMatch = parent; highestScore = 999; return; }
                    }

                    if (innerText === search || aria === search) score = 100;
                    else if (innerText.includes(search)) score = 60;

                    if (score > highestScore) { highestScore = score; bestMatch = el; }
                });

                if (bestMatch) {
                    bestMatch.style.border = "5px solid yellow";
                    bestMatch.scrollIntoView({ behavior: "smooth", block: "center" });
                    setTimeout(() => { bestMatch.click(); if (bestMatch.href) window.location.href = bestMatch.href; }, 500); 
                    return true; 
                }
                return false; 
            },
            args: [targetText]
        });

        return (results && results[0] && results[0].result === true);
    }

    // --- 6. CONTINUOUS LISTENER ---
    function toggleListening() {
        if (isListening) stopListening();
        else startListening();
    }

    function startListening() {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) return log("No voice support.", "system");

        try {
            recognition = new Recognition();
            recognition.lang = 'en-US';
            recognition.continuous = true;  
            recognition.interimResults = false;

            recognition.onstart = () => {
                isListening = true;
                micBtn.textContent = "🛑 Stop Listening"; 
                micBtn.style.background = "#dc3545"; 
            };

            recognition.onresult = (event) => {
                const last = event.results.length - 1;
                const text = event.results[last][0].transcript.trim();
                input.value = text; 
                processVoiceInput(text); 
            };

            recognition.onerror = (event) => {
                if (event.error === 'not-allowed') stopListening();
            };

            recognition.onend = () => {
                if (isListening) recognition.start(); // Auto-restart
                else {
                    micBtn.textContent = "🎤 Start Listening"; 
                    micBtn.style.background = "#d63384"; 
                }
            };

            recognition.start();
            
        } catch (e) {
            chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
        }
    }

    function stopListening() {
        isListening = false;
        if (recognition) recognition.stop();
    }

    micBtn.addEventListener('click', toggleListening);
});