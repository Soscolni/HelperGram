/**
 * Launcher — wrapper process that runs the bot and restarts it on update.
 *
 * The bot writes a file ".restart" when it needs to restart after git pull.
 * This launcher watches for that file and respawns the bot.
 *
 * Usage: node launcher.js
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESTART_FLAG = path.join(__dirname, ".restart");

// Clean up any stale restart flag
if (fs.existsSync(RESTART_FLAG)) fs.unlinkSync(RESTART_FLAG);

function startBot() {
  console.log("[launcher] Starting bot...");

  const bot = spawn("node", ["index.js"], {
    cwd: __dirname,
    stdio: "inherit",
    shell: true,
  });

  bot.on("close", (code) => {
    if (fs.existsSync(RESTART_FLAG)) {
      fs.unlinkSync(RESTART_FLAG);
      console.log("[launcher] Restart requested — restarting bot...");
      setTimeout(startBot, 1000);
    } else {
      console.log(`[launcher] Bot exited with code ${code}. Not restarting.`);
      process.exit(code);
    }
  });

  bot.on("error", (err) => {
    console.error("[launcher] Failed to start bot:", err.message);
    process.exit(1);
  });
}

startBot();
