/**
 * When the Thinking block should exist at all.
 *
 * A block reading "Thinking (0.0s)" over nothing is worse than no block: it
 * implies the model reasoned and the app lost it. `ReasoningBlock` returns null
 * on exactly this predicate, so testing it here tests the component's only
 * branch without needing a DOM.
 */

import { describe, expect, it } from 'vitest'

import { hasReasoning } from '../lib/reasoning'

describe('reasoning block visibility', () => {
  it('is hidden when the buffer is empty', () => {
    expect(hasReasoning('')).toBe(false)
  })

  it('is hidden when the buffer is only whitespace', () => {
    // Some frames carry a lone newline; that is not a thought.
    expect(hasReasoning('   \n\t ')).toBe(false)
  })

  it('is shown as soon as there is real reasoning text', () => {
    expect(hasReasoning('Let me think')).toBe(true)
    expect(hasReasoning('  padded  ')).toBe(true)
  })
})
