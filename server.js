const path = require("path");

// Automatically set working directory to where .env and node_modules are located
const targetDir = path.join(__dirname, "youtube-auto-skip (2)", "youtube-auto-skip");
process.chdir(targetDir);

// Run the MediaPilot backend server
require(path.join(targetDir, "server.js"));
