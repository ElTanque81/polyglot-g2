import { api, ApiError, type DigestPoint, type InboxItem } from './api'
import { Glasses, DIM, BRIGHT, sanitize, clip, type Gesture, type Screen } from './glasses'
import { t, getLang } from './i18n'

/**
 * The glasses-side app: one state machine, one screen at a time.
 * Read → act in seconds: tap for AI replies, one more tap to send,
 * hold to answer by voice. Every send waits 5 s so it can be undone.
 */

type Mode = 'signin' | 'loading' | 'focus' | 'empty' | 'replies' | 'voice' | 'sending' | 'digest'

const POLL_MS = 15_000
const UNDO_S = 5
const MAX_REC_MS = 30_000

export class TeleGlanceApp {
  private mode: Mode = 'loading'
  private items: InboxItem[] = []
  private idx = 0
  private needYou = 0
  private replies: string[] = []
  private replyLang = 'en'
  private draft = ''
  private voice: 'idle' | 'rec' | 'busy' | 'done' = 'idle'
  private chunks: Uint8Array[] = []
  private recTimer = 0
  private sendTimer = 0
  private sendLeft = 0
  private digestPoints: DigestPoint[] = []
  private digestHead = ''
  private digestIdx = 0
  private toast = ''
  private toastTimer = 0
  private pollTimer = 0

  constructor(private g: Glasses, private signedIn: () => boolean) {
    g.setMenu([
      { itemName: t().menuBrief, itemID: 1 },
      { itemName: t().menuReadAll, itemID: 2 },
      { itemName: t().menuRefresh, itemID: 3 },
    ])
    g.onGesture(ev => this.onGesture(ev).catch(err => this.fail(err)))
  }

  // ------------------------------------------------------------ lifecycle

  async start() {
    await this.render()
    if (!this.signedIn()) { this.mode = 'signin'; return this.render() }
    await this.refresh(true).catch(e => this.fail(e))
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

  private fail(err: unknown) {
    console.error('[TeleGlance]', err)
    if (err instanceof ApiError && err.status === 401) { this.mode = 'signin'; this.render(); return }
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
        if (ev.kind === 'tap') return this.openDigest()
        if (ev.kind === 'down' || ev.kind === 'up') return this.refresh(true)
        return

      case 'focus':
        if (ev.kind === 'double') return void this.g.exit()
        if (ev.kind === 'down') { this.idx = Math.min(this.idx + 1, this.items.length - 1); return this.render() }
        if (ev.kind === 'up') { this.idx = Math.max(this.idx - 1, 0); return this.render() }
        if (ev.kind === 'tap') return this.openReplies()
        if (ev.kind === 'longStart') { this.mode = 'voice'; this.replyLang = this.cur()?.translated?.from ?? getLang(); return this.startRec() }
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
          if (this.voice === 'done' && this.draft) return this.beginSend(this.draft)
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
    }
  }

  private async onMenu(id: number) {
    if (this.mode === 'sending' || this.mode === 'voice') return
    if (id === 1) return this.openDigest()
    if (id === 2) { await api.readAll(); this.flash(t().readAllDone); return this.refresh(true) }
    if (id === 3) return this.refresh(false)
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
    await this.render() // shows "drafting…" on the reply page
    const r = await api.replies(it.chatId, it.msgId)
    if (this.mode !== 'replies') return
    this.replies = r.replies
    this.replyLang = r.replyLang
    await this.render()
  }

  private async onReplyPick(i: number) {
    const it = this.cur()
    if (!it) return
    const n = this.replies.length
    if (n === 0) return // still drafting
    if (i < n) return this.beginSend(this.replies[i])
    if (i === n) { this.mode = 'voice'; this.voice = 'idle'; this.draft = ''; return this.render() }
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
    this.draft = ''
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
    const r = await api.stt(pcm, { chatId: it?.chatId, msgId: it?.msgId, lang: this.replyLang })
    if (this.mode !== 'voice') return
    this.draft = r.text
    this.voice = r.text ? 'done' : 'idle'
    if (!r.text) this.flash(t().noVoice)
    await this.render()
  }

  // ------------------------------------------------------------ sending

  private beginSend(text: string) {
    this.draft = text
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
    const it = this.cur()
    if (!it) return this.backToFocus()
    await api.send(it.chatId, this.draft, it.kind === 'group' ? it.msgId : undefined)
    this.dropChat(it.chatId)
    this.mode = this.items.length ? 'focus' : 'empty'
    this.flash(t().sent(it.sender || it.chatTitle), 2500)
    this.refresh(false).catch(e => this.fail(e))
  }

  private undoSend() {
    clearInterval(this.sendTimer)
    this.mode = 'focus'
    this.flash(t().undone)
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
        { name: 'hdrL', x: 0, y: 0, w: 360, h: 40, text: hl },
        { name: 'hdrR', x: 360, y: 0, w: 216, h: 40, text: hr, bright: DIM },
        { name: 'body', x: 0, y: 42, w: 576, h: 150, text: body, capture: true, bright: bodyBright },
        { name: 'note', x: 0, y: 194, w: 576, h: 48, text: this.toast || note, bright: this.toast ? BRIGHT : DIM },
        { name: 'foot', x: 0, y: 246, w: 576, h: 42, text: foot, bright: DIM },
      ],
    }
  }

  private screen(): Screen {
    const L = t()
    const it = this.cur()
    const who = it ? it.sender || it.chatTitle : ''
    const needYou = this.needYou ? L.needYou(this.needYou) : ''

    switch (this.mode) {
      case 'loading':
        return this.main(L.appName, '', `\n${L.loading}`, '', '')
      case 'signin':
        return this.main(L.appName, '', `${L.signIn}\n\n${L.signInSub}`, '', L.hintSignIn)
      case 'empty':
        return this.main(L.appName, '', `\n${L.clear}\n${L.clearSub}`, '', L.hintEmpty)
      case 'focus': {
        if (!it) return this.main(L.appName, '', L.clear, '', L.hintEmpty)
        const mins = Math.max(0, Math.round((Date.now() / 1000 - it.date) / 60))
        const where = it.kind === 'user' ? it.chatTitle : `${it.sender} · ${it.chatTitle}`
        const mark = it.needsYou ? '●' : '○'
        const head = `${mark} ${clip(where, 34)}   ${L.ago(mins)}`
        const text = clip(sanitize(it.text), 150)
        const note = it.translated
          ? `${L.orig} ${clip(sanitize(it.translated.original), 46)}`
          : it.gist ? `AI: ${it.gist}` : ''
        const right = it.translated ? L.translatedFrom(it.translated.from) : needYou
        return this.main(`${L.appName}  ${this.idx + 1}/${this.items.length}`, right, `${head}\n${text}`, note, L.hintFocus)
      }
      case 'replies': {
        const hdr = { name: 'hdr', x: 0, y: 0, w: 576, h: 40, text: clip(`${who}: ${sanitize(it?.text ?? '')}`, 52), bright: DIM }
        const foot = { name: 'foot', x: 0, y: 246, w: 576, h: 42, text: this.toast || L.hintReplies, bright: DIM }
        if (this.replies.length === 0) {
          return { layout: 'replies-wait', texts: [hdr, { name: 'body', x: 0, y: 42, w: 576, h: 200, text: `\n${L.thinking}`, capture: true }, foot] }
        }
        return {
          layout: 'replies',
          texts: [hdr, foot],
          list: { name: 'choices', x: 0, y: 42, w: 576, h: 202, items: [...this.replies, L.speakOwn, L.markRead, L.mute1h] },
        }
      }
      case 'voice': {
        const head = L.replyTo(who)
        const note = this.replyLang !== getLang() ? L.replyLangNote(this.replyLang) : ''
        if (this.voice === 'rec') return this.main(head, '', `${L.listening}   ▁▃▅▇▆▄▂▃▅`, note, L.hintVoiceRec)
        if (this.voice === 'busy') return this.main(head, '', L.transcribing, note, '')
        if (this.voice === 'done') return this.main(head, '', `${L.cleaned}\n${clip(this.draft, 220)}`, note, L.hintVoiceDone)
        return this.main(head, '', clip(sanitize(it?.text ?? ''), 150), note, L.hintVoiceIdle)
      }
      case 'sending':
        return this.main(L.appName, needYou, `${L.sendingIn(who, this.sendLeft)}\n\n"${clip(this.draft, 160)}"`, '━'.repeat(Math.max(0, this.sendLeft) * 6), L.hintSending)
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
    }
  }

  render() { return this.g.show(this.screen()) }
}
