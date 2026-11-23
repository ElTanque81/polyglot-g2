import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'
import { defaultSettings, type Settings } from './types.js'

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

export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.')
}

export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split('.').map(s => Buffer.from(s, 'base64'))
  const d = createDecipheriv('aes-256-gcm', key(), iv)
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

export function deleteAccount(token: string) {
  delete db[hashToken(token)]
  save()
}

export function allTokensHashes() {
  return Object.keys(db)
}
