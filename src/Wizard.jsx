import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Copy, ExternalLink, X } from 'lucide-react'

const RECIPES = {
  gemini: {
    title: 'Google Gemini',
    badge: 'Recommended · Free',
    why: 'Smart and fast. Free with any Google account.',
    link: 'https://aistudio.google.com/apikey',
    linkLabel: 'Open Google AI Studio',
    steps: [
      'Click the button below. A web page opens. Sign in with your Google account.',
      'Click “Create API key”. If it asks, pick any project and accept the terms.',
      'Click the copy button next to your new key.',
      'Come back here. Parlo notices the copied key by itself.',
    ],
  },
  groq: {
    title: 'Groq',
    badge: 'Free · Very fast',
    why: 'Lightning-fast replies. Free, sign up with Google or email.',
    link: 'https://console.groq.com/keys',
    linkLabel: 'Open Groq',
    steps: [
      'Click the button below and sign up. Google or email both work.',
      'Click “Create API key” (the button may be named slightly differently), give it any name and confirm.',
      'Click Copy on the key that appears. You only get to see it once.',
      'Come back here. Parlo notices the copied key by itself.',
    ],
  },
  ollama: {
    title: 'On my own computer',
    badge: 'Free · Works offline',
    why: 'No account and no internet needed. Needs a fairly modern PC and about 2 GB of space.',
    link: 'https://ollama.com/download',
    linkLabel: 'Download Ollama',
    command: 'ollama pull llama3.2',
    steps: [
      'Click the button below to download Ollama and install it like any normal app.',
      'Open “Command Prompt” (Windows) or “Terminal” (Mac and Linux), paste this command and press Enter:',
      'Wait for the download to finish. It can take a few minutes. Parlo notices by itself.',
    ],
  },
}

export default function Wizard({ onTryConnect, onRefreshOllama, onAdvanced, onClose }) {
  const [step, setStep] = useState('pick') // pick | setup | done
  const [provider, setProvider] = useState(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [manual, setManual] = useState('')
  const [copied, setCopied] = useState(false)
  const busy = useRef(false)
  const lastTried = useRef('')

  const recipe = provider ? RECIPES[provider] : null

  async function connect(key) {
    if (busy.current || !key.trim()) return
    busy.current = true
    setWorking(true)
    setError('')
    const r = await onTryConnect(provider, key)
    busy.current = false
    setWorking(false)
    if (r.ok) setStep('done')
    else setError(r.error)
  }

  // while on the setup screen, quietly watch for the key (or for Ollama's model)
  useEffect(() => {
    if (step !== 'setup' || !provider) return
    let cancelled = false

    const tick = async () => {
      if (busy.current) return
      if (provider === 'ollama') {
        busy.current = true
        const r = await onRefreshOllama()
        busy.current = false
        if (!cancelled && r.models?.length) setStep('done')
        return
      }
      const key = await window.api.clipboardKey(provider)
      if (cancelled || !key || key === lastTried.current) return
      lastTried.current = key
      await connect(key)
    }

    const timer = setInterval(tick, provider === 'ollama' ? 2500 : 1200)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [step, provider])

  function choose(id) {
    setProvider(id)
    setError('')
    setManual('')
    lastTried.current = ''
    setStep('setup')
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(recipe.command)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore: the command is also shown on screen
    }
  }

  return (
    <div className="modal-bg">
      <div className="modal wizard">
        <button className="icon-btn wz-close" onClick={onClose} title="Close">
          <X size={20} />
        </button>

        {step === 'pick' && (
          <>
            <h2>Welcome to Parlo 👋</h2>
            <p className="wz-lead">
              Pick a way to start. It is free and takes about two minutes. No technical knowledge needed.
            </p>
            <div className="wz-cards">
              {Object.entries(RECIPES).map(([id, r]) => (
                <button key={id} className="wz-card" onClick={() => choose(id)}>
                  <span className="wz-badge">{r.badge}</span>
                  <strong>{r.title}</strong>
                  <span>{r.why}</span>
                </button>
              ))}
            </div>
            <button className="link-btn wz-adv" onClick={onAdvanced}>
              I already have a key (Claude, GPT and others)
            </button>
          </>
        )}

        {step === 'setup' && recipe && (
          <>
            <button className="link-btn wz-back" onClick={() => setStep('pick')}>
              <ArrowLeft size={14} /> Back
            </button>
            <h2>{recipe.title}</h2>

            <ol className="wz-steps">
              {recipe.steps.map((text, i) => (
                <li key={i}>
                  {text}
                  {recipe.command && i === 1 && (
                    <div className="wz-command">
                      <code>{recipe.command}</code>
                      <button onClick={copyCommand}>
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ol>

            <a className="wz-open" href={recipe.link} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> {recipe.linkLabel}
            </a>

            <div className="wz-status">
              {working ? (
                <span>Checking your key…</span>
              ) : (
                <span>
                  <i className="wz-pulse" />
                  {provider === 'ollama'
                    ? 'Waiting for the download to finish…'
                    : 'Waiting for you to copy the key…'}
                </span>
              )}
            </div>
            {error && <p className="wz-error">{error}</p>}

            {provider !== 'ollama' && (
              <details className="wz-manual">
                <summary>Paste the key yourself instead</summary>
                <div className="prov-key">
                  <input
                    type="password"
                    placeholder="Paste your key here"
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && connect(manual)}
                  />
                  <button className="primary" onClick={() => connect(manual)}>
                    Connect
                  </button>
                </div>
              </details>
            )}
          </>
        )}

        {step === 'done' && (
          <div className="wz-done">
            <div className="wz-check">
              <Check size={36} />
            </div>
            <h2>You are all set!</h2>
            <p className="wz-lead">
              Parlo picked a good free model for you. You can switch models any time from the top bar.
            </p>
            <button className="wz-start" onClick={onClose}>
              Start chatting
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
