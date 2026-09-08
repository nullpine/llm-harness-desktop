# ADR-0004: The app mirrors the server's one-model rule rather than hiding it

**Status:** accepted
**Date:** 2026-08-25

## Context

The server serves exactly one model at a time (server ADR-0002), and switching
costs a real load — tens of seconds locally, over a minute on a GPU. The client
has to decide how much of that to show.

The tempting design is to hide it: let the user pick a model per message and
switch underneath. It reads as more capable, and it is a lie. A message sent
during a switch would sit for a minute with no explanation, and a conversation
would silently mix answers from two models with nothing recording which said what.

## Decision

**Make the constraint visible and honest.**

- one dropdown, showing the active model; choosing another is a *switch*, with a
  confirmation dialog that states the cost using `estimated_load_seconds` **read
  from the server**, not guessed by the client
- the composer is disabled while loading, with the reason in place of the
  placeholder, and elapsed-time progress in a banner
- assistant messages are labelled with the model that produced them, and a switch
  leaves a divider in the transcript — so a mixed conversation stays legible
  rather than being prevented
- server states map to UI states one-to-one: `idle`, `loading`, `ready`, `error`,
  plus `unreachable`, which is the client's own. No state is invented, and none is
  smoothed over
- a failed activation shows the reason and offers the server's own logs

## Consequences

- The user waits, and knows why, and knows how long. A wrong
  `estimated_load_seconds` in the server's catalog is therefore a promise the app
  breaks — which is why the server measures it rather than estimating.
- No per-message model choice and no queueing a message against a model that is
  not loaded (SPEC §3). Sending with nothing active gives a plain "no model
  loaded — pick one from the dropdown", not a raw 409 (A12).
- Recovery from a dead model is one click, deliberately, because the server does
  not auto-restart (server ADR-0005). The app must not paper over that with a
  retry loop.
- If the server ever holds two models resident, this ADR is what has to be
  revisited first — the UI's whole shape assumes one.
