import type { InboxItem, Lang } from '../types.js'
import type { DigestPoint } from '../ai.js'

/**
 * Scripted "AI" output for the keyless demo account, used only when no
 * ANTHROPIC_API_KEY is set. With a key, the demo chats go through Claude
 * like real ones.
 */

interface Script {
  needsYou: boolean
  gist: Record<Lang, string>
  translation?: { from: string; text: Record<Lang, string> }
  replies: string[]
  replyLang: string
  transcript: { raw: string; text: string }
}

const S: Record<string, Script> = {
  '1001:4': {
    needsYou: true,
    gist: { en: 'Needs the deck before 3pm', de: 'Braucht das Deck vor 15 Uhr' },
    replies: ['Sure, sending it in 10 minutes', 'On it, you will have it by 2:30', 'Can I send it right after lunch?'],
    replyLang: 'en',
    transcript: { raw: 'sending it at two I am adding the Q4 numbers', text: 'Sending it at 2, adding the Q4 numbers.' },
  },
  '1001:6': {
    needsYou: true,
    gist: { en: 'Asks you to join the 3:30 call', de: 'Fragt, ob du um 15:30 dabei bist' },
    replies: ['Yes, I will join at 3:30', 'I can join for the first 15 min', 'Sorry, I have a clash at 3:30'],
    replyLang: 'en',
    transcript: { raw: 'yes I will be there send me the link', text: 'Yes, I will be there. Send me the link?' },
  },
  '1002:1': {
    needsYou: true,
    gist: { en: 'Confirm tomorrow 10am at the office', de: 'Morgen 10 Uhr im Büro bestätigen' },
    translation: { from: 'es', text: { en: 'Are we still on for tomorrow at 10 at the office?', de: 'Bleibt es bei morgen um 10 im Büro?' } },
    replies: ['Sí, nos vemos a las 10', '¿Podemos pasarlo a las 11?', 'Mañana no puedo, ¿el jueves?'],
    replyLang: 'es',
    transcript: { raw: 'yes see you at ten I will bring coffee', text: 'Sí, nos vemos a las 10. Llevo café.' },
  },
  '1003:2': {
    needsYou: false,
    gist: { en: 'Family asks who brings dessert Sunday', de: 'Wer bringt Sonntag den Nachtisch?' },
    replies: ['I will bring dessert', 'I can bring drinks instead', 'Not sure yet, will let you know'],
    replyLang: 'en',
    transcript: { raw: 'I will bake a cake', text: 'I will bake a cake!' },
  },
  '1003:1': {
    needsYou: false,
    gist: { en: 'New weekend photos in the album', de: 'Neue Wochenend-Fotos im Album' },
    replies: ['Great photos, thanks!', 'Love them', 'Will look tonight'],
    replyLang: 'en',
    transcript: { raw: 'they look great', text: 'They look great!' },
  },
}

export function scriptedTriage(items: InboxItem[], lang: Lang): InboxItem[] {
  return items.map(m => {
    const s = S[`${m.chatId}:${m.msgId}`]
    if (!s) return m
    return {
      ...m,
      needsYou: s.needsYou,
      gist: s.gist[lang],
      ...(s.translation ? { text: s.translation.text[lang], translated: { from: s.translation.from, original: m.text } } : {}),
    }
  })
}

export const scriptedReplies = (chatId: string, msgId: number) => {
  const s = S[`${chatId}:${msgId}`]
  return s ? { replies: s.replies, replyLang: s.replyLang } : undefined
}

export const scriptedTranscript = (chatId?: string, msgId?: number) =>
  S[`${chatId}:${msgId}`]?.transcript ?? { raw: 'sounds good, talk soon', text: 'Sounds good, talk soon!' }

export const scriptedDigest = (lang: Lang): DigestPoint[] =>
  lang === 'de'
    ? [
        { title: 'Rekord-Zuflüsse in BTC-ETFs', detail: 'Spot-Bitcoin-ETFs hatten die größten Wochenzuflüsse seit März, angeführt von zwei Anbietern.', sources: ['Crypto Daily', 'DeFi Signals'] },
        { title: 'Airdrop-Snapshot am Freitag', detail: 'Snapshot für den DAO-Governance-Token am Freitag 12:00 UTC. Tokens in einer eigenen Wallet halten.', sources: ['Crypto Daily', 'DAO News'] },
        { title: 'Neuer Perp-Markt gelistet', detail: 'Eine große On-Chain-Börse hat einen neuen Perpetual-Markt gelistet; Funding ist positiv.', sources: ['DeFi Signals'] },
      ]
    : [
        { title: 'Record inflows into BTC ETFs', detail: 'Spot bitcoin ETFs saw their largest weekly inflows since March, led by two issuers.', sources: ['Crypto Daily', 'DeFi Signals'] },
        { title: 'Airdrop snapshot on Friday', detail: 'Snapshot for the DAO governance token is Friday 12:00 UTC. Hold tokens in a self-custody wallet.', sources: ['Crypto Daily', 'DAO News'] },
        { title: 'New perp market listed', detail: 'A major on-chain exchange listed a new perpetual market; funding is positive.', sources: ['DeFi Signals'] },
      ]
