import {
  type EvenAppBridge,
  type EvenHubEvent,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

/**
 * Rendering + input layer for the G2 display (576 × 288, one font, 4-bit green).
 * Screens are described declaratively; the renderer rebuilds the page only
 * when the layout changes and otherwise updates text in place (no flicker).
 */

export const W = 576
export const H = 288

/** Brightness levels for text (0 dim … 4 bright). */
export const BRIGHT = 4
export const DIM = 2

export interface TextBox {
  name: string // ≤16 chars, unique per page
  x: number; y: number; w: number; h: number
  text: string
  bright?: number
  border?: number
  capture?: boolean
}

export interface ListBox {
  name: string
  x: number; y: number; w: number; h: number
  items: string[]
}

export interface Screen {
  /** Layout id: same id + same boxes = in-place text update */
  layout: string
  texts: TextBox[]
  list?: ListBox
}

export type Gesture =
  | { kind: 'tap' }
  | { kind: 'double' }
  | { kind: 'up' }
  | { kind: 'down' }
  | { kind: 'longStart' }
  | { kind: 'longEnd'; ms: number }
  | { kind: 'listTap'; index: number }
  | { kind: 'menu'; id: number }
  | { kind: 'audio'; pcm: Uint8Array; other: boolean }
  | { kind: 'foreground' }

export interface MenuItem { itemName: string; itemID: number }

/** G2 drops glyphs it has no font for; keep messages readable. */
export function sanitize(s: string): string {
  return s
    .replace(/\r/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '') // most emoji
    .replace(/[ \t]+/g, ' ')
    .trim()
}

export function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

export class Glasses {
  private started = false
  private current: Screen | null = null
  private ids = new Map<string, number>()
  private lastListTap = 0
  private longStartAt = 0
  private menu: MenuItem[] = []

  constructor(private bridge: EvenAppBridge) {}

  setMenu(items: MenuItem[]) { this.menu = items }

  private textProps(b: TextBox, id: number) {
    return new TextContainerProperty({
      xPosition: b.x, yPosition: b.y, width: b.w, height: b.h,
      borderWidth: b.border ?? 0, borderColor: 8, borderRadius: 6, paddingLength: 4,
      containerID: id, containerName: b.name,
      content: b.text || ' ',
      textColor: b.bright ?? BRIGHT,
      isEventCapture: b.capture ? 1 : 0,
    })
  }

  private listProps(l: ListBox, id: number) {
    return new ListContainerProperty({
      xPosition: l.x, yPosition: l.y, width: l.w, height: l.h,
      borderWidth: 0, borderColor: 8, borderRadius: 6, paddingLength: 2,
      containerID: id, containerName: l.name,
      isEventCapture: 1,
      itemContainer: new ListItemContainerProperty({
        itemCount: l.items.length,
        itemWidth: l.w - 8,
        isItemSelectBorderEn: 1,
        itemName: l.items.map(i => clip(i, 63)),
      }),
    })
  }

  async show(s: Screen): Promise<void> {
    const sameLayout =
      this.started && this.current && this.current.layout === s.layout && !s.list && !this.current.list &&
      this.current.texts.length === s.texts.length && this.current.texts.every((b, i) => b.name === s.texts[i].name)

    if (sameLayout) {
      for (const b of s.texts) {
        const prev = this.current!.texts.find(p => p.name === b.name)
        if (prev && prev.text === b.text && (prev.bright ?? BRIGHT) === (b.bright ?? BRIGHT)) continue
        await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
          containerID: this.ids.get(b.name)!, containerName: b.name, content: b.text || ' ', textColor: b.bright ?? BRIGHT,
        }))
      }
      this.current = s
      return
    }

    this.ids.clear()
    let id = 1
    const textObject = s.texts.map(b => { this.ids.set(b.name, id); return this.textProps(b, id++) })
    const listObject = s.list ? [this.listProps(s.list, id)] : undefined
    if (s.list) this.ids.set(s.list.name, id++)
    const containerTotalNum = textObject.length + (listObject?.length ?? 0)
    const menuObject = this.menu.length ? { menuItems: this.menu } : undefined

    if (!this.started) {
      const r = await this.bridge.createStartUpPageContainer(
        new CreateStartUpPageContainer({ containerTotalNum, textObject, listObject, menuObject } as never),
      )
      if (r !== 0) console.error('[TeleGlance] startup page failed', r)
      this.started = true
    } else {
      const ok = await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({ containerTotalNum, textObject, listObject, menuObject } as never),
      )
      if (!ok) console.error('[TeleGlance] rebuild failed', s.layout)
    }
    this.current = s
  }

  /** Normalizes the SDK's event envelopes into one gesture stream. */
  onGesture(handler: (g: Gesture) => void) {
    const typeOf = (env?: { eventType?: OsEventTypeList }) => (env ? env.eventType ?? OsEventTypeList.CLICK_EVENT : null)
    return this.bridge.onEvenHubEvent((e: EvenHubEvent) => {
      if (e.audioEvent) {
        const a = e.audioEvent as unknown as { audioPcm: Uint8Array; speakerRole?: string }
        handler({ kind: 'audio', pcm: a.audioPcm, other: a.speakerRole === 'other' })
        return
      }
      const menuId = (e as { menuItemClickEvent?: { itemID?: number } }).menuItemClickEvent?.itemID
      if (menuId !== undefined) { handler({ kind: 'menu', id: menuId }); return }

      const sys = typeOf(e.sysEvent)
      const txt = typeOf(e.textEvent)
      const lst = typeOf(e.listEvent)

      if (sys === OsEventTypeList.LONG_PRESS_EVENT) { this.longStartAt = Date.now(); handler({ kind: 'longStart' }); return }
      if (sys === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) { handler({ kind: 'longEnd', ms: Date.now() - this.longStartAt }); return }
      if (sys === OsEventTypeList.FOREGROUND_ENTER_EVENT) return // context menu overlay opened
      if (sys === OsEventTypeList.FOREGROUND_EXIT_EVENT) { handler({ kind: 'foreground' }); return }
      if (sys === OsEventTypeList.IMU_DATA_REPORT || sys === OsEventTypeList.SYSTEM_EXIT_EVENT || sys === OsEventTypeList.ABNORMAL_EXIT_EVENT) return

      if (sys === OsEventTypeList.DOUBLE_CLICK_EVENT || txt === OsEventTypeList.DOUBLE_CLICK_EVENT || lst === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        handler({ kind: 'double' }); return
      }
      if (lst === OsEventTypeList.CLICK_EVENT) {
        this.lastListTap = Date.now()
        handler({ kind: 'listTap', index: e.listEvent?.currentSelectItemIndex ?? 0 }); return
      }
      if (lst === OsEventTypeList.SCROLL_TOP_EVENT || lst === OsEventTypeList.SCROLL_BOTTOM_EVENT) return // firmware moves the highlight
      if (txt === OsEventTypeList.SCROLL_TOP_EVENT) { handler({ kind: 'up' }); return }
      if (txt === OsEventTypeList.SCROLL_BOTTOM_EVENT) { handler({ kind: 'down' }); return }
      if (sys === OsEventTypeList.CLICK_EVENT || txt === OsEventTypeList.CLICK_EVENT) {
        if (this.current?.list) {
          // On list pages the selection comes with the list event; skip the duplicate.
          if (Date.now() - this.lastListTap < 400) return
          setTimeout(() => { if (Date.now() - this.lastListTap > 300) handler({ kind: 'tap' }) }, 120)
          return
        }
        handler({ kind: 'tap' })
      }
    })
  }

  audio(on: boolean) { return this.bridge.audioControl(on) }
  exit() { return this.bridge.shutDownPageContainer(1) }
}
