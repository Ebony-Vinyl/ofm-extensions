/**
 * openai-compatible — any OpenAI-compatible /chat/completions server as a
 * channel.
 *
 * The base URL is user configuration, falling back to the manifest default
 * until the user saves one; the API key, when stored, rides the authorization
 * header and never the body. The origin of the configured base URL must be
 * one the manifest's permissions declare — the marketplace copy serves
 * api.openai.com plus the common loopback dev ports, and further origins are
 * one manifest pull request away.
 */
import { sdk } from 'ofm:sdk'

/** The saved baseUrl, or the manifest default while the user has saved none. */
function configuredBaseUrl(ctx) {
  const saved = ctx.config?.baseUrl
  if (typeof saved === 'string' && saved.trim() !== '') return saved
  const field = Array.isArray(ctx.manifest?.config) ? ctx.manifest.config.find(row => row !== null && typeof row === 'object' && row.key === 'baseUrl') : null
  const fallback = field !== null && typeof field === 'object' ? field.default : undefined
  return typeof fallback === 'string' ? fallback : ''
}

/** Resolve and fence the configured base URL, or throw with a readable reason. */
function resolveBaseUrl(ctx) {
  const raw = configuredBaseUrl(ctx).trim().replace(/\/+$/, '')
  if (raw === '') {
    throw new Error('the baseUrl setting is empty — point it at an OpenAI-compatible server (https, or loopback http with a port)')
  }
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('the baseUrl setting is not a valid URL: ' + raw)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('the baseUrl setting must be an http(s) URL, not ' + parsed.protocol)
  }
  const allowed = Array.isArray(ctx.manifest?.permissions?.network) ? ctx.manifest.permissions.network : []
  if (!allowed.includes(parsed.origin)) {
    throw new Error(`the baseUrl origin "${parsed.origin}" is not in this extension's permissions; the marketplace copy serves: ${allowed.join(', ')}`)
  }
  return raw
}

export default {
  async prepareChat(ctx, req) {
    const baseUrl = resolveBaseUrl(ctx)
    const key = await ctx.secrets.get('apiKey')
    const headers = {}
    if (typeof key === 'string' && key !== '') headers.authorization = 'Bearer ' + key
    return {
      url: baseUrl + '/chat/completions',
      headers,
      wire: 'chat',
    }
  },
}
