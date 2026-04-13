/**
 * Setup script for Whisper (speech-to-text)
 * Downloads whisper.cpp pre-built binary and the base model for Hebrew
 *
 * Requirements: ffmpeg must be installed (for ogg→wav conversion)
 *   Install ffmpeg: winget install ffmpeg
 *
 * Usage: node setup-whisper.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WHISPER_DIR = path.join(__dirname, "whisper");

const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const WHISPER_RELEASE = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip";

async function download(url, dest) {
  console.log(`Downloading: ${url}`);
  console.log(`To: ${dest}`);

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

  const total = parseInt(res.headers.get("content-length") || "0");
  const reader = res.body.getReader();
  const chunks = [];
  let downloaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    if (total > 0) {
      const pct = ((downloaded / total) * 100).toFixed(1);
      process.stdout.write(`\r  ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}MB)`);
    }
  }
  console.log(" ✓");

  const buffer = Buffer.concat(chunks);
  fs.writeFileSync(dest, buffer);
  return dest;
}

async function main() {
  console.log("=== Whisper Setup for Telegram Assistant ===\n");

  // Check ffmpeg
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    console.log("✓ ffmpeg found");
  } catch {
    console.error("✗ ffmpeg not found! Install it with: winget install ffmpeg");
    console.error("  Then restart your terminal and run this script again.");
    process.exit(1);
  }

  // Create whisper directory
  if (!fs.existsSync(WHISPER_DIR)) fs.mkdirSync(WHISPER_DIR);

  // Download model
  const modelPath = path.join(WHISPER_DIR, "ggml-base.bin");
  if (fs.existsSync(modelPath)) {
    console.log("✓ Model already downloaded");
  } else {
    await download(MODEL_URL, modelPath);
  }

  // Download whisper binary
  const zipPath = path.join(WHISPER_DIR, "whisper-bin.zip");
  const exePath = path.join(WHISPER_DIR, "main.exe");

  if (fs.existsSync(exePath)) {
    console.log("✓ Whisper binary already exists");
  } else {
    await download(WHISPER_RELEASE, zipPath);

    // Extract using PowerShell
    console.log("Extracting...");
    try {
      execSync(
        `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${WHISPER_DIR}' -Force"`,
        { stdio: "inherit" }
      );

      // Find main.exe in extracted files (might be in a subfolder)
      const findExe = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = findExe(full);
            if (found) return found;
          }
          if (entry.name === "main.exe" || entry.name === "whisper-cli.exe") return full;
        }
        return null;
      };

      const foundExe = findExe(WHISPER_DIR);
      if (foundExe && foundExe !== exePath) {
        fs.copyFileSync(foundExe, exePath);
      }

      // Also copy any DLLs next to the exe
      const exeDir = foundExe ? path.dirname(foundExe) : WHISPER_DIR;
      for (const f of fs.readdirSync(exeDir)) {
        if (f.endsWith(".dll")) {
          const src = path.join(exeDir, f);
          const dst = path.join(WHISPER_DIR, f);
          if (src !== dst) fs.copyFileSync(src, dst);
        }
      }

      console.log("✓ Extracted");
    } catch (err) {
      console.error("✗ Extraction failed:", err.message);
      process.exit(1);
    }

    // Cleanup zip
    try { fs.unlinkSync(zipPath); } catch {}
  }

  // Verify
  if (fs.existsSync(exePath) && fs.existsSync(modelPath)) {
    console.log("\n=== Setup Complete! ===");
    console.log(`Whisper binary: ${exePath}`);
    console.log(`Model: ${modelPath}`);
    console.log("\nYour bot now supports voice messages! 🎤");
    console.log("Send a voice note in Telegram and the bot will transcribe and respond.");
  } else {
    console.error("\n✗ Something went wrong. Check the whisper/ directory.");
  }
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
