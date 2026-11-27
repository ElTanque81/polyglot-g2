import { config } from './config.js'
import type { ChannelPost, InboxItem, OutgoingMsg, ReadLang, Register, Settings } from './types.js'
import { addUsage } from './meter.js'

/**
 * All AI calls go through one LLM (Otari gateway, Claude or OpenAI). Every function has
 * a small heuristic fallback, so the app keeps working without an API key.
 * Inputs are trimmed: only the message being handled and a few lines of
 * context ever leave the server.
 */

export const LANG_NAME: Record<string, string> = {
  en: 'English', de: 'German', es: 'Spanish', fr: 'French', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish',
  tr: 'Turkish', ru: 'Russian', uk: 'Ukrainian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', vi: 'Vietnamese', id: 'Indonesian',
  ar: 'Arabic', hi: 'Hindi', he: 'Hebrew', fa: 'Persian', ur: 'Urdu', th: 'Thai', bn: 'Bengali',
}
const nameOf = (l: string) => LANG_NAME[l] ?? l

/**
 * Scripts the G2 font cannot draw (tested in the Even Hub simulator): Arabic, Hebrew,
 * Indic and Thai text simply disappears. Such text is always shown translated.
 */
const UNRENDERABLE = /[\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0E7F\uFB1D-\uFDFF\uFE70-\uFEFF]/
export const renderable = (s: string) => !UNRENDERABLE.test(s)
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export const aiEnabled = () => config.ai.key.length > 0

/** Otari keys can belong to another region; the gateway answers 421 and names the host. */
let regionBase: string | null = null

async function post(base: string, path: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { res, text: await res.text() }
}

/** One prompt in, one parsed JSON value out, whichever provider is configured. */
async function llmJSON<T>(system: string, user: string, maxTokens = 600): Promise<T> {
  const sys = system + '\nAnswer with one JSON value only, no prose, no code fences.'
  const { provider, key, model, baseUrl } = config.ai
  let text: string
  if (provider === 'anthropic') {
    const { res, text: raw } = await post(baseUrl, '/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
      model, max_tokens: maxTokens, system: sys, messages: [{ role: 'user', content: user }],
    })
    if (!res.ok) throw new Error(`Claude ${res.status}: ${raw.slice(0, 200)}`)
    const data = JSON.parse(raw) as { content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
    addUsage({ llmIn: data.usage?.input_tokens ?? 0, llmOut: data.usage?.output_tokens ?? 0, llmCalls: 1 })
    text = data.content.filter(c => c.type === 'text').map(c => c.text).join('')
  } else {
    const body = { model, max_tokens: maxTokens, temperature: 0.4, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }
    const auth = { authorization: `Bearer ${key}` }
    let out = await post(regionBase ?? baseUrl, '/chat/completions', auth, body)
    if (out.res.status === 421 && provider === 'otari') {
      const host = (out.text.match(/belongs to ([a-z0-9.-]+\.[a-z]{2,})/i) ?? [])[1]
      if (host) { regionBase = `https://${host}/api/v1`; out = await post(regionBase, '/chat/completions', auth, body) }
    }
    if (!out.res.ok) throw new Error(`${provider} ${out.res.status}: ${out.text.slice(0, 200)}`)
    const data = JSON.parse(out.text) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
    addUsage({ llmIn: data.usage?.prompt_tokens ?? 0, llmOut: data.usage?.completion_tokens ?? 0, llmCalls: 1 })
    text = data.choices[0]?.message?.content ?? ''
  }
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '')
  const start = text.search(/[[{]/)
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  return JSON.parse(text.slice(start, end + 1)) as T
}

// --------------------------------------------------------------- triage ----

interface TriageOut { i: number; needsYou: boolean; gist: string; lang: string; translation?: string }

/** Must this message be translated for the reader? */
const wantsTranslation = (lang: string, text: string, s: Settings) => lang !== s.readLang && (s.translate || !renderable(text))

export async function triage(items: InboxItem[], s: Settings): Promise<InboxItem[]> {
  if (items.length === 0) return items
  if (!aiEnabled()) return items.map(heuristicTriage)
  const batch = items.slice(0, 20)
  try {
    const out = await llmJSON<TriageOut[]>(
      `You triage Telegram messages for a person reading them on smart glasses. Messages can be in any language.
For each message decide needsYou: true if it asks the reader something, mentions them, sets a deadline, or clearly waits for their reply. Small talk, reactions and FYI posts are false.
gist: max 45 characters in ${nameOf(s.readLang)}, what the reader must know or do (empty string if nothing).
lang: ISO 639-1 code of the message.
translation: if lang is not "${s.readLang}", the message translated into ${nameOf(s.readLang)}, max 200 characters, natural wording. Otherwise omit.
Return an array of {i, needsYou, gist, lang, translation?}.`,
      JSON.stringify(batch.map((m, i) => ({ i, chat: m.chatTitle, type: m.kind, from: m.sender, mentionsReader: m.mentioned, text: clip(m.text, 500) }))),
      1400,
    )
    const byI = new Map(out.map(o => [o.i, o]))
    addUsage({ triaged: batch.length, translated: out.filter(o => o.translation).length })
    return items.map((m, i) => {
      const o = byI.get(i)
      if (!o) return heuristicTriage(m)
      const lang = (o.lang ?? '').toLowerCase().slice(0, 2)
      return {
        ...m,
        needsYou: !!o.needsYou,
        gist: clip(o.gist ?? '', 50),
        ...(o.translation && lang && wantsTranslation(lang, m.text, s)
          ? { text: o.translation, translated: { from: lang, original: m.text } }
          : {}),
      }
    })
  } catch (e) {
    console.warn('triage fallback:', (e as Error).message)
    return items.map(heuristicTriage)
  }
}

function heuristicTriage(m: InboxItem): InboxItem {
  const asks = /\?\s*$|\?\s|\b(can you|could you|please|kannst du|bitte)\b/i.test(m.text)
  return { ...m, needsYou: m.mentioned || (asks && m.kind === 'user'), gist: '' }
}

// -------------------------------------------------------------- replies ----

export interface Reply { text: string; meaning: string }

/** Register instructions, with the language-specific forms that matter most. */
function registerRule(r: Register): string {
  const forms = 'Respect language-specific forms: Japanese keigo/teineigo vs plain form, German Sie vs du, Spanish usted vs tú, French vous vs tu, Korean jondaetmal vs banmal, Russian вы vs ты, Arabic polite formulas.'
  if (r === 'formal') return `Use a formal, polite register. ${forms}`
  if (r === 'casual') return `Use a casual, friendly register. ${forms}`
  return `Detect the register the reader uses with this person from the history ("You" lines) and from how the other person writes: formal or casual. ${forms} If unclear (no history, a client, a boss, a stranger, an older person), choose formal.`
}

/**
 * Three one-tap replies, written in the language of the message, each with its
 * meaning in the reader's language so they know what they are sending.
 */
export async function suggestReplies(
  item: InboxItem,
  history: { sender: string; out: boolean; text: string }[],
  s: Settings,
): Promise<{ replies: Reply[]; replyLang: string; register: 'formal' | 'casual' }> {
  const reg: Register = s.registers?.[item.chatId] ?? 'auto'
  const fb = { replies: fallbackReplies(s.readLang), replyLang: item.translated?.from ?? s.readLang, register: (reg === 'casual' ? 'casual' : 'formal') as 'formal' | 'casual' }
  if (!aiEnabled()) return fb
  try {
    const out = await llmJSON<{ lang: string; register: string; replies: { text: string; meaning: string }[] }>(
      `You draft replies the reader can send with one tap from smart glasses.
Write exactly 3 different replies to the LAST message, each max 45 characters, no emoji, no quotes.
Cover: a yes/agree option, a specific helpful option, and a polite defer/no option.
Style: ${s.style}. Match how the reader writes in the history ("You" lines).
Register: ${registerRule(reg)}
Write each reply in the language of the last message (lang = its ISO 639-1 code), natural for a native speaker.
meaning: the same reply in ${nameOf(s.readLang)}, max 45 characters (identical if lang is ${s.readLang}).
Return {"lang": "xx", "register": "formal" | "casual", "replies": [{"text": "...", "meaning": "..."}, x3]}.`,
      JSON.stringify({
        chat: item.chatTitle,
        history: history.slice(-8).map(h => `${h.out ? 'You' : h.sender}: ${clip(h.text, 200)}`),
        last: `${item.sender}: ${clip(item.translated?.original ?? item.text, 500)}`,
      }),
      600,
    )
    const replies = (out.replies ?? [])
      .map(r => ({ text: clip(String(r.text ?? '').replace(/\s+/g, ' ').trim(), 120), meaning: clip(String(r.meaning ?? r.text ?? '').replace(/\s+/g, ' ').trim(), 52) }))
      .filter(r => r.text)
      .slice(0, 3)
    const lang = (out.lang ?? '').toLowerCase().slice(0, 2) || fb.replyLang
    const register = reg !== 'auto' ? reg : out.register === 'casual' ? 'casual' : 'formal'
    return replies.length ? { replies, replyLang: lang, register } : fb
  } catch (e) {
    console.warn('replies fallback:', (e as Error).message)
    return fb
  }
}

const fallbackReplies = (lang: ReadLang): Reply[] =>
  (lang === 'de'
    ? ['Ja, mache ich', 'Ich melde mich gleich', 'Passt heute leider nicht']
    : ['Yes, on it', 'I will get back to you shortly', 'Sorry, not today']
  ).map(t => ({ text: t, meaning: t }))

// ---------------------------------------------------------------- clean ----

/**
 * Turn a raw voice transcript (spoken in any language) into a sendable message
 * in the chat's language, plus its meaning in the reader's language.
 */
export async function cleanTranscript(raw: string, item: InboxItem | undefined, replyLang: string, s: Settings, register: Register = 'auto'): Promise<Reply> {
  const text = raw.trim()
  if (!text) return { text: '', meaning: '' }
  if (!aiEnabled()) { const t = text.charAt(0).toUpperCase() + text.slice(1); return { text: t, meaning: t } }
  try {
    const out = await llmJSON<{ text: string; meaning: string }>(
      `Turn a dictated chat reply into a clean message: fix punctuation, numbers ("two" -> "2" for times), filler words and obvious speech-recognition errors.
Keep the meaning; do not add content. Register: ${registerRule(register)}
text: the message in ${nameOf(replyLang)} (translate if the speaker used another language), max 300 characters.
meaning: the same message in ${nameOf(s.readLang)}, max 200 characters.
Return {"text": "...", "meaning": "..."}.`,
      JSON.stringify({ replyingTo: item ? clip(item.translated?.original ?? item.text, 300) : undefined, transcript: text }),
      500,
    )
    return { text: clip(out.text?.trim() || text, 300), meaning: clip(out.meaning?.trim() || out.text?.trim() || text, 200) }
  } catch {
    return { text, meaning: text }
  }
}

// --------------------------------------------------------------- digest ----

export interface DigestPoint { title: string; detail: string; sources: string[] }

export async function digest(posts: ChannelPost[], s: Settings): Promise<DigestPoint[]> {
  if (posts.length === 0) return []
  const fb = () => posts.filter(p => renderable(p.text)).slice(0, 3).map(p => ({ title: clip(p.text, 40), detail: clip(p.text, 220), sources: [p.chatTitle] }))
  if (!aiEnabled()) return fb()
  try {
    return await llmJSON<DigestPoint[]>(
      `Summarize Telegram channel posts (any language) into the 3 most important points for a quick glance on smart glasses.
Merge posts about the same story, even across languages, and list every channel that reported it in sources.
title: max 38 characters. detail: max 220 characters, plain facts, no advice. Write in ${nameOf(s.readLang)}.
Return an array of {title, detail, sources}. No financial advice.`,
      JSON.stringify(posts.slice(0, 60).map(p => ({ channel: p.chatTitle, text: clip(p.text, 400) }))),
      900,
    ).then(arr => arr.slice(0, 3).map(p => ({ title: clip(p.title, 42), detail: clip(p.detail, 240), sources: p.sources ?? [] })))
  } catch (e) {
    console.warn('digest fallback:', (e as Error).message)
    return fb()
  }
}

// ------------------------------------------------------------- promises ----

export interface FoundPromise { i: number; what: string; due: string | null; doneText: string; doneMeaning: string; lang: string }

/**
 * Finds commitments the user made in their own messages ("I'll send it by 3",
 * "te llamo mañana") so Polyglot can remind them and close the loop with one tap.
 */
export async function findPromises(msgs: OutgoingMsg[], s: Settings, nowIso: string): Promise<FoundPromise[]> {
  if (!aiEnabled() || msgs.length === 0) return []
  try {
    const out = await llmJSON<FoundPromise[]>(
      `These are messages the reader sent on Telegram (any language). Find concrete commitments the reader made to do something
(send, call, pay, bring, check, reply, deliver), with or without a time. Ignore vague talk, questions and things already done.
For each commitment return:
i: index of the message,
what: max 40 characters in ${nameOf(s.readLang)}, starting with a verb ("Send Anna the deck"),
due: ISO 8601 local time if a time/day is stated or clearly implied (now is ${nowIso}), else null,
lang: ISO 639-1 code of the original message,
doneText: a short message (max 40 chars) in that language telling the other person it is done,
doneMeaning: doneText in ${nameOf(s.readLang)}.
Return an array (empty if none).`,
      JSON.stringify(msgs.slice(-40).map((m, i) => ({ i, chat: m.chatTitle, text: clip(m.text, 300) }))),
      900,
    )
    return Array.isArray(out) ? out : []
  } catch (e) {
    console.warn('promises fallback:', (e as Error).message)
    return []
  }
}
