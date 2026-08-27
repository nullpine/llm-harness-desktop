# Changelog

## [0.1.0] — 2026-08-26

First release. A desktop client for a privately hosted open-weights model.

- Streaming chat against a self-hosted model, with reasoning shown as it arrives
- Model dropdown with honest load estimates read from the server, progress while
  switching, and clear failure reporting
- Conversations persisted locally; damaged files are reported, not silently
  swallowed; in-flight replies survive quitting
- The API key is encrypted by the OS keychain and never reaches the renderer,
  which makes no network requests at all

Speaks API contract v1.1 (`docs/API-CONTRACT.md`), which is versioned separately
from this release and shared byte-identically with the server repo.

Deliberately not included: tool calling, file attachments, vision, RAG, search,
cloud sync, auto-update, code signing.
