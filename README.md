# Parlo

A desktop chat app for talking to Claude: compare two models side by side, watch the cost live, summon it with a hotkey. Built with React + Vite + Electron.

## Features
- Works with Claude, GPT, Gemini, Groq, OpenRouter, Mistral and Ollama (free options included)
- Streaming replies, markdown + code blocks with copy button
- Compare mode: two models answer side by side, pick the winner
- Live token and cost meter (edit PRICES in src/App.jsx if rates change)
- Global hotkey Ctrl+Shift+Space (Cmd on Mac) opens the app with your clipboard attached
- Saved chats, rename, delete, export to Markdown, stop button, light/dark theme
- System tray, optional start on login (installed app only)

## Run it
    npm install
    npm run electron:dev

On first launch connect at least one provider (Providers and keys screen). Free options: Gemini, Groq,
OpenRouter, Mistral, or Ollama running on your own PC. Keys are stored encrypted on your computer and
never leave the Electron main process.

## Build installers
    npm run dist:win     # on Windows
    npm run dist:mac     # on a Mac
    npm run dist:linux   # on Linux

Or push a version tag and let GitHub Actions build all three:

    git add . && git commit -m "release"
    npm version minor
    git push --follow-tags

## Before publishing
Change "author" and "appId" in package.json to your own details.
After the first npm install, commit package-lock.json.
