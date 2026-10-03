// ==========================================
// MediaPilot - Popup Controller
// ==========================================

const toggle = document.getElementById("enabledToggle");

const back30 = document.getElementById("back30");
const forward30 = document.getElementById("forward30");
const forward60 = document.getElementById("forward60");

const enableVoice = document.getElementById("enableVoice");
const voiceStatus = document.getElementById("voiceStatus");

const summaryLanguage = document.getElementById("summaryLanguage");
const customLanguageInput = document.getElementById("customLanguageInput");
const triggerSummary = document.getElementById("triggerSummary");


// ==========================================
// AUTO SKIP ADS SETTING
// ==========================================

chrome.storage.sync.get(["enabled"], (result) => {
    toggle.checked = result.enabled !== false;
});

toggle.addEventListener("change", () => {
    chrome.storage.sync.set({
        enabled: toggle.checked
    });
});


// ==========================================
// SUMMARY LANGUAGE SETTING & TRIGGER
// ==========================================

chrome.storage.local.get(["preferredLanguage"], (result) => {
    if (result.preferredLanguage && summaryLanguage) {
        let found = false;
        for (let i = 0; i < summaryLanguage.options.length; i++) {
            if (summaryLanguage.options[i].value.toLowerCase() === result.preferredLanguage.toLowerCase()) {
                summaryLanguage.selectedIndex = i;
                found = true;
                break;
            }
        }
        if (!found && customLanguageInput) {
            summaryLanguage.value = "__CUSTOM__";
            customLanguageInput.style.display = "block";
            customLanguageInput.value = result.preferredLanguage;
        }
    }
});

if (summaryLanguage) {
    summaryLanguage.addEventListener("change", () => {
        if (summaryLanguage.value === "__CUSTOM__") {
            if (customLanguageInput) {
                customLanguageInput.style.display = "block";
                customLanguageInput.focus();
            }
        } else {
            if (customLanguageInput) {
                customLanguageInput.style.display = "none";
            }
            chrome.storage.local.set({
                preferredLanguage: summaryLanguage.value
            });
            console.log("Saved preferred language:", summaryLanguage.value);
        }
    });
}

if (customLanguageInput) {
    customLanguageInput.addEventListener("input", () => {
        const val = customLanguageInput.value.trim();
        if (val) {
            chrome.storage.local.set({
                preferredLanguage: val
            });
        }
    });
}

if (triggerSummary) {
    triggerSummary.addEventListener("click", () => {
        let lang = "English";
        if (summaryLanguage) {
            if (summaryLanguage.value === "__CUSTOM__" && customLanguageInput && customLanguageInput.value.trim()) {
                lang = customLanguageInput.value.trim();
            } else {
                lang = summaryLanguage.value;
            }
        }

        triggerSummary.textContent = "⏳ Extracting...";
        triggerSummary.disabled = true;

        getActiveYouTubeTab((tab) => {
            if (!tab) {
                alert("Please open a YouTube video first to generate a summary.");
                triggerSummary.textContent = "⚡ Summarize Video";
                triggerSummary.disabled = false;
                return;
            }

            chrome.tabs.sendMessage(
                tab.id,
                {
                    action: "TRIGGER_SUMMARY",
                    language: lang
                },
                (response) => {
                    triggerSummary.textContent = "⚡ Summarize Video";
                    triggerSummary.disabled = false;

                    if (chrome.runtime.lastError) {
                        alert("Could not reach YouTube tab. Please refresh the YouTube page and try again.");
                    } else {
                        // Close popup so user sees the overlay on the YouTube page
                        window.close();
                    }
                }
            );
        });
    });
}


// ==========================================
// FIND ACTIVE TAB
// ==========================================

function getActiveYouTubeTab(callback) {
    chrome.tabs.query(
        {
            active: true,
            currentWindow: true
        },
        (tabs) => {
            const tab = tabs[0];
            if (
                !tab ||
                !tab.id ||
                !tab.url ||
                !tab.url.startsWith("https://www.youtube.com/")
            ) {
                callback(null);
                return;
            }
            callback(tab);
        }
    );
}


// ==========================================
// SEND VIDEO COMMAND
// ==========================================

function sendVideoCommand(action, seconds) {
    getActiveYouTubeTab((tab) => {
        if (!tab) {
            console.log("Please open a YouTube video first.");
            return;
        }

        chrome.tabs.sendMessage(
            tab.id,
            {
                action: action,
                seconds: seconds
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.log(
                        "Could not communicate with YouTube:",
                        chrome.runtime.lastError.message
                    );
                    return;
                }
                console.log("Video command sent:", action, seconds);
            }
        );
    });
}


// ==========================================
// MANUAL VIDEO BUTTONS
// ==========================================

back30.addEventListener("click", () => {
    sendVideoCommand("BACKWARD", 30);
});

forward30.addEventListener("click", () => {
    sendVideoCommand("FORWARD", 30);
});

forward60.addEventListener("click", () => {
    sendVideoCommand("FORWARD", 60);
});


// ==========================================
// VOICE SETUP
// ==========================================

enableVoice.addEventListener("click", () => {
    getActiveYouTubeTab((tab) => {
        if (!tab) {
            voiceStatus.textContent = "Status: Open a YouTube video first.";
            return;
        }

        chrome.tabs.sendMessage(
            tab.id,
            {
                action: "ENABLE_VOICE"
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    voiceStatus.textContent = "Status: Refresh the YouTube page.";
                    console.error(chrome.runtime.lastError.message);
                    return;
                }

                if (response?.success) {
                    voiceStatus.textContent = "Status: Voice control enabled 🎤";
                    chrome.storage.local.set({
                        voiceEnabled: true
                    });
                } else {
                    voiceStatus.textContent = "Status: Microphone permission needed.";
                }
            }
        );
    });
});


// ==========================================
// LOAD VOICE STATUS
// ==========================================

chrome.storage.local.get(["voiceEnabled"], (result) => {
    if (result.voiceEnabled === true) {
        voiceStatus.textContent = "Status: Voice control enabled 🎤";
    }
});


// ==========================================
// GEMINI API KEY & SETTINGS
// ==========================================

const settingsHeader = document.getElementById("settingsHeader");
const settingsBody = document.getElementById("settingsBody");
const settingsArrow = document.getElementById("settingsArrow");
const customApiKeyInput = document.getElementById("customApiKeyInput");
const saveApiKeyBtn = document.getElementById("saveApiKeyBtn");
const testApiKeyBtn = document.getElementById("testApiKeyBtn");
const apiKeyStatus = document.getElementById("apiKeyStatus");

const BUNDLED_DEFAULT_KEY = "";

if (settingsHeader && settingsBody && settingsArrow) {
    settingsHeader.addEventListener("click", () => {
        const isHidden = settingsBody.style.display === "none" || settingsBody.style.display === "";
        settingsBody.style.display = isHidden ? "block" : "none";
        settingsArrow.textContent = isHidden ? "▲" : "▼";
    });
}

chrome.storage.local.get(["geminiApiKey"], (result) => {
    if (result.geminiApiKey && customApiKeyInput) {
        customApiKeyInput.value = result.geminiApiKey;
    }
});

if (saveApiKeyBtn && customApiKeyInput && apiKeyStatus) {
    saveApiKeyBtn.addEventListener("click", () => {
        const key = customApiKeyInput.value.trim();
        if (!key) {
            chrome.storage.local.remove("geminiApiKey", () => {
                apiKeyStatus.style.display = "block";
                apiKeyStatus.style.color = "#38bdf8";
                apiKeyStatus.textContent = "ℹ️ Reset to default bundled AI key.";
            });
        } else {
            chrome.storage.local.set({ geminiApiKey: key }, () => {
                apiKeyStatus.style.display = "block";
                apiKeyStatus.style.color = "#4ade80";
                apiKeyStatus.textContent = "✅ Personal Gemini API key saved!";
            });
        }
    });
}

if (testApiKeyBtn && customApiKeyInput && apiKeyStatus) {
    testApiKeyBtn.addEventListener("click", async () => {
        const key = (customApiKeyInput.value.trim() || BUNDLED_DEFAULT_KEY);
        apiKeyStatus.style.display = "block";
        apiKeyStatus.style.color = "#38bdf8";
        apiKeyStatus.textContent = "⏳ Testing API connection...";
        testApiKeyBtn.disabled = true;

        const startTime = Date.now();
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${key}`;
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] })
            });
            const data = await res.json();
            const elapsed = Date.now() - startTime;

            if (res.ok) {
                apiKeyStatus.style.color = "#4ade80";
                apiKeyStatus.textContent = `✅ Connected in ${elapsed}ms! (gemini-3.5-flash-lite)`;
            } else {
                apiKeyStatus.style.color = "#f87171";
                apiKeyStatus.textContent = `❌ Error (${res.status}): ${data.error?.message || "Check key"}`;
            }
        } catch (err) {
            apiKeyStatus.style.color = "#f87171";
            apiKeyStatus.textContent = `❌ Network error: ${err.message}`;
        } finally {
            testApiKeyBtn.disabled = false;
        }
    });
}