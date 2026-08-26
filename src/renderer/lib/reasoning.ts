/**
 * Whether a Thinking block should exist at all.
 *
 * A block reading "Thinking (0.0s)" over nothing is worse than no block: it
 * implies the model reasoned and the app lost it. Some frames carry a lone
 * newline, which is not a thought.
 */
export function hasReasoning(text: string): boolean {
  return text.trim() !== ''
}
