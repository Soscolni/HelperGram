<p align="center">
  <img src="assets/helpergram.png" alt="HelperGram" width="300">
</p>

Personal Telegram assistant bot with an easy GUI setup wizard, packaged as a cross-platform Electron desktop app.

Supports multiple AI providers: **Anthropic Claude**, **OpenAI GPT**, and **Google Gemini** — configure any of them through the built-in setup wizard on first launch.

## Features

- **GUI Setup Wizard** — configure your Telegram token, chat ID, and AI provider without touching config files
- **Task Management** — multiple named task lists with priorities, due dates, and status tracking
- **Notes** — tagged notes with search and filtering
- **Reminders** — one-time and daily recurring reminders with snooze and follow-ups
- **Voice Messages** — Hebrew speech-to-text via Whisper (optional)
- **Web Search** — real-time info lookup via DuckDuckGo
- **Memory** — persistent long-term memory of user context and preferences
- **Daily Summary** — overview of tasks, reminders, and activity

## Installation

No prebuilt installers are published yet — run from source for now.

Prerequisites:

- [Node.js](https://nodejs.org/) 18 or newer (includes `npm`)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An API key for at least one supported provider (Anthropic, OpenAI, or Google)
- (Optional) `ffmpeg` on your `PATH` if you want voice-message transcription

Steps:

```bash
# Clone the repo
git clone https://github.com/Soscolni/HelperGram.git
cd HelperGram

# Install dependencies — this also downloads the Electron runtime
npm install

# Launch the Electron app
npm start
```

`npm install` pulls in Electron as a dev dependency, so you don't need to install it globally. `npm start` runs `electron .`, which opens the HelperGram desktop window. On first launch the setup wizard walks you through entering your Telegram credentials and choosing an AI provider.

### (Optional) Voice message support

To enable Hebrew speech-to-text, run the Whisper setup script once after installing dependencies:

```bash
node setup-whisper.js
```

This downloads the Whisper binary and model. You'll also need `ffmpeg` available on your `PATH` for audio decoding.

## Building installers

To produce distributable installers yourself:

```bash
npm run build        # build for the current platform
npm run build:win    # Windows NSIS installer
npm run build:mac    # macOS DMG
```

Output is written to the `dist/` directory.

## Bot Commands

| Command | Description |
|---------|-------------|
| `/tasks` | Show all tasks |
| `/notes` | Show all notes |
| `/reminders` | Show active reminders |
| `/summary` | Daily summary |
| `/version` | Show current version |
| `/help` | Show available commands |

## Architecture

- **src/main/** — Electron main process: window lifecycle, IPC, bot supervision
- **src/preload/** — Electron preload scripts bridging renderer and main
- **src/renderer/** — GUI setup wizard and settings UI
- **src/bot/** — Telegram polling, AI provider integrations, tool execution, data persistence
- **setup-whisper.js** — downloads and configures the Whisper binary + model

## Data Storage

All data is stored locally as JSON files alongside the app's user data:

- `tasks/*.json` — task lists (one file per list)
- `data.json` — notes and reminders
- `daily/*.json` — daily check-in logs
- `memory.md` — long-term memory
- `history.json` — recent conversation history

## License

Private project.
