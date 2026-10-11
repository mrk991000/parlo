import { useState, useRef, useEffect } from 'react'
import {
  Menu, Sun, Moon, Plus, ArrowUp, KeyRound, Trash2, Square, Pencil,
  Columns2, Download, Clipboard, X,
} from 'lucide-react'
import Markdown from './Markdown'
import './App.css'

const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]

// USD per million tokens. Prices change, so check anthropic.com/pricing now and then.
const PRICES = {
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
}

const label = (id) => MODELS.find((x) => x.id === id)?.label || id

function costOf(model, usage) {
  const p = PRICES[model]
  if (!p || !usage) return 0
  return (usage.input * p.in + usage.output * p.out) / 1_000_000
}

function formatCost(c) {
  return c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(2)}`
}

function formatTokens(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

// every {model, usage} pair a message has cost us
function usagesOf(m) {
  if (m.compare) {
    return m.options.filter((o) => o.usage).map((o) => ({ model: o.model, usage: o.usage }))
  }
  const list = []
  if (m.usage) list.push({ model: m.model, usage: m.usage })
  if (m.other) list.push(m.other)
  return list
}

// messages in the shape the API wants
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

function App() {
  const [chats, setChats] = useState(loadChats)
  const [activeId, setActiveId] = useState(chats[0].id)
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [theme, setTheme] = useState('dark')
  const [needsKey, setNeedsKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [clip, setClip] = useState('')
  const [compare, setCompare] = useState(false)
  const [model, setModel] = useState(
    () => localStorage.getItem('parlo-model') || MODELS[0].id
  )
  const [model2, setModel2] = useState(
    () => localStorage.getItem('parlo-model2') || MODELS[1].id
  )
  const bottomRef = useRef(null)
  const cancelRef = useRef(false)
  const inputRef = useRef(null)

  const activeChat = chats.find((c) => c.id === activeId)
  const hasPending = activeChat.messages.some((m) => m.compare)

  const totals = activeChat.messages
    .flatMap(usagesOf)
    .concat(activeChat.discarded || [])
    .reduce(
      (t, u) => ({
        tokens: t.tokens + u.usage.input + u.usage.output,
        cost: t.cost + costOf(u.model, u.usage),
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
    window.api?.hasKey().then((has) => setNeedsKey(!has))
  }, [])

  useEffect(() => {
    localStorage.setItem('parlo-chats', JSON.stringify(chats))
  }, [chats])

  useEffect(() => {
    localStorage.setItem('parlo-model', model)
  }, [model])

  useEffect(() => {
    localStorage.setItem('parlo-model2', model2)
  }, [model2])

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

  async function saveKey() {
    if (!keyInput.trim()) return
    await window.api.setKey(keyInput)
    setKeyInput('')
    setNeedsKey(false)
    setShowKey(false)
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || isTyping || hasPending) return
    if (!window.api) {
      alert('Run this inside Electron: npm run electron:dev')
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
        messages: history,
        model,
      })
      off()

      updateChat(chatId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === baseId ? { ...finalizeOption(m, result), model } : m
        ),
      }))
      if (result?.error?.includes('No API key')) setNeedsKey(true)
    } else {
      // ----- two models at once -----
      const ids = [`${baseId}a`, `${baseId}b`]
      const models = [model, model2]

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
            options: models.map((md) => ({ model: md, text: '' })),
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
          window.api.sendChat({ requestId: id, messages: history, model: models[i] })
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
      if (results.some((r) => r?.error?.includes('No API key'))) setNeedsKey(true)
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
          model: picked.model,
          usage: picked.usage,
          ...(other.usage ? { other: { model: other.model, usage: other.usage } } : {}),
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
        // the money was spent even if we throw the answers away
        discarded: [...(c.discarded || []), ...(msg ? usagesOf(msg) : [])],
      }
    })
  }

  function exportChat() {
    const lines = [`# ${activeChat.title}`, '']
    for (const m of activeChat.messages) {
      if (m.compare || !m.text || m.error) continue
      lines.push(
        m.role === 'user' ? '## You' : `## ${m.model ? label(m.model) : 'Assistant'}`,
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
            <select
              className="model-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={isTyping}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            {compare && (
              <>
                <span className="vs">vs</span>
                <select
                  className="model-select"
                  value={model2}
                  onChange={(e) => setModel2(e.target.value)}
                  disabled={isTyping}
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
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
              <span className="totals" title="Tokens and estimated cost of this chat">
                {formatTokens(totals.tokens)} tokens · {formatCost(totals.cost)}
              </span>
            )}
            <button className="icon-btn" title="Export chat" onClick={exportChat}>
              <Download size={20} />
            </button>
            <button className="icon-btn" title="API key" onClick={() => setShowKey(true)}>
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
                      <div className="compare-head">{label(o.model)}</div>
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
                        <div className="msg-meta">
                          {formatTokens(o.usage.input)} in · {formatTokens(o.usage.output)} out ·{' '}
                          {formatCost(costOf(o.model, o.usage))}
                        </div>
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
                    <div className="msg-meta">
                      {label(m.model)} · {formatTokens(m.usage.input)} in ·{' '}
                      {formatTokens(m.usage.output)} out ·{' '}
                      {formatCost(costOf(m.model, m.usage))}
                    </div>
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

      {(needsKey || showKey) && (
        <div className="modal-bg">
          <div className="modal">
            <h3>API key</h3>
            <p>Paste your Anthropic API key. It is stored encrypted on this computer only.</p>
            <input
              type="password"
              placeholder="sk-ant-..."
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            />
            <div className="modal-actions">
              {!needsKey && <button onClick={() => setShowKey(false)}>Cancel</button>}
              <button className="primary" onClick={saveKey}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
