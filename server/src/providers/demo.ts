import type { ChannelPost, ChatInfo, InboxItem, Provider } from '../types.js'

/**
 * Keyless demo backend with scripted chats. Used for the simulator demo and
 * for judges who want to try TeleGlance without a Telegram login.
 * All names and messages are fictional.
 */

interface Msg { id: number; sender: string; out: boolean; text: string; date: number; mentioned?: boolean }
interface Chat extends ChatInfo { msgs: Msg[]; readUpTo: number; mutedUntil: number }

const now = () => Math.floor(Date.now() / 1000)

function seed(): Chat[] {
  const t = now()
  return [
    {
      id: '1001', title: 'Acme Work', kind: 'group', unread: 0, readUpTo: 3, mutedUntil: 0,
      msgs: [
        { id: 1, sender: 'Ben', out: false, text: 'Morning all, client call is still at 4pm', date: t - 7200 },
        { id: 2, sender: 'You', out: true, text: 'Great, deck is almost done', date: t - 7000 },
        { id: 3, sender: 'Ben', out: false, text: 'Nice', date: t - 6900 },
        { id: 4, sender: 'Anna', out: false, text: '@you can you send the deck before 3pm? The client moved the call up to 3:30.', date: t - 180, mentioned: true },
      ],
    },
    {
      id: '1002', title: 'Carlos', kind: 'user', unread: 0, readUpTo: 0, mutedUntil: 0,
      msgs: [
        { id: 1, sender: 'Carlos', out: false, text: '¿Seguimos mañana a las 10 en la oficina?', date: t - 900 },
      ],
    },
    {
      id: '1003', title: 'Family', kind: 'group', unread: 0, readUpTo: 0, mutedUntil: 0,
      msgs: [
        { id: 1, sender: 'Mia', out: false, text: 'Photos from the weekend are in the shared album 📸', date: t - 2400 },
        { id: 2, sender: 'Mia', out: false, text: 'Who is bringing dessert on Sunday?', date: t - 2300 },
      ],
    },
    {
      id: '1004', title: 'Lena', kind: 'user', unread: 0, readUpTo: 0, mutedUntil: 0,
      msgs: [
        { id: 1, sender: 'Lena', out: false, text: 'Haha that meme was great', date: t - 5000 },
      ],
    },
    {
      id: '2001', title: 'Crypto Daily', kind: 'channel', unread: 0, readUpTo: 0, mutedUntil: 0,
      msgs: [
        { id: 1, sender: 'Crypto Daily', out: false, text: 'Spot BTC ETFs saw their largest weekly inflows since March, led by two issuers.', date: t - 3000 },
        { id: 2, sender: 'Crypto Daily', out: false, text: 'Ethereum gas fees hit a 3-month low as L2 activity keeps growing.', date: t - 2000 },
        { id: 3, sender: 'Crypto Daily', out: false, text: 'Reminder: airdrop snapshot for the DAO governance token is this Friday 12:00 UTC.', date: t - 1000 },
      ],
    },
    {
      id: '2002', title: 'DeFi Signals', kind: 'channel', unread: 0, readUpTo: 0, mutedUntil: 0,
      msgs: [
        { id: 1, sender: 'DeFi Signals', out: false, text: 'New perpetual market listed on a major on-chain exchange today, funding is positive.', date: t - 2500 },
        { id: 2, sender: 'DeFi Signals', out: false, text: 'ETF flows again: third channel today reporting record weekly inflows.', date: t - 1500 },
      ],
    },
    {
      id: '2003', title: 'DAO News', kind: 'channel', unread: 0, readUpTo: 0, mutedUntil: 0,
      msgs: [
        { id: 1, sender: 'DAO News', out: false, text: 'Governance vote #42 passed: treasury diversification into stablecoins.', date: t - 4000 },
        { id: 2, sender: 'DAO News', out: false, text: 'Snapshot for the airdrop: Friday. Hold tokens in a self-custody wallet.', date: t - 800 },
      ],
    },
  ]
}

export class DemoProvider implements Provider {
  readonly name = 'demo'
  private chats = seed()

  private chat(id: string) {
    const c = this.chats.find(c => c.id === id)
    if (!c) throw new Error('chat not found')
    return c
  }

  private unreadOf(c: Chat) {
    return c.msgs.filter(m => !m.out && m.id > c.readUpTo)
  }

  async me() { return { name: 'Demo User' } }

  async listChats(): Promise<ChatInfo[]> {
    return this.chats.map(({ id, title, kind }) => ({ id, title, kind, unread: this.unreadOf(this.chat(id)).length }))
  }

  async inbox(focus: string[]): Promise<InboxItem[]> {
    const out: InboxItem[] = []
    for (const c of this.chats) {
      if (!focus.includes(c.id) || c.kind === 'channel' || c.mutedUntil > now()) continue
      for (const m of this.unreadOf(c)) {
        out.push({ chatId: c.id, chatTitle: c.title, kind: c.kind, msgId: m.id, sender: m.sender, text: m.text, date: m.date, mentioned: !!m.mentioned })
      }
    }
    return out
  }

  async history(chatId: string, limit: number) {
    return this.chat(chatId).msgs.slice(-limit).map(m => ({ sender: m.sender, out: m.out, text: m.text }))
  }

  async channelPosts(channels: string[], per: number): Promise<ChannelPost[]> {
    return this.chats
      .filter(c => channels.includes(c.id))
      .flatMap(c => c.msgs.slice(-per).map(m => ({ chatId: c.id, chatTitle: c.title, msgId: m.id, text: m.text, date: m.date })))
  }

  async send(chatId: string, text: string) {
    const c = this.chat(chatId)
    const id = (c.msgs.at(-1)?.id ?? 0) + 1
    c.msgs.push({ id, sender: 'You', out: true, text, date: now() })
    c.readUpTo = id
    // Scripted follow-up so the demo inbox stays alive.
    if (chatId === '1001') {
      setTimeout(() => {
        const nid = (c.msgs.at(-1)?.id ?? 0) + 1
        c.msgs.push({ id: nid, sender: 'Anna', out: false, text: 'Perfect, thank you! Can you also join the call at 3:30?', date: now(), mentioned: true })
      }, 20_000)
    }
    return { msgId: id }
  }

  async markRead(chatId: string, maxId?: number) {
    const c = this.chat(chatId)
    c.readUpTo = maxId ?? c.msgs.at(-1)?.id ?? 0
  }

  async mute(chatId: string, hours: number) {
    this.chat(chatId).mutedUntil = now() + hours * 3600
  }

  async close() {}
}
