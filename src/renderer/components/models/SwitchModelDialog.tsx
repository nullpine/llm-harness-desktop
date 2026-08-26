import type { ModelInfo } from '@shared/types'

import { describeSeconds } from '../../lib/duration'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'

interface SwitchModelDialogProps {
  target: ModelInfo
  current: ModelInfo | null
  streaming: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function SwitchModelDialog({
  target,
  current,
  streaming,
  onCancel,
  onConfirm,
}: SwitchModelDialogProps) {
  return (
    <Dialog
      open
      title={`Switch to ${target.displayName}?`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} data-testid="confirm-switch">
            Switch
          </Button>
        </>
      }
    >
      <div data-testid="switch-dialog" className="flex flex-col gap-3 text-sm">
        <p>
          {current
            ? `This unloads ${current.displayName} and loads ${target.displayName}.`
            : `This loads ${target.displayName}.`}
        </p>

        <p>
          {/* The duration is data, never copy: it is estimatedLoadSeconds from
              the catalog, which the server measures on the hardware in use. */}
          Takes about{' '}
          <span data-testid="switch-duration">{describeSeconds(target.estimatedLoadSeconds)}</span>.
          {streaming ? ' Any reply in progress will be cancelled.' : ''}
        </p>

        {!target.available ? (
          <p
            data-testid="switch-not-downloaded"
            className="rounded-md border border-[var(--color-border-subtle)] px-3 py-2 text-xs text-[var(--color-text-muted)]"
          >
            The server does not have these weights yet, so it will download them first. That takes
            considerably longer than the estimate above.
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
