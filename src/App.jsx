import { useState, useRef, useEffect } from 'react'
import {
  Menu, Sun, Moon, Plus, ArrowUp, KeyRound, Trash2, Square, Pencil,
  Columns2, Download, Clipboard, X, Check, RefreshCw,
} from 'lucide-react'
import Markdown from './Markdown'
import './App.css'

// ---------- providers ----------
const PROVIDERS = [
  {
    id: 'anthropic', name: 'Anthropic (Claude)', short: 'Anthropic', tag: 'Paid', kind: 'paid',
    blurb: 'Best answer quality. Needs an API key with credit.',
    url: 'https://console.anthropic.com',
  },
  {
    id: 'openai', name: 'OpenAI (GPT)', short: 'OpenAI', tag: 'Paid', kind: 'paid',
    blurb: 'GPT models. Needs an API key with credit.',
    url: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini', name: 'Google Gemini', short: 'Gemini', tag: 'Free tier', kind: 'free',
    blurb: 'Free key from Google AI Studio, no card needed. Daily limits apply.',
    url: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'groq', name: 'Groq', short: 'Groq', tag: 'Free tier', kind: 'free',
    blurb: 'Very fast open models. Free key, no card needed.',
    url: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter', name: 'OpenRouter', short: 'OpenRouter', tag: 'Free models', kind: 'free',
    blurb: 'Many models marked free. Free key, small daily limit.',
    url: 'https://openrouter.ai/keys',
  },
  {
    id: 'mistral', name: 'Mistral', short: 'Mistral', tag: 'Free tier', kind: 'free',
    blurb: 'Has a free mode with a free key.',
    url: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'ollama', name: 'Ollama (on your PC)', short: 'Ollama', tag: 'Free, offline', kind: 'free',
    blurb: 'No key and no internet. Install Ollama, then run: ollama pull llama3.2',
    url: 'https://ollama.com/download', noKey: true,
  },
]

const CLAUDE_LABELS = {
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-opus-5-5': 'Opus 5.5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}
const CLAUDE_IDS = Object.keys(CLAUDE_LABELS)

// USD per million tokens, Claude only. Prices change, so check anthropic.com/pricing now and then.
// Other providers are free or priced differently, so we show tokens only.
const PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
}

const provOf = (x) => x.provider || 'anthropic' // chats saved by v1.0.0 had no provider
const providerShort = (id) => PROVIDERS.find((p) => p.id === id)?.short || id

function modelLabel(model) {
  return (
    CLAUDE_LABELS[model] ||
    model.replace(/^models\//, '').split('/').pop().replace(/:free$/, ' (free)')
  )
}

// a selection is stored as "provider|model"
function parseSel(sel) {
  const i = sel.indexOf('|')
  return i < 0
    ? { provider: 'anthropic', model: sel }
    : { provider: sel.slice(0, i), model: sel.slice(i + 1) }
}

function loadSel(key, oldKey, fallback) {
  const v = localStorage.getItem(key)
  if (v && v.includes('|')) return v
  const old = oldKey && localStorage.getItem(oldKey)
  return old ? `anthropic|${old}` : fallback
}

// null = unknown price, 0 = free
function costOf(provider, model, usage) {
  if (!usage) return null
  if (provider === 'ollama') return 0
  const p = provider === 'anthropic' ? PRICES[model] : null
  if (!p) return null
  return (usage.input * p.in + usage.output * p.out) / 1_000_000
}

function formatCost(c) {
  return c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(2)}`
}

function formatTokens(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

// every {provider, model, usage} a message has cost us
function usagesOf(m) {
  if (m.compare) {
    return m.options
      .filter((o) => o.usage)
      .map((o) => ({ provider: provOf(o), model: o.model, usage: o.usage }))
  }
  const list = []
  if (m.usage) list.push({ provider: provOf(m), model: m.model, usage: m.usage })
  if (m.other) list.push({ ...m.other, provider: provOf(m.other) })
  return list
}

// messages in the shape the APIs want
function toApi(messages) {
  return messages
    .filter((m) => m.text && !m.error)
    .map((m) => ({
      role: m.role,
      content: m.attachment
        ? `${m.text}\n\nClipboard content:\n${m.attachment}`
        : m.text,
    }))
}

function finalizeOption(o, r) {
  if (r?.error) return { ...o, text: '⚠ ' + r.error, error: true }
  if (r?.stopped && o.text === '') return { ...o, text: 'Stopped.', error: true }
  return { ...o, usage: r.usage }
}

function newChat() {
  return { id: Date.now(), title: 'New chat', messages: [] }
}

function loadChats() {
  try {
    const saved = JSON.parse(localStorage.getItem('parlo-chats'))
    if (Array.isArray(saved) && saved.length > 0) {
      return saved.map((c) => ({
        ...c,
        messages: c.messages
          .filter((m) => !(m.role === 'assistant' && m.text === ''))
          .map((m) =>
            m.compare
              ? {
                  ...m,
                  options: m.options.map((o) =>
                    !o.usage && !o.error
                      ? { ...o, text: o.text || 'Interrupted.', error: true }
                      : o
                  ),
                }
              : m
          ),
      }))
    }
  } catch {
    // ignore corrupted data
  }
  return [newChat()]
}

const Dots = () => <span className="dots"><i></i><i></i><i></i></span>

function UsageLine({ provider, model, usage, withModel }) {
  const c = costOf(provider, model, usage)
  const est = usage.estimated ? '~' : ''
  return (
    <div className="msg-meta">
      {withModel && `${providerShort(provider)} · ${modelLabel(model)} · `}
      {est}{formatTokens(usage.input)} in · {est}{formatTokens(usage.output)} out
      {c !== null && ` · ${c === 0 ? 'free' : formatCost(c)}`}
    </div>
  )
}

function ModelSelect({ value, onChange, status, catalog, disabled }) {
  const groups = PROVIDERS.filter((p) => status[p.id] && catalog[p.id]?.length)
  const known = groups.some((p) => catalog[p.id].some((m) => `${p.id}|${m}` === value))
  return (
    <select
      className="model-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {!known && (
        <option value={value}>
          {value ? modelLabel(parseSel(value).model) : 'No model connected'}
        </option>
      )}
      {groups.map((p) => (
        <optgroup key={p.id} label={`${p.short} · ${p.tag}`}>
          {catalog[p.id].map((m) => (
            <option key={m} value={`${p.id}|${m}`}>{modelLabel(m)}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

function App() {
  const [chats, setChats] = useState(loadChats)
  const [activeId, setActiveId] = useState(chats[0].id)
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [theme, setTheme] = useState('dark')
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [clip, setClip] = useState('')
  const [compare, setCompare] = useState(false)

  const [status, setStatus] = useState({}) // provider -> connected?
  const [catalog, setCatalog] = useState({}) // provider -> model ids
  const [catalogError, setCatalogError] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [drafts, setDrafts] = useState({})
  const [sel1, setSel1] = useState(() => loadSel('parlo-sel1', 'parlo-model', ''))
  const [sel2, setSel2] = useState(() => loadSel('parlo-sel2', 'parlo-model2', ''))

  const bottomRef = useRef(null)
  const cancelRef = useRef(false)
  const inputRef = useRef(null)

  const activeChat = chats.find((c) => c.id === activeId)
  const hasPending = activeChat.messages.some((m) => m.compare)

  const allOptions = PROVIDERS.flatMap((p) =>
    (status[p.id] ? catalog[p.id] || [] : []).map((m) => `${p.id}|${m}`)
  )
  const optionsKey = allOptions.join('\n')

  const totals = activeChat.messages
    .flatMap(usagesOf)
    .concat(activeChat.discarded || [])
    .reduce(
      (t, u) => ({
        tokens: t.tokens + u.usage.input + u.usage.output,
        cost: t.cost + (costOf(u.provider || 'anthropic', u.model, u.usage) ?? 0),
      }),
      { tokens: 0, cost: 0 }
    )

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeChat.messages, activeId])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    localStorage.setItem('parlo-chats', JSON.stringify(chats))
  }, [chats])

  useEffect(() => {
    localStorage.setItem('parlo-sel1', sel1)
  }, [sel1])

  useEffect(() => {
    localStorage.setItem('parlo-sel2', sel2)
  }, [sel2])

  // load which providers are connected and their model lists
  useEffect(() => {
    if (!window.api) {
      setLoaded(true)
      return
    }
    loadAll()
  }, [])

  // make sure the selected models exist; otherwise pick the first available
  useEffect(() => {
    if (!loaded || allOptions.length === 0) return
    if (!allOptions.includes(sel1)) setSel1(allOptions[0])
    if (!allOptions.includes(sel2)) setSel2(allOptions[1] || allOptions[0])
  }, [loaded, optionsKey])

  // nothing connected yet: open the providers screen
  useEffect(() => {
    if (loaded && allOptions.length === 0) setShowSettings(true)
  }, [loaded, optionsKey])

  // global hotkey: the main process tells us to focus the input and offers the clipboard
  useEffect(() => {
    if (!window.api?.onQuickAsk) return
    return window.api.onQuickAsk(({ clip: c }) => {
      setClip(c || '')
      inputRef.current?.focus()
    })
  }, [])

  function updateChat(chatId, updater) {
    setChats((prev) => prev.map((c) => (c.id === chatId ? updater(c) : c)))
  }

  // ---------- providers ----------
  async function refreshProvider(id) {
    if (id === 'anthropic') {
      setCatalog((c) => ({ ...c, anthropic: CLAUDE_IDS }))
      return
    }
    const r = await window.api.listModels(id)
    setCatalog((c) => ({ ...c, [id]: r.models || [] }))
    setCatalogError((e) => ({ ...e, [id]: r.error || '' }))
  }

  async function loadAll() {
    const st = await window.api.keysStatus()
    setStatus(st)
    await Promise.all(PROVIDERS.filter((p) => st[p.id]).map((p) => refreshProvider(p.id)))
    setLoaded(true)
  }

  async function saveProviderKey(id) {
    const key = (drafts[id] || '').trim()
    if (!key) return
    await window.api.setKey(id, key)
    setDrafts((d) => ({ ...d, [id]: '' }))
    setStatus((s) => ({ ...s, [id]: true }))
    await refreshProvider(id)
  }

  async function removeProviderKey(id) {
    await window.api.setKey(id, '')
    setStatus((s) => ({ ...s, [id]: false }))
    setCatalog((c) => ({ ...c, [id]: [] }))
    setCatalogError((e) => ({ ...e, [id]: '' }))
  }

  // ---------- chat ----------
  async function sendMessage() {
    const text = input.trim()
    if (!text || isTyping || hasPending) return
    if (!window.api) {
      alert('Run this inside Electron: npm run electron:dev')
      return
    }
    if (!sel1) {
      setShowSettings(true)
      return
    }

    const chatId = activeId
    const userMsg = {
      id: Date.now(),
      role: 'user',
      text,
      ...(clip ? { attachment: clip } : {}),
    }
    const history = toApi([...activeChat.messages, userMsg])
    const baseId = Date.now() + 1
    const setTitle = (c) => (c.messages.length === 0 ? text.slice(0, 30) : c.title)

    setInput('')
    setClip('')
    setIsTyping(true)

    if (!compare) {
      // ----- one model -----
      const { provider, model } = parseSel(sel1)

      updateChat(chatId, (c) => ({
        ...c,
        title: setTitle(c),
        messages: [...c.messages, userMsg, { id: baseId, role: 'assistant', text: '' }],
      }))

      const off = window.api.onChunk((p) => {
        if (p.requestId !== baseId) return
        updateChat(chatId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === baseId ? { ...m, text: m.text + p.text } : m
          ),
        }))
      })

      const result = await window.api.sendChat({
        requestId: baseId,
        provider,
        model,
        messages: history,
      })
      off()

      updateChat(chatId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === baseId ? { ...finalizeOption(m, result), provider, model } : m
        ),
      }))
      if (result?.needsKey) setShowSettings(true)
    } else {
      // ----- two models at once -----
      const ids = [`${baseId}a`, `${baseId}b`]
      const picks = [parseSel(sel1), parseSel(sel2)]

      updateChat(chatId, (c) => ({
        ...c,
        title: setTitle(c),
        messages: [
          ...c.messages,
          userMsg,
          {
            id: baseId,
            role: 'assistant',
            compare: true,
            options: picks.map((pk) => ({ provider: pk.provider, model: pk.model, text: '' })),
          },
        ],
      }))

      const off = window.api.onChunk((p) => {
        const i = ids.indexOf(p.requestId)
        if (i < 0) return
        updateChat(chatId, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id !== baseId
              ? m
              : {
                  ...m,
                  options: m.options.map((o, j) =>
                    j === i ? { ...o, text: o.text + p.text } : o
                  ),
                }
          ),
        }))
      })

      const results = await Promise.all(
        ids.map((id, i) =>
          window.api.sendChat({
            requestId: id,
            provider: picks[i].provider,
            model: picks[i].model,
            messages: history,
          })
        )
      )
      off()

      updateChat(chatId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id !== baseId
            ? m
            : { ...m, options: m.options.map((o, j) => finalizeOption(o, results[j])) }
        ),
      }))
      if (results.some((r) => r?.needsKey)) setShowSettings(true)
    }

    setIsTyping(false)
  }

  async function stopChat() {
    await window.api?.stopChat()
  }

  // turn a compare row into a normal message using the chosen answer
  function pickOption(msgId, i) {
    updateChat(activeId, (c) => ({
      ...c,
      messages: c.messages.map((m) => {
        if (m.id !== msgId) return m
        const picked = m.options[i]
        const other = m.options[1 - i]
        return {
          id: m.id,
          role: 'assistant',
          text: picked.text,
          provider: provOf(picked),
          model: picked.model,
          usage: picked.usage,
          ...(other.usage
            ? { other: { provider: provOf(other), model: other.model, usage: other.usage } }
            : {}),
        }
      }),
    }))
  }

  function discardCompare(msgId) {
    updateChat(activeId, (c) => {
      const msg = c.messages.find((m) => m.id === msgId)
      return {
        ...c,
        messages: c.messages.filter((m) => m.id !== msgId),
        // the tokens were spent even if we throw the answers away
        discarded: [...(c.discarded || []), ...(msg ? usagesOf(msg) : [])],
      }
    })
  }

  function exportChat() {
    const lines = [`# ${activeChat.title}`, '']
    for (const m of activeChat.messages) {
      if (m.compare || !m.text || m.error) continue
      lines.push(
        m.role === 'user' ? '## You' : `## ${m.model ? modelLabel(m.model) : 'Assistant'}`,
        '',
        m.text,
        ''
      )
      if (m.attachment) lines.push('> Clipboard attached:', '', '```', m.attachment, '```', '')
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeChat.title.replace(/[^\w\- ]+/g, '').trim() || 'chat'}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function handleNewChat() {
    if (activeChat.messages.length === 0) return
    const chat = newChat()
    setChats((prev) => [chat, ...prev])
    setActiveId(chat.id)
  }

  function startRename(chat) {
    cancelRef.current = false
    setEditingId(chat.id)
    setEditText(chat.title)
  }

  function finishRename() {
    if (cancelRef.current) {
      cancelRef.current = false
      return
    }
    const title = editText.trim()
    if (title) updateChat(editingId, (c) => ({ ...c, title }))
    setEditingId(null)
  }

  function deleteChat(id) {
    const remaining = chats.filter((c) => c.id !== id)
    if (remaining.length === 0) {
      const fresh = newChat()
      setChats([fresh])
      setActiveId(fresh.id)
      return
    }
    setChats(remaining)
    if (id === activeId) setActiveId(remaining[0].id)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') sendMessage()
    if (e.key === 'Escape' && isTyping) stopChat()
  }

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        <div className="sidebar-inner">
          <button className="new-chat" onClick={handleNewChat}>
            <Plus size={18} /> New chat
          </button>
          <div className="chat-list">
            {chats.map((c) => (
              <div
                key={c.id}
                className={`chat-item ${c.id === activeId ? 'active' : ''}`}
                onClick={() => setActiveId(c.id)}
              >
                {editingId === c.id ? (
                  <input
                    className="rename-input"
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={finishRename}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') finishRename()
                      if (e.key === 'Escape') {
                        cancelRef.current = true
                        setEditingId(null)
                      }
                    }}
                  />
                ) : (
                  <span className="chat-title" onDoubleClick={() => startRename(c)}>
                    {c.title}
                  </span>
                )}
                {editingId !== c.id && (
                  <div className="item-actions">
                    <button
                      className="delete-btn edit"
                      onClick={(e) => {
                        e.stopPropagation()
                        startRename(c)
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="delete-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteChat(c.id)
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Menu size={20} />
          </button>

          <div className="btn-group">
            <ModelSelect
              value={sel1}
              onChange={setSel1}
              status={status}
              catalog={catalog}
              disabled={isTyping}
            />
            {compare && (
              <>
                <span className="vs">vs</span>
                <ModelSelect
                  value={sel2}
                  onChange={setSel2}
                  status={status}
                  catalog={catalog}
                  disabled={isTyping}
                />
              </>
            )}
            <button
              className={`icon-btn ${compare ? 'on' : ''}`}
              title="Compare two models"
              onClick={() => setCompare(!compare)}
            >
              <Columns2 size={20} />
            </button>
          </div>

          <div className="btn-group">
            {totals.tokens > 0 && (
              <span
                className="totals"
                title="Tokens used in this chat. Dollar cost is only estimated for Claude models."
              >
                {formatTokens(totals.tokens)} tokens
                {totals.cost > 0 ? ` · ${formatCost(totals.cost)}` : ''}
              </span>
            )}
            <button className="icon-btn" title="Export chat" onClick={exportChat}>
              <Download size={20} />
            </button>
            <button
              className="icon-btn"
              title="Providers and API keys"
              onClick={() => setShowSettings(true)}
            >
              <KeyRound size={20} />
            </button>
            <button
              className="icon-btn"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
        </header>

        <div className="messages">
          {activeChat.messages.length === 0 && (
            <div className="welcome">
              <h1>Parlo</h1>
              <p>Ask anything. Compare two minds. Watch the meter.</p>
            </div>
          )}

          {activeChat.messages.map((m) => (
            <div
              key={m.id}
              className={`message ${m.role} ${m.compare ? 'compare-row' : ''}`}
            >
              {m.compare ? (
                <div className="compare">
                  {m.options.map((o, i) => (
                    <div className="compare-col" key={i}>
                      <div className="compare-head">
                        {modelLabel(o.model)} <span>{providerShort(provOf(o))}</span>
                      </div>
                      <div className="bubble">
                        {o.text === '' ? (
                          <Dots />
                        ) : o.error ? (
                          o.text
                        ) : (
                          <Markdown text={o.text} />
                        )}
                      </div>
                      {o.usage && (
                        <UsageLine provider={provOf(o)} model={o.model} usage={o.usage} />
                      )}
                      <button
                        className="pick-btn"
                        disabled={isTyping || o.error || !o.usage}
                        onClick={() => pickOption(m.id, i)}
                      >
                        Use this answer
                      </button>
                    </div>
                  ))}
                  {!isTyping && (
                    <button className="discard-btn" onClick={() => discardCompare(m.id)}>
                      Discard both
                    </button>
                  )}
                </div>
              ) : (
                <div className="msg-body">
                  <div className="bubble">
                    {m.text === '' ? (
                      <Dots />
                    ) : m.role === 'assistant' && !m.error ? (
                      <Markdown text={m.text} />
                    ) : (
                      m.text
                    )}
                  </div>
                  {m.attachment && (
                    <div className="msg-meta">
                      Clipboard attached · {m.attachment.length} chars
                    </div>
                  )}
                  {m.usage && (
                    <UsageLine provider={provOf(m)} model={m.model} usage={m.usage} withModel />
                  )}
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="input-area">
          {clip && (
            <div className="clip-row">
              <div className="clip-chip">
                <Clipboard size={14} />
                Clipboard attached · {clip.length} chars
                <button onClick={() => setClip('')}>
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
          <div className="input-box">
            <input
              ref={inputRef}
              placeholder={hasPending ? 'Pick an answer above to continue' : 'Ask Parlo anything'}
              value={input}
              disabled={hasPending}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="send"
              onClick={isTyping ? stopChat : sendMessage}
              disabled={!isTyping && (!input.trim() || hasPending)}
            >
              {isTyping ? <Square size={14} fill="currentColor" /> : <ArrowUp size={20} />}
            </button>
          </div>
        </div>
      </main>

      {showSettings && (
        <div className="modal-bg">
          <div className="modal wide">
            <div className="modal-top">
              <h3>{allOptions.length === 0 ? 'Connect a model to start' : 'Providers and keys'}</h3>
              <button className="icon-btn" onClick={() => setShowSettings(false)}>
                <X size={20} />
              </button>
            </div>
            <p>
              Connect one or more providers. Free options: Gemini, Groq, OpenRouter, Mistral, or
              Ollama on your own PC. Free tiers have daily limits that can change. Keys are stored
              encrypted on this computer only.
            </p>

            {PROVIDERS.map((p) => (
              <div className="prov" key={p.id}>
                <div className="prov-head">
                  <strong>{p.name}</strong>
                  <span className={`tag ${p.kind}`}>{p.tag}</span>
                  {status[p.id] && (
                    <span className="ok">
                      <Check size={14} /> {p.noKey ? 'enabled' : 'connected'}
                    </span>
                  )}
                </div>
                <p className="prov-blurb">
                  {p.blurb}{' '}
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.noKey ? 'Get Ollama' : 'Get a key'}
                  </a>
                </p>

                {!p.noKey && (
                  <div className="prov-key">
                    <input
                      type="password"
                      placeholder={status[p.id] ? 'Saved. Paste a new key to replace it' : 'Paste API key'}
                      value={drafts[p.id] || ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && saveProviderKey(p.id)}
                    />
                    <button className="primary" onClick={() => saveProviderKey(p.id)}>
                      Save
                    </button>
                    {status[p.id] && (
                      <button className="danger" onClick={() => removeProviderKey(p.id)}>
                        Remove
                      </button>
                    )}
                  </div>
                )}

                {status[p.id] && p.id !== 'anthropic' && (
                  <div className="prov-foot">
                    <span>
                      {catalog[p.id]?.length
                        ? `${catalog[p.id].length} models available`
                        : 'No models found yet'}
                    </span>
                    <button className="link-btn" onClick={() => refreshProvider(p.id)}>
                      <RefreshCw size={13} /> Refresh models
                    </button>
                  </div>
                )}
                {catalogError[p.id] && <p className="err">{catalogError[p.id]}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
