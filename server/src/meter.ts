import { AsyncLocalStorage } from 'node:async_hooks'
import * as store from './store.js'
import { config } from './config.js'
import type { Activity, Usage } from './types.js'

/**
 * Per-account usage and activity. Every request runs with its device token in
 * an AsyncLocalStorage, so deep calls (LLM, Whisper) can be attributed to the
 * right account without passing it around.
 */
export const meterCtx = new AsyncLocalStorage<{ token: string }>()

const month = () => new Date().toISOString().slice(0, 7)
const empty = (): Usage => ({ month: month(), llmIn: 0, llmOut: 0, llmCalls: 0, sttSec: 0, triaged: 0, translated: 0, replies: 0, voice: 0 })

export function addUsage(patch: Partial<Omit<Usage, 'month'>>) {
  const token = meterCtx.getStore()?.token
  if (!token || !store.getAccount(token)) return
  store.mutate(token, a => {
    if (!a.usage || a.usage.month !== month()) a.usage = empty()
    for (const [k, v] of Object.entries(patch)) (a.usage as unknown as Record<string, number>)[k] += v as number
  })
}

export function usageOf(token: string) {
  const acc = store.getAccount(token)
  const u = acc?.usage && acc.usage.month === month() ? acc.usage : empty()
  const p = config.prices
  const cost = (u.llmIn / 1e6) * p.llmInPerM + (u.llmOut / 1e6) * p.llmOutPerM + (u.sttSec / 3600) * p.sttPerHour
  return { ...u, costUsd: Math.round(cost * 10000) / 10000, prices: p }
}

export function logActivity(kind: Activity['kind'], chat?: string, lang?: string) {
  const token = meterCtx.getStore()?.token
  if (!token || !store.getAccount(token)) return
  store.mutate(token, a => {
    a.activity = [{ t: Math.floor(Date.now() / 1000), kind, chat, lang }, ...(a.activity ?? [])].slice(0, 50)
  })
}
