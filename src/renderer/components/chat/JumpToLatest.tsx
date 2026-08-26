import { Button } from '../ui/Button'

export function JumpToLatest({ onClick }: { onClick: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <Button
        variant="secondary"
        onClick={onClick}
        className="pointer-events-auto shadow-lg"
        aria-label="Jump to latest"
      >
        ↓ Jump to latest
      </Button>
    </div>
  )
}
