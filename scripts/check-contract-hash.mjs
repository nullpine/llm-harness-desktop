#!/usr/bin/env node
/**
 * Guards `docs/API-CONTRACT.md` against silent drift.
 *
 * The file is byte-identical to the copy in `llm-harness-server`. Changing it in
 * one repo and not the other is how the desktop app and the server end up
 * disagreeing about the wire format two weeks later, so the hash is committed
 * and CI fails the moment the file and the hash diverge.
 *
 * Only API-CONTRACT.md is checked. docs/BACKLOG.md is shared content too, but it
 * is *expected* to diverge as checkboxes are ticked independently in each repo.
 *
 * Usage:
 *   node scripts/check-contract-hash.mjs           verify
 *   node scripts/check-contract-hash.mjs --write    re-stamp after a two-repo change
 */
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { argv, exit } from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const CONTRACT = new URL('docs/API-CONTRACT.md', `file://${repoRoot}`)
const HASH_FILE = new URL('docs/.api-contract.sha256', `file://${repoRoot}`)

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function readOrDie(url, what) {
  try {
    return await readFile(url)
  } catch (err) {
    console.error(`check-contract-hash: cannot read ${what} (${url.pathname}): ${err.message}`)
    exit(2)
  }
}

const contract = await readOrDie(CONTRACT, 'the contract')
const actual = sha256(contract)

if (argv.includes('--write')) {
  await writeFile(HASH_FILE, `${actual}  docs/API-CONTRACT.md\n`, 'utf8')
  console.log(`check-contract-hash: stamped ${actual}`)
  exit(0)
}

const recorded = (await readOrDie(HASH_FILE, 'the recorded hash'))
  .toString('utf8')
  .trim()
  .split(/\s+/)[0]

if (recorded === actual) {
  console.log(`check-contract-hash: docs/API-CONTRACT.md matches ${actual.slice(0, 12)}…`)
  exit(0)
}

console.error(`
check-contract-hash: docs/API-CONTRACT.md has changed.

  recorded  ${recorded}
  actual    ${actual}

API-CONTRACT.md is shared content: it must be byte-identical to the copy in
llm-harness-server. A change means a PR in BOTH repos and a version bump in the
contract itself.

If this change is deliberate and the server PR is open, re-stamp the hash with:

  node scripts/check-contract-hash.mjs --write

Otherwise revert docs/API-CONTRACT.md.
`)
exit(1)
