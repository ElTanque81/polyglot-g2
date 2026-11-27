import { api, ApiError, setToken, READ_LANGS, type Activity, type ChatInfo, type Settings, type Usage } from './api'
import { getLang, setLang, type Lang } from './i18n'

/**
 * Phone-side page (what the WebView shows inside the Even Realities app):
 * Telegram sign-in with phone + code (Google sign-in does not work in the WebView),
 * picking focus chats and channels, language and reply style.
 */

const T = {
  en: {
    title: 'Polyglot', tagline: 'Telegram in every language, at a glance on Even G2.',
    signInTitle: 'Sign in with Telegram', phone: 'Phone number (with country code)', sendCode: 'Send code',
    code: 'Code from Telegram', password: '2-step verification password', verify: 'Sign in',
    demo: 'Try the demo (no login)', or: 'or',
    codeHint: (app: boolean) => (app ? 'Telegram sent the code to your Telegram app.' : 'Telegram sent the code by SMS.'),
    focusTitle: 'Focus chats', focusHint: 'Only these chats show up on your glasses.',
    channelsTitle: 'Channels for the brief', channelsHint: 'Summarized into 3 points on demand.',
    prefs: 'Preferences', lang: 'Language', style: 'Reply style', translate: 'Translate foreign messages',
    short: 'Short', friendly: 'Friendly', formal: 'Formal',
    save: 'Save', saved: 'Saved. Your glasses are updated.', logout: 'Sign out and delete session',
    signedInAs: (n: string, p: string) => `Signed in as ${n}${p === 'demo' ? ' (demo)' : ''}`,
    privacy: 'Messages are never stored. Only the chats you pick are read. Your Telegram session is encrypted on the Polyglot server; signing out deletes it.',
    regAuto: 'Tone: auto', regFormal: 'Formal', regCasual: 'Casual',
    regHint: 'Tone of replies per chat. Auto reads it from the history (keigo, Sie/du, usted/tú); work and unknown chats default to formal.',
    readOnly: 'Read-only mode', readOnlyHint: 'Polyglot reads and translates, but never sends anything for you.',
    trustTitle: 'Trust', activityTitle: 'What Polyglot did', noActivity: 'Nothing yet.',
    usageTitle: 'This month', usageLine: (u: Usage) => `${u.triaged} messages read · ${u.translated} translated · ${u.replies} reply drafts · ${u.voice} voice replies`,
    costLine: (c: string) => `API cost so far: ${c}`,
    act: { sent: 'Sent a reply to', read: 'Marked read:', muted: 'Muted 1 h:', promise_done: 'Promise done, told', promise_snoozed: 'Promise snoozed:', promise_dropped: 'Promise dropped:', signin: 'Signed in with Telegram', settings: 'Settings changed' } as Record<string, string>,
    selfHost: 'This server is run by whoever set up Polyglot for you. The code is open source, so you can run your own on any computer.',
    readLang: 'Read my messages in', readHint: 'Messages in other languages are translated into this one. Replies go out in the sender\'s language.',
    search: 'Search chats', err: (e: string) => `Error: ${e}`, noTg: 'Telegram login is not configured on this server (TG_API_ID / TG_API_HASH missing in server/.env). Use the demo.',
    sending: 'Asking Telegram for a code…', checking: 'Signing in…', changeNumber: 'Use another number',
    switchAccount: 'Sign out / switch to Telegram', serverDown: 'Cannot reach the Polyglot server. Is start-mac.command running?',
  },
  de: {
    title: 'Polyglot', tagline: 'Telegram in jeder Sprache, auf einen Blick in der Even G2.',
    signInTitle: 'Mit Telegram anmelden', phone: 'Telefonnummer (mit Ländervorwahl)', sendCode: 'Code senden',
    code: 'Code von Telegram', password: 'Passwort der Zwei-Schritt-Bestätigung', verify: 'Anmelden',
    demo: 'Demo ausprobieren (ohne Login)', or: 'oder',
    codeHint: (app: boolean) => (app ? 'Telegram hat den Code in deine Telegram-App geschickt.' : 'Telegram hat den Code per SMS geschickt.'),
    focusTitle: 'Fokus-Chats', focusHint: 'Nur diese Chats erscheinen in der Brille.',
    channelsTitle: 'Kanäle fürs Briefing', channelsHint: 'Auf Wunsch in 3 Punkten zusammengefasst.',
    prefs: 'Einstellungen', lang: 'Sprache', style: 'Antwortstil', translate: 'Fremdsprachige Nachrichten übersetzen',
    short: 'Kurz', friendly: 'Freundlich', formal: 'Förmlich',
    save: 'Speichern', saved: 'Gespeichert. Die Brille ist aktualisiert.', logout: 'Abmelden und Sitzung löschen',
    signedInAs: (n: string, p: string) => `Angemeldet als ${n}${p === 'demo' ? ' (Demo)' : ''}`,
    privacy: 'Nachrichten werden nie gespeichert. Nur die gewählten Chats werden gelesen. Deine Telegram-Sitzung liegt verschlüsselt auf dem Polyglot-Server; Abmelden löscht sie.',
    regAuto: 'Ton: auto', regFormal: 'Förmlich', regCasual: 'Locker',
    regHint: 'Tonfall der Antworten pro Chat. Auto erkennt ihn aus dem Verlauf (Keigo, Sie/du, usted/tú); Arbeit und Unbekannte sind standardmäßig förmlich.',
    readOnly: 'Nur-Lesen-Modus', readOnlyHint: 'Polyglot liest und übersetzt, sendet aber nie etwas in deinem Namen.',
    trustTitle: 'Vertrauen', activityTitle: 'Was Polyglot getan hat', noActivity: 'Noch nichts.',
    usageTitle: 'Dieser Monat', usageLine: (u: Usage) => `${u.triaged} Nachrichten gelesen · ${u.translated} übersetzt · ${u.replies} Antwortentwürfe · ${u.voice} Sprachantworten`,
    costLine: (c: string) => `API-Kosten bisher: ${c}`,
    act: { sent: 'Antwort gesendet an', read: 'Gelesen:', muted: '1 Std stumm:', promise_done: 'Versprechen erledigt, informiert:', promise_snoozed: 'Versprechen verschoben:', promise_dropped: 'Versprechen verworfen:', signin: 'Mit Telegram angemeldet', settings: 'Einstellungen geändert' } as Record<string, string>,
    selfHost: 'Diesen Server betreibt, wer Polyglot für dich eingerichtet hat. Der Code ist Open Source, du kannst also deinen eigenen auf jedem Rechner betreiben.',
    readLang: 'Nachrichten lesen auf', readHint: 'Nachrichten in anderen Sprachen werden hierhin übersetzt. Antworten gehen in der Sprache des Absenders raus.',
    search: 'Chats suchen', err: (e: string) => `Fehler: ${e}`, noTg: 'Telegram-Login ist auf diesem Server nicht eingerichtet (TG_API_ID / TG_API_HASH fehlen in server/.env). Nutze die Demo.',
    sending: 'Telegram schickt dir einen Code…', checking: 'Anmeldung läuft…', changeNumber: 'Andere Nummer verwenden',
    switchAccount: 'Abmelden / zu Telegram wechseln', serverDown: 'Polyglot-Server nicht erreichbar. Läuft start-mac.command?',
  },
}
const L = () => T[getLang()]

/** Language names in their own language. */
const LANG_LABEL: Record<(typeof READ_LANGS)[number], string> = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano', pt: 'Português', nl: 'Nederlands', pl: 'Polski',
  tr: 'Türkçe', ru: 'Русский', uk: 'Українська', zh: '中文', ja: '日本語', ko: '한국어', vi: 'Tiếng Việt', id: 'Bahasa Indonesia',
}

/** Turns Telegram/server error codes into a sentence the user can act on. */
function friendly(code: string): string {
  const de = getLang() === 'de'
  const map: Record<string, [string, string]> = {
    PHONE_NUMBER_INVALID: ['Phone number not valid. Use the full number with country code, e.g. +49 151 2345678.', 'Telefonnummer ungültig. Bitte mit Ländervorwahl eingeben, z. B. +49 151 2345678.'],
    INVALID_PHONE: ['Phone number not valid. Use the full number with country code, e.g. +49 151 2345678.', 'Telefonnummer ungültig. Bitte mit Ländervorwahl eingeben, z. B. +49 151 2345678.'],
    API_ID_INVALID: ['TG_API_ID or TG_API_HASH in server/.env is wrong. Check both values from my.telegram.org.', 'TG_API_ID oder TG_API_HASH in server/.env ist falsch. Bitte beide Werte von my.telegram.org prüfen.'],
    API_ID_PUBLISHED_FLOOD: ['Telegram blocked this api_id. Create a new app on my.telegram.org.', 'Telegram hat diese api_id gesperrt. Lege auf my.telegram.org eine neue App an.'],
    PHONE_CODE_INVALID: ['The code is wrong. Check it in your Telegram app.', 'Der Code ist falsch. Schau in deiner Telegram-App nach.'],
    PHONE_CODE_EXPIRED: ['The code expired. Tap "Use another number" and request a new one.', 'Der Code ist abgelaufen. Tippe auf „Andere Nummer verwenden“ und fordere einen neuen an.'],
    PASSWORD_HASH_INVALID: ['Wrong 2-step verification password.', 'Falsches Passwort der Zwei-Schritt-Bestätigung.'],
    LOGIN_EXPIRED: ['The login timed out. Please start again.', 'Die Anmeldung ist abgelaufen. Bitte neu starten.'],
    TELEGRAM_UNREACHABLE: ['The server cannot reach Telegram. Check the Mac\'s internet connection.', 'Der Server erreicht Telegram nicht. Internetverbindung des Macs prüfen.'],
    TELEGRAM_TIMEOUT: ['Telegram did not answer in time. Try again.', 'Telegram hat nicht rechtzeitig geantwortet. Bitte nochmal versuchen.'],
    TELEGRAM_NOT_CONFIGURED: ['Telegram login is not configured (TG_API_ID / TG_API_HASH missing in server/.env).', 'Telegram-Login nicht eingerichtet (TG_API_ID / TG_API_HASH fehlen in server/.env).'],
    TOO_MANY_ATTEMPTS: ['Too many attempts. Wait 10 minutes.', 'Zu viele Versuche. Bitte 10 Minuten warten.'],
  }
  if (code.startsWith('FLOOD_WAIT')) return de ? 'Telegram verlangt eine Pause. Bitte später nochmal versuchen.' : 'Telegram asks you to wait. Try again later.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(code)) return de ? T.de.serverDown : T.en.serverDown
  const m = map[code]
  return m ? m[de ? 1 : 0] : (de ? `Fehler: ${code}` : `Error: ${code}`)
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export interface PhoneHooks {
  saveToken(token: string): Promise<void>
  saveLang(lang: Lang): Promise<void>
  onChange(): void
}

export class PhonePage {
  private root: HTMLElement
  private loginId = ''
  private viaApp = true
  private step: 'phone' | 'code' | 'password' = 'phone'
  private chats: ChatInfo[] = []
  private settings: Settings | null = null
  private filter = ''
  private usage: Usage | null = null
  private activity: Activity[] = []

  constructor(el: HTMLElement, private hooks: PhoneHooks) { this.root = el }

  async show(signedIn: boolean) {
    if (!signedIn) return this.renderLogin()
    try {
      const [me, chats, usage, activity] = await Promise.all([api.me(), api.chats(), api.usage().catch(() => null), api.activity().catch(() => ({ activity: [] }))])
      this.settings = { ...me.settings, registers: me.settings.registers ?? {}, readOnly: !!me.settings.readOnly }
      this.chats = chats.chats
      this.usage = usage
      this.activity = activity.activity
      if (me.settings.lang !== getLang()) { setLang(me.settings.lang); await this.hooks.saveLang(me.settings.lang) }
      this.renderSettings(me.name, me.provider)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await this.hooks.saveToken(''); return this.renderLogin() }
      this.root.innerHTML = `<p class="err">${esc(friendly(String((e as Error).message)))}</p>`
    }
  }

  private shell(inner: string) {
    this.root.innerHTML = `<header><h1>${L().title}</h1><p class="sub">${L().tagline}</p>
      <div class="lang"><button data-lang="en" class="${getLang() === 'en' ? 'on' : ''}">EN</button><button data-lang="de" class="${getLang() === 'de' ? 'on' : ''}">DE</button></div></header>${inner}
      <p class="privacy">${L().privacy}</p>`
    this.root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach(b => b.onclick = async () => {
      const l = b.dataset.lang as Lang
      setLang(l); await this.hooks.saveLang(l)
      if (this.settings) { await api.saveSettings({ lang: l }).catch(() => {}); this.settings.lang = l }
      this.hooks.onChange()
      this.show(!!this.settings)
    })
  }

  private async renderLogin() {
    this.settings = null
    const h = await api.health().catch(() => null)
    const field =
      this.step === 'phone' ? `<label>${L().phone}<input id="phone" type="tel" placeholder="+49 151 2345678" autocomplete="tel"></label><button id="go" class="primary">${L().sendCode}</button>`
      : this.step === 'code' ? `<p class="hint">${L().codeHint(this.viaApp)}</p><label>${L().code}<input id="code" inputmode="numeric" autocomplete="one-time-code"></label><button id="go" class="primary">${L().verify}</button><button id="back">${L().changeNumber}</button>`
      : `<label>${L().password}<input id="pw" type="password" autocomplete="current-password"></label><button id="go" class="primary">${L().verify}</button><button id="back">${L().changeNumber}</button>`
    this.shell(`<section><h2>${L().signInTitle}</h2>
      ${!h ? `<p class="err">${L().serverDown}</p>` : !h.telegram ? `<p class="err">${L().noTg}</p>` : field}
      <p id="status" class="hint"></p>
      <p id="msg" class="err"></p>
      ${h?.demo !== false ? `<div class="or">${L().or}</div><button id="demo">${L().demo}</button>` : ''}
    </section>`)
    const msg = this.root.querySelector<HTMLElement>('#msg')!
    const go = this.root.querySelector<HTMLButtonElement>('#go')
    const status = this.root.querySelector<HTMLElement>('#status')!
    const fail = (e: unknown) => { status.textContent = ''; msg.textContent = friendly((e as Error).message ?? String(e)); if (go) go.disabled = false }
    const back = this.root.querySelector<HTMLButtonElement>('#back')
    if (back) back.onclick = () => { this.step = 'phone'; this.loginId = ''; this.renderLogin() }
    if (go) go.onclick = async () => {
      go.disabled = true
      msg.textContent = ''
      status.textContent = this.step === 'phone' ? L().sending : L().checking
      try {
        if (this.step === 'phone') {
          const phone = (this.root.querySelector<HTMLInputElement>('#phone')!).value
          const r = await api.loginStart(phone)
          this.loginId = r.loginId; this.viaApp = r.viaApp; this.step = 'code'
          return this.renderLogin()
        }
        const code = this.step === 'code' ? this.root.querySelector<HTMLInputElement>('#code')!.value : (this.lastCode ?? '')
        if (this.step === 'code') this.lastCode = code
        const pw = this.step === 'password' ? this.root.querySelector<HTMLInputElement>('#pw')!.value : undefined
        const r = await api.loginVerify(this.loginId, code, pw)
        if (r.needPassword) { this.step = 'password'; return this.renderLogin() }
        if (!r.ok || !r.token) return fail(new Error(r.error ?? 'LOGIN_FAILED'))
        await this.signedIn(r.token)
      } catch (e) { fail(e) }
    }
    const demo = this.root.querySelector<HTMLButtonElement>('#demo')
    if (demo) demo.onclick = async () => {
      demo.disabled = true
      try { await this.signedIn((await api.demo()).token) } catch (e) { fail(e); demo.disabled = false }
    }
  }
  private lastCode?: string

  private async signedIn(token: string) {
    setToken(token)
    await this.hooks.saveToken(token)
    await api.saveSettings({ lang: getLang(), readLang: getLang() }).catch(() => {})
    this.step = 'phone'
    this.hooks.onChange()
    await this.show(true)
  }

  private renderSettings(name: string, provider: string) {
    const s = this.settings!
    const people = this.chats.filter(c => c.kind !== 'channel')
    const channels = this.chats.filter(c => c.kind === 'channel')
    const match = (c: ChatInfo) => !this.filter || c.title.toLowerCase().includes(this.filter.toLowerCase())
    const reg = (c: ChatInfo) => {
      const v = s.registers[c.id] ?? 'auto'
      return `<select class="reg" data-reg="${esc(c.id)}">${(['auto', 'formal', 'casual'] as const).map(o => `<option value="${o}" ${v === o ? 'selected' : ''}>${o === 'auto' ? L().regAuto : o === 'formal' ? L().regFormal : L().regCasual}</option>`).join('')}</select>`
    }
    const row = (c: ChatInfo, group: 'f' | 'c', on: boolean) =>
      `<div class="chat"><label class="pick"><input type="checkbox" data-g="${group}" value="${esc(c.id)}" ${on ? 'checked' : ''}><span>${esc(c.title)}</span>${c.unread ? `<em>${c.unread}</em>` : ''}</label>${group === 'f' && on ? reg(c) : ''}</div>`
    this.shell(`<p class="who">${esc(L().signedInAs(name, provider))}</p>
      <button id="switch">${L().switchAccount}</button>
      <input id="filter" class="search" placeholder="${L().search}" value="${esc(this.filter)}">
      <section><h2>${L().focusTitle}</h2><p class="hint">${L().focusHint} ${L().regHint}</p>
        ${people.filter(match).slice(0, 80).map(c => row(c, 'f', s.focusChats.includes(c.id))).join('')}</section>
      <section><h2>${L().channelsTitle}</h2><p class="hint">${L().channelsHint}</p>
        ${channels.filter(match).slice(0, 60).map(c => row(c, 'c', s.channels.includes(c.id))).join('')}</section>
      <section><h2>${L().prefs}</h2>
        <label>${L().readLang}<select id="readLang">${READ_LANGS.map(v => `<option value="${v}" ${s.readLang === v ? 'selected' : ''}>${LANG_LABEL[v]}</option>`).join('')}</select></label>
        <p class="hint">${L().readHint}</p>
        <label>${L().style}<select id="style">${(['short', 'friendly', 'formal'] as const).map(v => `<option value="${v}" ${s.style === v ? 'selected' : ''}>${L()[v]}</option>`).join('')}</select></label>
        <label class="chat"><input type="checkbox" id="translate" ${s.translate ? 'checked' : ''}><span>${L().translate}</span></label>
      </section>
      <section><h2>${L().trustTitle}</h2>
        <label class="chat"><input type="checkbox" id="readOnly" ${s.readOnly ? 'checked' : ''}><span>${L().readOnly}</span></label>
        <p class="hint">${L().readOnlyHint}</p>
        <h2 style="margin-top:12px">${L().activityTitle}</h2>
        ${this.activity.length ? `<ul class="log">${this.activity.slice(0, 15).map(a => `<li><time>${new Date(a.t * 1000).toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time> ${esc(L().act[a.kind] ?? a.kind)} ${esc(a.chat ?? '')}${a.lang ? ` (${esc(a.lang.toUpperCase())})` : ''}</li>`).join('')}</ul>` : `<p class="hint">${L().noActivity}</p>`}
        <p class="hint">${L().selfHost}</p>
      </section>
      ${this.usage ? `<section><h2>${L().usageTitle}</h2><p class="hint">${L().usageLine(this.usage)}</p><p class="hint">${L().costLine(`$${this.usage.costUsd.toFixed(this.usage.costUsd < 1 ? 4 : 2)}`)}</p></section>` : ''}
      <button id="save" class="primary">${L().save}</button><p id="msg" class="ok"></p>
      <button id="logout" class="danger">${L().logout}</button>`)

    this.root.querySelectorAll<HTMLInputElement>('input[data-g="f"]').forEach(b => b.onchange = () => { this.collect(); this.renderSettings(name, provider) })
    const filter = this.root.querySelector<HTMLInputElement>('#filter')!
    filter.oninput = () => { this.collect(); this.filter = filter.value; this.renderSettings(name, provider); this.root.querySelector<HTMLInputElement>('#filter')!.focus() }
    this.root.querySelector<HTMLButtonElement>('#save')!.onclick = async () => {
      this.collect()
      const msg = this.root.querySelector<HTMLElement>('#msg')!
      try {
        this.settings = (await api.saveSettings(this.settings!)).settings
        msg.textContent = L().saved
        this.hooks.onChange()
      } catch (e) { msg.textContent = L().err((e as Error).message) }
    }
    const signOut = async () => {
      await api.logout().catch(() => {})
      setToken('')
      await this.hooks.saveToken('')
      this.hooks.onChange()
      this.renderLogin()
    }
    this.root.querySelector<HTMLButtonElement>('#logout')!.onclick = signOut
    this.root.querySelector<HTMLButtonElement>('#switch')!.onclick = signOut
  }

  /** Reads the visible checkboxes into settings (keeps hidden selections). */
  private collect() {
    const s = this.settings!
    const boxes = [...this.root.querySelectorAll<HTMLInputElement>('input[data-g]')]
    for (const b of boxes) {
      const list = b.dataset.g === 'f' ? s.focusChats : s.channels
      const has = list.includes(b.value)
      if (b.checked && !has) list.push(b.value)
      if (!b.checked && has) list.splice(list.indexOf(b.value), 1)
    }
    for (const sel of this.root.querySelectorAll<HTMLSelectElement>('select[data-reg]')) {
      const id = sel.dataset.reg!
      if (sel.value === 'auto') delete s.registers[id]
      else s.registers[id] = sel.value as 'formal' | 'casual'
    }
    const ro = this.root.querySelector<HTMLInputElement>('#readOnly')
    if (ro) s.readOnly = ro.checked
    const rl = this.root.querySelector<HTMLSelectElement>('#readLang')
    if (rl) s.readLang = rl.value as Settings['readLang']
    const style = this.root.querySelector<HTMLSelectElement>('#style')
    if (style) s.style = style.value as Settings['style']
    const tr = this.root.querySelector<HTMLInputElement>('#translate')
    if (tr) s.translate = tr.checked
  }
}
