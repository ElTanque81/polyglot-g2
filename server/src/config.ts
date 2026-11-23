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
  anthropic: {
    key: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'claude-haiku-5-5',
  },
  stt: {
    /** 'groq' | 'openai' */
    provider: process.env.STT_PROVIDER ?? 'groq',
    key: process.env.STT_API_KEY ?? '',
  },
  /** Allow the keyless demo account (fixtures, no Telegram). */
  allowDemo: (process.env.ALLOW_DEMO ?? 'true') === 'true',
}

export const telegramConfigured = () => config.telegram.apiId > 0 && config.telegram.apiHash.length > 0
