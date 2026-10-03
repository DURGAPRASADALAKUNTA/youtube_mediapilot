// ============================================================
// MEDIAPILOT
// ============================================================
// Auto Skip Ads
// Manual Video Controls
// Voice Wake Word
// Next / Previous Video
// Transcript Extraction
// AI Summary Requests
// ============================================================

console.log("🎬 MediaPilot loaded");


// ============================================================
// AUTO SKIP ADS (REAL-CLICK + INSTANT AD ACCELERATION)
// ============================================================

let autoSkipEnabled = true;
let lastClickTime = 0;
let wasAdPlaying = false;
let originalMuteState = false;
let currentUserPlaybackRate = 1.0;

// Specific selectors strictly within the YouTube video player
const SKIP_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-skip-ad-button-modern",
    ".ytp-ad-skip-button-slot button",
    ".ytp-ad-skip-button-slot",
    ".ytp-ad-skip-button-container button",
    ".ytp-ad-skip-button-container",
    "button.ytp-ad-skip-button",
    "button.ytp-ad-skip-button-modern",
    "button.ytp-skip-ad-button",
    "button.ytp-skip-ad-button-modern",
    "[class*='ytp-ad-skip-button']",
    "[class*='ytp-skip-ad-button']",
    "button[aria-label^='Skip ad']",
    "button[aria-label^='Skip Ad']",
    ".ytp-ad-overlay-close-button",
    ".ytp-ad-overlay-close-container button"
];

chrome.storage.sync.get(["enabled"], (result) => {
    autoSkipEnabled = result.enabled !== false;
});

chrome.storage.onChanged.addListener((changes) => {
    if (changes.enabled) {
        autoSkipEnabled = changes.enabled.newValue;
    }
});

// Guard: detect if user is typing anywhere (search bar, comments, etc.)
function isUserTyping() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = (active.tagName || "").toLowerCase();
    return (
        tag === "input" ||
        tag === "textarea" ||
        active.isContentEditable ||
        active.getAttribute("role") === "textbox" ||
        active.id === "search" ||
        active.classList.contains("ytSearchboxComponentInput")
    );
}

// Check if an ad is actively playing
function isAdActive() {
    const player = document.querySelector(".html5-video-player, #movie_player");
    if (!player) return false;
    return (
        player.classList.contains("ad-showing") ||
        player.classList.contains("ad-interrupting") ||
        !!player.querySelector(".ytp-ad-player-overlay, .ytp-ad-suite, .ytp-ad-module:not(:empty)")
    );
}

function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        style.pointerEvents !== "none"
    );
}

// Search for skip button strictly inside YouTube's video player
function findSkipButton() {
    const player = document.querySelector(".html5-video-player, #movie_player");
    if (!player) return null;

    // 1. Check known selectors inside player
    for (const selector of SKIP_SELECTORS) {
        try {
            const elements = player.querySelectorAll(selector);
            for (const el of elements) {
                if (isVisible(el)) return el;
            }
        } catch (e) {}
    }

    // 2. Strict text fallback strictly inside player ad containers
    const adContainer = player.querySelector(".ytp-ad-module, .video-ads") || player;
    const buttons = adContainer.querySelectorAll("button, [role='button']");
    for (const btn of buttons) {
        if (!isVisible(btn)) continue;
        const text = [
            btn.innerText,
            btn.textContent,
            btn.getAttribute("aria-label"),
            btn.getAttribute("title")
        ].filter(Boolean).join(" ").trim().toLowerCase();

        if (text === "skip ad" || text === "skip ads" || text.startsWith("skip ad ")) {
            return btn;
        }
    }

    return null;
}

// Hardware-level click via background worker (debugger)
function requestRealClick(button) {
    const rect = button.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);

    chrome.runtime.sendMessage({
        action: "REAL_CLICK",
        x: x,
        y: y
    }, (resp) => {
        if (resp?.success) {
            console.log("✅ Real-Click executed at", x, y);
        }
    });
}

// Multi-tier skip click: native events + real hardware click
function executeSkipClick(button) {
    if (isUserTyping()) return; // Never steal focus from user typing!

    // 1. Synthetic mouse & pointer events
    const events = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    events.forEach(type => {
        try {
            button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        } catch (e) {}
    });
    try {
        button.click();
    } catch (e) {}

    // 2. Real hardware click via debugger (bypasses YouTube isTrusted checks)
    try {
        requestRealClick(button);
    } catch (e) {}
}

// Instant ad fast-forwarding & muting
function handleAdPlayback() {
    const video = getVideo();
    const adActive = isAdActive();

    if (adActive) {
        if (!wasAdPlaying) {
            wasAdPlaying = true;
            if (video) originalMuteState = video.muted;
        }

        if (video) {
            video.muted = true;
            video.playbackRate = 16.0;
            if (Number.isFinite(video.duration) && video.duration > 0.2) {
                if (video.currentTime < video.duration - 0.1) {
                    video.currentTime = video.duration - 0.05;
                }
            }
        }
    } else if (wasAdPlaying) {
        wasAdPlaying = false;
        if (video) {
            video.playbackRate = currentUserPlaybackRate;
            video.muted = originalMuteState;
        }
    }
}

function checkForSkipButton() {
    if (!autoSkipEnabled) return;
    if (isUserTyping()) return; // Guard: protect search bar focus!
    if (!isYouTubeVideoPage() && !document.querySelector("video")) return;

    // 1. Instant ad acceleration & mute
    handleAdPlayback();

    // 2. Click skip button if present
    const button = findSkipButton();
    if (button) {
        const now = Date.now();
        if (now - lastClickTime > 400) {
            lastClickTime = now;
            console.log("⚡ Auto Skip: Clicking skip button...");
            executeSkipClick(button);
        }
    }
}

// MutationObserver - guarded by isUserTyping()
const adObserver = new MutationObserver(() => {
    if (isUserTyping()) return;
    checkForSkipButton();
});

adObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"]
});

// Periodic check
setInterval(() => {
    if (!isUserTyping() && isYouTubeVideoPage()) {
        checkForSkipButton();
    }
}, 250);


// ============================================================
// VIDEO HELPERS
// ============================================================

function getVideo() {

    return document.querySelector(
        "video.html5-main-video, video"
    );

}


// ============================================================
// FORWARD
// ============================================================

function forwardVideo(seconds) {

    const video =
        getVideo();


    if (!video) {

        console.log(
            "❌ YouTube video not found"
        );

        return false;

    }


    if (
        !Number.isFinite(seconds) ||
        seconds <= 0
    ) {

        return false;

    }


    const duration =
        Number.isFinite(video.duration)
            ? video.duration
            : Infinity;


    video.currentTime =
        Math.min(
            video.currentTime + seconds,
            duration
        );


    console.log(
        `⏩ Forwarded ${seconds} seconds`
    );


    return true;

}


// ============================================================
// BACKWARD
// ============================================================

function backwardVideo(seconds) {

    const video =
        getVideo();


    if (!video) {

        console.log(
            "❌ YouTube video not found"
        );

        return false;

    }


    if (
        !Number.isFinite(seconds) ||
        seconds <= 0
    ) {

        return false;

    }


    video.currentTime =
        Math.max(
            video.currentTime - seconds,
            0
        );


    console.log(
        `⏪ Moved back ${seconds} seconds`
    );


    return true;

}


// ============================================================
// TIMELINE ABSOLUTE SEEK
// ============================================================

function seekToTimeline(seconds) {

    const video =
        getVideo();


    if (!video) {

        console.log(
            "❌ YouTube video not found"
        );

        return false;

    }


    if (
        !Number.isFinite(seconds) ||
        seconds < 0
    ) {

        return false;

    }


    const duration =
        Number.isFinite(video.duration)
            ? video.duration
            : Infinity;


    const targetTime =
        Math.min(seconds, duration);


    video.currentTime = targetTime;

    video.play().catch(() => {});


    const hrs = Math.floor(targetTime / 3600);
    const mins = Math.floor((targetTime % 3600) / 60);
    const secs = Math.floor(targetTime % 60);
    const formatted = hrs > 0
        ? `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
        : `${mins}:${secs.toString().padStart(2, "0")}`;


    console.log(
        `⏱️ Jumped to timeline: ${formatted} (${targetTime}s)`
    );

    showVoiceIndicator(`⏩ Jumped to ${formatted}`, true);


    return true;

}


// ============================================================
// PLAYBACK SPEED
// ============================================================

function setVideoPlaybackSpeed(speed) {

    const video =
        getVideo();

    if (!video) {
        console.log("❌ YouTube video not found");
        return false;
    }

    if (!Number.isFinite(speed) || speed <= 0) {
        return false;
    }

    const targetSpeed = Math.max(0.1, Math.min(speed, 16.0));
    currentUserPlaybackRate = targetSpeed;

    video.playbackRate = targetSpeed;

    const player = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
    if (player && typeof player.setPlaybackRate === "function") {
        try {
            player.setPlaybackRate(targetSpeed);
        } catch (e) {}
    }

    video.play().catch(() => {});
    if (typeof videoVoiceState !== "undefined") {
        videoVoiceState.wasPlaying = true;
    }

    console.log(`⚡ Playback speed set to ${targetSpeed}x`);
    showVoiceIndicator(`⚡ Playing at ${targetSpeed}x speed`, true);

    return true;

}


// ============================================================
// NEXT VIDEO
// ============================================================

function findNextVideoButton() {

    const selectors = [

        ".ytp-next-button",

        "button.ytp-next-button",

        "[aria-label='Next']",

        "[aria-label='Next video']",

        "[title='Next']",

        "[title='Next video']"

    ];


    for (
        const selector of selectors
    ) {

        const element =
            document.querySelector(
                selector
            );


        if (
            element &&
            isVisible(element)
        ) {

            return element;

        }

    }


    return null;

}


function playNextVideo() {

    const button =
        findNextVideoButton();


    if (!button) {

        console.log(
            "❌ Next video button not found"
        );

        return false;

    }


    button.click();


    console.log(
        "⏭️ Next video"
    );


    return true;

}


// ============================================================
// PREVIOUS VIDEO
// ============================================================

function findPreviousVideoButton() {

    const selectors = [

        ".ytp-prev-button",

        "button.ytp-prev-button",

        "[aria-label='Previous']",

        "[aria-label='Previous video']",

        "[title='Previous']",

        "[title='Previous video']"

    ];


    for (
        const selector of selectors
    ) {

        const element =
            document.querySelector(
                selector
            );


        if (
            element &&
            isVisible(element)
        ) {

            return element;

        }

    }


    return null;

}


function playPreviousVideo() {

    const button =
        findPreviousVideoButton();


    if (!button) {

        console.log(
            "❌ Previous video button not found"
        );

        return false;

    }


    button.click();


    console.log(
        "⏮️ Previous video"
    );


    return true;

}


// ============================================================
// NUMBER WORDS
// ============================================================

const NUMBER_WORDS = {

    zero: 0,

    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,

    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,

    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,

    hundred: 100

};


function extractNumber(text) {

    // Digits

    const digitMatch =
        text.match(
            /\d+(?:\.\d+)?/
        );


    if (digitMatch) {

        return Number(
            digitMatch[0]
        );

    }


    // Words

    const words =
        text
            .toLowerCase()
            .split(/\s+/)
            .map(
                word =>
                    word.replace(
                        /[^a-z]/g,
                        ""
                    )
            )
            .filter(Boolean);


    let total = 0;
    let current = 0;
    let found = false;


    for (
        const word of words
    ) {

        const value =
            NUMBER_WORDS[word];


        if (
            value === undefined
        ) {

            continue;

        }


        found = true;


        if (
            value === 100
        ) {

            if (
                current === 0
            ) {

                current = 1;

            }


            current *= 100;

        } else {

            current += value;

        }

    }


    if (!found) {

        return null;

    }


    total += current;


    return total;

}


// ============================================================
// TIME CONVERSION
// ============================================================

function getSecondsFromCommand(
    command
) {

    const amount =
        extractNumber(command);


    if (
        amount === null ||
        amount <= 0
    ) {

        return null;

    }


    if (
        command.includes("hour") ||
        command.includes("hours") ||
        command.includes("hr") ||
        command.includes("hrs")
    ) {

        return amount * 3600;

    }


    if (
        command.includes("minute") ||
        command.includes("minutes") ||
        command.includes("min")
    ) {

        return amount * 60;

    }


    return amount;

}


// ============================================================
// WORDS TO NUMBERS CONVERTER
// ============================================================

function wordsToNumbers(text) {
    if (!text) return "";
    const tokens = text.toLowerCase().replace(/[-_]/g, " ").split(/\s+/);
    const result = [];
    let currentNum = null;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const val = NUMBER_WORDS[token];
        if (val !== undefined) {
            if (val === 100) {
                currentNum = (currentNum || 1) * 100;
            } else if (currentNum !== null && currentNum < 100 && val < 10 && currentNum >= 20) {
                currentNum += val;
            } else {
                if (currentNum !== null) result.push(currentNum);
                currentNum = val;
            }
        } else {
            if (currentNum !== null) {
                result.push(currentNum);
                currentNum = null;
            }
            result.push(token);
        }
    }
    if (currentNum !== null) result.push(currentNum);
    return result.join(" ");
}


// ============================================================
// ABSOLUTE TIMELINE PARSER (HOURS, MINUTES, SECONDS & HH:MM:SS)
// ============================================================

function parseTimelineSeconds(command) {
    if (!command) return null;
    const norm = wordsToNumbers(command);

    // Pattern A: Colons (e.g. 10:35, 1:15:30)
    const colonMatch = norm.match(/\b(?:(\d+):)?(\d+):(\d+)\b/);
    if (colonMatch) {
        if (colonMatch[1] !== undefined) {
            return (parseInt(colonMatch[1], 10) * 3600) + (parseInt(colonMatch[2], 10) * 60) + parseInt(colonMatch[3], 10);
        } else {
            return (parseInt(colonMatch[2], 10) * 60) + parseInt(colonMatch[3], 10);
        }
    }

    // Pattern B: Hours / Minutes / Seconds
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    let hasMatch = false;

    const hrMatch = norm.match(/(\d+)\s*(?:hours?|hrs?)\b/);
    if (hrMatch) {
        hours = parseInt(hrMatch[1], 10);
        hasMatch = true;
    }

    const minMatch = norm.match(/(\d+)\s*(?:minutes?|mins?)\b/);
    if (minMatch) {
        minutes = parseInt(minMatch[1], 10);
        hasMatch = true;
    }

    const secMatch = norm.match(/(\d+)\s*(?:seconds?|secs?)\b/);
    if (secMatch) {
        seconds = parseInt(secMatch[1], 10);
        hasMatch = true;
    }

    if (hasMatch) {
        return (hours * 3600) + (minutes * 60) + seconds;
    }

    return null;
}


// ============================================================
// PLAYBACK SPEED PARSER (E.G. "PLAY VIDEO AT 2X SPEED")
// ============================================================

function parseSpeedFromCommand(command) {
    if (!command) return null;
    let norm = command.toLowerCase().trim();

    const hasSpeedWord = norm.includes("speed") || norm.includes("playback") || norm.includes("rate");
    const hasXPattern = /\b\d+(?:\.\d+)?\s*x\b/i.test(norm) || /\b(?:two|three|four|five|half|double|triple)\s*x\b/i.test(norm);

    if (!hasSpeedWord && !hasXPattern) {
        return null;
    }

    if (norm.includes("normal") || norm.includes("regular") || norm.includes("default") || norm.includes("standard")) {
        return 1.0;
    }
    if (norm.includes("double")) {
        return 2.0;
    }
    if (norm.includes("triple")) {
        return 3.0;
    }
    if (norm.includes("half")) {
        return 0.5;
    }
    if (norm.includes("quarter")) {
        return 0.25;
    }

    norm = norm.replace(/\b([a-z]+)\s+point\s+([a-z]+)\b/g, (match, p1, p2) => {
        const n1 = NUMBER_WORDS[p1] !== undefined ? NUMBER_WORDS[p1] : p1;
        const n2 = NUMBER_WORDS[p2] !== undefined ? NUMBER_WORDS[p2] : p2;
        return n1 + "." + n2;
    });
    norm = norm.replace(/(\d+)\s+point\s+(\d+)/g, "$1.$2");
    norm = norm.replace(/(\d+)\s+point\s+([a-z]+)/g, (match, p1, p2) => {
        const n2 = NUMBER_WORDS[p2] !== undefined ? NUMBER_WORDS[p2] : p2;
        return p1 + "." + n2;
    });

    norm = wordsToNumbers(norm);
    norm = norm.replace(/(\d+)\s*\.\s*(\d+)/g, "$1.$2");

    const xMatch = norm.match(/\b(\d+(?:\.\d+)?)\s*x\b/i);
    if (xMatch) {
        const val = parseFloat(xMatch[1]);
        if (Number.isFinite(val) && val > 0 && val <= 16) {
            return val;
        }
    }

    const speedNumMatch = norm.match(/(?:at|in|to|speed|is)\s+(\d+(?:\.\d+)?)(?:\s*(?:speed|x))?/i);
    if (speedNumMatch) {
        const val = parseFloat(speedNumMatch[1]);
        if (Number.isFinite(val) && val > 0 && val <= 16) {
            return val;
        }
    }

    const numBeforeSpeed = norm.match(/(\d+(?:\.\d+)?)\s*(?:times\s*)?speed\b/i);
    if (numBeforeSpeed) {
        const val = parseFloat(numBeforeSpeed[1]);
        if (Number.isFinite(val) && val > 0 && val <= 16) {
            return val;
        }
    }

    if (hasSpeedWord) {
        const anyNumMatch = norm.match(/(\d+(?:\.\d+)?)/);
        if (anyNumMatch) {
            const val = parseFloat(anyNumMatch[1]);
            if (Number.isFinite(val) && val > 0 && val <= 16) {
                return val;
            }
        }
    }

    return null;
}


// ============================================================
// LANGUAGE DETECTION
// ============================================================

const WORLD_LANGUAGES_LIST = [
    // South Asian & Indian Languages
    { id: "Telugu", label: "తెలుగు (Telugu)", aliases: ["telugu", "te"] },
    { id: "Hindi", label: "हिन्दी (Hindi)", aliases: ["hindi", "hi"] },
    { id: "Tamil", label: "தமிழ் (Tamil)", aliases: ["tamil", "ta"] },
    { id: "Kannada", label: "ಕನ್ನಡ (Kannada)", aliases: ["kannada", "kn"] },
    { id: "Malayalam", label: "മലയാളം (Malayalam)", aliases: ["malayalam", "ml"] },
    { id: "Marathi", label: "मराठी (Marathi)", aliases: ["marathi", "mr"] },
    { id: "Bengali", label: "বাংলা (Bengali)", aliases: ["bengali", "bangla", "bn"] },
    { id: "Gujarati", label: "ગુજરાતી (Gujarati)", aliases: ["gujarati", "gu"] },
    { id: "Punjabi", label: "ਪੰਜਾਬੀ (Punjabi)", aliases: ["punjabi", "pa"] },
    { id: "Odia", label: "ଓଡ଼ିଆ (Odia)", aliases: ["odia", "oriya", "or"] },
    { id: "Assamese", label: "অসমীয়া (Assamese)", aliases: ["assamese", "as"] },
    { id: "Urdu", label: "اردو (Urdu)", aliases: ["urdu", "ur"] },
    { id: "Sanskrit", label: "संस्कृतम् (Sanskrit)", aliases: ["sanskrit", "sa"] },
    { id: "Nepali", label: "नेपाली (Nepali)", aliases: ["nepali", "ne"] },
    { id: "Sinhala", label: "සිංහල (Sinhala)", aliases: ["sinhala", "sinhalese", "si"] },
    { id: "Konkani", label: "कोंकणी (Konkani)", aliases: ["konkani"] },
    { id: "Maithili", label: "मैथिली (Maithili)", aliases: ["maithili"] },
    { id: "Sindhi", label: "سنڌي (Sindhi)", aliases: ["sindhi"] },

    // European & Global Languages
    { id: "English", label: "English", aliases: ["english", "en"] },
    { id: "Spanish", label: "Español (Spanish)", aliases: ["spanish", "espanol", "castilian", "es"] },
    { id: "French", label: "Français (French)", aliases: ["french", "francais", "fr"] },
    { id: "German", label: "Deutsch (German)", aliases: ["german", "deutsch", "de"] },
    { id: "Italian", label: "Italiano (Italian)", aliases: ["italian", "italiano", "it"] },
    { id: "Portuguese", label: "Português (Portuguese)", aliases: ["portuguese", "portugues", "pt"] },
    { id: "Russian", label: "Русский (Russian)", aliases: ["russian", "ru"] },
    { id: "Ukrainian", label: "Українська (Ukrainian)", aliases: ["ukrainian", "uk"] },
    { id: "Polish", label: "Polski (Polish)", aliases: ["polish", "polski", "pl"] },
    { id: "Dutch", label: "Nederlands (Dutch)", aliases: ["dutch", "nederlands", "nl"] },
    { id: "Swedish", label: "Svenska (Swedish)", aliases: ["swedish", "svenska", "sv"] },
    { id: "Norwegian", label: "Norsk (Norwegian)", aliases: ["norwegian", "norsk", "no"] },
    { id: "Danish", label: "Dansk (Danish)", aliases: ["danish", "dansk", "da"] },
    { id: "Finnish", label: "Suomi (Finnish)", aliases: ["finnish", "suomi", "fi"] },
    { id: "Greek", label: "Ελληνικά (Greek)", aliases: ["greek", "el"] },
    { id: "Czech", label: "Čeština (Czech)", aliases: ["czech", "cesky", "cs"] },
    { id: "Hungarian", label: "Magyar (Hungarian)", aliases: ["hungarian", "magyar", "hu"] },
    { id: "Romanian", label: "Română (Romanian)", aliases: ["romanian", "romana", "ro"] },
    { id: "Bulgarian", label: "Български (Bulgarian)", aliases: ["bulgarian", "bg"] },
    { id: "Serbian", label: "Српски (Serbian)", aliases: ["serbian", "sr"] },
    { id: "Croatian", label: "Hrvatski (Croatian)", aliases: ["croatian", "hr"] },
    { id: "Slovak", label: "Slovenčina (Slovak)", aliases: ["slovak", "sk"] },
    { id: "Turkish", label: "Türkçe (Turkish)", aliases: ["turkish", "turkce", "tr"] },
    { id: "Irish", label: "Gaeilge (Irish)", aliases: ["irish", "gaeilge", "ga"] },
    { id: "Welsh", label: "Cymraeg (Welsh)", aliases: ["welsh", "cymraeg", "cy"] },

    // East & Southeast Asian Languages
    { id: "Japanese", label: "日本語 (Japanese)", aliases: ["japanese", "nihongo", "ja"] },
    { id: "Korean", label: "한국어 (Korean)", aliases: ["korean", "hangul", "ko"] },
    { id: "Chinese (Simplified)", label: "简体中文 (Chinese Simplified)", aliases: ["chinese", "mandarin", "simplified chinese", "zh", "zh-cn"] },
    { id: "Chinese (Traditional)", label: "繁體中文 (Chinese Traditional)", aliases: ["traditional chinese", "cantonese", "zh-tw"] },
    { id: "Vietnamese", label: "Tiếng Việt (Vietnamese)", aliases: ["vietnamese", "tieng viet", "vi"] },
    { id: "Thai", label: "ไทย (Thai)", aliases: ["thai", "th"] },
    { id: "Indonesian", label: "Bahasa Indonesia (Indonesian)", aliases: ["indonesian", "bahasa", "id"] },
    { id: "Malay", label: "Bahasa Melayu (Malay)", aliases: ["malay", "ms"] },
    { id: "Filipino", label: "Filipino (Tagalog)", aliases: ["filipino", "tagalog", "tl"] },
    { id: "Burmese", label: "မြန်မာ (Burmese)", aliases: ["burmese", "myanmar", "my"] },
    { id: "Khmer", label: "ភាសាខ្មែរ (Khmer)", aliases: ["khmer", "cambodian", "km"] },
    { id: "Mongolian", label: "Монгол (Mongolian)", aliases: ["mongolian", "mn"] },
    { id: "Kazakh", label: "Қазақ (Kazakh)", aliases: ["kazakh", "kk"] },
    { id: "Uzbek", label: "Oʻzbek (Uzbek)", aliases: ["uzbek", "uz"] },

    // Middle Eastern Languages
    { id: "Arabic", label: "العربية (Arabic)", aliases: ["arabic", "ar"] },
    { id: "Persian", label: "فارسی (Persian / Farsi)", aliases: ["persian", "farsi", "fa"] },
    { id: "Hebrew", label: "עברית (Hebrew)", aliases: ["hebrew", "he"] },

    // African & Other Languages
    { id: "Swahili", label: "Kiswahili (Swahili)", aliases: ["swahili", "kiswahili", "sw"] },
    { id: "Amharic", label: "አማርኛ (Amharic)", aliases: ["amharic", "am"] },
    { id: "Yoruba", label: "Èdè Yorùbá (Yoruba)", aliases: ["yoruba", "yo"] },
    { id: "Igbo", label: "Asụsụ Igbo (Igbo)", aliases: ["igbo", "ig"] },
    { id: "Hausa", label: "Harshen Hausa (Hausa)", aliases: ["hausa", "ha"] },
    { id: "Zulu", label: "isiZulu (Zulu)", aliases: ["zulu", "zu"] },
    { id: "Afrikaans", label: "Afrikaans", aliases: ["afrikaans", "af"] },
    { id: "Latin", label: "Latina (Latin)", aliases: ["latin", "la"] },
    { id: "Esperanto", label: "Esperanto", aliases: ["esperanto", "eo"] }
];

let userPreferredSummaryLanguage = "English";
chrome.storage.local.get(["preferredLanguage"], (result) => {
    if (result?.preferredLanguage) {
        userPreferredSummaryLanguage = result.preferredLanguage;
    }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.preferredLanguage) {
        userPreferredSummaryLanguage = changes.preferredLanguage.newValue;
        console.log("Updated preferred summary language to:", userPreferredSummaryLanguage);
    }
});

function detectSummaryLanguage(command) {
    const lower = (command || "").toLowerCase();

    // 1. Direct "in [language]" or "into [language]" pattern - ANY language in the world!
    const languagePattern = /(?:in|into)\s+([a-zA-Z\s]+)/i;
    const match = lower.match(languagePattern);
    if (match) {
        const rawCandidate = match[1].replace(/^(?:the\s+)?language\s+/i, "").replace(/\s+language$/i, "").trim();
        if (rawCandidate.length >= 2) {
            // Check if matches known alias
            const found = WORLD_LANGUAGES_LIST.find(l => 
                l.id.toLowerCase() === rawCandidate.toLowerCase() ||
                l.aliases.some(a => a.toLowerCase() === rawCandidate.toLowerCase())
            );
            if (found) return found.id;
            // Otherwise return capitalized name of requested language!
            return rawCandidate.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        }
    }

    // 2. Keyword check across world languages
    for (const item of WORLD_LANGUAGES_LIST) {
        for (const alias of item.aliases) {
            const regex = new RegExp(`\\b${alias}\\b`, "i");
            if (regex.test(lower)) {
                return item.id;
            }
        }
    }

    // 3. Fallback to user preferred language or English
    return userPreferredSummaryLanguage || "English";
}


// ============================================================
// TRANSCRIPT HELPERS
// ============================================================

function normalizeTranscriptText(
    text
) {

    return String(text || "")
        .replace(/\s+/g, " ")
        .trim();

}


function collectTranscriptText() {

    const selectors = [
        "ytd-transcript-segment-renderer",
        ".ytd-transcript-segment-renderer",
        "yt-transcript-segment-renderer",
        ".segment-text",
        "yt-formatted-string.segment-text"
    ];

    let segments = [];

    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
            segments = Array.from(elements);
            break;
        }
    }

    if (segments.length === 0) {
        return "";
    }

    const text = segments
        .map(element => normalizeTranscriptText(element.innerText || element.textContent))
        .filter(Boolean)
        .join(" ");

    return text;
}


// Direct caption track fetch from page metadata (lightning-fast & highly reliable)
async function getTranscriptFromCaptionTracks() {
    try {
        let tracks = null;

        // 1. Try accessing window.ytInitialPlayerResponse if in scope
        try {
            if (window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
                tracks = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
            }
        } catch (e) {}

        // 2. Search scripts on page for captionTracks JSON array
        if (!tracks || tracks.length === 0) {
            for (const script of document.scripts) {
                const content = script.textContent || "";
                const idx = content.indexOf('"captionTracks":');
                if (idx !== -1) {
                    const startIdx = content.indexOf('[', idx);
                    if (startIdx !== -1) {
                        let depth = 0;
                        let endIdx = -1;
                        for (let i = startIdx; i < content.length; i++) {
                            if (content[i] === '[') depth++;
                            else if (content[i] === ']') {
                                depth--;
                                if (depth === 0) {
                                    endIdx = i + 1;
                                    break;
                                }
                            }
                        }
                        if (endIdx !== -1) {
                            try {
                                const parsed = JSON.parse(content.slice(startIdx, endIdx));
                                if (Array.isArray(parsed) && parsed.length > 0) {
                                    tracks = parsed;
                                    break;
                                }
                            } catch (e) {}
                        }
                    }
                }
            }
        }

        if (tracks && tracks.length > 0) {
            // Find English track, or language track matching user, or fallback to first available track
            const track = tracks.find(t => t.languageCode === "en" || (t.vssId && t.vssId.includes(".en"))) || tracks[0];
            if (track && track.baseUrl) {
                console.log(`📡 Fetching direct transcript from track (${track.name?.simpleText || track.languageCode})...`);
                const response = await fetch(track.baseUrl);
                if (response.ok) {
                    const xmlText = await response.text();
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
                    const textNodes = xmlDoc.querySelectorAll("text");
                    const pieces = [];
                    for (const node of textNodes) {
                        const temp = document.createElement("div");
                        temp.innerHTML = node.textContent;
                        pieces.push(temp.textContent);
                    }
                    const result = pieces.join(" ").replace(/\s+/g, " ").trim();
                    if (result.length > 30) {
                        console.log("✅ Direct transcript fetched successfully! Length:", result.length);
                        return result;
                    }
                }
            }
        }
    } catch (err) {
        console.warn("Direct captionTracks fetch attempt failed:", err);
    }
    return "";
}


async function clickTranscriptButton() {

    function findTranscriptBtn() {
        const candidates = document.querySelectorAll(
            'button, tp-yt-paper-button, [role="button"], ytd-button-renderer, ytd-video-description-transcript-section-renderer button'
        );
        for (const element of candidates) {
            const text = [
                element.innerText,
                element.textContent,
                element.getAttribute("aria-label"),
                element.getAttribute("title")
            ].filter(Boolean).join(" ").trim().toLowerCase();

            if (text.includes("show transcript") || text === "transcript") {
                const clickable = element.querySelector("button") || element;
                clickable.click();
                return true;
            }
        }
        return false;
    }

    // Try finding button immediately if already visible
    if (findTranscriptBtn()) {
        return true;
    }

    // Expand video description if collapsed
    console.log("📝 Expanding description to find transcript button...");
    const expanders = [
        "#expand",
        "#description-inline-expander #expand",
        "tp-yt-paper-button#expand",
        "#description #expand",
        "#bottom-row #expand",
        "#description-inline-expander",
        "ytd-text-inline-expander #expand"
    ];
    for (const sel of expanders) {
        const el = document.querySelector(sel);
        if (el) {
            el.click();
            break;
        }
    }

    // Wait 400ms for description to expand and render transcript button
    await new Promise(resolve => setTimeout(resolve, 400));

    if (findTranscriptBtn()) {
        return true;
    }

    // Try clicking 'More actions' (...) menu if available
    const moreActions = document.querySelector('button[aria-label="More actions"], ytd-menu-renderer yt-icon-button button');
    if (moreActions) {
        moreActions.click();
        await new Promise(resolve => setTimeout(resolve, 300));
        return findTranscriptBtn();
    }

    return false;
}


async function waitForTranscript(
    timeout = 8000
) {

    const started =
        Date.now();


    while (
        Date.now() - started <
        timeout
    ) {

        const transcript =
            collectTranscriptText();


        if (
            transcript.length > 50
        ) {

            return transcript;

        }


        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    300
                )
        );

    }


    return "";

}


function closeTranscriptPanel() {
    try {
        console.log("🧹 Closing YouTube transcript panel to keep user UI clean...");
        const panelSelectors = [
            'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
            'ytd-engagement-panel-section-list-renderer[target-id*="transcript"]',
            'ytd-engagement-panel-section-list-renderer[section-identifier="engagement-panel-searchable-transcript"]'
        ];

        for (const sel of panelSelectors) {
            const panel = document.querySelector(sel);
            if (panel) {
                const closeBtn = panel.querySelector(
                    '#visibility-button button, yt-icon-button#visibility-button, button[aria-label*="Close" i], #dismiss-button, tp-yt-paper-icon-button#visibility-button'
                );
                if (closeBtn) {
                    closeBtn.click();
                    console.log("✅ Native transcript panel close button clicked");
                    break;
                }
                panel.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN");
            }
        }

        // Re-collapse description if it was expanded by us
        const collapseBtn = document.querySelector(
            "#collapse, #description-inline-expander #collapse, tp-yt-paper-button#collapse, ytd-text-inline-expander #collapse"
        );
        if (collapseBtn) {
            collapseBtn.click();
        }
    } catch (err) {
        console.warn("Could not auto-close transcript panel:", err);
    }
}


async function extractYouTubeTranscript() {

    console.log(
        "📝 Looking for YouTube transcript..."
    );


    // 1. Check if already open on page
    let transcript =
        collectTranscriptText();

    if (
        transcript.length > 50
    ) {

        console.log(
            "✅ Transcript already available on page"
        );

        return transcript;

    }


    // 2. Try direct caption fetch from YouTube tracks (fast & works without opening UI)
    transcript =
        await getTranscriptFromCaptionTracks();

    if (
        transcript.length > 50
    ) {

        return transcript;

    }


    // 3. Fallback to expanding description and clicking transcript button
    let openedByUs = false;
    const clicked =
        await clickTranscriptButton();

    if (clicked) {
        openedByUs = true;

        console.log(
            "📝 Transcript button clicked, waiting for panel..."
        );

        transcript =
            await waitForTranscript();

        // Immediately close the native transcript panel so the user never has to see it!
        closeTranscriptPanel();

        if (
            transcript.length > 50
        ) {

            console.log(
                "✅ Transcript extracted from DOM and panel closed"
            );

            return transcript;

        }

    }

    if (openedByUs) {
        closeTranscriptPanel();
    }

    console.log(
        "❌ Transcript could not be extracted"
    );


    return "";

}


// ============================================================
// EXTRACT VIDEO METADATA (FOR VIDEOS WITHOUT CAPTIONS)
// ============================================================

async function extractVideoMetadata() {
    console.log("📑 Extracting full video metadata, outline, chapters & description...");

    // 1. Channel / Creator name
    const channelEl = document.querySelector(
        "#owner #channel-name a, ytd-channel-name a, #upload-info #channel-name a, ytd-video-owner-renderer ytd-channel-name"
    );
    const creator = channelEl ? channelEl.innerText.trim() : "YouTube Creator";

    // 2. Expand video description if collapsed so we get the full text
    const expanders = [
        "#expand",
        "#description-inline-expander #expand",
        "tp-yt-paper-button#expand",
        "#description #expand",
        "#bottom-row #expand",
        "#description-inline-expander",
        "ytd-text-inline-expander #expand"
    ];
    for (const sel of expanders) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
            try { el.click(); } catch(e) {}
            break;
        }
    }
    await new Promise(r => setTimeout(r, 350));

    // 3. Full description text
    const descEl = document.querySelector(
        "#description-inline-expander yt-attributed-string, #description-inline-expander, #description yt-formatted-string, ytd-expandable-video-description-body-renderer"
    );
    let description = descEl ? descEl.innerText.trim() : "";

    // 4. Chapters / Timetable
    const chapterEls = document.querySelectorAll(
        "ytd-macro-markers-list-item-renderer, ytd-chapter-renderer, ytd-engagement-panel-section-list-renderer[target-id*='chapters'] ytd-macro-markers-list-item-renderer"
    );
    let chapters = [];
    if (chapterEls.length > 0) {
        chapterEls.forEach(ch => {
            const t = ch.innerText.replace(/\s+/g, " ").trim();
            if (t) chapters.push(t);
        });
    }

    // Also look for timestamp lines in description if chapters array is empty
    if (chapters.length === 0 && description) {
        const lines = description.split("\n");
        const tsRegex = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/;
        lines.forEach(l => {
            if (tsRegex.test(l)) {
                chapters.push(l.trim());
            }
        });
    }

    // 5. Pinned / Top Comments
    const commentEls = document.querySelectorAll("#comments ytd-comment-thread-renderer #content-text");
    let comments = [];
    if (commentEls.length > 0) {
        Array.from(commentEls).slice(0, 3).forEach(c => {
            const text = c.innerText.trim();
            if (text && text.length > 20) {
                comments.push(text.slice(0, 500));
            }
        });
    }

    return {
        creator: creator,
        description: description.slice(0, 35000),
        chapters: chapters.join("\n"),
        comments: comments.join("\n---\n")
    };
}


// ============================================================
// ASK BACKGROUND FOR AI SUMMARY
// ============================================================

async function requestAISummary(
    language,
    command
) {

    // Guard: ensure user is actually on a video page!
    if (!isYouTubeVideoPage()) {
        showSummaryOverlay(
            "⚠️ Please open a YouTube video first to generate a summary.\n\nSummaries can only be created while watching a video, not on the home feed or search results.",
            language,
            "No Video Playing"
        );
        return;
    }

    const requestedLang = language || userPreferredSummaryLanguage || "English";

    console.log(
        `🤖 Requesting summary in ${requestedLang}`
    );

    const videoTitle =
        document.title
            .replace(
                " - YouTube",
                ""
            )
            .trim();

    showSummaryOverlay(
        `🔍 Looking for video subtitles & transcript...\nPlease wait a moment.`,
        requestedLang,
        videoTitle,
        true
    );

    const transcript =
        await extractYouTubeTranscript();


    if (transcript && transcript.length > 50) {
        // Mode A: Transcript / Captions available
        showSummaryOverlay(
            `🧠 AI is analyzing the full video transcript & preparing your summary in ${requestedLang}...\nAlmost ready!`,
            requestedLang,
            videoTitle,
            true
        );

        chrome.runtime.sendMessage({
            action: "AI_SUMMARY_REQUEST",
            language: requestedLang,
            transcript: transcript,
            title: videoTitle,
            command: command,
            isMetadataBased: false
        });
    } else {
        // Mode B: NO captions/transcript found -> Extract complete video metadata, description, chapters & outline!
        console.log("ℹ️ No captions track found. Extracting complete video outline, chapters, and description...");
        showSummaryOverlay(
            `ℹ️ No subtitles found on YouTube.\n🔍 Reading full video outline, syllabus & chapters...\n🧠 Generating in-depth AI summary in ${requestedLang}...`,
            requestedLang,
            videoTitle,
            true
        );

        const videoDetails = await extractVideoMetadata();

        chrome.runtime.sendMessage({
            action: "AI_SUMMARY_REQUEST",
            language: requestedLang,
            transcript: "",
            videoDetails: videoDetails,
            isMetadataBased: true,
            title: videoTitle,
            command: command
        });
    }

}


// ============================================================
// PROCESS VOICE COMMAND
// ============================================================

function processVoiceCommand(
    command
) {

    let clean =
        command
            .toLowerCase()
            .trim()
            .replace(/^(?:bujji|buji|budji|booji|boodji|boujee|hey\s*bujji|hi\s*bujji|yt|y\s*t|whitey|why\s*t(?:ee)?|hey\s*youtube)\s+/i, "")
            .trim();


    console.log(
        "🎤 Processing:",
        clean
    );


    // ========================================================
    // SUMMARY
    // ========================================================

    if (
        clean.includes("summarize") ||
        clean.includes("summarise") ||
        clean.includes("summary")
    ) {

        const language =
            detectSummaryLanguage(
                clean
            );


        console.log(
            `📝 Summary language: ${language}`
        );


        requestAISummary(
            language,
            clean
        );


        return true;

    }


    // ========================================================
    // NEXT VIDEO
    // ========================================================

    if (
        clean === "next" ||
        clean.includes("next video") ||
        clean.includes("play next") ||
        clean.includes("go to next") ||
        clean.includes("go to the next")
    ) {

        return playNextVideo();

    }


    // ========================================================
    // PREVIOUS VIDEO
    // ========================================================

    if (
        clean === "previous" ||
        clean.includes("previous video") ||
        clean.includes("play previous") ||
        clean.includes("go to previous") ||
        clean.includes("go to the previous") ||
        clean.includes("last video")
    ) {

        return playPreviousVideo();

    }


    // ========================================================
    // PAUSE
    // ========================================================

    if (
        clean === "pause" ||
        clean.includes("pause video") ||
        clean.includes("pause the video")
    ) {

        const video =
            getVideo();


        if (video) {

            video.pause();

        }


        return true;

    }


    // ========================================================
    // PLAYBACK SPEED (E.G. "BUJJI PLAY VIDEO AT 2X SPEED")
    // ========================================================

    const speed =
        parseSpeedFromCommand(
            clean
        );

    if (
        speed !== null
    ) {

        return setVideoPlaybackSpeed(
            speed
        );

    }


    // ========================================================
    // PLAY
    // ========================================================

    if (
        clean === "play" ||
        clean.includes("play video") ||
        clean.includes("play the video")
    ) {

        const video =
            getVideo();


        if (video) {

            video.play().catch(
                () => {}
            );

        }


        return true;

    }


    // ========================================================
    // MUTE
    // ========================================================

    if (
        clean === "mute" ||
        clean.includes("mute video") ||
        clean.includes("mute the video")
    ) {

        const video =
            getVideo();


        if (video) {

            video.muted = true;

        }


        return true;

    }


    // ========================================================
    // UNMUTE
    // ========================================================

    if (
        clean === "unmute" ||
        clean.includes("unmute video") ||
        clean.includes("unmute the video")
    ) {

        const video =
            getVideo();


        if (video) {

            video.muted = false;

        }


        return true;

    }


    // ========================================================
    // ABSOLUTE TIMELINE NAVIGATION (E.G. "MOVE TO 10 MINUTES 35 SECONDS")
    // ========================================================

    const isRelative =
        clean.includes("forward") ||
        clean.includes("backward") ||
        clean.includes("rewind") ||
        clean.includes("skip ahead") ||
        clean.includes("jump forward") ||
        clean.includes("move forward") ||
        clean.includes("go forward") ||
        clean.includes("go back") ||
        clean.includes("move back");

    if (!isRelative) {
        const isTimelineTrigger =
            clean.includes("move to") ||
            clean.includes("go to") ||
            clean.includes("jump to") ||
            clean.includes("seek to") ||
            clean.includes("skip to") ||
            clean.includes("play at") ||
            clean.includes("play from") ||
            clean.includes("take me to") ||
            clean.includes("navigate to") ||
            clean.includes("timeline") ||
            clean.includes("timestamp") ||
            clean.startsWith("at ");

        const targetSeconds = parseTimelineSeconds(clean);

        if (targetSeconds !== null && (isTimelineTrigger || clean.includes("minute") || clean.includes("second") || clean.includes("hour") || clean.includes(":"))) {
            console.log(`⏱️ Timeline voice seek: ${targetSeconds}s from command: "${clean}"`);
            return seekToTimeline(targetSeconds);
        }
    }


    // ========================================================
    // FORWARD
    // ========================================================

    const isForward =
        clean.includes("forward") ||
        clean.includes("skip ahead") ||
        clean.includes("jump forward") ||
        clean.includes("move forward") ||
        clean.includes("go forward");


    if (isForward) {

        const seconds =
            getSecondsFromCommand(
                clean
            );


        if (
            seconds !== null
        ) {

            return forwardVideo(
                seconds
            );

        }


        return false;

    }


    // ========================================================
    // BACKWARD
    // ========================================================

    const isBackward =
        clean.includes("go back") ||
        clean.includes("backward") ||
        clean.includes("rewind") ||
        clean.includes("go backward") ||
        clean.includes("move back");


    if (isBackward) {

        const seconds =
            getSecondsFromCommand(
                clean
            );


        if (
            seconds !== null
        ) {

            return backwardVideo(
                seconds
            );

        }


        return false;

    }


    console.log(
        "❌ Command not recognized"
    );


    return false;

}


// ============================================================
// VOICE CONTROL
// ============================================================

const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;


let recognition = null;

let voiceActive = false;

let commandMode = false;

let restarting = false;

let commandModeTimer = null;

let videoVoiceState = {
    wasPlaying: false,
    originalVolume: 1
};


function pauseOrDuckVideo() {
    const video = getVideo();
    if (video) {
        videoVoiceState.wasPlaying = !video.paused;
        videoVoiceState.originalVolume = video.volume;
        // Pause video immediately to silence speakers so mic hears user cleanly
        if (!video.paused) {
            video.pause();
        }
    }
}


function restoreVideo() {
    const video = getVideo();
    if (video) {
        if (videoVoiceState.wasPlaying && video.paused) {
            video.play().catch(() => {});
        }
        if (videoVoiceState.originalVolume !== undefined) {
            video.volume = videoVoiceState.originalVolume;
        }
    }
}


function showVoiceIndicator(text, active = false) {
    if (!isYouTubeVideoPage()) return;

    let indicator = document.getElementById("mediapilot-voice-indicator");

    if (!indicator) {
        indicator = document.createElement("div");
        indicator.id = "mediapilot-voice-indicator";

        Object.assign(indicator.style, {
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: "2147483646",
            padding: "10px 18px",
            borderRadius: "30px",
            fontSize: "13px",
            fontWeight: "bold",
            fontFamily: "Arial, sans-serif",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
            cursor: "pointer",
            transition: "all 0.25s ease",
            userSelect: "none"
        });

        // Click to Talk / Push to Talk
        indicator.addEventListener("click", () => {
            if (!voiceActive) {
                enableVoiceControl();
            }
            commandMode = true;
            pauseOrDuckVideo();
            showVoiceIndicator("🔴 Listening to you... (video paused)", true);

            clearTimeout(commandModeTimer);
            commandModeTimer = setTimeout(() => {
                if (commandMode) {
                    commandMode = false;
                    restoreVideo();
                    showVoiceIndicator("🎙️ Say 'bujji' to control", false);
                }
            }, 6000);
        });

        document.body.appendChild(indicator);
    }

    if (active) {
        indicator.style.background = "linear-gradient(135deg, #e50914, #ff334b)";
        indicator.style.color = "#ffffff";
        indicator.style.transform = "scale(1.05)";
        indicator.style.border = "none";
    } else {
        indicator.style.background = "rgba(20, 20, 20, 0.92)";
        indicator.style.color = "#ffffff";
        indicator.style.transform = "scale(1)";
        indicator.style.border = "1px solid rgba(255, 255, 255, 0.2)";
    }

    indicator.textContent = text;
}


function hideVoiceIndicator() {
    const el = document.getElementById("mediapilot-voice-indicator");
    if (el) el.remove();
}


// Push-to-Talk via Alt+V
window.addEventListener("keydown", (e) => {
    if (e.altKey && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        if (!voiceActive) {
            enableVoiceControl();
        }
        commandMode = true;
        pauseOrDuckVideo();
        showVoiceIndicator("🔴 Listening to you... (Alt+V)", true);

        clearTimeout(commandModeTimer);
        commandModeTimer = setTimeout(() => {
            if (commandMode) {
                commandMode = false;
                restoreVideo();
                showVoiceIndicator("🎙️ Say 'bujji' to control", false);
            }
        }, 6000);
    }
});


// ============================================================
// YOUTUBE PAGE CHECK
// ============================================================

function isYouTubeVideoPage() {

    return (
        location.hostname ===
            "www.youtube.com" &&
        location.pathname ===
            "/watch"
    );

}


// ============================================================
// CREATE SPEECH RECOGNITION
// ============================================================

function createRecognition() {

    if (
        !SpeechRecognition
    ) {

        console.error(
            "❌ Speech recognition is not supported."
        );

        return null;

    }


    const instance =
        new SpeechRecognition();


    instance.continuous = false;

    instance.interimResults = false;

    instance.maxAlternatives = 1;

    instance.lang = "en-US";


    // ========================================================
    // RESULT
    // ========================================================

    instance.onresult =
        (event) => {

            const result =
                event.results[
                    event.results.length - 1
                ];


            if (!result) {

                return;

            }


            const transcript =
                result[0]
                    .transcript
                    .trim()
                    .toLowerCase();


            console.log(
                "🎤 Heard:",
                transcript
            );


            // Wake-word mode

            if (
                !commandMode
            ) {

                const wakeRegex = /\b(bujji|buji|budji|booji|boodji|boujee|hey\s*bujji|hi\s*bujji|yt|y\s*t|whitey|why\s*t(?:ee)?|hey\s*youtube)\b/i;
                const match = transcript.match(wakeRegex);

                if (match) {

                    console.log(
                        "🟢 Wake word detected ('bujji')"
                    );


                    commandMode =
                        true;


                    const wakeIndex = match.index;
                    const wakeLength = match[0].length;


                    const commandPart =
                        transcript
                            .slice(
                                wakeIndex +
                                wakeLength
                            )
                            .trim();


                    // Supports: e.g. "bujji forward 4 minutes" or "bujji pause" in one breath
                    if (
                        commandPart
                    ) {

                        showVoiceIndicator(`⚡ "${commandPart}"`, true);

                        processVoiceCommand(
                            commandPart
                        );


                        commandMode =
                            false;

                        setTimeout(() => {
                            if (voiceActive) showVoiceIndicator("🎙️ Say 'bujji' to control", false);
                        }, 2500);

                        return;

                    }


                    // Two-step command: Pause video so speakers stop feeding sound into mic!
                    pauseOrDuckVideo();
                    showVoiceIndicator("🔴 Listening to you... (video paused)", true);

                    clearTimeout(commandModeTimer);
                    commandModeTimer = setTimeout(() => {
                        if (commandMode) {
                            console.log("⏰ Command mode timed out");
                            commandMode = false;
                            restoreVideo();
                            if (voiceActive) showVoiceIndicator("🎙️ Say 'bujji' to control", false);
                        }
                    }, 6000);

                    console.log(
                        "🎤 Waiting for command..."
                    );

                }


                return;

            }


            // Command mode
            clearTimeout(commandModeTimer);
            commandMode = false;

            showVoiceIndicator(`⚡ "${transcript}"`, true);

            processVoiceCommand(
                transcript
            );

            restoreVideo();

            setTimeout(() => {
                if (voiceActive) showVoiceIndicator("🎙️ Say 'bujji' to control", false);
            }, 2500);

        };


    // ========================================================
    // START
    // ========================================================

    instance.onstart =
        () => {

            restarting =
                false;

            if (voiceActive && !commandMode) {
                showVoiceIndicator("🎙️ Say 'bujji' to control", false);
            }

            console.log(
                commandMode
                    ? "🎤 Listening for command..."
                    : "👂 Waiting for 'bujji'..."
            );

        };


    // ========================================================
    // END
    // ========================================================

    instance.onend =
        () => {

            if (
                !voiceActive
            ) {

                return;

            }


            if (
                restarting
            ) {

                return;

            }


            restarting =
                true;


            setTimeout(
                () => {

                    restarting =
                        false;


                    if (
                        voiceActive &&
                        isYouTubeVideoPage()
                    ) {

                        startRecognition();

                    }

                },
                300
            );

        };


    // ========================================================
    // ERROR
    // ========================================================

    instance.onerror =
        (event) => {

            console.error(
                "🎤 Voice error:",
                event.error
            );


            if (
                event.error ===
                "not-allowed"
            ) {

                console.error(
                    "Microphone permission denied."
                );


                voiceActive =
                    false;


                return;

            }


            if (
                event.error ===
                "no-speech"
            ) {

                return;

            }

        };


    return instance;

}


// ============================================================
// START RECOGNITION
// ============================================================

function startRecognition() {

    if (
        !voiceActive
    ) {

        return;

    }


    if (
        !isYouTubeVideoPage()
    ) {

        return;

    }


    if (
        !recognition
    ) {

        recognition =
            createRecognition();

    }


    if (
        !recognition
    ) {

        return;

    }


    try {

        recognition.start();

    }

    catch (error) {

        console.log(
            "Recognition start skipped:",
            error.message
        );

    }

}


// ============================================================
// ENABLE VOICE
// ============================================================

function enableVoiceControl() {

    if (
        !isYouTubeVideoPage()
    ) {

        return;

    }


    if (
        !SpeechRecognition
    ) {

        return;

    }


    voiceActive =
        true;


    commandMode =
        false;


    recognition =
        createRecognition();


    startRecognition();

}


// ============================================================
// DISABLE VOICE
// ============================================================

function disableVoiceControl() {

    voiceActive =
        false;


    commandMode =
        false;


    if (
        recognition
    ) {

        try {

            recognition.stop();

        }

        catch (error) {

            // Ignore

        }

    }

}


// ============================================================
// MESSAGE HANDLER
// ============================================================

chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {


        // ------------------------------
        // Manual forward
        // ------------------------------

        if (
            message.action ===
            "FORWARD"
        ) {

            forwardVideo(
                Number(message.seconds)
            );

            return;

        }


        // ------------------------------
        // Manual backward
        // ------------------------------

        if (
            message.action ===
            "BACKWARD"
        ) {

            backwardVideo(
                Number(message.seconds)
            );

            return;

        }


        // ------------------------------
        // Manual seek / timeline
        // ------------------------------

        if (
            message.action ===
            "SEEK_TO"
        ) {

            seekToTimeline(
                Number(message.seconds)
            );

            return;

        }


        // ------------------------------
        // Enable voice
        // ------------------------------

        if (
            message.action ===
            "ENABLE_VOICE"
        ) {

            enableVoiceControl();


            sendResponse({
                success: true
            });


            return true;

        }


        // ------------------------------
        // Disable voice
        // ------------------------------

        if (
            message.action ===
            "DISABLE_VOICE"
        ) {

            disableVoiceControl();


            sendResponse({
                success: true
            });


            return true;

        }


        // ------------------------------
        // Trigger summary (from popup)
        // ------------------------------
        if (message.action === "TRIGGER_SUMMARY") {
            const lang = message.language || userPreferredSummaryLanguage || "English";
            requestAISummary(lang, "Manual trigger");
            sendResponse({ success: true });
            return true;
        }

        // ------------------------------
        // Summary result
        // ------------------------------
        if (
            message.action ===
            "SUMMARY_RESULT"
        ) {

            console.log(
                "🤖 Summary result received"
            );

            if (
                message.success
            ) {

                showSummaryOverlay(
                    message.summary,
                    message.language,
                    message.title,
                    false
                );

            } else {

                showSummaryOverlay(
                    "❌ " + (message.error || "Failed to generate video summary."),
                    message.language,
                    message.title,
                    false,
                    true // isError
                );

            }

            return;

        }

    }
);


// ============================================================
// SUMMARY UI & MARKDOWN FORMATTER
// ============================================================

function ensureMediaPilotStyles() {
    if (document.getElementById("mediapilot-styles")) return;
    const style = document.createElement("style");
    style.id = "mediapilot-styles";
    style.textContent = `
        @keyframes mp-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .mp-pulse {
            animation: mp-pulse 1.5s infinite ease-in-out;
        }
        @keyframes mp-pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
        }
        #mediapilot-summary-overlay::-webkit-scrollbar {
            width: 8px;
        }
        #mediapilot-summary-overlay::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
        }
        #mediapilot-summary-overlay::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.25);
            border-radius: 4px;
        }
        #mediapilot-summary-overlay::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.4);
        }
    `;
    document.head.appendChild(style);
}

function formatSummaryMarkdown(rawText) {
    if (!rawText) return "";

    // Escape raw HTML
    let text = rawText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Headings ###
    text = text.replace(/^### (.*$)/gim, '<h3 style="margin: 14px 0 6px 0; color: #60a5fa; font-size: 15px; font-weight: 700;">$1</h3>');
    text = text.replace(/^## (.*$)/gim, '<h2 style="margin: 16px 0 8px 0; color: #93c5fd; font-size: 16px; font-weight: 700;">$1</h2>');
    text = text.replace(/^# (.*$)/gim, '<h1 style="margin: 18px 0 10px 0; color: #bfdbfe; font-size: 17px; font-weight: 700;">$1</h1>');

    // Bold text **word**
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong style="color: #ffffff; font-weight: 600;">$1</strong>');

    // Horizontal divider ---
    text = text.replace(/^\s*---+\s*$/gim, '<hr style="border: none; border-top: 1px solid rgba(255,255,255,0.15); margin: 12px 0;">');

    // Bullet lists (* or -)
    text = text.replace(/^\s*[\*\-]\s+(.*$)/gim, '<li style="margin-left: 18px; margin-bottom: 5px; color: #e5e7eb; line-height: 1.5;">$1</li>');

    // Wrap consecutive list items
    text = text.replace(/(<li[\s\S]*?<\/li>)+/g, '<ul style="margin: 8px 0; padding-left: 6px;">$&</ul>');

    // Paragraphs
    const blocks = text.split(/\n\n+/);
    return blocks.map(block => {
        const trimmed = block.trim();
        if (!trimmed) return "";
        if (trimmed.startsWith("<h") || trimmed.startsWith("<ul") || trimmed.startsWith("<hr")) {
            return trimmed;
        }
        return `<p style="margin: 8px 0; line-height: 1.6; color: #d1d5db;">${trimmed.replace(/\n/g, "<br>")}</p>`;
    }).join("");
}

function showSummaryOverlay(
    summary,
    language,
    title,
    isLoading = false,
    isError = false
) {
    ensureMediaPilotStyles();

    let overlay = document.getElementById("mediapilot-summary-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "mediapilot-summary-overlay";
        document.body.appendChild(overlay);
    }

    Object.assign(
        overlay.style,
        {
            position: "fixed",
            top: "75px",
            right: "24px",
            width: "440px",
            maxHeight: "75vh",
            overflowY: "auto",
            zIndex: "2147483647",
            background: "rgba(18, 20, 24, 0.96)",
            backdropFilter: "blur(12px)",
            color: "#ffffff",
            borderRadius: "14px",
            padding: "18px 20px",
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1)",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            lineHeight: "1.5",
            transition: "all 0.2s ease"
        }
    );

    overlay.innerHTML = "";

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    Object.assign(closeBtn.style, {
        position: "absolute",
        top: "12px",
        right: "12px",
        background: "rgba(255, 255, 255, 0.08)",
        color: "#d1d5db",
        border: "none",
        borderRadius: "50%",
        width: "28px",
        height: "28px",
        fontSize: "14px",
        fontWeight: "bold",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.2s"
    });
    closeBtn.onmouseenter = () => closeBtn.style.background = "rgba(239, 68, 68, 0.4)";
    closeBtn.onmouseleave = () => closeBtn.style.background = "rgba(255, 255, 255, 0.08)";
    closeBtn.onclick = () => overlay.remove();
    overlay.appendChild(closeBtn);

    // Header
    const header = document.createElement("div");
    header.style.marginBottom = "10px";
    header.style.paddingRight = "30px";

    const titleRow = document.createElement("div");
    titleRow.style.display = "flex";
    titleRow.style.alignItems = "center";
    titleRow.style.gap = "8px";

    const heading = document.createElement("h2");
    heading.textContent = "🤖 MediaPilot Summary";
    heading.style.margin = "0";
    heading.style.fontSize = "16px";
    heading.style.fontWeight = "700";
    heading.style.color = "#ffffff";
    titleRow.appendChild(heading);

    if (language) {
        const langBadge = document.createElement("span");
        langBadge.textContent = language;
        Object.assign(langBadge.style, {
            fontSize: "11px",
            padding: "2px 8px",
            background: "rgba(59, 130, 246, 0.25)",
            color: "#60a5fa",
            borderRadius: "10px",
            fontWeight: "600",
            border: "1px solid rgba(59, 130, 246, 0.4)"
        });
        titleRow.appendChild(langBadge);
    }
    header.appendChild(titleRow);

    if (title) {
        const subTitle = document.createElement("div");
        subTitle.textContent = title;
        Object.assign(subTitle.style, {
            fontSize: "12px",
            color: "#9ca3af",
            marginTop: "4px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
        });
        header.appendChild(subTitle);
    }
    overlay.appendChild(header);

    // If LOADING state
    if (isLoading) {
        const loadingBox = document.createElement("div");
        Object.assign(loadingBox.style, {
            display: "flex",
            alignItems: "center",
            gap: "14px",
            padding: "20px 10px",
            marginTop: "8px"
        });

        const spinner = document.createElement("div");
        Object.assign(spinner.style, {
            width: "24px",
            height: "24px",
            border: "3px solid rgba(59, 130, 246, 0.2)",
            borderTopColor: "#3b82f6",
            borderRadius: "50%",
            animation: "mp-spin 0.8s linear infinite",
            flexShrink: "0"
        });

        const msg = document.createElement("div");
        msg.innerHTML = summary.replace(/\n/g, "<br>");
        Object.assign(msg.style, {
            fontSize: "13px",
            color: "#cbd5e1",
            lineHeight: "1.4"
        });

        loadingBox.appendChild(spinner);
        loadingBox.appendChild(msg);
        overlay.appendChild(loadingBox);
        return;
    }

    // Actions Toolbar (Copy & Quick Translate)
    if (!isError) {
        const toolbar = document.createElement("div");
        Object.assign(toolbar.style, {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            padding: "8px 0",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            marginBottom: "12px",
            fontSize: "12px"
        });

        // Copy button
        const copyBtn = document.createElement("button");
        copyBtn.textContent = "📋 Copy Summary";
        Object.assign(copyBtn.style, {
            background: "rgba(255, 255, 255, 0.08)",
            color: "#e2e8f0",
            border: "none",
            borderRadius: "6px",
            padding: "5px 10px",
            fontSize: "12px",
            cursor: "pointer",
            transition: "background 0.2s"
        });
        copyBtn.onmouseenter = () => copyBtn.style.background = "rgba(255, 255, 255, 0.16)";
        copyBtn.onmouseleave = () => copyBtn.style.background = "rgba(255, 255, 255, 0.08)";
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(summary).then(() => {
                copyBtn.textContent = "✅ Copied!";
                setTimeout(() => { copyBtn.textContent = "📋 Copy Summary"; }, 2000);
            });
        };
        toolbar.appendChild(copyBtn);

        // Translate dropdown
        const translateRow = document.createElement("div");
        translateRow.style.display = "flex";
        translateRow.style.alignItems = "center";
        translateRow.style.gap = "6px";

        const translateSelect = document.createElement("select");
        Object.assign(translateSelect.style, {
            background: "#1e293b",
            color: "#ffffff",
            border: "1px solid rgba(255, 255, 255, 0.2)",
            borderRadius: "6px",
            padding: "4px 8px",
            fontSize: "11px",
            cursor: "pointer",
            maxWidth: "170px"
        });

        WORLD_LANGUAGES_LIST.forEach(lang => {
            const opt = document.createElement("option");
            opt.value = lang.id;
            opt.textContent = lang.label;
            if (lang.id.toLowerCase() === (language || "").toLowerCase()) {
                opt.selected = true;
            }
            translateSelect.appendChild(opt);
        });

        const customOpt = document.createElement("option");
        customOpt.value = "__CUSTOM__";
        customOpt.textContent = "✏️ Other Language...";
        translateSelect.appendChild(customOpt);

        const translateBtn = document.createElement("button");
        translateBtn.textContent = "Translate";
        Object.assign(translateBtn.style, {
            background: "#2563eb",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            padding: "4px 10px",
            fontSize: "11px",
            fontWeight: "600",
            cursor: "pointer"
        });
        translateBtn.onclick = () => {
            let chosenLang = translateSelect.value;
            if (chosenLang === "__CUSTOM__") {
                chosenLang = prompt("Enter target language (e.g. Basque, Latin, Icelandic, Catalan):");
                if (!chosenLang || !chosenLang.trim()) return;
                chosenLang = chosenLang.trim();
            }
            requestAISummary(chosenLang, `translate into ${chosenLang}`);
        };

        translateRow.appendChild(translateSelect);
        translateRow.appendChild(translateBtn);
        toolbar.appendChild(translateRow);

        overlay.appendChild(toolbar);
    }

    // Content container
    const content = document.createElement("div");
    Object.assign(content.style, {
        fontSize: "13px",
        lineHeight: "1.55",
        color: "#e2e8f0"
    });

    if (isError) {
        content.style.color = "#fca5a5";
        content.style.whiteSpace = "pre-wrap";
        content.textContent = summary;
    } else {
        content.innerHTML = formatSummaryMarkdown(summary);
    }

    overlay.appendChild(content);
}


// ============================================================
// AUTOMATIC VOICE START
// ============================================================

setTimeout(
    () => {

        if (
            isYouTubeVideoPage()
        ) {

            enableVoiceControl();

        }

    },
    2000
);


// ============================================================
// YOUTUBE SPA NAVIGATION
// ============================================================

let lastURL =
    location.href;


setInterval(
    () => {

        const currentURL =
            location.href;


        if (
            currentURL !==
            lastURL
        ) {

            lastURL =
                currentURL;


            if (
                isYouTubeVideoPage()
            ) {

                if (
                    !voiceActive
                ) {

                    enableVoiceControl();

                }

            } else {

                disableVoiceControl();

            }

        }

    },
    1000
);


console.log(
    "🚀 MediaPilot is ready."
);