import { api, ApiError, type Commitment, type DigestPoint, type InboxItem, type Reply } from './api'
import { Glasses, DIM, BRIGHT, sanitize, clip, clipW, renderable, type Gesture, type Screen } from './glasses'
import { t, getLang, langName } from './i18n'

/**
 * Polyglot on the glasses: one state machine, one screen at a time.
 * Read any language → act in seconds: tap for replies written in the sender's
 * language (with their meaning in yours), hold to answer by voice, and let
 * Polyglot remind you of what you promised. Every send waits 5 s for undo.
 */

type Mode = 'signin' | 'loading' | 'focus' | 'empty' | 'replies' | 'voice' | 'sending' | 'digest' | 'promises' | 'promise'

/** What a pending send does once the undo window has passed. */
type Pending =
  | { kind: 'reply'; text: string; meaning: string; lang: string; item: InboxItem }
  | { kind: 'promise'; c: Commitment }

const POLL_MS = 15_000
const UNDO_S = 5
const MAX_REC_MS = 30_000

export class PolyglotApp {
  private mode: Mode = 'loading'
  private items: InboxItem[] = []
  private idx = 0
  private needYou = 0
  private promiseCount = 0
  private replies: Reply[] = []
  private replyLang = 'en'
  private replyRegister: 'formal' | 'casual' | '' = ''
  private draft: Reply = { text: '', meaning: '' }
  private voice: 'idle' | 'rec' | 'busy' | 'done' = 'idle'
  private chunks: Uint8Array[] = []
  private recTimer = 0
  private pending: Pending | null = null
  private sendTimer = 0
  private sendLeft = 0
  private digestPoints: DigestPoint[] = []
  private digestHead = ''
  private digestIdx = 0
  private promiseList: Commitment[] = []
  private promiseSel: Commitment | null = null
  private promisesLoaded = false
  private toast = ''
  private toastTimer = 0
  private pollTimer = 0

  constructor(private g: Glasses, private signedIn: () => boolean, private readLang: () => string) {
    this.setMenu()
    g.onGesture(ev => this.onGesture(ev).catch(err => this.fail(err)))
  }

  private setMenu() {
    this.g.setMenu([
      { itemName: t().menuPromises, itemID: 4 },
      { itemName: t().menuBrief, itemID: 1 },
      { itemName: t().menuReadAll, itemID: 2 },
      { itemName: t().menuRefresh, itemID: 3 },
    ])
  }

  // ------------------------------------------------------------ lifecycle

  async start() {
    this.setMenu()
    await this.render()
    if (!this.signedIn()) { this.mode = 'signin'; return this.render() }
    await this.refresh(true).catch(e => this.fail(e))
    this.scanPromises()
    clearInterval(this.pollTimer)
    this.pollTimer = window.setInterval(() => {
      if (this.mode === 'focus' || this.mode === 'empty') this.refresh(false).catch(e => this.fail(e))
    }, POLL_MS)
  }

  /** Called by the phone page after sign-in or settings changes. */
  async reload() {
    this.mode = 'loading'
    this.idx = 0
    await this.start()
  }

  private async refresh(resetIdx: boolean) {
    const cur = this.items[this.idx]
    const r = await api.inbox()
    this.items = r.items
    this.needYou = r.needYou
    this.promiseCount = r.promises
    if (resetIdx || !cur) this.idx = 0
    else {
      const k = this.items.findIndex(i => i.chatId === cur.chatId && i.msgId === cur.msgId)
      this.idx = k >= 0 ? k : Math.min(this.idx, Math.max(0, this.items.length - 1))
    }
    if (this.mode === 'loading' || this.mode === 'focus' || this.mode === 'empty') {
      this.mode = this.items.length ? 'focus' : 'empty'
    }
    await this.render()
  }

  /** Looks for new promises in the user's own messages (in the background). */
  private scanPromises() {
    api.promises()
      .then(r => { this.promiseList = r.promises; this.promiseCount = r.promises.length; this.promisesLoaded = true; return this.render() })
      .catch(e => console.warn('[Polyglot] promises', e))
  }

  private fail(err: unknown) {
    console.error('[Polyglot]', err)
    if (err instanceof ApiError && err.status === 401) { this.mode = 'signin'; this.render(); return }
    if (err instanceof ApiError && err.message === 'READ_ONLY') {
      clearInterval(this.sendTimer)
      this.pending = null
      if (this.mode === 'sending') this.mode = this.items.length ? 'focus' : 'empty'
      this.flash(t().readOnlyOn, 3000)
      return
    }
    this.flash(t().error)
  }

  private flash(msg: string, ms = 2200) {
    this.toast = msg
    clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => { this.toast = ''; this.render() }, ms)
    this.render()
  }

  // -------------------------------------------------------------- input

  private async onGesture(ev: Gesture) {
    if (ev.kind === 'audio') { if (this.voice === 'rec' && !ev.other) this.chunks.push(ev.pcm); return }
    if (ev.kind === 'foreground') return
    if (ev.kind === 'menu') return this.onMenu(ev.id)

    switch (this.mode) {
      case 'signin':
      case 'loading':
        if (ev.kind === 'double') return void this.g.exit()
        if (ev.kind === 'tap' && this.signedIn()) return this.reload()
        return

      case 'empty':
        if (ev.kind === 'double') return void this.g.exit()
        if (ev.kind === 'tap') return this.promiseCount ? this.openPromises() : this.openDigest()
        if (ev.kind === 'down') return this.openDigest()
        if (ev.kind === 'up') return this.refresh(true)
        return

      case 'focus':
        if (ev.kind === 'double') return void this.g.exit()
        if (ev.kind === 'down') { this.idx = Math.min(this.idx + 1, this.items.length - 1); return this.render() }
        if (ev.kind === 'up') { this.idx = Math.max(this.idx - 1, 0); return this.render() }
        if (ev.kind === 'tap') return this.openReplies()
        if (ev.kind === 'longStart') { this.mode = 'voice'; this.replyLang = this.cur()?.translated?.from ?? this.readLang(); return this.startRec() }
        return

      case 'replies':
        if (ev.kind === 'double') return this.backToFocus()
        if (ev.kind === 'listTap') return this.onReplyPick(ev.index)
        if (ev.kind === 'longStart') { this.mode = 'voice'; return this.startRec() }
        return

      case 'voice':
        if (ev.kind === 'double') { await this.stopRec(true); return this.backToFocus() }
        if (ev.kind === 'longStart') return this.startRec()
        if (ev.kind === 'longEnd') return this.stopRec(false)
        if (ev.kind === 'tap') {
          if (this.voice === 'idle') return this.startRec()
          if (this.voice === 'rec') return this.stopRec(false)
          if (this.voice === 'done' && this.draft.text) return this.sendReply(this.draft)
        }
        return

      case 'sending':
        if (ev.kind === 'tap' || ev.kind === 'double') return this.undoSend()
        return

      case 'digest':
        if (ev.kind === 'down') { this.digestIdx = Math.min(this.digestIdx + 1, Math.max(0, this.digestPoints.length - 1)); return this.render() }
        if (ev.kind === 'up') { this.digestIdx = Math.max(this.digestIdx - 1, 0); return this.render() }
        if (ev.kind === 'tap' || ev.kind === 'double') return this.backToFocus()
        return

      case 'promises':
        if (ev.kind === 'double') return this.backToFocus()
        if (ev.kind === 'listTap') {
          const c = this.promiseList[ev.index]
          if (!c) return
          this.promiseSel = c
          this.mode = 'promise'
          return this.render()
        }
        if (ev.kind === 'tap' && this.promiseList.length === 0) return this.backToFocus()
        return

      case 'promise':
        if (ev.kind === 'double') { this.mode = 'promises'; return this.render() }
        if (ev.kind === 'listTap') return this.onPromiseAction(ev.index)
        return
    }
  }

  private async onMenu(id: number) {
    if (this.mode === 'sending' || this.mode === 'voice') return
    if (id === 1) return this.openDigest()
    if (id === 2) { await api.readAll(); this.flash(t().readAllDone); return this.refresh(true) }
    if (id === 3) { this.scanPromises(); return this.refresh(false) }
    if (id === 4) return this.openPromises()
  }

  private cur(): InboxItem | undefined { return this.items[this.idx] }

  private async backToFocus() {
    this.mode = this.items.length ? 'focus' : 'empty'
    this.voice = 'idle'
    await this.render()
    this.refresh(false).catch(e => this.fail(e))
  }

  // ------------------------------------------------------------ replies

  private async openReplies() {
    const it = this.cur()
    if (!it) return
    this.mode = 'replies'
    this.replies = []
    this.replyRegister = ''
    this.replyLang = it.translated?.from ?? this.readLang()
    await this.render() // shows "drafting…" on the reply page
    const r = await api.replies(it.chatId, it.msgId)
    if (this.mode !== 'replies') return
    this.replies = r.replies
    this.replyLang = r.replyLang
    this.replyRegister = r.register ?? ''
    await this.render()
  }

  private async onReplyPick(i: number) {
    const it = this.cur()
    if (!it) return
    const n = this.replies.length
    if (n === 0) return // still drafting
    if (i < n) return this.sendReply(this.replies[i])
    if (i === n) { this.mode = 'voice'; this.voice = 'idle'; this.draft = { text: '', meaning: '' }; return this.render() }
    if (i === n + 1) { await api.read(it.chatId, it.msgId); this.dropChat(it.chatId); this.flash(t().markedRead); return this.backToFocus() }
    if (i === n + 2) { await api.mute(it.chatId, 1); this.dropChat(it.chatId); this.flash(t().muted); return this.backToFocus() }
  }

  private dropChat(chatId: string) {
    this.items = this.items.filter(i => i.chatId !== chatId)
    this.needYou = this.items.filter(i => i.needsYou).length
    this.idx = Math.min(this.idx, Math.max(0, this.items.length - 1))
  }

  // -------------------------------------------------------------- voice

  private async startRec() {
    this.chunks = []
    this.draft = { text: '', meaning: '' }
    this.voice = 'rec'
    await this.g.audio(true)
    clearTimeout(this.recTimer)
    this.recTimer = window.setTimeout(() => this.stopRec(false), MAX_REC_MS)
    await this.render()
  }

  private async stopRec(discard: boolean) {
    if (this.voice !== 'rec') return
    clearTimeout(this.recTimer)
    await this.g.audio(false)
    if (discard) { this.voice = 'idle'; return }
    this.voice = 'busy'
    await this.render()
    const total = this.chunks.reduce((s, c) => s + c.length, 0)
    const pcm = new Uint8Array(total)
    let o = 0
    for (const c of this.chunks) { pcm.set(c, o); o += c.length }
    const it = this.cur()
    const r = await api.stt(pcm, { chatId: it?.chatId, msgId: it?.msgId, lang: this.replyLang, register: this.replyRegister || undefined })
    if (this.mode !== 'voice') return
    this.draft = { text: r.text, meaning: r.meaning || r.text }
    this.voice = r.text ? 'done' : 'idle'
    if (!r.text) this.flash(t().noVoice)
    await this.render()
  }

  // ------------------------------------------------------------ sending

  private sendReply(r: Reply) {
    const it = this.cur()
    if (!it) return
    return this.beginSend({ kind: 'reply', text: r.text, meaning: r.meaning || r.text, lang: this.replyLang, item: it })
  }

  private beginSend(p: Pending) {
    this.pending = p
    this.mode = 'sending'
    this.sendLeft = UNDO_S
    clearInterval(this.sendTimer)
    this.sendTimer = window.setInterval(() => this.tickSend().catch(e => this.fail(e)), 1000)
    return this.render()
  }

  private async tickSend() {
    this.sendLeft -= 1
    if (this.sendLeft > 0) return this.render()
    clearInterval(this.sendTimer)
    const p = this.pending
    this.pending = null
    if (!p) return this.backToFocus()
    if (p.kind === 'reply') {
      const it = p.item
      await api.send(it.chatId, p.text, it.kind === 'group' ? it.msgId : undefined, p.lang)
      this.dropChat(it.chatId)
      this.mode = this.items.length ? 'focus' : 'empty'
      this.flash(t().sent(it.sender || it.chatTitle), 2500)
      this.refresh(false).catch(e => this.fail(e))
      window.setTimeout(() => this.scanPromises(), 1500) // the reply may contain a new promise
    } else {
      await api.promiseDone(p.c.key)
      this.promiseList = this.promiseList.filter(c => c.key !== p.c.key)
      this.promiseCount = this.promiseList.length
      this.mode = 'promises'
      this.flash(t().doneSent(p.c.chatTitle), 2500)
    }
  }

  private undoSend() {
    clearInterval(this.sendTimer)
    const p = this.pending
    this.pending = null
    this.mode = p?.kind === 'promise' ? 'promise' : 'focus'
    this.flash(t().undone)
  }

  // ------------------------------------------------------------ promises

  private async openPromises() {
    this.mode = 'promises'
    if (!this.promisesLoaded) { this.promiseList = []; await this.render() }
    const r = await api.promises()
    this.promiseList = r.promises
    this.promiseCount = r.promises.length
    this.promisesLoaded = true
    if (this.mode === 'promises') await this.render()
  }

  private async onPromiseAction(i: number) {
    const c = this.promiseSel
    if (!c) return
    if (i === 0) return this.beginSend({ kind: 'promise', c })
    if (i === 1 || i === 2) {
      await api.promiseSnooze(c.key, i === 1 ? 1 : this.hoursUntilTomorrow9())
      this.flash(t().snoozed)
    } else if (i === 3) {
      await api.promiseDrop(c.key)
      this.flash(t().dropped)
    } else return
    this.promiseList = this.promiseList.filter(x => x.key !== c.key)
    this.promiseCount = this.promiseList.length
    this.mode = 'promises'
    return this.render()
  }

  private hoursUntilTomorrow9() {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0)
    return Math.max(1, (d.getTime() - Date.now()) / 3_600_000)
  }

  private dueLabel(due: number | null): string {
    if (!due) return ''
    const L = t()
    const ms = due * 1000
    if (ms < Date.now()) return L.overdue
    const d = new Date(ms)
    const loc = getLang() === 'de' ? 'de-DE' : 'en-GB'
    const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
    if (d.toDateString() === new Date().toDateString()) return L.due(time)
    return L.due(`${d.toLocaleDateString(loc, { weekday: 'short' })} ${time}`)
  }

  // ------------------------------------------------------------- digest

  private async openDigest() {
    this.mode = 'digest'
    this.digestPoints = []
    this.digestHead = t().loading
    this.digestIdx = 0
    await this.render()
    const d = await api.digest()
    if (this.mode !== 'digest') return
    this.digestPoints = d.points
    this.digestHead = t().briefHead(d.channels, d.posts)
    await this.render()
  }

  // ------------------------------------------------------------- render

  private main(hl: string, hr: string, body: string, note: string, foot: string, bodyBright = BRIGHT): Screen {
    return {
      layout: 'main',
      texts: [
        { name: 'hdrL', x: 0, y: 0, w: 300, h: 40, text: hl },
        { name: 'hdrR', x: 300, y: 0, w: 276, h: 40, text: hr, bright: DIM },
        { name: 'body', x: 0, y: 42, w: 576, h: 150, text: body, capture: true, bright: bodyBright },
        { name: 'note', x: 0, y: 194, w: 576, h: 48, text: this.toast || note, bright: this.toast ? BRIGHT : DIM },
        { name: 'foot', x: 0, y: 246, w: 576, h: 42, text: foot, bright: DIM },
      ],
    }
  }

  private listScreen(layout: string, head: string, items: string[], foot: string): Screen {
    return {
      layout,
      texts: [
        { name: 'hdr', x: 0, y: 0, w: 576, h: 40, text: head, bright: DIM },
        { name: 'foot', x: 0, y: 246, w: 576, h: 42, text: this.toast || foot, bright: DIM },
      ],
      list: { name: 'choices', x: 0, y: 42, w: 576, h: 202, items },
    }
  }

  /** How a reply in another language is listed: what it says, in the reader's words. */
  private replyLabel(r: Reply): string {
    if (this.replyLang === this.readLang()) return r.text
    return `[${this.replyLang.toUpperCase()}] ${r.meaning || r.text}`
  }

  /** The actual outgoing text (if G2 can draw it) and, for other languages, its meaning. */
  private outgoingLines(text: string, meaning: string, lang: string): string {
    const L = t()
    const show = renderable(text) ? `"${clip(text, 120)}"` : L.scriptText(langName(lang))
    return lang !== this.readLang() && meaning && meaning !== text ? `${show}\n${L.means} ${clip(meaning, 110)}` : show
  }

  private screen(): Screen {
    const L = t()
    const it = this.cur()
    const who = it ? it.sender || it.chatTitle : ''
    const counts = [this.needYou ? L.needYou(this.needYou) : '', this.promiseCount ? L.promises(this.promiseCount) : ''].filter(Boolean)
    const countsLine = counts.join(' · ')

    switch (this.mode) {
      case 'loading':
        return this.main(L.appName, '', `\n${L.loading}`, '', '')
      case 'signin':
        return this.main(L.appName, '', `${L.signIn}\n\n${L.signInSub}`, '', L.hintSignIn)
      case 'empty':
        return this.main(L.appName, '', `\n${L.clear}\n${L.clearSub}`, this.promiseCount ? L.clearPromises(this.promiseCount) : '', this.promiseCount ? L.hintEmptyP : L.hintEmpty)
      case 'focus': {
        if (!it) return this.main(L.appName, '', L.clear, '', L.hintEmpty)
        const mins = Math.max(0, Math.round((Date.now() / 1000 - it.date) / 60))
        const where = it.kind === 'user' ? it.chatTitle : `${it.sender} · ${it.chatTitle}`
        const mark = it.needsYou ? '●' : '○'
        const head = `${mark} ${clip(where, 34)}   ${L.ago(mins)}`
        const raw = sanitize(it.text)
        const text = renderable(raw) ? clip(raw, 150) : L.unsupported
        let note = it.gist ? `AI: ${it.gist}` : ''
        if (it.translated) {
          const orig = sanitize(it.translated.original)
          note = renderable(orig) ? `${L.orig} ${clipW(orig, 50)}` : L.hiddenScript(langName(it.translated.from))
        }
        const right = it.translated ? L.translatedTo(it.translated.from, this.readLang()) : countsLine
        return this.main(`${L.appName}  ${this.idx + 1}/${this.items.length}`, right, `${head}\n${text}`, note, L.hintFocus)
      }
      case 'replies': {
        const head = clipW(`${who}: ${sanitize(it?.text ?? '')}`, 52)
        if (this.replies.length === 0) {
          return { layout: 'replies-wait', texts: [
            { name: 'hdr', x: 0, y: 0, w: 576, h: 40, text: head, bright: DIM },
            { name: 'body', x: 0, y: 42, w: 576, h: 200, text: `\n${L.thinking}`, capture: true },
            { name: 'foot', x: 0, y: 246, w: 576, h: 42, text: L.hintReplies, bright: DIM },
          ] }
        }
        const tags = [this.replyLang !== this.readLang() ? L.sendsAs(this.replyLang) : '', this.replyRegister ? L[this.replyRegister] : ''].filter(Boolean).join(' · ')
        const foot = tags ? `${L.hintRepliesShort}   ${tags}` : L.hintReplies
        return this.listScreen('replies', head, [...this.replies.map(r => this.replyLabel(r)), L.speakOwn, L.markRead, L.mute1h], foot)
      }
      case 'voice': {
        const head = L.replyTo(who)
        const note = this.replyLang !== this.readLang() ? L.replyLangNote(this.replyLang) : ''
        if (this.voice === 'rec') return this.main(head, '', `${L.listening}   ▁▃▅▇▆▄▂▃▅`, note, L.hintVoiceRec)
        if (this.voice === 'busy') return this.main(head, '', L.transcribing, note, '')
        if (this.voice === 'done') return this.main(head, '', `${L.cleaned}\n${this.outgoingLines(this.draft.text, this.draft.meaning, this.replyLang)}`, note, L.hintVoiceDone)
        const raw = sanitize(it?.text ?? '')
        return this.main(head, '', renderable(raw) ? clip(raw, 150) : L.unsupported, note, L.hintVoiceIdle)
      }
      case 'sending': {
        const p = this.pending
        if (!p) return this.main(L.appName, '', '', '', '')
        const bar = '━'.repeat(Math.max(0, this.sendLeft) * 5)
        const [to, text, meaning, lang] = p.kind === 'reply'
          ? [p.item.sender || p.item.chatTitle, p.text, p.meaning, p.lang]
          : [p.c.chatTitle, p.c.doneText, p.c.doneMeaning, p.c.doneLang]
        const head = lang !== this.readLang() ? L.sendingLang(to, this.sendLeft, lang) : L.sendingIn(to, this.sendLeft)
        return this.main(L.appName, countsLine, `${head}\n\n${this.outgoingLines(text, meaning, lang)}`, bar, L.hintSending)
      }
      case 'digest': {
        const p = this.digestPoints[this.digestIdx]
        if (!p) return this.main(L.brief, '', this.digestHead === L.loading ? `\n${L.loading}` : L.noChannels, '', L.hintDigest)
        return this.main(
          clip(this.digestHead, 44), `${this.digestIdx + 1}/${this.digestPoints.length}`,
          `${p.title}\n${clip(p.detail, 170)}`,
          clip(p.sources.join(', '), 60),
          L.hintDigest,
        )
      }
      case 'promises': {
        if (this.promiseList.length === 0) {
          return this.main(L.menuPromises, '', this.promisesLoaded ? L.noPromises : `\n${L.loading}`, '', L.hintPromises)
        }
        const items = this.promiseList.map(c => {
          const due = this.dueLabel(c.due)
          return clip(`${c.what}${due ? ` · ${due}` : ''}`, 62)
        })
        return this.listScreen('promises', L.promisesHead(this.promiseList.length), items, L.hintPromises)
      }
      case 'promise': {
        const c = this.promiseSel!
        const done = clip(L.doneTell(c.chatTitle, c.doneMeaning), 62)
        const head = clip(`${c.what} · ${c.chatTitle}`, 52)
        return this.listScreen('promise', head, [done, L.snooze1h, L.snoozeTomorrow, L.drop], L.hintPromise)
      }
    }
  }

  render() { return this.g.show(this.screen()) }
}
