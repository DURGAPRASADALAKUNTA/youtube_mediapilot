# 🎬 MediaPilot — YouTube Smart Controller & AI Assistant

**MediaPilot** is a voice-controlled Chrome Extension and Node.js AI backend that elevates your YouTube experience with **multi-tiered smart ad-skipping**, **hands-free voice controls**, and **instant multilingual video summaries** powered by Google Gemini and OpenAI.

---

## ✨ Features

- 🛑 **Multi-Tiered Auto Skip Ads**:
  - **Tier 1 (Instant 0ms Ad Acceleration & Auto-Mute)**: Silences ad audio and fast-forwards ads at 16x speed so both skippable and unskippable ads complete in under 100 milliseconds.
  - **Tier 2 (Real-Click Hardware Skip)**: Uses the Chrome Debugger API to dispatch genuine hardware-level mouse events (`Input.dispatchMouseEvent`) with `isTrusted: true` directly to the skip button coordinates, safely bypassing YouTube's anti-adblock detection.
  - **Protected Search & Input Typing**: Intelligent typing guard (`isUserTyping`) guarantees that search bar typing and comment writing are never interrupted or de-focused.
  - **Player-Scoped Accuracy**: Scoped exclusively inside YouTube's video player (`#movie_player`), preventing accidental misfires on YouTube's "Skip navigation" accessibility button.
- 🎙️ **Voice Control with `"bujji"` Wake Word**:
  - Control playback seamlessly using your microphone.
  - Supports continuous listening or saying the wake word and command in one breath (*"bujji pause"*, *"bujji forward 2 minutes"*).
  - ⏱️ **Absolute Timeline Seeking**: Jump directly to any video point by voice (*"bujji move to 10 minutes 35 seconds"*, *"bujji go to 1 hour 15 minutes"*, *"bujji jump to 45 seconds"*, *"bujji play at 10:35"*).
  - Push-to-talk shortcut: **Alt + V** or click the floating microphone badge.
- 🧠 **AI Multilingual Video Summaries**:
  - Automatically extracts and parses video transcripts and caption tracks across any language (*English, Telugu, Hindi, Tamil, Spanish, etc.*).
  - Displays a floating dark-mode summary overlay directly over YouTube with key takeaways, important concepts, and conclusions.
  - Guards against invalid pages (e.g., reminding users to open a video if triggered on the home feed).
- ⚡ **Dual AI Backend Support**:
  - **Google Gemini API** (Automated 8-model cascade: `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.5-flash`, etc. with zero-downtime failover).
  - **OpenAI API** (`gpt-4o-mini`).
  - **Mock Testing Mode** (`MOCK_AI=true`) for instant offline testing without API credits.

---

## 🏗️ Architecture

```text
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                     │
│                                                         │
│   [content.js] ───────────────► [popup.html / js]       │
│        │ (Player-isolated skip,      (UI toggle & mic)  │
│        │  transcript extractor,                         │
│        │  voice wake-word engine)                       │
│        ▼                                                │
│   [background.js] (Service Worker / Real-Click Dispatch)│
└────────┬────────────────────────────────────────────────┘
         │ HTTP POST /api/summarize
         ▼
┌─────────────────────────────────────────────────────────┐
│                 Node.js Express Backend                 │
│                      (server.js)                        │
│                                                         │
│   • Model Router: Gemini (3.6 / 3.5 Flash) / OpenAI     │
│   • Resilient Fallback Engine                           │
│   • Multilingual Prompt Builder                         │
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│               AI Provider (Google / OpenAI)             │
│        Generates Structured Multilingual Summary        │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Google Chrome** (or Chromium-based browser like Edge, Brave).
- **Node.js** (v18 or higher).

---

### 2. Backend Setup

1. Open your terminal and navigate to the project directory:
   ```bash
   cd "youtube-auto-skip (2)/youtube-auto-skip"
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your `.env` file:
   Edit the `.env` file in the project directory:
   ```env
   PORT=3000

   # Option 1: Google Gemini (Free Tier - Recommended)
   GEMINI_API_KEY=your_gemini_api_key_here

   # Option 2: OpenAI (Paid)
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_MODEL=gpt-4o-mini

   # Set to true for offline mock testing without AI API keys
   MOCK_AI=false
   ```

4. Start the backend server:
   ```bash
   node server.js
   ```

   You should see:
   ```text
   🚀 MediaPilot AI Backend
   🌐 http://localhost:3000
   ✅ Server is running
   💡 Using Google Gemini AI
   ```

---

### 3. Chrome Extension Setup

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the `youtube-auto-skip (2)/youtube-auto-skip` folder containing `manifest.json`.
5. The **MediaPilot** extension is now installed!

> 🔄 **Note on Updating**: Whenever you make changes to extension files, go to `chrome://extensions`, click the 🔄 **Reload** icon on the MediaPilot card, and refresh open YouTube tabs (**F5**).

---

## 🗣️ Voice Command Reference

Wake word: **`"bujji"`** (or press **Alt + V**)

| Command Type | Voice Prompt | What It Does |
| :--- | :--- | :--- |
| **Playback** | `"bujji pause"` | Pauses the current video |
| | `"bujji play"` | Resumes video playback |
| **Speed** | `"bujji play video at 2x speed"` | Plays video at custom speed (supports any number e.g. 1.5x, 2x, 3x) |
| **Audio** | `"bujji mute"` | Mutes audio |
| | `"bujji unmute"` | Unmutes audio |
| **Navigation** | `"bujji next"` / `"bujji next video"` | Plays the next video in queue |
| | `"bujji previous"` / `"bujji previous video"` | Goes back to the previous video |
| **Seeking** | `"bujji forward 30 seconds"` | Skips forward 30 seconds |
| | `"bujji forward 2 minutes"` | Skips forward 2 minutes |
| | `"bujji go back 15 seconds"` | Rewinds 15 seconds |
| | `"bujji rewind 1 minute"` | Rewinds 1 minute |
| **Timeline Jump** | `"bujji move to 10 minutes 35 seconds"` | Jumps to exact timeline 10:35 |
| | `"bujji go to 1 hour 15 minutes"` | Jumps to exact timeline 1:15:00 |
| | `"bujji play at 10:35"` | Jumps to exact timestamp and plays |
| **AI Summary** | `"bujji summarize this video"` | Generates summary in English |
| | `"bujji summarize this video in Telugu"` | Generates summary in **Telugu** (తెలుగు) |
| | `"bujji summarize this video in Hindi"` | Generates summary in **Hindi** (हिंदी) |
| | `"bujji summarize this video in Tamil"` | Generates summary in **Tamil** (தமிழ்) |
| | `"bujji summarize this video in Spanish"` | Generates summary in **Spanish** (Español) |

> 💡 **Tip**: You can speak the wake word and command together (*"bujji forward 10 seconds"*, *"bujji move to 5 minutes"*) or say *"bujji"*, wait for the indicator, and then say *"pause"*.

---

## 📁 Project Structure

```text
├── manifest.json       # Extension Manifest V3 configuration
├── background.js       # Service worker (Real-Click hardware dispatch & API proxy)
├── content.js          # YouTube page script (Player-scoped ad-skip, voice engine, summary overlay)
├── popup.html          # Extension popup UI
├── popup.js            # Extension popup logic (microphone permissions, toggles)
├── server.js           # Express server interfacing with Gemini (3.6 / 3.5 Flash) & OpenAI
├── package.json        # Dependencies (express, cors, dotenv, openai)
└── .env                # API keys and environment variables
```

---

## 🛡️ Ad Skip Mechanism & Focus Protection

Unlike traditional ad blockers that modify network packets (which triggers YouTube's anti-adblock detection), MediaPilot operates transparently:
1. **Ad Fast-Forwarding**: Instantly mutes and fast-forwards through unskippable ads or the initial 5-second countdown.
2. **Real-Click Dispatch**: Detects the official skip button inside `#movie_player` and uses `chrome.debugger` to dispatch real hardware mouse coordinates. YouTube validates the event as `isTrusted: true`, ensuring uninterrupted playback.
3. **Input Protection**: Automatically checks `document.activeElement` before any click action. If you are typing in the search bar, comment box, or playlist inputs, ad-skipping never touches or steals keyboard focus.
4. **Immediate Detach**: The debugger attaches strictly for the millisecond duration needed to click the skip button and detaches immediately afterward.

---

## 📄 License

ISC License. Feel free to use and modify for personal or educational projects!
