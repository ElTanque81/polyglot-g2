import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { api, setToken, hasToken } from './api'
import { setLang, type Lang } from './i18n'
import { Glasses } from './glasses'
import { PolyglotApp } from './app'
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

const storedLang = (await load('pg.lang')) as Lang
setLang(storedLang === 'de' || storedLang === 'en' ? storedLang : navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en')
setToken(await load('pg.token'))

// `?demo` signs into the keyless demo account (simulator runs, judges).
if (new URLSearchParams(location.search).has('demo')) {
  const valid = hasToken() && (await api.me().then(() => true, () => false))
  if (!valid) {
    try { const { token } = await api.demo(); setToken(token); await save('pg.token', token) } catch (e) { console.error(e) }
  }
}

// Language messages are translated into (from the account settings).
let readLang = 'en'
async function loadReadLang() {
  if (!hasToken()) return
  try { readLang = (await api.me()).settings.readLang ?? readLang } catch { /* offline or signed out */ }
}
await loadReadLang()

const glasses = new Glasses(bridge)
const app = new PolyglotApp(glasses, hasToken, () => readLang)

const phone = new PhonePage(document.getElementById('app')!, {
  saveToken: t => save('pg.token', t),
  saveLang: l => save('pg.lang', l),
  onChange: () => { loadReadLang().then(() => app.reload()).catch(err => console.error(err)) },
})

await app.start()
await phone.show(hasToken())
console.log('[Polyglot] ready')
