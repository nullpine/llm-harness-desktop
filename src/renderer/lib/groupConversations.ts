/**
 * Group the sidebar by Today / Yesterday / Earlier (SPEC §8).
 *
 * Grouping is by *calendar day in the viewer's timezone*, not by elapsed hours:
 * something sent at 23:50 is "Yesterday" at 00:10, not "20 minutes ago". Doing it
 * by subtraction is the classic bug here, and it looks right until you test near
 * midnight — which is why the day boundary is computed explicitly.
 */

import type { ConversationSummary } from '@shared/types'

export type GroupLabel = 'Today' | 'Yesterday' | 'Earlier'

export interface ConversationGroup {
  label: GroupLabel
  conversations: ConversationSummary[]
}

const ORDER: GroupLabel[] = ['Today', 'Yesterday', 'Earlier']

export function groupConversations(
  summaries: ConversationSummary[],
  now: Date = new Date(),
): ConversationGroup[] {
  const buckets = new Map<GroupLabel, ConversationSummary[]>()

  for (const summary of [...summaries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const label = labelFor(summary.updatedAt, now)
    const bucket = buckets.get(label)
    if (bucket) bucket.push(summary)
    else buckets.set(label, [summary])
  }

  return ORDER.filter((label) => buckets.has(label)).map((label) => ({
    label,
    conversations: buckets.get(label) ?? [],
  }))
}

export function labelFor(iso: string, now: Date = new Date()): GroupLabel {
  const updated = new Date(iso)
  // An unparseable date is old, not "today" — never surface a broken timestamp
  // at the top of the list.
  if (Number.isNaN(updated.getTime())) return 'Earlier'

  const days = calendarDaysBetween(updated, now)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return 'Earlier'
}

/** Whole calendar days between two instants, in local time. */
function calendarDaysBetween(earlier: Date, later: Date): number {
  const a = startOfLocalDay(earlier)
  const b = startOfLocalDay(later)
  return Math.round((b - a) / 86_400_000)
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
