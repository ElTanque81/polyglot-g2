import { api, ApiError, setToken, type ChatInfo, type Settings } from './api'
import { getLang, setLang, type Lang } from './i18n'

/**
 * Phone-side page (what the WebView shows inside the Even Realities app):
 * Telegram sign-in with phone + code (Google sign-in does not work in the WebView),
 * picking focus chats and channels, language and reply style.
 */

const T = {
  en: {
    title: 'TeleGlance', tagline: 'Your Telegram, at a glance on Even G2.',
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
    privacy: 'Messages are never stored. Only the chats you pick are read. Your Telegram session is encrypted on the TeleGlance server; signing out deletes it.',
    search: 'Search chats', err: (e: string) => `Error: ${e}`, noTg: 'Telegram login is not configured on this server. Use the demo.',
  },
  de: {
    title: 'TeleGlance', tagline: 'Dein Telegram, auf einen Blick in der Even G2.',
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
    privacy: 'Nachrichten werden nie gespeichert. Nur die gewählten Chats werden gelesen. Deine Telegram-Sitzung liegt verschlüsselt auf dem TeleGlance-Server; Abmelden löscht sie.',
    search: 'Chats suchen', err: (e: string) => `Fehler: ${e}`, noTg: 'Telegram-Login ist auf diesem Server nicht eingerichtet. Nutze die Demo.',
  },
}
const L = () => T[getLang()]

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

  constructor(el: HTMLElement, private hooks: PhoneHooks) { this.root = el }

  async show(signedIn: boolean) {
    if (!signedIn) return this.renderLogin()
    try {
      const [me, chats] = await Promise.all([api.me(), api.chats()])
      this.settings = me.settings
      this.chats = chats.chats
      if (me.settings.lang !== getLang()) { setLang(me.settings.lang); await this.hooks.saveLang(me.settings.lang) }
      this.renderSettings(me.name, me.provider)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await this.hooks.saveToken(''); return this.renderLogin() }
      this.root.innerHTML = `<p class="err">${esc(L().err(String((e as Error).message)))}</p>`
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
      : this.step === 'code' ? `<p class="hint">${L().codeHint(this.viaApp)}</p><label>${L().code}<input id="code" inputmode="numeric" autocomplete="one-time-code"></label><button id="go" class="primary">${L().verify}</button>`
      : `<label>${L().password}<input id="pw" type="password" autocomplete="current-password"></label><button id="go" class="primary">${L().verify}</button>`
    this.shell(`<section><h2>${L().signInTitle}</h2>
      ${h && !h.telegram ? `<p class="hint">${L().noTg}</p>` : field}
      <p id="msg" class="err"></p>
      ${h?.demo !== false ? `<div class="or">${L().or}</div><button id="demo">${L().demo}</button>` : ''}
    </section>`)
    const msg = this.root.querySelector<HTMLElement>('#msg')!
    const go = this.root.querySelector<HTMLButtonElement>('#go')
    const fail = (e: unknown) => { msg.textContent = L().err((e as Error).message ?? String(e)); if (go) go.disabled = false }
    if (go) go.onclick = async () => {
      go.disabled = true
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
    await api.saveSettings({ lang: getLang() }).catch(() => {})
    this.step = 'phone'
    this.hooks.onChange()
    await this.show(true)
  }

  private renderSettings(name: string, provider: string) {
    const s = this.settings!
    const people = this.chats.filter(c => c.kind !== 'channel')
    const channels = this.chats.filter(c => c.kind === 'channel')
    const match = (c: ChatInfo) => !this.filter || c.title.toLowerCase().includes(this.filter.toLowerCase())
    const row = (c: ChatInfo, group: 'f' | 'c', on: boolean) =>
      `<label class="chat"><input type="checkbox" data-g="${group}" value="${esc(c.id)}" ${on ? 'checked' : ''}><span>${esc(c.title)}</span>${c.unread ? `<em>${c.unread}</em>` : ''}</label>`
    this.shell(`<p class="who">${esc(L().signedInAs(name, provider))}</p>
      <input id="filter" class="search" placeholder="${L().search}" value="${esc(this.filter)}">
      <section><h2>${L().focusTitle}</h2><p class="hint">${L().focusHint}</p>
        ${people.filter(match).slice(0, 80).map(c => row(c, 'f', s.focusChats.includes(c.id))).join('')}</section>
      <section><h2>${L().channelsTitle}</h2><p class="hint">${L().channelsHint}</p>
        ${channels.filter(match).slice(0, 60).map(c => row(c, 'c', s.channels.includes(c.id))).join('')}</section>
      <section><h2>${L().prefs}</h2>
        <label>${L().style}<select id="style">${(['short', 'friendly', 'formal'] as const).map(v => `<option value="${v}" ${s.style === v ? 'selected' : ''}>${L()[v]}</option>`).join('')}</select></label>
        <label class="chat"><input type="checkbox" id="translate" ${s.translate ? 'checked' : ''}><span>${L().translate}</span></label>
      </section>
      <button id="save" class="primary">${L().save}</button><p id="msg" class="ok"></p>
      <button id="logout" class="danger">${L().logout}</button>`)

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
    this.root.querySelector<HTMLButtonElement>('#logout')!.onclick = async () => {
      await api.logout().catch(() => {})
      setToken('')
      await this.hooks.saveToken('')
      this.hooks.onChange()
      this.renderLogin()
    }
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
    const style = this.root.querySelector<HTMLSelectElement>('#style')
    if (style) s.style = style.value as Settings['style']
    const tr = this.root.querySelector<HTMLInputElement>('#translate')
    if (tr) s.translate = tr.checked
  }
}
