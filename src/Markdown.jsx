import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Copy, Check } from 'lucide-react'
import 'highlight.js/styles/github-dark.css'

function CodeBlock({ children }) {
  const preRef = useRef(null)
  const [copied, setCopied] = useState(false)
  const lang = children?.props?.className?.match(/language-(\w+)/)?.[1] || 'code'

  async function copy() {
    await navigator.clipboard.writeText(preRef.current.innerText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang}</span>
        <button onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  )
}

export default function Markdown({ text }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: CodeBlock,
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
