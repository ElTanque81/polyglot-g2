import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { Logger, LogLevel } from 'telegram/extensions/Logger.js'
import type { ChannelPost, ChatInfo, InboxItem, Provider } from '../types.js'
import { config } from '../config.js'

/**
 * Real Telegram backend over MTProto (the user's own account).
 * Reads only the chats the user picked; nothing is stored server-side
 * except the encrypted session string.
 */

const quiet = new Logger(LogLevel.ERROR)
const creds = () => ({ apiId: config.telegram.apiId, apiHash: config.telegram.apiHash })

function newClient(session = '') {
  return new TelegramClient(new StringSession(session), config.telegram.apiId, config.telegram.apiHash, {
    connectionRetries: 5,
    baseLogger: quiet,
    deviceModel: 'TeleGlance (Even G2)',
    appVersion: '0.1.0',
  })
}

const kindOf = (d: { isUser: boolean; isGroup: boolean; isChannel: boolean }): ChatInfo['kind'] =>
  d.isUser ? 'user' : d.isGroup ? 'group' : 'channel'

function senderName(m: Api.Message): string {
  const s = m.sender as { firstName?: string; lastName?: string; title?: string } | undefined
  if (!s) return ''
  return s.title ?? [s.firstName, s.lastName].filter(Boolean).join(' ')
}

/** Text for display: message text, or a short label for media. */
function textOf(m: Api.Message): string {
  if (m.message) return m.message
  if (m.photo) return '[photo]'
  if (m.voice) return '[voice message]'
  if (m.video) return '[video]'
  if (m.sticker) return '[sticker]'
  if (m.document) return '[file]'
  return '[message]'
}

// ---------------------------------------------------------------- login ----

interface PendingLogin { client: TelegramClient; phone: string; phoneCodeHash: string; created: number }
const pending = new Map<string, PendingLogin>()

setInterval(() => {
  for (const [id, p] of pending) {
    if (Date.now() - p.created > 10 * 60_000) { p.client.disconnect().catch(() => {}); pending.delete(id) }
  }
}, 60_000).unref()

const withTimeout = <T>(p: Promise<T>, ms: number, code: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(code)), ms))])

export async function startLogin(loginId: string, phone: string) {
  const client = newClient()
  try {
    await withTimeout(client.connect(), 20_000, 'TELEGRAM_UNREACHABLE')
    const { phoneCodeHash, isCodeViaApp } = await withTimeout(client.sendCode(creds(), phone), 20_000, 'TELEGRAM_TIMEOUT')
    pending.set(loginId, { client, phone, phoneCodeHash, created: Date.now() })
    return { viaApp: isCodeViaApp }
  } catch (e) {
    client.disconnect().catch(() => {})
    const code = (e as { errorMessage?: string }).errorMessage ?? (e as Error).message ?? String(e)
    console.error('[auth/start] Telegram said:', code)
    throw Object.assign(new Error(code), { statusCode: 400 })
  }
}

export type VerifyResult = { ok: true; session: string } | { ok: false; needPassword: true } | { ok: false; error: string }

export async function verifyLogin(loginId: string, code: string, password?: string): Promise<VerifyResult> {
  const p = pending.get(loginId)
  if (!p) return { ok: false, error: 'LOGIN_EXPIRED' }
  try {
    if (!password) {
      await p.client.invoke(new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.phoneCodeHash, phoneCode: code }))
    } else {
      await p.client.signInWithPassword(creds(), {
        password: async () => password,
        onError: async () => true,
      })
    }
  } catch (e) {
    const msg = (e as { errorMessage?: string }).errorMessage ?? String(e)
    if (msg === 'SESSION_PASSWORD_NEEDED') return { ok: false, needPassword: true }
    console.error('[auth/verify] Telegram said:', msg)
    return { ok: false, error: msg }
  }
  const session = (p.client.session as StringSession).save()
  await p.client.disconnect()
  pending.delete(loginId)
  return { ok: true, session }
}

// ------------------------------------------------------------- provider ----

export class TelegramProvider implements Provider {
  readonly name = 'telegram'
  private client: TelegramClient
  private ready: Promise<void>
  /** chat id -> input peer, refreshed on every dialog fetch */
  private peers = new Map<string, Api.TypeInputPeer>()

  constructor(session: string) {
    this.client = newClient(session)
    this.ready = this.client.connect().then(() => this.refresh()).then(() => {})
  }

  private async refresh() {
    const dialogs = await this.client.getDialogs({ limit: 200 })
    for (const d of dialogs) if (d.id) this.peers.set(d.id.toString(), d.inputEntity)
    return dialogs
  }

  private async peer(chatId: string) {
    await this.ready
    let p = this.peers.get(chatId)
    if (!p) { await this.refresh(); p = this.peers.get(chatId) }
    if (!p) throw new Error('chat not found')
    return p
  }

  async me() {
    await this.ready
    const u = (await this.client.getMe()) as Api.User
    return { name: [u.firstName, u.lastName].filter(Boolean).join(' ') }
  }

  async listChats(): Promise<ChatInfo[]> {
    await this.ready
    const dialogs = await this.refresh()
    return dialogs
      .filter(d => d.id)
      .map(d => ({ id: d.id!.toString(), title: d.title ?? d.name ?? '?', kind: kindOf(d), unread: d.unreadCount }))
  }

  async inbox(focus: string[]): Promise<InboxItem[]> {
    await this.ready
    const dialogs = await this.refresh()
    const items: InboxItem[] = []
    for (const d of dialogs) {
      const id = d.id?.toString()
      if (!id || !focus.includes(id) || d.unreadCount === 0 || d.isChannel && !d.isGroup) continue
      const msgs = await this.client.getMessages(d.inputEntity, { limit: Math.min(d.unreadCount, 5) })
      for (const m of [...msgs].reverse()) {
        if (m.out) continue
        items.push({
          chatId: id,
          chatTitle: d.title ?? d.name ?? '?',
          kind: kindOf(d),
          msgId: m.id,
          sender: d.isUser ? (d.title ?? '') : senderName(m),
          text: textOf(m),
          date: m.date,
          mentioned: !!m.mentioned,
        })
      }
    }
    return items
  }

  async history(chatId: string, limit: number) {
    const msgs = await this.client.getMessages(await this.peer(chatId), { limit })
    return [...msgs].reverse().map(m => ({ sender: m.out ? 'You' : senderName(m), out: !!m.out, text: textOf(m) }))
  }

  async channelPosts(channels: string[], per: number): Promise<ChannelPost[]> {
    await this.ready
    const out: ChannelPost[] = []
    for (const id of channels) {
      const p = await this.peer(id)
      const msgs = await this.client.getMessages(p, { limit: per })
      const title = (await this.client.getEntity(p) as { title?: string }).title ?? '?'
      for (const m of msgs) if (m.message) out.push({ chatId: id, chatTitle: title, msgId: m.id, text: m.message, date: m.date })
    }
    return out
  }

  async send(chatId: string, text: string, replyTo?: number) {
    const m = await this.client.sendMessage(await this.peer(chatId), { message: text, replyTo })
    return { msgId: m.id }
  }

  async markRead(chatId: string, maxId?: number) {
    await this.client.markAsRead(await this.peer(chatId), maxId)
  }

  async mute(chatId: string, hours: number) {
    const peer = await this.peer(chatId)
    await this.client.invoke(new Api.account.UpdateNotifySettings({
      peer: new Api.InputNotifyPeer({ peer }),
      settings: new Api.InputPeerNotifySettings({ muteUntil: Math.floor(Date.now() / 1000) + hours * 3600 }),
    }))
  }

  async close() { await this.client.disconnect() }
}
