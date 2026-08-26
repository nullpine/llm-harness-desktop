/// <reference types="vite/client" />

/**
 * Pulls in the `Window.api` global declared by `@shared/api`.
 *
 * A side-effect import, because the declaration is ambient: without this the
 * renderer type-checks against a `Window` that has no `api` on it.
 */
import '@shared/api'
