import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { api, setToken, hasToken } from './api'
import { setLang, type Lang } from './i18n'
import { Glasses } from './glasses'
import { TeleGlanceApp } from './app'
import { PhonePage } from './phone'

const bridge = await waitForEvenAppBridge()

// Persist through the host (survives Android WebView suspension); mirror in localStorage.
async function load(key: string): Promise<string> {
  try { const v = await bridge.getLocalStorage(key); if (v) return v } catch { /* host without storage */ }
  try { return window.localStorage.getItem(key) ?? '' } catch { return '' }
}
async function save(key: string, value: string) {
  try { await bridge.setLocalStorage(key, value) } catch { /* ignore */ }
  try { window.localStorage.setItem(key, value) } catch { /* ignore */ }
}

const storedLang = (await load('tg.lang')) as Lang
setLang(storedLang === 'de' || storedLang === 'en' ? storedLang : navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en')
setToken(await load('tg.token'))

// `?demo` signs into the keyless demo account (simulator runs, judges).
if (new URLSearchParams(location.search).has('demo')) {
  const valid = hasToken() && (await api.me().then(() => true, () => false))
  if (!valid) {
    try { const { token } = await api.demo(); setToken(token); await save('tg.token', token) } catch (e) { console.error(e) }
  }
}

const glasses = new Glasses(bridge)
const app = new TeleGlanceApp(glasses, hasToken)

const phone = new PhonePage(document.getElementById('app')!, {
  saveToken: t => save('tg.token', t),
  saveLang: l => save('tg.lang', l),
  onChange: () => { app.reload().catch(err => console.error(err)) },
})

await app.start()
await phone.show(hasToken())
console.log('[TeleGlance] ready')
