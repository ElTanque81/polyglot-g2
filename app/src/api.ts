/** Thin client for the TeleGlance server. The token never leaves this device and the server. */

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787'

export type Lang = 'en' | 'de'
export interface Settings { focusChats: string[]; channels: string[]; lang: Lang; style: 'short' | 'friendly' | 'formal'; translate: boolean }
export interface ChatInfo { id: string; title: string; kind: 'user' | 'group' | 'channel'; unread: number }
export interface InboxItem {
  chatId: string; chatTitle: string; kind: ChatInfo['kind']; msgId: number; sender: string; text: string; date: number
  mentioned: boolean; needsYou?: boolean; gist?: string; translated?: { from: string; original: string }
}
export interface DigestPoint { title: string; detail: string; sources: string[] }

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg) } }

let token = ''
export const setToken = (t: string) => { token = t }
export const hasToken = () => token.length > 0

async function call<T>(method: string, path: string, body?: unknown, raw?: Uint8Array): Promise<T> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  let payload: BodyInit | undefined
  if (raw) { headers['Content-Type'] = 'application/octet-stream'; payload = raw as unknown as BodyInit }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(API_URL + path, { method, headers, body: payload })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`)
  return data as T
}

export const api = {
  health: () => call<{ telegram: boolean; ai: boolean; stt: boolean; demo: boolean }>('GET', '/health'),
  demo: () => call<{ token: string }>('POST', '/auth/demo'),
  loginStart: (phone: string) => call<{ loginId: string; viaApp: boolean }>('POST', '/auth/start', { phone }),
  loginVerify: (loginId: string, code: string, password?: string) =>
    call<{ ok: boolean; token?: string; needPassword?: boolean; error?: string }>('POST', '/auth/verify', { loginId, code, password }),
  logout: () => call<{ ok: boolean }>('POST', '/auth/logout'),
  me: () => call<{ name: string; provider: string; settings: Settings }>('GET', '/me'),
  chats: () => call<{ chats: ChatInfo[] }>('GET', '/chats'),
  saveSettings: (s: Partial<Settings>) => call<{ settings: Settings }>('PUT', '/settings', s),
  inbox: () => call<{ items: InboxItem[]; needYou: number }>('GET', '/inbox'),
  replies: (chatId: string, msgId: number) => call<{ replies: string[]; replyLang: string }>('POST', '/replies', { chatId, msgId }),
  send: (chatId: string, text: string, replyTo?: number) => call<{ ok: boolean; msgId: number }>('POST', '/send', { chatId, text, replyTo }),
  read: (chatId: string, maxId?: number) => call<{ ok: boolean }>('POST', '/read', { chatId, maxId }),
  readAll: () => call<{ ok: boolean }>('POST', '/read-all', {}),
  mute: (chatId: string, hours = 1) => call<{ ok: boolean }>('POST', '/mute', { chatId, hours }),
  digest: () => call<{ points: DigestPoint[]; channels: number; posts: number }>('GET', '/digest'),
  stt: (pcm: Uint8Array, q: { chatId?: string; msgId?: number; lang?: string }) =>
    call<{ raw: string; text: string }>('POST', `/stt?${new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`, undefined, pcm),
}
