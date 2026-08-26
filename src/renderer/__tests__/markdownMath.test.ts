/**
 * Math actually renders (fix for "LaTeX renders as raw source").
 *
 * GLM writes `$…$` and `$$…$$` for anything remotely mathematical, and before
 * this the TeX appeared literally, which makes a technical answer unreadable.
 *
 * This runs the *same* plugin chain `MarkdownContent` uses. Checking that KaTeX's
 * stylesheet is present would not be enough — the CSS can load fine while the
 * plugins are misconfigured and the source still shows through.
 */

import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

/**
 * The rendered TeX source, minus KaTeX's MathML annotation.
 *
 * KaTeX embeds the original TeX in `<annotation encoding="application/x-tex">`
 * on purpose — that is how copy-paste and screen readers recover the source — so
 * "the source is not visible" has to be asserted against everything *else*.
 */
const withoutAnnotations = (html: string): string =>
  html.replace(/<annotation[^>]*>[\s\S]*?<\/annotation>/g, '')

const render = async (markdown: string): Promise<string> =>
  String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkRehype)
      .use(rehypeKatex)
      .use(rehypeStringify)
      .process(markdown),
  )

describe('inline math', () => {
  it('renders $…$ as KaTeX rather than as source', async () => {
    const html = await render('The area is $\\pi r^2$ exactly.')
    expect(html).toContain('katex')
    expect(withoutAnnotations(html)).not.toContain('\\pi r^2')
  })

  it('keeps the surrounding prose', async () => {
    const html = await render('The area is $r^2$ exactly.')
    expect(html).toContain('The area is')
    expect(html).toContain('exactly.')
  })
})

describe('display math', () => {
  it('renders $$…$$ as a block', async () => {
    const html = await render('$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$')
    expect(html).toContain('katex-display')
    expect(withoutAnnotations(html)).not.toContain('\\sum_{i=1}^{n}')
  })
})

describe('what must not be treated as math', () => {
  it('leaves a lone dollar sign alone', async () => {
    const html = await render('It costs $7 an hour to run.')
    expect(html).toContain('$7 an hour')
  })

  it('leaves currency in a sentence alone', async () => {
    const html = await render('Between $5 and $9, roughly.')
    expect(html).toContain('Between')
    expect(html).toContain('roughly')
  })

  it('does not touch math inside a code fence', async () => {
    // A code block showing TeX source must stay source.
    const html = await render('```\n$x^2$\n```')
    expect(html).toContain('$x^2$')
    expect(html).not.toContain('katex')
  })
})

describe('malformed input', () => {
  it('does not throw on unparseable TeX', async () => {
    // rehype-katex renders an error node rather than exploding, which matters:
    // a model emitting broken TeX must not blank the message.
    await expect(render('$\\frac{1}{$')).resolves.toBeTypeOf('string')
  })

  it('does not throw on an unclosed display block', async () => {
    await expect(render('$$\n\\sum_{i=1}')).resolves.toBeTypeOf('string')
  })
})
