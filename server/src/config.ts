import 'dotenv/config'

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d)

export const config = {
  port: num(process.env.PORT, 8787),
  host: process.env.HOST ?? '0.0.0.0',
  /** 32+ random chars; encrypts Telegram sessions at rest */
  secret: process.env.SERVER_SECRET ?? '',
  dataDir: process.env.DATA_DIR ?? './data',
  telegram: {
    apiId: num(process.env.TG_API_ID, 0),
    apiHash: process.env.TG_API_HASH ?? '',
  },
  /**
   * LLM for triage, reply drafts, cleanup, digest and translation.
   * AI_PROVIDER: 'otari' (Mozilla.ai gateway, OpenAI-compatible), 'anthropic' or 'openai'.
   */
  ai: (() => {
    const provider = (process.env.AI_PROVIDER ?? (process.env.OTARI_API_KEY ? 'otari' : 'anthropic')).toLowerCase()
    const defaults: Record<string, { base: string; model: string; keyVar: string }> = {
      otari: { base: 'https://api.otari.ai/api/v1', model: 'alibaba/qwen3-235b-a22b-instruct-2507', keyVar: 'OTARI_API_KEY' },
      anthropic: { base: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5', keyVar: 'ANTHROPIC_API_KEY' },
      openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyVar: 'OPENAI_API_KEY' },
    }
    const d = defaults[provider] ?? defaults.anthropic
    const clean = (v?: string) => (v ?? '').trim().replace(/^["']|["']$/g, '').trim()
    return {
      provider: defaults[provider] ? provider : 'anthropic',
      key: clean(process.env.AI_API_KEY || process.env[d.keyVar]),
      model: clean(process.env.AI_MODEL) || d.model,
      baseUrl: (clean(process.env.AI_BASE_URL) || d.base).replace(/\/+$/, ''),
    }
  })(),
  stt: {
    /** 'groq' | 'openai' */
    provider: process.env.STT_PROVIDER ?? 'groq',
    key: (process.env.STT_API_KEY ?? process.env.GROQ_API_KEY ?? '').trim(),
  },
  /** Allow the keyless demo account (fixtures, no Telegram). */
  allowDemo: (process.env.ALLOW_DEMO ?? 'true') === 'true',
}

export const telegramConfigured = () => config.telegram.apiId > 0 && config.telegram.apiHash.length > 0
