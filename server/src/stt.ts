import { config } from './config.js'

/**
 * Speech-to-text for raw G2 microphone audio (PCM 16 kHz, s16le, mono).
 * The PCM is wrapped in a WAV header and sent to Whisper (Groq or OpenAI).
 */

export const sttEnabled = () => config.stt.key.length > 0

export function pcmToWav(pcm: Buffer, sampleRate = 16000): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

const ENDPOINTS: Record<string, { url: string; model: string }> = {
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' },
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1' },
}

export async function transcribe(pcm: Buffer, langHint?: string): Promise<string> {
  if (!sttEnabled()) throw new Error('STT_NOT_CONFIGURED')
  if (pcm.length < 3200) return '' // < 100 ms
  const ep = ENDPOINTS[config.stt.provider] ?? ENDPOINTS.groq
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(pcmToWav(pcm))], { type: 'audio/wav' }), 'reply.wav')
  form.append('model', ep.model)
  form.append('response_format', 'json')
  if (langHint) form.append('language', langHint)
  const res = await fetch(ep.url, { method: 'POST', headers: { authorization: `Bearer ${config.stt.key}` }, body: form })
  if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { text?: string }
  return (data.text ?? '').trim()
}
