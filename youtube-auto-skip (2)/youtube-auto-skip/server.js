const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI client if key is provided
let openai = null;
if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });
}

// Warn if neither API key nor MOCK_AI is configured
if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY && process.env.MOCK_AI !== "true") {
    console.warn("⚠️ Warning: Neither OPENAI_API_KEY nor GEMINI_API_KEY is configured in .env.");
    console.warn("⚠️ Set MOCK_AI=true in .env to test without paid API credits.");
}

app.use(cors());
app.use(express.json({ limit: "15mb" }));


// --------------------------------------------------
// Test endpoint
// --------------------------------------------------

app.get("/", (req, res) => {
    res.json({
        success: true,
        service: "MediaPilot AI Backend",
        status: "running",
        mockMode: process.env.MOCK_AI === "true"
    });
});


// --------------------------------------------------
// Helper: Google Gemini API (Free tier available)
// --------------------------------------------------
async function generateGeminiSummary(apiKey, systemPrompt, userPrompt) {
    const key = (apiKey || "").trim();
    const candidateModels = [
        process.env.GEMINI_MODEL,
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3.5-flash",
        "gemini-3.6-flash",
        "gemini-flash-latest",
        "gemini-3.7-flash",
        "gemini-3.8-flash",
        "gemini-3.1-flash-lite"
    ].filter(Boolean);

    const combinedPrompt = `${systemPrompt}\n\n------------------------\n\n${userPrompt}`;

    let lastError = null;
    for (const model of candidateModels) {
        try {
            console.log(`🤖 MediaPilot Backend: Trying Gemini model "${model}"...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 16000);

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
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
                console.log(`✅ MediaPilot Backend: Summary generated successfully using model "${model}"!`);
                return text;
            }
        } catch (err) {
            console.warn(`⚠️ Model "${model}" failed: ${err.message}. Cascading to next fallback model...`);
            lastError = err;
        }
    }

    throw lastError || new Error("Failed to generate summary from Gemini");
}


// --------------------------------------------------
// Helper: Mock Summary generator for instant testing
// --------------------------------------------------
function generateMockSummary(title, language, transcript) {
    const preview = transcript.length > 120 ? transcript.slice(0, 120) + "..." : transcript;
    return `📌 Summary
This is a test summary for "${title}" generated in ${language}. The video discusses foundational topics based on the input transcript: "${preview}"

🎯 Key Points
• MediaPilot AI backend successfully processed the incoming transcript.
• The communication pipeline between the client and server is fully verified.
• Language output is configured for ${language}.

🧠 Important Concepts
• Video Transcript Parsing: Seamlessly passing video audio text to language models.
• Automated Summarization: Distilling core ideas into concise, structured insights.

✅ Conclusion
The test completed successfully! The backend is ready to accept real transcripts from your YouTube extension.`;
}


// --------------------------------------------------
// AI Summary endpoint
// --------------------------------------------------

app.post("/api/summarize", async (req, res) => {

    try {

        const {
            title,
            language,
            transcript,
            videoDetails,
            isMetadataBased
        } = req.body;

        const hasTranscript = typeof transcript === "string" && transcript.trim().length > 50;
        const hasMetadata = videoDetails && (videoDetails.description || videoDetails.chapters);

        if (!hasTranscript && !hasMetadata) {
            return res.status(400).json({
                success: false,
                error: "Either transcript or video outline/metadata is required."
            });
        }

        const requestedLanguage =
            typeof language === "string" &&
            language.trim()
                ? language.trim()
                : "English";

        const videoTitle =
            typeof title === "string" &&
            title.trim()
                ? title.trim()
                : "YouTube Video";

        console.log("────────────────────────");
        console.log("📹 Video:", videoTitle);
        console.log("🌍 Language:", requestedLanguage);
        console.log("📌 Mode:", isMetadataBased || !hasTranscript ? "Metadata / Outline" : "Transcript");
        console.log("🤖 Sending to AI...");
        console.log("────────────────────────");

        let systemPrompt, userPrompt;

        if (isMetadataBased || !hasTranscript) {
            systemPrompt = `You are MediaPilot, an advanced multilingual AI video analyst and assistant.

Your task is to provide an in-depth, comprehensive, and structured summary of this YouTube video.

CRITICAL CONTEXT:
This video does not have closed captions or subtitles enabled on YouTube.
You are provided with the complete video metadata: title, creator, comprehensive description, roadmap chapters, timeline, and viewer context.
Analyze all these rich materials deeply to synthesize the complete roadmap, concepts, teachings, and actionable takeaways of the video.

CRITICAL MULTILINGUAL RULES:
1. OUTPUT LANGUAGE: You MUST write the ENTIRE summary in the user's requested language: "${requestedLanguage}".
2. All section headers, bullet points, explanations, roadmap steps, and takeaways must be written in fluent, natural ${requestedLanguage}.
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

            userPrompt = `Video Title:\n${videoTitle}\n\nCreator / Channel:\n${videoDetails?.creator || "YouTube Creator"}\n\nVideo Outline & Full Description:\n${(videoDetails?.description || "No description provided.").slice(0, 35000)}\n\nVideo Chapters & Timetable:\n${videoDetails?.chapters || "See description above."}\n\nKey Notes & Context:\n${videoDetails?.comments || "None"}\n\nTarget Output Language:\n${requestedLanguage}`;
        } else {
            // Prevent accidentally sending an enormous request.
            const MAX_CHARS = 100000;
            const cleanTranscript = transcript.replace(/\s+/g, " ").trim();
            const transcriptForAI = cleanTranscript.length > MAX_CHARS ? cleanTranscript.slice(0, MAX_CHARS) : cleanTranscript;

            systemPrompt = `You are MediaPilot, an advanced multilingual AI video analyst and assistant.

Summarize the supplied YouTube transcript clearly, comprehensively, and accurately.

CRITICAL MULTILINGUAL RULES:
1. The video title and transcript may be in ANY language (such as Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Spanish, German, Japanese, French, English, or mixed languages/code-switching).
2. Deeply understand the core message and all details of the video REGARDLESS of the original spoken language.
3. OUTPUT LANGUAGE REQUIREMENT:
   - You MUST write the ENTIRE summary in the user's requested language: "${requestedLanguage}".
   - All section headers, bullet points, explanations, and insights must be in natural, fluent ${requestedLanguage}.
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

            userPrompt = `Video title:\n${videoTitle}\n\nRequested output language:\n${requestedLanguage}\n\nTranscript:\n${transcriptForAI}`;
        }

        let summary = null;

        // Mode 1: Mock mode (fast testing without paid credits)
        if (process.env.MOCK_AI === "true") {
            summary = generateMockSummary(videoTitle, requestedLanguage, hasTranscript ? transcript : (videoDetails?.description || ""));
        }
        // Mode 2: Google Gemini (Free tier available)
        else if (process.env.GEMINI_API_KEY) {
            try {
                summary = await generateGeminiSummary(process.env.GEMINI_API_KEY, systemPrompt, userPrompt);
            } catch (geminiErr) {
                console.warn("⚠️ Gemini API call failed, falling back to mock summary:", geminiErr.message);
                summary = generateMockSummary(videoTitle, requestedLanguage, hasTranscript ? transcript : (videoDetails?.description || ""));
            }
        }
        // Mode 3: OpenAI (gpt-4o-mini)
        else if (openai) {
            const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";
            const completion = await openai.chat.completions.create({
                model: modelName,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0.5
            });

            summary = completion.choices?.[0]?.message?.content?.trim();
        } else {
            return res.status(500).json({
                success: false,
                error: "No AI provider configured. Add OPENAI_API_KEY or GEMINI_API_KEY, or set MOCK_AI=true in .env."
            });
        }

        if (!summary) {
            return res.status(500).json({
                success: false,
                error: "AI returned an empty summary."
            });
        }

        console.log("✅ Summary generated");

        return res.json({
            success: true,
            language: requestedLanguage,
            summary
        });

    } catch (error) {

        console.error("❌ AI request failed:", error.message || error);

        let errorMessage = error.message || "The AI summary request failed.";
        let hint = "Check your server console logs for details.";

        if (error.status === 429 || (error.message && error.message.includes("credit_balance_exhausted"))) {
            errorMessage = "OpenAI Quota Exceeded (No Credits Remaining).";
            hint = "Your OpenAI account has 0 credits. Either: (1) Add credits at https://platform.openai.com/settings/organization/billing/, or (2) Use a free Google Gemini API key, or (3) Add MOCK_AI=true to your .env file for instant free local testing.";
        }

        return res.status(500).json({
            success: false,
            error: errorMessage,
            hint: hint,
            details: error.message
        });
    }
});


// --------------------------------------------------
// Start server
// --------------------------------------------------

app.listen(PORT, () => {

    console.log("");
    console.log("🚀 MediaPilot AI Backend");
    console.log(`🌐 http://localhost:${PORT}`);
    console.log("✅ Server is running");
    if (process.env.MOCK_AI === "true") {
        console.log("💡 Running in MOCK_AI mode (instant local test responses, no API fees)");
    } else if (process.env.GEMINI_API_KEY) {
        console.log("💡 Using Google Gemini AI");
    } else {
        console.log(`💡 Using OpenAI (${process.env.OPENAI_MODEL || "gpt-4o-mini"})`);
    }
    console.log("");

});