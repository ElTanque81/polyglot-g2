import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'
import { defaultSettings, type Activity, type Commitment, type Settings, type Usage } from './types.js'

/**
 * Tiny file store. Telegram session strings are encrypted with AES-256-GCM
 * using a key derived from SERVER_SECRET; device tokens are stored only as
 * SHA-256 hashes, so a leaked data file does not leak usable tokens.
 */

export interface Account {
  kind: 'telegram' | 'demo'
  /** encrypted Telegram StringSession (telegram accounts only) */
  session?: string
  settings: Settings
  createdAt: number
  /** promise tracker state, keyed chatId:msgId */
  commitments?: Record<string, Commitment>
  /** outgoing message keys already scanned for promises */
  scanned?: string[]
  /** cost meter, current month */
  usage?: Usage
  /** last actions, without message content */
  activity?: Activity[]
}

type DB = Record<string, Account> // key = sha256(token)

const file = () => join(config.dataDir, 'accounts.json')
let db: DB = {}

function key(): Buffer {
  if (!config.secret || config.secret.length < 16) {
    throw new Error('SERVER_SECRET must be set (16+ chars) to store Telegram sessions')
  }
  return createHash('sha256').update(config.secret).digest()
}

/**
 * Per-user key: derived from SERVER_SECRET *and* the user's device token. The server
 * stores only a hash of the token, so the data file plus the server secret are still
 * not enough to open a Telegram session; the user's device has to be part of it.
 */
function userKey(token: string): Buffer {
  return Buffer.from(hkdfSync('sha256', key(), Buffer.from(token, 'utf8'), 'polyglot-session-v2', 32))
}

export function encrypt(plain: string, token: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', userKey(token), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return 'v2.' + [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.')
}

export function decrypt(blob: string, token: string): string {
  const v2 = blob.startsWith('v2.')
  const [iv, tag, enc] = (v2 ? blob.slice(3) : blob).split('.').map(s => Buffer.from(s, 'base64'))
  const d = createDecipheriv('aes-256-gcm', v2 ? userKey(token) : key(), iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex')
export const newToken = () => randomBytes(24).toString('base64url')

export function load() {
  mkdirSync(config.dataDir, { recursive: true })
  if (existsSync(file())) db = JSON.parse(readFileSync(file(), 'utf8'))
}

function save() {
  const tmp = file() + '.tmp'
  writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 })
  renameSync(tmp, file())
}

export function getAccount(token: string): Account | undefined {
  return db[hashToken(token)]
}

export function putAccount(token: string, acc: Account) {
  db[hashToken(token)] = acc
  save()
}

export function updateSettings(token: string, patch: Partial<Settings>): Settings {
  const acc = getAccount(token)
  if (!acc) throw new Error('unknown account')
  acc.settings = { ...defaultSettings(), ...acc.settings, ...patch }
  save()
  return acc.settings
}

/** Change an account in place and persist it. */
export function mutate<T>(token: string, fn: (acc: Account) => T): T {
  const acc = getAccount(token)
  if (!acc) throw Object.assign(new Error('unauthorized'), { statusCode: 401 })
  const r = fn(acc)
  save()
  return r
}

export function deleteAccount(token: string) {
  delete db[hashToken(token)]
  save()
}

export function allTokensHashes() {
  return Object.keys(db)
}
