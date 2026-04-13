/**
 * Voice transcription via Whisper (optional — graceful degradation)
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import fetch from "node-fetch";
import { tgApi, getTelegramConfig } from "./telegram.js";

let whisperDir = "";
let whisperModel = "";
let whisperExe = "";

export function initWhisper(baseDir) {
  whisperDir = path.join(baseDir, "whisper");
  whisperModel = path.join(whisperDir, "ggml-base.bin");
  whisperExe = fs.existsSync(path.join(whisperDir, "whisper-cli.exe"))
    ? path.join(whisperDir, "whisper-cli.exe")
    : path.join(whisperDir, "main.exe");
}

export function isWhisperInstalled() {
  return whisperExe && fs.existsSync(whisperExe) && fs.existsSync(whisperModel);
}

export async function transcribeVoice(fileId, tmpDir) {
  if (!isWhisperInstalled()) {
    console.error("[HelperGram] Whisper not installed.");
    return null;
  }

  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const { botToken } = getTelegramConfig();

  // 1. Get file path from Telegram
  const fileInfo = await tgApi("getFile", { file_id: fileId });
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;

  // 2. Download the ogg file
  const oggFile = path.join(tmpDir, `voice_${Date.now()}.ogg`);
  const wavFile = oggFile.replace(".ogg", ".wav");

  const res = await fetch(fileUrl);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(oggFile, buffer);

  // 3. Convert ogg to wav using ffmpeg
  try {
    await new Promise((resolve, reject) => {
      const ffmpegPath = fs.existsSync(path.join(whisperDir, "ffmpeg.exe"))
        ? `"${path.join(whisperDir, "ffmpeg.exe")}"`
        : "ffmpeg";
      const proc = spawn(ffmpegPath, ["-i", oggFile, "-ar", "16000", "-ac", "1", "-y", wavFile], { shell: true, windowsHide: true });
      proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
      proc.on("error", reject);
    });
  } catch (err) {
    console.error("[HelperGram] ffmpeg error:", err.message);
    try { fs.unlinkSync(oggFile); } catch {}
    return null;
  }

  // 4. Run whisper
  try {
    const result = await new Promise((resolve, reject) => {
      const proc = spawn(`"${whisperExe}"`, ["-m", `"${whisperModel}"`, "-f", `"${wavFile}"`, "-l", "he", "--no-timestamps", "-nt"], { shell: true, timeout: 60_000, windowsHide: true });
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d) => stdout += d);
      proc.stderr.on("data", (d) => stderr += d);
      proc.on("close", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`whisper exited ${code}: ${stderr.slice(0, 200)}`));
      });
      proc.on("error", reject);
    });
    try { fs.unlinkSync(oggFile); fs.unlinkSync(wavFile); } catch {}
    return result || null;
  } catch (err) {
    console.error("[HelperGram] Whisper error:", err.message);
    try { fs.unlinkSync(oggFile); fs.unlinkSync(wavFile); } catch {}
    return null;
  }
}
