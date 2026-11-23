import { config } from './config.js'
import type { ChannelPost, InboxItem, Lang, Settings } from './types.js'

/**
 * All AI calls go through Claude (Anthropic Messages API). Every function has
 * a small heuristic fallback, so the app keeps working without an API key.
 * Inputs are trimmed: only the message being handled and a few lines of
 * context ever leave the server.
 */

const LANG_NAME: Record<Lang, string> = { en: 'English', de: 'German' }
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

export const aiEnabled = () => config.anthropic.key.length > 0

async function claudeJSON<T>(system: string, user: string, maxTokens = 600): Promise<T> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.anthropic.key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: maxTokens,
      system: system + '\nAnswer with one JSON value only, no prose, no code fences.',
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { content: { type: string; text?: string }[] }
  const text = data.content.filter(c => c.type === 'text').map(c => c.text).join('')
  const start = text.search(/[[{]/)
  return JSON.parse(text.slice(start)) as T
}

// --------------------------------------------------------------- triage ----

interface TriageOut { i: number; needsYou: boolean; gist: string; lang: string; translation?: string }

export async function triage(items: InboxItem[], s: Settings): Promise<InboxItem[]> {
  if (items.length === 0) return items
  if (!aiEnabled()) return items.map(heuristicTriage)
  const batch = items.slice(0, 20)
  try {
    const out = await claudeJSON<TriageOut[]>(
      `You triage Telegram messages for a person reading them on smart glasses.
For each message decide needsYou: true if it asks the reader something, mentions them, sets a deadline, or clearly waits for their reply. Small talk, reactions and FYI posts are false.
gist: max 45 characters in ${LANG_NAME[s.lang]}, what the reader must know or do (empty string if nothing).
lang: ISO 639-1 code of the message.
translation: ${s.translate ? `only if lang is not "${s.lang}", the message translated into ${LANG_NAME[s.lang]}, max 200 characters` : 'omit'}.
Return an array of {i, needsYou, gist, lang, translation?}.`,
      JSON.stringify(batch.map((m, i) => ({ i, chat: m.chatTitle, type: m.kind, from: m.sender, mentionsReader: m.mentioned, text: clip(m.text, 500) }))),
      1200,
    )
    const byI = new Map(out.map(o => [o.i, o]))
    return items.map((m, i) => {
      const o = byI.get(i)
      if (!o) return heuristicTriage(m)
      return {
        ...m,
        needsYou: !!o.needsYou,
        gist: clip(o.gist ?? '', 50),
        ...(o.translation && o.lang && o.lang !== s.lang
          ? { text: o.translation, translated: { from: o.lang, original: m.text } }
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

export async function suggestReplies(
  item: InboxItem,
  history: { sender: string; out: boolean; text: string }[],
  s: Settings,
): Promise<{ replies: string[]; replyLang: string }> {
  if (!aiEnabled()) return { replies: fallbackReplies(s.lang), replyLang: s.lang }
  try {
    const out = await claudeJSON<{ replies: string[]; lang: string }>(
      `You draft replies the reader can send with one tap from smart glasses.
Write exactly 3 different replies to the LAST message, each max 55 characters, no emoji, no quotes.
Cover: a yes/agree option, a specific helpful option, and a polite defer/no option.
Style: ${s.style}. Match how the reader writes in the history ("You" lines).
Write the replies in the language of the last message (lang = its ISO 639-1 code).
Return {"replies": [..3], "lang": "xx"}.`,
      JSON.stringify({
        chat: item.chatTitle,
        history: history.slice(-8).map(h => `${h.out ? 'You' : h.sender}: ${clip(h.text, 200)}`),
        last: `${item.sender}: ${clip(item.translated?.original ?? item.text, 500)}`,
      }),
      400,
    )
    const replies = (out.replies ?? []).map(r => clip(String(r).replace(/\s+/g, ' ').trim(), 58)).filter(Boolean).slice(0, 3)
    return replies.length ? { replies, replyLang: out.lang ?? s.lang } : { replies: fallbackReplies(s.lang), replyLang: s.lang }
  } catch (e) {
    console.warn('replies fallback:', (e as Error).message)
    return { replies: fallbackReplies(s.lang), replyLang: s.lang }
  }
}

const fallbackReplies = (lang: Lang) =>
  lang === 'de'
    ? ['Ja, mache ich', 'Ich melde mich gleich', 'Passt heute leider nicht']
    : ['Yes, on it', 'I will get back to you shortly', 'Sorry, not today']

// ---------------------------------------------------------------- clean ----

/** Turn a raw voice transcript into a sendable message in the chat's language. */
export async function cleanTranscript(raw: string, item: InboxItem | undefined, replyLang: string): Promise<string> {
  const text = raw.trim()
  if (!text) return ''
  if (!aiEnabled()) return text.charAt(0).toUpperCase() + text.slice(1)
  try {
    const out = await claudeJSON<{ text: string }>(
      `Clean up a dictated chat reply: fix punctuation, numbers ("two" -> "2" for times), filler words and obvious speech-recognition errors.
Keep the meaning and the speaker's tone; do not add content. Output language: ${replyLang} (translate if needed). Max 300 characters.
Return {"text": "..."}.`,
      JSON.stringify({ replyingTo: item ? clip(item.translated?.original ?? item.text, 300) : undefined, transcript: text }),
      300,
    )
    return clip(out.text?.trim() || text, 300)
  } catch {
    return text
  }
}

// --------------------------------------------------------------- digest ----

export interface DigestPoint { title: string; detail: string; sources: string[] }

export async function digest(posts: ChannelPost[], s: Settings): Promise<DigestPoint[]> {
  if (posts.length === 0) return []
  if (!aiEnabled()) {
    return posts.slice(0, 3).map(p => ({ title: clip(p.text, 40), detail: clip(p.text, 220), sources: [p.chatTitle] }))
  }
  try {
    return await claudeJSON<DigestPoint[]>(
      `Summarize Telegram channel posts into the 3 most important points for a quick glance on smart glasses.
Merge posts about the same story and list every channel that reported it in sources.
title: max 38 characters. detail: max 220 characters, plain facts, no advice. Language: ${LANG_NAME[s.lang]}.
Return an array of {title, detail, sources}. No financial advice.`,
      JSON.stringify(posts.slice(0, 60).map(p => ({ channel: p.chatTitle, text: clip(p.text, 400) }))),
      900,
    ).then(arr => arr.slice(0, 3).map(p => ({ title: clip(p.title, 42), detail: clip(p.detail, 240), sources: p.sources ?? [] })))
  } catch (e) {
    console.warn('digest fallback:', (e as Error).message)
    return posts.slice(0, 3).map(p => ({ title: clip(p.text, 40), detail: clip(p.text, 220), sources: [p.chatTitle] }))
  }
}
