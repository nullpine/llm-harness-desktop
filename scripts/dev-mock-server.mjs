#!/usr/bin/env node
/**
 * The API contract's second implementation.
 *
 * `docs/API-CONTRACT.md` v1.1, implemented independently of the Python server so
 * that a disagreement between the two shows up here rather than on the VM. Desktop
 * M2 gets built against this, so **a mock that lies is worse than no mock**: if
 * something is ambiguous in the contract, that is a finding to report, not a gap
 * to paper over with a guess.
 *
 * Deliberate details, each mirroring something real:
 *   - `/healthz` is unauthenticated and reports two versions
 *   - streamed frames carry the model's `model_ref`, not its catalog id, because
 *     the real server relays engine frames verbatim (contract §2)
 *   - one model emits `delta.reasoning` (Ollama), the other
 *     `delta.reasoning_content` (vLLM), so both client paths run locally
 *   - activation is asynchronous: 202, then `loading` for a while, then `ready`
 *   - `gpu` is always `[]` — Ollama on a Mac has no accelerators to report, and
 *     the UI has to cope with that (SPEC acceptance L11 on the server side)
 *
 * Run it:  npm run dev:mock
 * Import it: `createMockServer({ loadMs: 50 })` from a test.
 */
import { createServer } from 'node:http'
import { once } from 'node:events'

export const CONTRACT_VERSION = '1.1'
export const SERVICE_VERSION = '0.0.0-mock'
export const DEFAULT_PORT = 8787
export const DEFAULT_API_KEY = 'dev-mock-key'

/** Two models, chosen so both reasoning spellings are exercised locally. */
const CATALOG = [
  {
    id: 'glm-4.7-flash',
    display_name: 'GLM 4.7 Flash',
    model_ref: 'glm-4.7-flash:q4_K_M',
    params: '30B-A3B (MoE)',
    quantization: 'q4_K_M',
    context_length: 32768,
    available: true,
    estimated_load_seconds: 25,
    /** Ollama's spelling — the local MVP path. */
    reasoningField: 'reasoning',
  },
  {
    id: 'qwen3.8-27b',
    display_name: 'Qwen 3.8 27B',
    model_ref: 'qwen3.8:27b-q4_K_M',
    params: '27B (dense)',
    quantization: 'q4_K_M',
    context_length: 32768,
    available: true,
    estimated_load_seconds: 35,
    /** vLLM's spelling. */
    reasoningField: 'reasoning_content',
  },
]

const PROGRESS_STEPS = [
  'reading manifest',
  'loading weights (4.2/18.0 GB)',
  'loading weights (11.6/18.0 GB)',
  'warming up',
]

const ERROR_STATUS = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  model_not_active: 409,
  model_loading: 503,
  activation_in_progress: 409,
  activation_failed: 500,
  upstream_unavailable: 502,
  bad_request: 400,
  internal: 500,
}

/**
 * @param {object} [options]
 * @param {number} [options.loadMs]  how long a simulated activation takes
 * @param {number} [options.tokenDelayMs] gap between streamed words
 * @param {string} [options.apiKey]
 * @param {string} [options.activeModelId] start already serving this model
 * @param {string} [options.finishReason] what to end a stream with, default "stop".
 *   Set to "length" to exercise the truncation note.
 * @param {boolean} [options.emptyContent] stream reasoning only, no content — what a
 *   reasoning model does when the token budget runs out mid-thought.
 * @param {boolean} [options.activationFails] make every activation end in `error`
 *   with a `last_error`, for exercising the failure banner and the logs modal.
 */
export function createMockServer(options = {}) {
  const loadMs = options.loadMs ?? Number(process.env.MOCK_LOAD_MS ?? 8000)
  const tokenDelayMs = options.tokenDelayMs ?? Number(process.env.MOCK_TOKEN_DELAY_MS ?? 40)
  const apiKey = options.apiKey ?? process.env.MOCK_API_KEY ?? DEFAULT_API_KEY
  const finishReason = options.finishReason ?? 'stop'
  const emptyContent = options.emptyContent ?? false
  let activationFails = options.activationFails ?? false
  const startedAt = Date.now()

  const state = {
    state: options.activeModelId ? 'ready' : 'idle',
    activeModelId: options.activeModelId ?? null,
    previousModelId: null,
    since: new Date().toISOString(),
    progressHint: null,
    lastError: null,
  }
  /** @type {Map<string, object>} */
  const jobs = new Map()
  let jobCounter = 0
  let activationTimer = null

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      // A mock that 500s silently is a mock that wastes an afternoon.
      console.error('mock server error:', error)
      if (!res.headersSent) sendError(res, 'internal', String(error))
    })
  })

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const path = url.pathname

    if (path === '/healthz') {
      // Unauthenticated on purpose: probes run before a key exists (contract §3).
      return sendJson(res, 200, {
        status: 'ok',
        version: CONTRACT_VERSION,
        service_version: SERVICE_VERSION,
        uptime_s: Math.floor((Date.now() - startedAt) / 1000),
      })
    }

    const auth = req.headers.authorization ?? ''
    const presented = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null
    if (presented === null) {
      return sendError(
        res,
        'unauthorized',
        'missing bearer token',
        {},
        { 'WWW-Authenticate': 'Bearer' },
      )
    }
    if (presented !== apiKey) {
      return sendError(res, 'unauthorized', 'invalid API key', {}, { 'WWW-Authenticate': 'Bearer' })
    }

    if (path === '/v1/models' && req.method === 'GET') return getV1Models(res)
    if (path === '/admin/models' && req.method === 'GET') return getAdminModels(res)
    if (path === '/admin/state' && req.method === 'GET') return getAdminState(res)
    if (path === '/admin/logs' && req.method === 'GET') return getLogs(res, url)
    if (path === '/v1/chat/completions' && req.method === 'POST')
      return chat(req, res, tokenDelayMs)

    const activate = /^\/admin\/models\/([^/]+)\/activate$/.exec(path)
    if (activate && req.method === 'POST') return postActivate(res, decodeURIComponent(activate[1]))

    const job = /^\/admin\/jobs\/([^/]+)$/.exec(path)
    if (job && req.method === 'GET') {
      const found = jobs.get(decodeURIComponent(job[1]))
      return found ? sendJson(res, 200, found) : sendError(res, 'not_found', 'no such job')
    }

    return sendError(res, 'not_found', `no route for ${req.method} ${path}`)
  }

  // --- routes ---------------------------------------------------------------

  function getV1Models(res) {
    // Only what you can call right now (contract §2), which is nothing unless ready.
    const active = state.state === 'ready' ? findModel(state.activeModelId) : null
    sendJson(res, 200, {
      object: 'list',
      data: active
        ? [
            {
              id: active.id,
              object: 'model',
              owned_by: 'harness',
              created: Math.floor(startedAt / 1000),
            },
          ]
        : [],
    })
  }

  function getAdminModels(res) {
    sendJson(res, 200, {
      active_model_id: state.activeModelId,
      state: state.state,
      models: CATALOG.map((m) => ({
        id: m.id,
        display_name: m.display_name,
        model_ref: m.model_ref,
        params: m.params,
        quantization: m.quantization,
        context_length: m.context_length,
        available: m.available,
        state: m.id === state.activeModelId ? state.state : 'idle',
        estimated_load_seconds: m.estimated_load_seconds,
      })),
    })
  }

  function getAdminState(res) {
    sendJson(res, 200, {
      state: state.state,
      active_model_id: state.activeModelId,
      previous_model_id: state.previousModelId,
      since: state.since,
      progress_hint: state.progressHint,
      last_error: state.lastError,
      // Always empty: no nvidia-smi on the machine this stands in for.
      gpu: [],
    })
  }

  function getLogs(res, url) {
    const source = url.searchParams.get('source') === 'control' ? 'control' : 'vllm'
    const lines = Math.min(Number(url.searchParams.get('lines') ?? 200) || 200, 1000)
    sendJson(res, 200, {
      source,
      lines: Array.from(
        { length: Math.min(lines, 20) },
        (_, i) => `INFO mock ${source} line ${i + 1}`,
      ),
    })
  }

  function postActivate(res, modelId) {
    const model = findModel(modelId)
    if (!model) return sendError(res, 'not_found', `no model ${modelId}`)

    if (state.state === 'loading' || state.state === 'stopping') {
      return sendError(res, 'activation_in_progress', 'an activation is already in flight')
    }
    if (state.activeModelId === modelId && state.state === 'ready') {
      return sendJson(res, 200, { job_id: null, model_id: modelId, already_active: true })
    }

    jobCounter += 1
    const jobId = `act_${String(jobCounter).padStart(8, '0')}`
    const job = {
      job_id: jobId,
      model_id: modelId,
      status: 'running',
      started_at: new Date().toISOString(),
      finished_at: null,
      error: null,
      log_tail: [],
    }
    jobs.set(jobId, job)
    beginActivation(model, job)

    sendJson(res, 202, {
      job_id: jobId,
      model_id: modelId,
      estimated_seconds: model.estimated_load_seconds,
    })
  }

  /** idle → loading (with moving progress) → ready, on a timer. */
  function beginActivation(model, job) {
    state.previousModelId = state.activeModelId
    state.activeModelId = model.id
    state.state = 'loading'
    state.lastError = null
    state.progressHint = PROGRESS_STEPS[0]
    state.since = new Date().toISOString()

    const stepMs = Math.max(1, Math.floor(loadMs / PROGRESS_STEPS.length))
    let step = 0
    clearInterval(activationTimer)
    activationTimer = setInterval(() => {
      step += 1
      if (step < PROGRESS_STEPS.length) {
        state.progressHint = PROGRESS_STEPS[step]
        return
      }
      clearInterval(activationTimer)
      activationTimer = null
      state.since = new Date().toISOString()
      job.finished_at = new Date().toISOString()

      if (activationFails) {
        // What a real failed load looks like: error, a reason, and log lines the
        // desktop's "View server logs" modal can show.
        state.state = 'error'
        state.progressHint = null
        state.lastError = `could not load ${model.id}: out of memory`
        job.status = 'failed'
        job.error = state.lastError
        job.log_tail = ['ERROR loading weights', 'ERROR out of memory']
        return
      }

      state.state = 'ready'
      state.progressHint = null
      state.lastError = null
      job.status = 'succeeded'
    }, stepMs)
    activationTimer.unref?.()
  }

  async function chat(req, res, delayMs) {
    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      return sendError(res, 'bad_request', 'request body is not valid JSON')
    }

    // The state guards, in the contract's order (§2, §3).
    if (state.state === 'loading' || state.state === 'stopping') {
      const model = findModel(state.activeModelId)
      return sendError(
        res,
        'model_loading',
        'a model is loading; retry shortly',
        { state: state.state, active: state.activeModelId },
        { 'Retry-After': String(model?.estimated_load_seconds ?? 10) },
      )
    }
    if (state.state !== 'ready' || !state.activeModelId) {
      return sendError(res, 'model_not_active', 'no model is currently active', {
        active: state.activeModelId,
        requested: body.model ?? null,
      })
    }
    if (body.model !== state.activeModelId) {
      return sendError(res, 'model_not_active', `${body.model} is not the active model`, {
        active: state.activeModelId,
        requested: body.model ?? null,
      })
    }

    const model = findModel(state.activeModelId)
    const words = mockAnswer(body)

    if (!body.stream) {
      return sendJson(res, 200, {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        // The engine's name, as a verbatim relay would carry it.
        model: model.model_ref,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: words.join('') },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: words.length },
      })
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    })

    let aborted = false
    req.on('aborted', () => {
      aborted = true
    })
    res.on('close', () => {
      aborted = true
    })

    const frame = (payload) => {
      res.write(`data: ${JSON.stringify({ ...payload, model: model.model_ref })}\n\n`)
    }

    // A short "thinking" preamble in whichever spelling this model uses.
    for (const token of ['Let ', 'me ', 'think. ']) {
      if (aborted) return
      frame({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { [model.reasoningField]: token } }],
      })
      await sleep(delayMs)
    }

    for (const word of emptyContent ? [] : words) {
      if (aborted) return
      frame({
        id: 'chatcmpl-mock',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: word } }],
      })
      await sleep(delayMs)
    }

    if (aborted) return
    frame({
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
      usage: { prompt_tokens: 12, completion_tokens: emptyContent ? 0 : words.length },
    })
    res.write('data: [DONE]\n\n')
    res.end()
  }

  // --- helpers --------------------------------------------------------------

  function findModel(id) {
    return CATALOG.find((m) => m.id === id) ?? null
  }

  function sendJson(res, status, payload, headers = {}) {
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...headers,
    })
    res.end(body)
  }

  function sendError(res, code, message, details = {}, headers = {}) {
    sendJson(res, ERROR_STATUS[code] ?? 500, { error: { code, message, details } }, headers)
  }

  return {
    server,
    get state() {
      return { ...state }
    },
    /** Force a state for testing the guards without waiting on a timer. */
    setState(next) {
      Object.assign(state, next)
    },
    /** Make the next activation fail, for the failure-banner path. */
    setActivationFails(value) {
      activationFails = value
    },
    async listen(port = 0, host = '127.0.0.1') {
      server.listen(port, host)
      await once(server, 'listening')
      const address = server.address()
      return `http://${host}:${address.port}`
    },
    async close() {
      clearInterval(activationTimer)
      server.closeAllConnections?.()
      server.close()
      await once(server, 'close')
    },
    apiKey,
  }
}

function mockAnswer(body) {
  const prompt = body?.messages?.at(-1)?.content ?? ''
  const text = `You said: ${String(prompt).slice(0, 80)}. This is a mock response from the contract v${CONTRACT_VERSION} stub, streamed word by word so the UI has something honest to render.`
  return text.split(/(?<=\s)/)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Only start listening when run directly, so tests can import and drive it.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const mock = createMockServer()
  const port = Number(process.env.MOCK_PORT ?? DEFAULT_PORT)
  const url = await mock.listen(port)
  console.log(`mock harness server on ${url}`)
  console.log(`  contract v${CONTRACT_VERSION}, service ${SERVICE_VERSION}`)
  console.log(`  API key: ${mock.apiKey}`)
  console.log(`  models : ${CATALOG.map((m) => m.id).join(', ')}`)
}
