/**
 * kilo-free — the Kilo gateway's free tier as a keyless extension channel.
 *
 * listModels reads the gateway's public model listing and keeps the rows the
 * gateway itself marks free; prepareChat aims every turn at the gateway's
 * OpenAI-compatible chat endpoint. No key, no secrets: the tier is open.
 * When the live listing cannot be reached, the static shelf below answers.
 */
import { sdk } from 'ofm:sdk'

const GATEWAY_ORIGIN = 'https://ai-gateway.kilo.ai'
const LIST_URL = GATEWAY_ORIGIN + '/api/v1/models'
const CHAT_URL = GATEWAY_ORIGIN + '/api/v1/chat/completions'

const LISTING_HEADERS = { 'http-referer': 'https://kilo.ai/', 'x-title': 'OFM Extensions' }

/** The static shelf: served when the live listing cannot be reached. */
const FALLBACK_MODELS = [
  { id: 'kilo-auto/free', name: 'Kilo Auto', contextWindow: 256000, maxOutput: 32768, vision: false, reasoning: false, wire: 'chat' },
  { id: 'nvidia/nemotron-3.5-super-vl:free', name: 'Nemotron 3.5 Super VL', contextWindow: 262144, maxOutput: 32768, vision: true, reasoning: false, wire: 'chat' },
  { id: 'reflection/beam-free', name: 'Beam', contextWindow: 131072, maxOutput: 16384, vision: false, reasoning: true, wire: 'chat' },
  { id: 'stealth/glyph-cluster', name: 'Glyph Cluster', contextWindow: 200000, maxOutput: 32768, vision: false, reasoning: true, wire: 'chat' },
  { id: 'stealth/crouton-alpha', name: 'Crouton Alpha', contextWindow: 200000, maxOutput: 32768, vision: false, reasoning: false, wire: 'chat' },
  { id: 'dots-studio/dots-3-note-preview:free', name: 'Dots 3 Note Preview', contextWindow: 131072, maxOutput: 16384, vision: false, reasoning: false, wire: 'chat' },
  { id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nemotron 3.5 Lightning', contextWindow: 262144, maxOutput: 16384, vision: false, reasoning: false, wire: 'chat' },
  { id: 'cohere/north-mini-code:free', name: 'North Mini Code', contextWindow: 256000, maxOutput: 32768, vision: false, reasoning: false, wire: 'chat' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra 550B', contextWindow: 262144, maxOutput: 32768, vision: false, reasoning: true, wire: 'chat' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', name: 'Nemotron 3 Nano Omni 30B', contextWindow: 262144, maxOutput: 32768, vision: true, reasoning: true, wire: 'chat' },
  { id: 'openrouter/free', name: 'OpenRouter Free', contextWindow: 131072, maxOutput: 16384, vision: false, reasoning: false, wire: 'chat' },
]

/** Strip the "Vendor: " prefix and the " (free)" suffix the listing decorates names with. */
function displayName(rawName, id) {
  const base = typeof rawName === 'string' && rawName.trim() !== '' ? rawName.trim() : String(id ?? '')
  return base.replace(/^[^:]{1,64}:\s*/, '').replace(/\s*\(free\)\s*$/i, '')
}

/** One listing row -> one catalog row, every field access guarded. */
function rowFromListing(row) {
  if (row === null || typeof row !== 'object') return null
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  if (id === '') return null
  const contextLength = Number(row.context_length)
  const maxCompletion = Number(row.top_provider?.max_completion_tokens)
  const modalities = row.architecture?.input_modalities
  const parameters = row.supported_parameters
  return {
    id,
    name: displayName(row.name, id) || id,
    contextWindow: Number.isFinite(contextLength) && contextLength > 0 ? contextLength : undefined,
    maxOutput: Number.isFinite(maxCompletion) && maxCompletion > 0 ? maxCompletion : undefined,
    vision: Array.isArray(modalities) && modalities.includes('image'),
    reasoning: Array.isArray(parameters) && parameters.includes('reasoning'),
    wire: 'chat',
  }
}

export default {
  async listModels(ctx) {
    let rows = []
    try {
      const response = await ctx.fetch(LIST_URL, { headers: LISTING_HEADERS })
      if (response.ok && typeof response.json === 'function') {
        const payload = response.json()
        if (payload !== null && typeof payload === 'object' && Array.isArray(payload.data)) {
          rows = payload.data.map(rowFromListing).filter(row => row !== null)
        }
      }
    } catch {
      rows = []
    }
    return rows.length > 0 ? rows : FALLBACK_MODELS
  },

  async prepareChat(ctx, req) {
    return {
      url: CHAT_URL,
      headers: { ...LISTING_HEADERS },
      wire: 'chat',
    }
  },
}
