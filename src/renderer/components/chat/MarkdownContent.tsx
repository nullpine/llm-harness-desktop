import { memo, useState } from 'react'
import Markdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

import { useThrottledValue } from '../../hooks/useThrottledValue'

/**
 * Markdown, parsed on a throttle.
 *
 * `memo` plus `useThrottledValue` are both load-bearing: the throttle bounds how
 * often the parse runs, and the memo stops a parent re-render (a new chunk on a
 * *different* message, say) re-parsing this one for nothing.
 *
 * No `rehype-raw`. Model output is untrusted, and `react-markdown` escapes HTML
 * by default — the renderer's CSP is the second line of defence, not the first.
 *
 * Math is rendered because GLM writes `$…$` and `$$…$$` for anything remotely
 * mathematical, and raw TeX makes a technical answer unreadable. KaTeX's CSS and
 * fonts are imported (see `styles/globals.css`) so Vite emits them into the
 * bundle: `font-src 'self'` covers them, and a CDN would simply be refused.
 */
export const MarkdownContent = memo(function MarkdownContent({
  text,
  streaming,
}: {
  text: string
  streaming: boolean
}) {
  // A finished message never changes, so it skips the throttle entirely and
  // renders its final form immediately.
  const throttled = useThrottledValue(text)
  const visible = streaming ? throttled : text

  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        // Order matters: rehype-katex consumes the math nodes remark-math
        // produced, and highlighting runs on what is left.
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{ pre: CodeBlock }}
      >
        {visible}
      </Markdown>
    </div>
  )
})

/** A `pre` with a language label and a copy button (SPEC §8.2). */
function CodeBlock({ children, ...props }: React.ComponentPropsWithoutRef<'pre'>) {
  const [copied, setCopied] = useState(false)
  const language = languageOf(children)

  const copy = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const pre = event.currentTarget.closest('.code-block')?.querySelector('pre')
    const text = pre?.textContent ?? ''
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className="code-block relative my-3 overflow-hidden rounded-lg border border-[var(--color-border-subtle)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] px-3 py-1 text-xs text-[var(--color-text-muted)]">
        <span>{language ?? 'code'}</span>
        <button type="button" onClick={copy} className="hover:text-[var(--color-text-primary)]">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre {...props} className="overflow-x-auto p-3 text-[13px] leading-relaxed">
        {children}
      </pre>
    </div>
  )
}

/** `rehype-highlight` puts the language in a `language-x` class on the `code`. */
function languageOf(children: React.ReactNode): string | null {
  if (!children || typeof children !== 'object' || !('props' in children)) return null
  const className = (children.props as { className?: string }).className ?? ''
  return /language-([\w-]+)/.exec(className)?.[1] ?? null
}
