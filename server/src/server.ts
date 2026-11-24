import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import { randomUUID } from 'node:crypto'
import { config, telegramConfigured } from './config.js'
import * as store from './store.js'
import { defaultSettings, READ_LANGS, type Commitment, type InboxItem, type Provider, type ReadLang, type Settings } from './types.js'
import { DemoProvider } from './providers/demo.js'
import { TelegramProvider, startLogin, testConnect, verifyLogin } from './providers/telegram.js'
import { aiEnabled, cleanTranscript, digest, findPromises, suggestReplies, triage } from './ai.js'
import { sttEnabled, transcribe } from './stt.js'
import { scriptedDigest, scriptedPromises, scriptedReplies, scriptedTranscript, scriptedTriage } from './providers/demo-script.js'

store.load()

const app = Fastify({ logger: { level: 'info', redact: ['req.headers.authorization'] }, bodyLimit: 64 * 1024 })
await app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
})
app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 }, (_req, body, done) => done(null, body))

// ----------------------------------------------------------- sessions ----

interface Live { provider: Provider; inbox: InboxItem[]; triaged: Map<string, InboxItem> }
const live = new Map<string, Live>() // key = token hash

function liveFor(token: string): Live {
  const h = store.hashToken(token)
  let l = live.get(h)
  if (l) return l
  const acc = store.getAccount(token)
  if (!acc) throw Object.assign(new Error('unauthorized'), { statusCode: 401 })
  const provider = acc.kind === 'demo' ? new DemoProvider() : new TelegramProvider(store.decrypt(acc.session!))
  l = { provider, inbox: [], triaged: new Map() }
  live.set(h, l)
  return l
}

function auth(req: FastifyRequest): { token: string; settings: Settings; live: Live } {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const acc = token ? store.getAccount(token) : undefined
  if (!acc) throw Object.assign(new Error('unauthorized'), { statusCode: 401 })
  return { token, settings: { ...defaultSettings(), ...acc.settings }, live: liveFor(token) }
}

const key = (m: { chatId: string; msgId: number }) => `${m.chatId}:${m.msgId}`
/** Keyless demo: scripted AI output instead of heuristics. */
const scripted = (l: Live) => l.provider.name === 'demo' && !aiEnabled()

app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply: FastifyReply) => {
  const code = err.statusCode ?? 500
  if (code >= 500) app.log.error(err)
  else if (code !== 401) app.log.warn(`${_req.method} ${_req.url} -> ${code} ${err.message}`)
  reply.code(code).send({ error: code === 401 ? 'UNAUTHORIZED' : err.message })
})

// --------------------------------------------------------------- meta ----

app.get('/', async () => ({ name: 'Polyglot server', ok: true }))
app.get('/health', async () => ({
  ok: true,
  telegram: telegramConfigured(),
  ai: aiEnabled(),
  stt: sttEnabled(),
  demo: config.allowDemo,
}))

/** Network check: can this machine complete an MTProto handshake with Telegram? */
app.get('/diag', async () => {
  if (!telegramConfigured()) return { telegramConfigured: false }
  const [port443, port80] = [await testConnect(true), await testConnect(false)]
  return { telegramConfigured: true, port443, port80 }
})

// --------------------------------------------------------------- auth ----

/** Simple per-IP throttle for login attempts. */
const attempts = new Map<string, number[]>()
function throttle(ip: string, max = 8, windowMs = 10 * 60_000) {
  const now = Date.now()
  const list = (attempts.get(ip) ?? []).filter(t => now - t < windowMs)
  if (list.length >= max) throw Object.assign(new Error('TOO_MANY_ATTEMPTS'), { statusCode: 429 })
  list.push(now)
  attempts.set(ip, list)
}

app.post<{ Body: { phone: string } }>('/auth/start', async req => {
  if (!telegramConfigured()) throw Object.assign(new Error('TELEGRAM_NOT_CONFIGURED'), { statusCode: 503 })
  throttle(req.ip)
  const phone = String(req.body?.phone ?? '').replace(/[^\d+]/g, '')
  if (phone.length < 7) throw Object.assign(new Error('INVALID_PHONE'), { statusCode: 400 })
  const loginId = randomUUID()
  const { viaApp } = await startLogin(loginId, phone)
  return { loginId, viaApp }
})

app.post<{ Body: { loginId: string; code: string; password?: string } }>('/auth/verify', async req => {
  throttle(req.ip, 15)
  const { loginId, code, password } = req.body ?? ({} as never)
  const r = await verifyLogin(String(loginId), String(code ?? '').trim(), password ? String(password) : undefined)
  if (!r.ok) return r
  const token = store.newToken()
  store.putAccount(token, { kind: 'telegram', session: store.encrypt(r.session), settings: defaultSettings(), createdAt: Date.now() })
  return { ok: true, token }
})

app.post('/auth/demo', async () => {
  if (!config.allowDemo) throw Object.assign(new Error('DEMO_DISABLED'), { statusCode: 403 })
  const token = store.newToken()
  store.putAccount(token, {
    kind: 'demo',
    settings: { ...defaultSettings(), focusChats: ['1001', '1005', '1002', '1003', '1004'], channels: ['2001', '2002', '2003', '2004'] },
    createdAt: Date.now(),
  })
  return { ok: true, token }
})

app.post('/auth/logout', async req => {
  const { token, live: l } = auth(req)
  await l.provider.close().catch(() => {})
  live.delete(store.hashToken(token))
  store.deleteAccount(token)
  return { ok: true }
})

// ----------------------------------------------------------- settings ----

app.get('/me', async req => {
  const { settings, live: l } = auth(req)
  return { name: (await l.provider.me()).name, provider: l.provider.name, settings }
})

app.get('/chats', async req => ({ chats: await auth(req).live.provider.listChats() }))

app.put<{ Body: Partial<Settings> }>('/settings', async req => {
  const { token } = auth(req)
  const b = req.body ?? {}
  const patch: Partial<Settings> = {}
  if (Array.isArray(b.focusChats)) patch.focusChats = b.focusChats.map(String).slice(0, 50)
  if (Array.isArray(b.channels)) patch.channels = b.channels.map(String).slice(0, 30)
  if (b.lang === 'en' || b.lang === 'de') patch.lang = b.lang
  if (typeof b.readLang === 'string' && (READ_LANGS as readonly string[]).includes(b.readLang)) patch.readLang = b.readLang as ReadLang
  if (b.style === 'short' || b.style === 'friendly' || b.style === 'formal') patch.style = b.style
  if (typeof b.translate === 'boolean') patch.translate = b.translate
  return { settings: store.updateSettings(token, patch) }
})

// -------------------------------------------------------------- inbox ----

app.get('/inbox', async req => {
  const { settings, live: l } = auth(req)
  const raw = await l.provider.inbox(settings.focusChats)
  const fresh = raw.filter(m => !l.triaged.has(key(m)))
  if (fresh.length) {
    const done = scripted(l) ? scriptedTriage(fresh, settings.readLang) : await triage(fresh, settings)
    for (const m of done) l.triaged.set(key(m), m)
  }
  const items = raw.map(m => l.triaged.get(key(m)) ?? m)
  // Needs-you first, then newest first.
  items.sort((a, b) => Number(!!b.needsYou) - Number(!!a.needsYou) || b.date - a.date)
  l.inbox = items
  return { items, needYou: items.filter(i => i.needsYou).length, promises: openPromises(req).length }
})

function findItem(l: Live, chatId: string, msgId: number) {
  const it = l.inbox.find(i => i.chatId === chatId && i.msgId === msgId) ?? l.triaged.get(`${chatId}:${msgId}`)
  if (!it) throw Object.assign(new Error('MESSAGE_NOT_IN_INBOX'), { statusCode: 404 })
  return it
}

app.post<{ Body: { chatId: string; msgId: number } }>('/replies', async req => {
  const { settings, live: l } = auth(req)
  const item = findItem(l, String(req.body.chatId), Number(req.body.msgId))
  if (scripted(l)) { const r = scriptedReplies(item.chatId, item.msgId, settings.readLang); if (r) return r }
  const history = await l.provider.history(item.chatId, 10)
  return suggestReplies(item, history, settings)
})

app.post<{ Body: { chatId: string; text: string; replyTo?: number } }>('/send', async req => {
  const { live: l } = auth(req)
  const text = String(req.body.text ?? '').trim().slice(0, 4000)
  if (!text) throw Object.assign(new Error('EMPTY'), { statusCode: 400 })
  const chatId = String(req.body.chatId)
  const r = await l.provider.send(chatId, text, req.body.replyTo ? Number(req.body.replyTo) : undefined)
  await l.provider.markRead(chatId).catch(() => {})
  return { ok: true, ...r }
})

app.post<{ Body: { chatId: string; maxId?: number } }>('/read', async req => {
  const { live: l } = auth(req)
  await l.provider.markRead(String(req.body.chatId), req.body.maxId ? Number(req.body.maxId) : undefined)
  return { ok: true }
})

app.post('/read-all', async req => {
  const { settings, live: l } = auth(req)
  for (const id of settings.focusChats) await l.provider.markRead(id).catch(() => {})
  return { ok: true }
})

app.post<{ Body: { chatId: string; hours?: number } }>('/mute', async req => {
  const { live: l } = auth(req)
  await l.provider.mute(String(req.body.chatId), Math.min(Math.max(Number(req.body.hours ?? 1), 1), 168))
  return { ok: true }
})

app.get('/digest', async req => {
  const { settings, live: l } = auth(req)
  const posts = await l.provider.channelPosts(settings.channels, 8)
  return { points: scripted(l) ? scriptedDigest(settings.lang) : await digest(posts, settings), channels: new Set(posts.map(p => p.chatId)).size, posts: posts.length }
})

// ---------------------------------------------------------------- voice ----

app.post<{ Querystring: { chatId?: string; msgId?: string; lang?: string } }>('/stt', async req => {
  const { settings, live: l } = auth(req)
  const pcm = req.body as Buffer
  if (!Buffer.isBuffer(pcm)) throw Object.assign(new Error('SEND_PCM_AS_OCTET_STREAM'), { statusCode: 415 })
  const item = req.query.chatId ? l.inbox.find(i => i.chatId === req.query.chatId && i.msgId === Number(req.query.msgId)) : undefined
  const replyLang = req.query.lang || item?.translated?.from || settings.readLang
  if (!sttEnabled()) {
    if (l.provider.name !== 'demo') throw Object.assign(new Error('STT_NOT_CONFIGURED'), { statusCode: 503 })
    const s = scriptedTranscript(req.query.chatId, Number(req.query.msgId), settings.readLang) // demo without STT key
    return aiEnabled() ? { raw: s.raw, ...(await cleanTranscript(s.raw, item, replyLang, settings)) } : s
  }
  const raw = await transcribe(pcm)
  return { raw, ...(await cleanTranscript(raw, item, replyLang, settings)) }
})

// ------------------------------------------------------------- promises ----

const nowS = () => Math.floor(Date.now() / 1000)

function openPromises(req: FastifyRequest): Commitment[] {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  const acc = store.getAccount(token)
  return Object.values(acc?.commitments ?? {})
    .filter(c => c.state === 'open' && (!c.snoozedUntil || c.snoozedUntil <= nowS()))
    .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || b.createdAt - a.createdAt)
}

/** Scans the user's recent own messages for new promises, then lists the open ones. */
app.get('/promises', async req => {
  const { token, settings, live: l } = auth(req)
  const acc = store.getAccount(token)!
  const scanned = new Set(acc.scanned ?? [])
  const recent = await l.provider.outgoing(settings.focusChats, nowS() - 72 * 3600)
  const fresh = recent.filter(m => !scanned.has(`${m.chatId}:${m.msgId}`))
  if (fresh.length) {
    const found = scripted(l) ? scriptedPromises(fresh, settings.readLang, new Date()) : await findPromises(fresh, settings, new Date().toISOString())
    store.mutate(token, a => {
      a.commitments ??= {}
      for (const f of found) {
        const m = fresh[f.i]
        if (!m || !f.what) continue
        const key = `${m.chatId}:${m.msgId}`
        if (a.commitments[key]) continue
        const due = f.due ? Math.floor(Date.parse(f.due) / 1000) : NaN
        a.commitments[key] = {
          key, chatId: m.chatId, chatTitle: m.chatTitle, msgId: m.msgId,
          what: String(f.what).slice(0, 60), due: Number.isFinite(due) ? due : null,
          doneText: String(f.doneText || 'Done!').slice(0, 120), doneMeaning: String(f.doneMeaning || f.doneText || 'Done!').slice(0, 80),
          doneLang: String(f.lang || settings.readLang).slice(0, 2), state: 'open', createdAt: nowS(),
        }
      }
      a.scanned = [...scanned, ...fresh.map(m => `${m.chatId}:${m.msgId}`)].slice(-500)
    })
  }
  return { promises: openPromises(req) }
})

function promiseFor(token: string, key: string) {
  const c = store.getAccount(token)?.commitments?.[key]
  if (!c) throw Object.assign(new Error('PROMISE_NOT_FOUND'), { statusCode: 404 })
  return c
}

/** Marks a promise done and tells the other person, in their language. */
app.post<{ Body: { key: string; send?: boolean } }>('/promises/done', async req => {
  const { token, live: l } = auth(req)
  const c = promiseFor(token, String(req.body.key))
  if (req.body.send !== false) await l.provider.send(c.chatId, c.doneText, c.msgId)
  store.mutate(token, a => { a.commitments![c.key].state = 'done' })
  return { ok: true }
})

app.post<{ Body: { key: string; hours?: number } }>('/promises/snooze', async req => {
  const { token } = auth(req)
  const c = promiseFor(token, String(req.body.key))
  const hours = Math.min(Math.max(Number(req.body.hours ?? 1), 0.25), 72)
  store.mutate(token, a => { a.commitments![c.key].snoozedUntil = nowS() + Math.round(hours * 3600) })
  return { ok: true }
})

app.post<{ Body: { key: string } }>('/promises/drop', async req => {
  const { token } = auth(req)
  const c = promiseFor(token, String(req.body.key))
  store.mutate(token, a => { a.commitments![c.key].state = 'dropped' })
  return { ok: true }
})

await app.listen({ port: config.port, host: config.host })
