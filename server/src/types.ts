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

export interface ChannelPost {
  chatId: string
  chatTitle: string
  msgId: number
  text: string
  date: number
}

export interface Settings {
  focusChats: string[]
  channels: string[]
  lang: Lang
  /** short, friendly, formal */
  style: 'short' | 'friendly' | 'formal'
  translate: boolean
}

export const defaultSettings = (): Settings => ({
  focusChats: [],
  channels: [],
  lang: 'en',
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
  send(chatId: string, text: string, replyTo?: number): Promise<{ msgId: number }>
  markRead(chatId: string, maxId?: number): Promise<void>
  mute(chatId: string, hours: number): Promise<void>
  close(): Promise<void>
}
