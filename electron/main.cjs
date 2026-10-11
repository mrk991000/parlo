const {
  app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, safeStorage, shell,
  globalShortcut, clipboard,
} = require('electron')
const path = require('path')
const fs = require('fs')

const iconPath = path.join(__dirname, 'icon.png')
const HOTKEY = 'CommandOrControl+Shift+Space'
const startHidden = process.argv.includes('--hidden')

let win = null
let tray = null
let quitting = false

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: '#212121',
    autoHideMenuBar: true,
    icon: iconPath,
    show: !startHidden,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    win.loadURL('http://localhost:5173')
  }

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })
}

function showWindow() {
  if (!win) createWindow()
  win.show()
  win.focus()
}

// open the app and offer the clipboard text to the page
async function quickAsk() {
  let clip = ''
  try {
    // readText() can return a Promise in newer Electron versions, so await it
    clip = String((await clipboard.readText()) ?? '').slice(0, 20000)
  } catch {
    // clipboard unavailable: carry on without it
  }
  showWindow()
  win.webContents.send('quick:ask', { clip })
}

function createTray() {
  const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  tray = new Tray(img)
  tray.setToolTip('Parlo')

  const items = [
    { label: 'Open Parlo', click: showWindow },
    { label: 'Quick ask (Ctrl+Shift+Space)', click: quickAsk },
  ]

  // "start when I log in" only makes sense in the installed app
  if (app.isPackaged && process.platform !== 'linux') {
    items.push({
      label: 'Start when I log in',
      type: 'checkbox',
      checked: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin,
      click: (item) =>
        app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }),
    })
  }

  items.push(
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit() } }
  )

  tray.setContextMenu(Menu.buildFromTemplate(items))
  tray.on('click', showWindow)
}

// ---------- Providers ----------
// "anthropic" speaks Anthropic's API. Everything else speaks the OpenAI-style
// /chat/completions API, so one code path covers all of them.
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    needsKey: true,
  },
  openai: {
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
  },
  gemini: {
    name: 'Google Gemini',
    type: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    needsKey: true,
  },
  groq: {
    name: 'Groq',
    type: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    needsKey: true,
  },
  openrouter: {
    name: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    headers: { 'X-Title': 'Parlo' },
  },
  mistral: {
    name: 'Mistral',
    type: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    needsKey: true,
  },
  ollama: {
    name: 'Ollama',
    type: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
  },
}

const ANTHROPIC_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001']

// keep only models that can chat (model lists include embeddings, speech, images...)
const MODEL_FILTERS = {
  openai: (m) =>
    /^(gpt-|o\d|chatgpt)/.test(m.id) &&
    !/(audio|realtime|transcribe|tts|image|embedding|moderation|whisper|search|instruct|codex)/.test(m.id),
  gemini: (m) =>
    /^(gemini|gemma)/.test(m.id) &&
    !/(embedding|aqa|imagen|tts|image|live|veo|robotics|computer-use)/.test(m.id),
  groq: (m) => !/(whisper|tts|guard|playai|orpheus)/.test(m.id),
  // OpenRouter lists hundreds of models, so show only the free ones
  openrouter: (m) =>
    m.id.endsWith(':free') ||
    (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0),
  mistral: (m) =>
    m.capabilities?.completion_chat !== false && !/(embed|moderation|ocr)/.test(m.id),
}

// ---------- API keys (encrypted on disk) ----------
const userFile = (name) => path.join(app.getPath('userData'), name)

function readKeys() {
  try {
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(userFile('keys.bin'))))
  } catch {
    // fall through to the old single-key file
  }
  // v1.0.0 stored one Anthropic key in key.bin
  try {
    const old = safeStorage.decryptString(fs.readFileSync(userFile('key.bin')))
    if (old) return { anthropic: old }
  } catch {
    // no old key either
  }
  return {}
}

function writeKeys(keys) {
  fs.writeFileSync(userFile('keys.bin'), safeStorage.encryptString(JSON.stringify(keys)))
}

ipcMain.handle('keys:status', () => {
  const keys = readKeys()
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, p]) => [id, !p.needsKey || !!keys[id]])
  )
})

ipcMain.handle('key:set', (_e, provider, key) => {
  const p = PROVIDERS[provider]
  if (!p || !p.needsKey) return false
  const keys = readKeys()
  const clean = String(key || '').trim()
  if (clean) keys[provider] = clean
  else delete keys[provider]
  writeKeys(keys)
  return true
})

// ---------- Helpers ----------
async function errorMessage(res) {
  let msg = ''
  try {
    const body = await res.json()
    msg = body?.error?.message || body?.[0]?.error?.message || body?.message || ''
  } catch {
    // body was not JSON
  }
  if (res.status === 401 || res.status === 403) {
    return `${msg || 'Access denied'} (check your API key)`
  }
  if (res.status === 429) {
    return `Rate limit reached. Free tiers have daily limits, so try again later or pick another model. ${msg}`.trim()
  }
  return msg || `Request failed (${res.status})`
}

function networkMessage(provider, err) {
  if (provider === 'ollama') {
    return 'Could not reach Ollama. Install it from ollama.com and make sure it is running.'
  }
  return `Network error: ${err.message}`
}

// reads a Server-Sent-Events stream and calls onEvent with each JSON payload
async function readSSE(res, onEvent) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        onEvent(JSON.parse(data))
      } catch {
        // ignore partial or non-JSON lines
      }
    }
  }
}

function sendRequest(cfg, key, model, messages, signal, withUsage) {
  if (cfg.type === 'anthropic') {
    return fetch(`${cfg.baseUrl}/messages`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: 4096, stream: true, messages }),
    })
  }
  const body = { model, messages, stream: true }
  if (withUsage) body.stream_options = { include_usage: true }
  return fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...(cfg.headers || {}),
    },
    body: JSON.stringify(body),
  })
}

// ---------- Model lists ----------
ipcMain.handle('models:list', async (_e, provider) => {
  const cfg = PROVIDERS[provider]
  if (!cfg) return { error: 'Unknown provider.' }
  if (provider === 'anthropic') return { models: ANTHROPIC_MODELS }

  const key = readKeys()[provider]
  if (cfg.needsKey && !key) return { error: 'No API key saved.' }

  try {
    const res = await fetch(`${cfg.baseUrl}/models`, {
      signal: AbortSignal.timeout(15000),
      headers: {
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(cfg.headers || {}),
      },
    })
    if (!res.ok) return { error: await errorMessage(res) }

    const json = await res.json()
    const list = json.data || json.models || []
    const filter = MODEL_FILTERS[provider] || (() => true)
    const models = [
      ...new Set(
        list
          .map((m) => ({ ...m, id: String(m.id || m.name || '').replace(/^models\//, '') }))
          .filter((m) => m.id && filter(m))
          .map((m) => m.id)
      ),
    ].sort()
    return { models }
  } catch (err) {
    return { error: networkMessage(provider, err) }
  }
})

// ---------- Chat ----------
const controllers = new Map() // requestId -> AbortController

ipcMain.handle('chat:send', async (event, { requestId, provider, messages, model }) => {
  const cfg = PROVIDERS[provider]
  if (!cfg) return { error: 'Unknown provider.' }
  if (typeof model !== 'string' || !/^[\w.:\/\-]{1,120}$/.test(model)) {
    return { error: 'Invalid model name.' }
  }
  const key = readKeys()[provider]
  if (cfg.needsKey && !key) {
    return { error: `No ${cfg.name} API key saved.`, needsKey: true }
  }

  const controller = new AbortController()
  controllers.set(requestId, controller)
  const usage = { input: 0, output: 0 }
  let outChars = 0
  let streamError = ''

  const emit = (text) => {
    outChars += text.length
    event.sender.send('chat:chunk', { requestId, text })
  }

  // some providers don't report token usage, so estimate (about 4 characters per token)
  const finishUsage = () => {
    if (cfg.type !== 'anthropic' && !usage.output && outChars > 0) {
      usage.output = Math.ceil(outChars / 4)
      usage.input = usage.input || Math.ceil(JSON.stringify(messages).length / 4)
      usage.estimated = true
    }
    return usage
  }

  try {
    let res = await sendRequest(cfg, key, model, messages, controller.signal, true)
    // a few servers reject stream_options: retry once without it
    if (!res.ok && res.status === 400 && cfg.type === 'openai') {
      res = await sendRequest(cfg, key, model, messages, controller.signal, false)
    }
    if (!res.ok) return { error: await errorMessage(res) }

    await readSSE(res, (ev) => {
      if (cfg.type === 'anthropic') {
        if (ev.type === 'message_start') {
          usage.input = ev.message?.usage?.input_tokens ?? 0
        } else if (ev.type === 'message_delta') {
          usage.output = ev.usage?.output_tokens ?? usage.output
        } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          emit(ev.delta.text)
        }
      } else {
        if (ev.error) streamError = ev.error.message || 'The model returned an error.'
        const text = ev.choices?.[0]?.delta?.content
        if (text) emit(text)
        if (ev.usage) {
          usage.input = ev.usage.prompt_tokens ?? usage.input
          usage.output = ev.usage.completion_tokens ?? usage.output
        }
      }
    })

    if (streamError && outChars === 0) return { error: streamError }
    return { ok: true, usage: finishUsage() }
  } catch (err) {
    if (err.name === 'AbortError') return { stopped: true, usage: finishUsage() }
    return { error: networkMessage(provider, err) }
  } finally {
    controllers.delete(requestId)
  }
})

ipcMain.handle('chat:stop', (_e, requestId) => {
  if (requestId) controllers.get(requestId)?.abort()
  else controllers.forEach((c) => c.abort())
  return true
})

// ---------- App lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.whenReady().then(() => {
    createWindow()
    createTray()
    if (!globalShortcut.register(HOTKEY, quickAsk)) {
      console.warn('Could not register hotkey (another app may be using it)')
    }
  })
}

app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {})
