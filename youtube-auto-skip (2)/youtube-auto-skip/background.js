// ==========================================
// MediaPilot - Background Service Worker
// ==========================================

console.log("🎬 MediaPilot background service worker active");

// ==========================================
// MESSAGE HANDLER
// ==========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // ------------------------------------------
    // REAL HARDWARE CLICK (FOR SKIP AD BUTTON)
    // ------------------------------------------
    if (message.action === "REAL_CLICK") {
        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({ success: false, error: "No tab ID" });
            return;
        }

        const x = Number(message.x);
        const y = Number(message.y);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            sendResponse({ success: false, error: "Invalid coordinates" });
            return;
        }

        performRealClick(tabId, x, y)
            .then(() => sendResponse({ success: true }))
            .catch((err) => {
                console.warn("Real click note:", err.message);
                sendResponse({ success: false, error: err.message });
            });

        return true;
    }

    // ------------------------------------------
    // VOICE STATUS
    // ------------------------------------------
    if (message.action === "VOICE_STATUS") {
        chrome.storage.local.set({
            voiceStatus: message.status
        });
        console.log("Voice status:", message.status);
        return;
    }

    // ------------------------------------------
    // AI SUMMARY REQUEST (DUAL-MODE: LOCAL SERVER + DIRECT GEMINI)
    // ------------------------------------------
    if (message.action === "AI_SUMMARY_REQUEST") {
        const tabId = sender.tab?.id;
        handleAISummaryRequest(tabId, message);
        return true;
    }
});

// Default bundled Gemini API Key (ensures extension works out-of-the-box without setup)
const DEFAULT_GEMINI_KEY = "";

async function handleAISummaryRequest(tabId, message) {
    const requestedLanguage = (message.language || "English").trim();
    const videoTitle = (message.title || "YouTube Video").trim();
    const transcript = (message.transcript || "").trim();
    const videoDetails = message.videoDetails || null;
    const isMetadataBased = Boolean(message.isMetadataBased || !transcript);

    console.log(
        `🤖 Handling AI summary request for: "${videoTitle}" in language: "${requestedLanguage}" (Mode: ${isMetadataBased ? "Metadata/Outline" : "Captions"})`
    );

    // Step 1: Try local backend server if running
    let serverSummary = null;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await fetch("http://localhost:3000/api/summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: videoTitle,
                language: requestedLanguage,
                transcript: transcript,
                videoDetails: videoDetails,
                isMetadataBased: isMetadataBased
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.summary) {
                console.log("✅ Summary obtained from local backend server");
                serverSummary = data.summary;
            }
        }
    } catch (serverErr) {
        console.log("💡 Local server not running or timed out (" + (serverErr.message || "") + "). Using direct Gemini AI engine...");
    }

    if (serverSummary) {
        if (tabId) {
            chrome.tabs.sendMessage(tabId, {
                action: "SUMMARY_RESULT",
                success: true,
                summary: serverSummary,
                language: requestedLanguage,
                title: videoTitle
            });
        }
        return;
    }

    // Step 2: Direct Gemini API fallback (No local server required!)
    try {
        console.log("🚀 Generating summary directly via Google Gemini AI...");
        const summary = await callDirectGeminiAI(videoTitle, requestedLanguage, transcript, videoDetails, isMetadataBased);

        if (tabId) {
            chrome.tabs.sendMessage(tabId, {
                action: "SUMMARY_RESULT",
                success: true,
                summary: summary,
                language: requestedLanguage,
                title: videoTitle
            });
        }
        console.log("✅ Direct Gemini summary successfully delivered to tab");
    } catch (directErr) {
        console.error("❌ Direct AI summary failed:", directErr);
        if (tabId) {
            const isHighDemand = directErr.message && directErr.message.toLowerCase().includes("high demand");
            const hint = isHighDemand
                ? "Google AI servers are temporarily experiencing high demand across endpoints. Please try again in 1 minute, or click the MediaPilot extension icon to paste your personal free Gemini API key."
                : "Please check your internet connection or verify your Gemini API key in the extension popup settings.";

            chrome.tabs.sendMessage(tabId, {
                action: "SUMMARY_RESULT",
                success: false,
                error: `Could not generate summary: ${directErr.message || "Unknown AI error"}.\n\n${hint}`
            });
        }
    }
}

async function callDirectGeminiAI(title, language, transcript, videoDetails = null, isMetadataBased = false) {
    // Check if custom key or model saved in storage, else use default bundled key
    const storageData = await new Promise(resolve => {
        chrome.storage.local.get(["geminiApiKey", "geminiModel"], resolve);
    });
    const apiKey = (storageData?.geminiApiKey || DEFAULT_GEMINI_KEY).trim();

    if (!apiKey) {
        throw new Error("No Gemini API key found. Please configure an API key.");
    }

    let systemPrompt = "";
    let userPrompt = "";

    if (isMetadataBased || !transcript) {
        // Mode: No captions available -> In-depth synthesis from title, outline, chapters, and description
        systemPrompt = `You are MediaPilot, an advanced multilingual AI video analyst and assistant.

Your task is to provide an in-depth, comprehensive, and structured summary of this YouTube video.

CRITICAL CONTEXT:
This video does not have closed captions or subtitles enabled on YouTube.
You are provided with the complete video metadata: title, creator, comprehensive description, roadmap chapters, timeline, and viewer context.
Analyze all these rich materials deeply to synthesize the complete roadmap, concepts, teachings, and actionable takeaways of the video.

CRITICAL MULTILINGUAL RULES:
1. OUTPUT LANGUAGE: You MUST write the ENTIRE summary in the user's requested language: "${language}".
2. All section headers, bullet points, explanations, roadmap steps, and takeaways must be written in fluent, natural ${language}.
3. The user may request ANY language in the world (such as Malayalam, Telugu, Hindi, Tamil, Kannada, Marathi, Bengali, Gujarati, Punjabi, Spanish, French, German, Japanese, Korean, Arabic, Russian, etc.). You must produce a fluent, grammatically natural summary strictly in that exact requested language.

REQUIRED STRUCTURE:
📌 Summary
(A thorough synopsis of what the video covers, its purpose, and target audience)

🎯 Key Points & Core Concepts
(Clear, detailed breakdown of all primary topics, tools, and principles covered)

🧠 In-Depth Roadmap / Step-by-Step Breakdown
(Systematic breakdown of the phases, months, topics, algorithms, or techniques explained in the video)

✅ Conclusion & Actionable Advice
(Key recommendations, best practices, and final takeaways)`;

        userPrompt = `Video Title:\n${title}\n\nCreator / Channel:\n${videoDetails?.creator || "YouTube Creator"}\n\nVideo Outline & Full Description:\n${(videoDetails?.description || "No description provided.").slice(0, 35000)}\n\nVideo Chapters & Timetable:\n${videoDetails?.chapters || "See description above."}\n\nKey Notes & Context:\n${videoDetails?.comments || "None"}\n\nTarget Output Language:\n${language}`;
    } else {
        // Mode: Closed captions / transcript available
        const cleanTranscript = transcript.replace(/\s+/g, " ").trim();
        const MAX_CHARS = 100000;
        const truncatedTranscript = cleanTranscript.length > MAX_CHARS 
            ? cleanTranscript.slice(0, MAX_CHARS) 
            : cleanTranscript;

        systemPrompt = `You are MediaPilot, an advanced multilingual AI video analyst and assistant.

Summarize the provided YouTube video transcript clearly, comprehensively, and accurately.

CRITICAL MULTILINGUAL RULES:
1. The video title and transcript may be in ANY language (such as Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Spanish, German, Japanese, French, English, or mixed languages/code-switching).
2. Deeply comprehend the entire content, context, and message of the video regardless of the original spoken language.
3. OUTPUT LANGUAGE REQUIREMENT:
   - You MUST write the ENTIRE summary in the user's requested language: "${language}".
   - All section headers, bullet points, explanations, and insights must be in natural, fluent ${language}.
   - The user may request ANY language in the world. You must support all world languages.
4. Do NOT translate line-by-line. Synthesize the whole video into structured, actionable insights.
5. Filter out filler words, sponsorship ads, and repetitive transcript artifacts.

REQUIRED STRUCTURE:
📌 Summary
(A concise, well-written synopsis of the entire video)

🎯 Key Points
(Clear bullet points detailing the essential lessons or topics)

🧠 Important Concepts & Insights
(Deep-dive explanations, steps, strategies, or techniques mentioned)

✅ Conclusion
(Final takeaway and actionable conclusion)`;

        userPrompt = `Video Title:\n${title}\n\nTarget Output Language:\n${language}\n\nVideo Transcript:\n${truncatedTranscript}`;
    }

    const combinedPrompt = `${systemPrompt}\n\n------------------------\n\n${userPrompt}`;

    const candidateModels = [
        storageData?.geminiModel,
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3.5-flash",
        "gemini-3.6-flash",
        "gemini-flash-latest",
        "gemini-3.7-flash",
        "gemini-3.8-flash",
        "gemini-3.1-flash-lite"
    ].filter(Boolean);

    let lastError = null;

    for (const model of candidateModels) {
        try {
            console.log(`🤖 MediaPilot AI: Trying model "${model}"...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 16000);

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: combinedPrompt }] }]
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await response.json();
            if (!response.ok) {
                const errMsg = data.error?.message || `Gemini API error (${response.status})`;
                console.warn(`⚠️ Model "${model}" returned error (${response.status}): ${errMsg}. Cascading to next fallback model...`);
                lastError = new Error(errMsg);
                continue;
            }

            const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            if (text) {
                console.log(`✅ MediaPilot AI: Summary generated successfully using model "${model}"!`);
                return text;
            }
        } catch (err) {
            console.warn(`⚠️ Model "${model}" failed: ${err.message}. Trying next fallback model...`);
            lastError = err;
        }
    }

    throw lastError || new Error("Failed to get summary response from Gemini AI.");
}

// ==========================================
// REAL HARDWARE CLICK VIA CHROME DEBUGGER
// ==========================================

async function performRealClick(tabId, x, y) {
    const target = { tabId };
    let attached = false;

    try {
        await new Promise((resolve, reject) => {
            chrome.debugger.attach(target, "1.3", () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    attached = true;
                    resolve();
                }
            });
        });

        const sendMouse = (params) => new Promise((resolve, reject) => {
            chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", params, () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
            });
        });

        await sendMouse({ type: "mouseMoved", x, y });
        await sendMouse({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
        await sendMouse({ type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    } finally {
        if (attached) {
            try {
                await new Promise(resolve => chrome.debugger.detach(target, () => resolve()));
            } catch (e) {}
        }
    }
}