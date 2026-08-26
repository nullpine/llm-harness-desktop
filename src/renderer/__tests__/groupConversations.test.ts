/**
 * Sidebar grouping (SPEC §8).
 *
 * The interesting cases are all around midnight. Grouping by elapsed hours rather
 * than by calendar day looks correct in every daytime test and is wrong exactly
 * when someone is up late, so these fix `now` and walk the boundary.
 */

import { describe, expect, it } from 'vitest'

import type { ConversationSummary } from '@shared/types'

import { groupConversations, labelFor } from '../lib/groupConversations'

/** A local-time instant, so the tests do not depend on the runner's timezone. */
const at = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min)

const NOW = at(2026, 8, 26, 9, 30)

const summary = (updatedAt: Date, id = updatedAt.toISOString()): ConversationSummary => ({
  id,
  title: id,
  updatedAt: updatedAt.toISOString(),
  modelId: 'glm-4.7-flash',
})

describe('labelFor', () => {
  it('calls the same calendar day Today', () => {
    expect(labelFor(at(2026, 8, 26, 0, 1).toISOString(), NOW)).toBe('Today')
    expect(labelFor(at(2026, 8, 26, 9, 29).toISOString(), NOW)).toBe('Today')
  })

  it('calls the previous calendar day Yesterday', () => {
    expect(labelFor(at(2026, 8, 25, 23, 59).toISOString(), NOW)).toBe('Yesterday')
    expect(labelFor(at(2026, 8, 25, 0, 0).toISOString(), NOW)).toBe('Yesterday')
  })

  it('calls anything older Earlier', () => {
    expect(labelFor(at(2026, 8, 24, 23, 59).toISOString(), NOW)).toBe('Earlier')
    expect(labelFor(at(2020, 1, 1).toISOString(), NOW)).toBe('Earlier')
  })

  it('groups by calendar day, not by elapsed hours', () => {
    // 20 minutes ago, but a different day. Subtraction would say "Today".
    const justAfterMidnight = at(2026, 8, 26, 0, 10)
    const justBeforeMidnight = at(2026, 8, 25, 23, 50)
    expect(labelFor(justBeforeMidnight.toISOString(), justAfterMidnight)).toBe('Yesterday')
  })

  it('treats a whole day ago at the same clock time as Yesterday', () => {
    expect(labelFor(at(2026, 8, 25, 9, 30).toISOString(), NOW)).toBe('Yesterday')
  })

  it('treats a future timestamp as Today rather than crashing', () => {
    // Clock skew, or a file copied from another machine.
    expect(labelFor(at(2026, 8, 27).toISOString(), NOW)).toBe('Today')
  })

  it('treats an unparseable timestamp as Earlier', () => {
    expect(labelFor('not a date', NOW)).toBe('Earlier')
    expect(labelFor('', NOW)).toBe('Earlier')
  })

  it('handles a month boundary', () => {
    expect(labelFor(at(2026, 7, 31, 22, 0).toISOString(), at(2026, 8, 1, 8, 0))).toBe('Yesterday')
  })

  it('handles a year boundary', () => {
    expect(labelFor(at(2025, 12, 31, 22, 0).toISOString(), at(2026, 1, 1, 8, 0))).toBe('Yesterday')
  })
})

describe('groupConversations', () => {
  it('returns groups in Today, Yesterday, Earlier order', () => {
    const groups = groupConversations(
      [
        summary(at(2020, 1, 1), 'old'),
        summary(at(2026, 8, 26, 8), 'today'),
        summary(at(2026, 8, 25, 8), 'yesterday'),
      ],
      NOW,
    )
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Earlier'])
  })

  it('omits empty groups rather than rendering an empty heading', () => {
    const groups = groupConversations([summary(at(2026, 8, 26, 8), 'today')], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.label).toBe('Today')
  })

  it('sorts newest first within a group', () => {
    const groups = groupConversations(
      [
        summary(at(2026, 8, 26, 3), 'early'),
        summary(at(2026, 8, 26, 8), 'late'),
        summary(at(2026, 8, 26, 5), 'middle'),
      ],
      NOW,
    )
    expect(groups[0]?.conversations.map((c) => c.id)).toEqual(['late', 'middle', 'early'])
  })

  it('returns nothing for an empty list', () => {
    expect(groupConversations([], NOW)).toEqual([])
  })

  it('does not mutate its input', () => {
    const input = [summary(at(2026, 8, 20), 'a'), summary(at(2026, 8, 26), 'b')]
    const before = input.map((s) => s.id)
    groupConversations(input, NOW)
    expect(input.map((s) => s.id)).toEqual(before)
  })

  it('keeps every conversation exactly once', () => {
    const input = [
      summary(at(2026, 8, 26, 8), 'a'),
      summary(at(2026, 8, 25, 8), 'b'),
      summary(at(2026, 8, 1, 8), 'c'),
      summary(at(2026, 8, 26, 1), 'd'),
    ]
    const ids = groupConversations(input, NOW).flatMap((g) => g.conversations.map((c) => c.id))
    expect(ids.sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})
