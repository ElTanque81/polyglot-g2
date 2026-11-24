import type { InboxItem, OutgoingMsg, ReadLang } from '../types.js'
import type { DigestPoint, FoundPromise, Reply } from '../ai.js'

/**
 * Scripted "AI" output for the keyless demo account, used only when no LLM key
 * is set. With a key, the demo chats go through the LLM like real ones.
 * Readers other than German get the English script.
 */

type L2 = { en: string; de: string }
const pick = (l: ReadLang, v: L2) => (l === 'de' ? v.de : v.en)

interface Script {
  needsYou: boolean
  gist: L2
  translation?: { from: string; text: L2 }
  replyLang: string
  replies: { text: string; meaning: L2 }[]
  transcript: { raw: string; text: string; meaning: L2 }
}

const same = (t: string, de: string): { text: string; meaning: L2 } => ({ text: t, meaning: { en: t, de } })

const S: Record<string, Script> = {
  '1001:4': {
    needsYou: true,
    gist: { en: 'Needs the deck before 3pm', de: 'Braucht das Deck vor 15 Uhr' },
    replyLang: 'en',
    replies: [
      same('Sure, sending it in 10 minutes', 'Klar, schicke es in 10 Minuten'),
      same('On it, you will have it by 2:30', 'Mache ich, du hast es bis 14:30'),
      same('Can I send it right after lunch?', 'Kann ich es nach dem Mittag schicken?'),
    ],
    transcript: { raw: 'sending it at two I am adding the Q4 numbers', text: 'Sending it at 2, adding the Q4 numbers.', meaning: { en: 'Sending it at 2, adding the Q4 numbers.', de: 'Schicke es um 14 Uhr, mit den Q4-Zahlen.' } },
  },
  '1001:6': {
    needsYou: true,
    gist: { en: 'Asks you to join the 3:30 call', de: 'Fragt, ob du um 15:30 dabei bist' },
    replyLang: 'en',
    replies: [
      same('Yes, I will join at 3:30', 'Ja, ich bin um 15:30 dabei'),
      same('I can join for the first 15 min', 'Ich kann die ersten 15 Min dabei sein'),
      same('Sorry, I have a clash at 3:30', 'Sorry, um 15:30 habe ich einen Termin'),
    ],
    transcript: { raw: 'yes I will be there send me the link', text: 'Yes, I will be there. Send me the link?', meaning: { en: 'Yes, I will be there. Send me the link?', de: 'Ja, ich bin dabei. Schickst du mir den Link?' } },
  },
  '1002:1': {
    needsYou: true,
    gist: { en: 'Confirm tomorrow 10am at the office', de: 'Morgen 10 Uhr im Büro bestätigen' },
    translation: { from: 'es', text: { en: 'Are we still on for tomorrow at 10 at the office?', de: 'Bleibt es bei morgen um 10 im Büro?' } },
    replyLang: 'es',
    replies: [
      { text: 'Sí, nos vemos a las 10', meaning: { en: 'Yes, see you at 10', de: 'Ja, wir sehen uns um 10' } },
      { text: '¿Podemos pasarlo a las 11?', meaning: { en: 'Can we move it to 11?', de: 'Können wir auf 11 verschieben?' } },
      { text: 'Mañana no puedo, ¿el jueves?', meaning: { en: "Can't tomorrow, Thursday?", de: 'Morgen geht nicht, Donnerstag?' } },
    ],
    transcript: { raw: 'yes see you at ten I will bring coffee', text: 'Sí, nos vemos a las 10. Llevo café.', meaning: { en: 'Yes, see you at 10. I will bring coffee.', de: 'Ja, bis um 10. Ich bringe Kaffee mit.' } },
  },
  '1005:1': {
    needsYou: true,
    gist: { en: 'Confirm Thursday dinner, Dubai Marina', de: 'Abendessen Do. in Dubai Marina bestätigen' },
    translation: { from: 'ar', text: { en: 'Hi! Are we still on for dinner on Thursday at Dubai Marina?', de: 'Hallo! Bleibt es beim Abendessen am Donnerstag in Dubai Marina?' } },
    replyLang: 'ar',
    replies: [
      { text: 'نعم، أراك يوم الخميس!', meaning: { en: 'Yes, see you Thursday!', de: 'Ja, bis Donnerstag!' } },
      { text: 'نعم، هل الساعة الثامنة مناسبة؟', meaning: { en: 'Yes, does 8pm work?', de: 'Ja, passt 20 Uhr?' } },
      { text: 'آسف، هل يمكننا التأجيل للجمعة؟', meaning: { en: 'Sorry, can we move to Friday?', de: 'Sorry, ginge auch Freitag?' } },
    ],
    transcript: { raw: 'yes Thursday works, I will book a table for eight', text: 'نعم، الخميس مناسب. سأحجز طاولة الساعة الثامنة.', meaning: { en: 'Yes, Thursday works. I will book a table for 8pm.', de: 'Ja, Donnerstag passt. Ich reserviere für 20 Uhr.' } },
  },
  '1003:4': {
    needsYou: false,
    gist: { en: 'Family asks who brings dessert Sunday', de: 'Wer bringt Sonntag den Nachtisch?' },
    replyLang: 'en',
    replies: [
      same('I will bring dessert', 'Ich bringe den Nachtisch mit'),
      same('I can bring drinks instead', 'Ich bringe lieber Getränke'),
      same('Not sure yet, will let you know', 'Weiß noch nicht, sage Bescheid'),
    ],
    transcript: { raw: 'I will bake a cake', text: 'I will bake a cake!', meaning: { en: 'I will bake a cake!', de: 'Ich backe einen Kuchen!' } },
  },
  '1003:3': {
    needsYou: false,
    gist: { en: 'New weekend photos in the album', de: 'Neue Wochenend-Fotos im Album' },
    replyLang: 'en',
    replies: [same('Great photos, thanks!', 'Tolle Fotos, danke!'), same('Love them', 'Super schön'), same('Will look tonight', 'Schaue ich heute Abend an')],
    transcript: { raw: 'they look great', text: 'They look great!', meaning: { en: 'They look great!', de: 'Sehen toll aus!' } },
  },
}

export function scriptedTriage(items: InboxItem[], lang: ReadLang): InboxItem[] {
  return items.map(m => {
    const s = S[`${m.chatId}:${m.msgId}`]
    if (!s) return m
    return {
      ...m,
      needsYou: s.needsYou,
      gist: pick(lang, s.gist),
      ...(s.translation ? { text: pick(lang, s.translation.text), translated: { from: s.translation.from, original: m.text } } : {}),
    }
  })
}

export const scriptedReplies = (chatId: string, msgId: number, lang: ReadLang): { replies: Reply[]; replyLang: string } | undefined => {
  const s = S[`${chatId}:${msgId}`]
  return s ? { replyLang: s.replyLang, replies: s.replies.map(r => ({ text: r.text, meaning: pick(lang, r.meaning) })) } : undefined
}

export const scriptedTranscript = (chatId: string | undefined, msgId: number | undefined, lang: ReadLang) => {
  const s = S[`${chatId}:${msgId}`]?.transcript
  return s ? { raw: s.raw, text: s.text, meaning: pick(lang, s.meaning) } : { raw: 'sounds good, talk soon', text: 'Sounds good, talk soon!', meaning: 'Sounds good, talk soon!' }
}

/** Scripted promise detection on the demo's own messages. */
export function scriptedPromises(msgs: OutgoingMsg[], lang: ReadLang, now: Date): FoundPromise[] {
  const at = (days: number, h: number, m = 0) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d.toISOString() }
  const out: FoundPromise[] = []
  msgs.forEach((m, i) => {
    const t = m.text.toLowerCase()
    if (m.chatId === '1003' && t.includes('call grandma')) out.push({ i, what: pick(lang, { en: 'Call grandma about Sunday', de: 'Oma wegen Sonntag anrufen' }), due: at(0, 20), lang: 'en', doneText: 'Called grandma, Sunday is on!', doneMeaning: pick(lang, { en: 'Called grandma, Sunday is on!', de: 'Oma angerufen, Sonntag steht!' }) })
    if (m.chatId === '1004' && t.includes('hotel link')) out.push({ i, what: pick(lang, { en: 'Send Lena the hotel link', de: 'Lena den Hotel-Link schicken' }), due: at(1, 9), lang: 'en', doneText: 'Here is the hotel link!', doneMeaning: pick(lang, { en: 'Here is the hotel link!', de: 'Hier ist der Hotel-Link!' }) })
    if (m.chatId === '1001' && /send|sending/.test(t)) out.push({ i, what: pick(lang, { en: 'Send Anna the deck', de: 'Anna das Deck schicken' }), due: at(0, 14), lang: 'en', doneText: 'Deck is in your inbox!', doneMeaning: pick(lang, { en: 'Deck is in your inbox!', de: 'Deck ist in deinem Postfach!' }) })
    if (m.chatId === '1005' && /حجز|سأحجز/.test(m.text)) out.push({ i, what: pick(lang, { en: 'Book a table for Thursday 8pm', de: 'Tisch für Do. 20 Uhr reservieren' }), due: at(0, 18), lang: 'ar', doneText: 'تم حجز الطاولة للخميس!', doneMeaning: pick(lang, { en: 'Table booked for Thursday!', de: 'Tisch für Donnerstag reserviert!' }) })
  })
  return out
}

export const scriptedDigest = (lang: ReadLang): DigestPoint[] =>
  lang === 'de'
    ? [
        { title: 'Rekord-Zuflüsse in BTC-ETFs', detail: 'Spot-Bitcoin-ETFs hatten die größten Wochenzuflüsse seit März, angeführt von zwei Anbietern. Auch der russische Kanal meldet es.', sources: ['Crypto Daily', 'DeFi Signals', 'Крипто Новости'] },
        { title: 'Airdrop-Snapshot am Freitag', detail: 'Snapshot für den DAO-Governance-Token am Freitag 12:00 UTC. Tokens in einer eigenen Wallet halten.', sources: ['Crypto Daily', 'DAO News', 'Крипто Новости'] },
        { title: 'Neuer Perp-Markt gelistet', detail: 'Eine große On-Chain-Börse hat einen neuen Perpetual-Markt gelistet; Funding ist positiv.', sources: ['DeFi Signals'] },
      ]
    : [
        { title: 'Record inflows into BTC ETFs', detail: 'Spot bitcoin ETFs saw their largest weekly inflows since March, led by two issuers. The Russian channel reports the same.', sources: ['Crypto Daily', 'DeFi Signals', 'Крипто Новости'] },
        { title: 'Airdrop snapshot on Friday', detail: 'Snapshot for the DAO governance token is Friday 12:00 UTC. Hold tokens in a self-custody wallet.', sources: ['Crypto Daily', 'DAO News', 'Крипто Новости'] },
        { title: 'New perp market listed', detail: 'A major on-chain exchange listed a new perpetual market; funding is positive.', sources: ['DeFi Signals'] },
      ]
