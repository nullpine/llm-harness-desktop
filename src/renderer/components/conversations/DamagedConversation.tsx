import { Button } from '../ui/Button'

/**
 * What the main pane shows when `conv:get` fails (acceptance A10).
 *
 * Before this, a damaged conversation rendered the ordinary
 * no-conversation-selected empty state — so a corrupt file was
 * indistinguishable from an empty chat, and the warning went only to the log.
 *
 * **Remove from list** drops the entry from the index and leaves the file where
 * it is. The bytes may be recoverable by hand, and throwing away someone's
 * transcript to tidy a sidebar is not a decision this app should make.
 */
export function DamagedConversation({ onForget }: { onForget: () => void }) {
  return (
    <div
      data-testid="damaged-conversation"
      className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center"
    >
      <p className="text-[var(--color-text-primary)]">
        This conversation&rsquo;s file is damaged and couldn&rsquo;t be opened.
      </p>
      <p className="max-w-md text-xs text-[var(--color-text-muted)]">
        The file is still on disk, so it may be recoverable by hand. Removing it from the list
        leaves it there.
      </p>
      <Button variant="secondary" onClick={onForget}>
        Remove from list
      </Button>
    </div>
  )
}
