export type Lang = 'en' | 'de'

export interface ChatInfo {
  id: string
  title: string
  kind: 'user' | 'group' | 'channel'
  unread: number
}

/** One unread message as the glasses see it. */
export interface InboxItem {
  chatId: string
  chatTitle: string
  kind: ChatInfo['kind']
  msgId: number
  sender: string
  text: string
  /** Unix seconds */
  date: number
  /** true when the message mentions the user directly */
  mentioned: boolean
  /** AI fields, filled by the triage step */
  needsYou?: boolean
  gist?: string
  /** Set when the message was translated for display */
  translated?: { from: string; original: string }
}

/** A message the user sent, scanned for promises. */
export interface OutgoingMsg { chatId: string; chatTitle: string; msgId: number; text: string; date: number }

export interface Commitment {
  key: string // chatId:msgId
  chatId: string
  chatTitle: string
  msgId: number
  /** what was promised, short, in the reader's language */
  what: string
  /** unix seconds or null */
  due: number | null
  /** short message to send when done, in the chat's language */
  doneText: string
  /** doneText in the reader's language (for display) */
  doneMeaning: string
  doneLang: string
  state: 'open' | 'done' | 'dropped'
  snoozedUntil?: number
  createdAt: number
}

export interface ChannelPost {
  chatId: string
  chatTitle: string
  msgId: number
  text: string
  date: number
}

/** Languages Polyglot can translate into for reading (UI itself is EN/DE). */
export const READ_LANGS = ['en', 'de', 'es', 'fr', 'it', 'pt', 'nl', 'pl', 'tr', 'ru', 'uk', 'zh', 'ja', 'ko', 'vi', 'id'] as const
export type ReadLang = (typeof READ_LANGS)[number]

export interface Settings {
  focusChats: string[]
  channels: string[]
  /** UI language on glasses and phone */
  lang: Lang
  /** Language messages are translated into for reading */
  readLang: ReadLang
  /** short, friendly, formal */
  style: 'short' | 'friendly' | 'formal'
  translate: boolean
}

export const defaultSettings = (): Settings => ({
  focusChats: [],
  channels: [],
  lang: 'en',
  readLang: 'en',
  style: 'short',
  translate: true,
})

/** What every Telegram backend (real or demo) must offer. */
export interface Provider {
  readonly name: string
  me(): Promise<{ name: string }>
  listChats(): Promise<ChatInfo[]>
  inbox(focusChats: string[]): Promise<InboxItem[]>
  /** Recent messages of one chat (oldest first), used as reply context */
  history(chatId: string, limit: number): Promise<{ sender: string; out: boolean; text: string }[]>
  channelPosts(channels: string[], perChannel: number): Promise<ChannelPost[]>
  /** Messages the user sent in these chats since `since` (unix seconds) */
  outgoing(chats: string[], since: number): Promise<OutgoingMsg[]>
  send(chatId: string, text: string, replyTo?: number): Promise<{ msgId: number }>
  markRead(chatId: string, maxId?: number): Promise<void>
  mute(chatId: string, hours: number): Promise<void>
  close(): Promise<void>
}
