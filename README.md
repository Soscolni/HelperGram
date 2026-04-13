<p align="center">
  <img src="assets/helpergram.png" alt="HelperGram" width="300">
</p>

Personal Telegram assistant bot with an easy GUI setup wizard.

Supports multiple AI providers: **Anthropic Claude**, **OpenAI GPT**, **Google Gemini**, and **Claude Code CLI** (free with Max subscription).

## Features

- **Task Management** — multiple named task lists with priorities, due dates, and status tracking
- **Notes** — tagged notes with search and filtering
- **Reminders** — one-time and daily recurring reminders with snooze and follow-ups
- **Voice Messages** — Hebrew speech-to-text via Whisper
- **Web Search** — real-time info lookup via DuckDuckGo
- **Memory** — persistent long-term memory of user context and preferences
- **Daily Summary** — overview of tasks, reminders, and activity
- **Auto-Update** — pull from GitHub and restart with `/update`

## Prerequisites

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- ffmpeg (for voice messages): `winget install ffmpeg`

## Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/Soscolni/HelperGram.git
   cd HelperGram
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` from the example:
   ```bash
   cp .env.example .env
   ```
   Fill in your `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

4. (Optional) Set up Whisper for voice transcription:
   ```bash
   node setup-whisper.js
   ```

5. Start the bot:
   ```bash
   node launcher.js
   ```
   Or directly: `npm start`

## Bot Commands

| Command | Description |
|---------|-------------|
| `/tasks` | Show all tasks |
| `/notes` | Show all notes |
| `/reminders` | Show active reminders |
| `/summary` | Daily summary |
| `/update` | Pull latest code and restart |
| `/version` | Show current version |
| `/help` | Show available commands |

## Architecture

- **index.js** — main bot logic: Telegram polling, Claude CLI integration, tool execution, data persistence
- **launcher.js** — process wrapper for auto-restart on updates
- **setup-whisper.js** — downloads and configures Whisper binary + model

## Data Storage

All data is stored locally as JSON files:
- `tasks/*.json` — task lists (one file per list)
- `data.json` — notes and reminders
- `daily/*.json` — daily check-in logs
- `memory.md` — long-term memory
- `history.json` — recent conversation history

## License

Private project.
