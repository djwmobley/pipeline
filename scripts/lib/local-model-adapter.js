'use strict';
/**
 * local-model-adapter.js — Host-agnostic local model completion adapter
 *
 * v1 implements: OllamaAdapter, OpenAICompatibleAdapter
 * Custom adapters: implement LocalModelAdapter interface, place in
 *   scripts/lib/adapters/<name>-adapter.js, register in ADAPTER_MAP below.
 *
 * Usage:
 *   const { getAdapter } = require('./local-model-adapter');
 *   const adapter = getAdapter('ollama');
 *   const models = await adapter.listModels({ endpoint: 'http://localhost:11434', modelName: '', apiProtocol: 'ollama_native', timeoutMs: 5000, maxRetries: 1 });
 *   const text = await adapter.complete(cfg, 'Write a short commit message.', { maxTokens: 100, temperature: 0.2 });
 */

const http  = require('http');
const https = require('https');

// ─── Error types ─────────────────────────────────────────────────────────────

class LocalModelUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'LocalModelUnavailableError'; }
}
class LocalModelBadOutputError extends Error {
  constructor(message) { super(message); this.name = 'LocalModelBadOutputError'; }
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function httpRequest(url, method, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      method,
      headers: bodyStr
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }
        : {},
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function httpRequestWithRetry(url, method, body, cfg) {
  const timeoutMs = cfg.timeoutMs || 30000;
  const maxRetries = cfg.maxRetries !== undefined ? cfg.maxRetries : 2;
  let lastErr;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await httpRequest(url, method, body, timeoutMs);
    } catch (e) {
      lastErr = e;
      // Only retry on network errors (ECONNREFUSED, ETIMEDOUT, ECONNRESET)
      if (e.code && ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(e.code)) continue;
      if (e.message && e.message.includes('timed out')) continue;
      throw e; // Not a transient error — bubble immediately
    }
  }
  throw new LocalModelUnavailableError(`Host unreachable at ${url}: ${lastErr.message}`);
}

// ─── OllamaAdapter ───────────────────────────────────────────────────────────

const OllamaAdapter = {
  hostType: 'ollama',

  async probe(cfg) {
    const url = `${cfg.endpoint}/api/tags`;
    let res;
    try {
      res = await httpRequestWithRetry(url, 'GET', null, cfg);
    } catch (e) {
      throw new LocalModelUnavailableError(`Ollama not reachable at ${cfg.endpoint}: ${e.message}`);
    }
    if (res.status !== 200) {
      throw new LocalModelUnavailableError(`Ollama /api/tags returned ${res.status}`);
    }
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (_) {
      throw new LocalModelUnavailableError(`Ollama /api/tags returned non-JSON`);
    }
    if (!cfg.modelName) return; // Just checking host reachability
    const names = (parsed.models || []).map(m => m.name);
    if (!names.some(n => n === cfg.modelName || n.startsWith(cfg.modelName + ':'))) {
      throw new LocalModelUnavailableError(
        `Model "${cfg.modelName}" not found on Ollama. Available: ${names.join(', ')}\n` +
        `Pull it with: ollama pull ${cfg.modelName}`
      );
    }
  },

  async listModels(cfg) {
    const url = `${cfg.endpoint}/api/tags`;
    const res = await httpRequestWithRetry(url, 'GET', null, cfg);
    if (res.status !== 200) return [];
    try {
      const parsed = JSON.parse(res.body);
      return (parsed.models || []).map(m => m.name);
    } catch (_) { return []; }
  },

  async complete(cfg, prompt, opts = {}) {
    const url = `${cfg.endpoint}/api/generate`;
    const body = {
      model:  cfg.modelName,
      prompt,
      stream: false,
      options: {
        ...(opts.maxTokens  ? { num_predict:  opts.maxTokens }  : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : { temperature: 0.2 }),
      },
      ...(opts.system ? { system: opts.system } : {}),
    };
    let res;
    try {
      res = await httpRequestWithRetry(url, 'POST', body, cfg);
    } catch (e) {
      if (e instanceof LocalModelUnavailableError) throw e;
      throw new LocalModelUnavailableError(`Ollama request failed: ${e.message}`);
    }
    if (res.status !== 200) {
      throw new LocalModelUnavailableError(`Ollama /api/generate returned ${res.status}: ${res.body.slice(0, 200)}`);
    }
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (_) {
      throw new LocalModelBadOutputError(`Ollama returned non-JSON response`);
    }
    if (!parsed.response || parsed.response.trim().length === 0) {
      throw new LocalModelBadOutputError(`Ollama returned empty response for model ${cfg.modelName}`);
    }
    return parsed.response;
  },
};

// ─── OpenAICompatibleAdapter ─────────────────────────────────────────────────

const OpenAICompatibleAdapter = {
  hostType: 'openai_compatible',

  async probe(cfg) {
    const url = `${cfg.endpoint}/v1/models`;
    let res;
    try {
      res = await httpRequestWithRetry(url, 'GET', null, cfg);
    } catch (e) {
      throw new LocalModelUnavailableError(`OpenAI-compatible host not reachable at ${cfg.endpoint}: ${e.message}`);
    }
    if (res.status !== 200) {
      throw new LocalModelUnavailableError(`${cfg.endpoint}/v1/models returned ${res.status}`);
    }
    if (!cfg.modelName) return;
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (_) {
      throw new LocalModelUnavailableError(`${cfg.endpoint}/v1/models returned non-JSON`);
    }
    const ids = (parsed.data || []).map(m => m.id);
    if (!ids.includes(cfg.modelName)) {
      throw new LocalModelUnavailableError(
        `Model "${cfg.modelName}" not found. Available: ${ids.join(', ')}`
      );
    }
  },

  async listModels(cfg) {
    const url = `${cfg.endpoint}/v1/models`;
    try {
      const res = await httpRequestWithRetry(url, 'GET', null, cfg);
      if (res.status !== 200) return [];
      const parsed = JSON.parse(res.body);
      return (parsed.data || []).map(m => m.id);
    } catch (_) { return []; }
  },

  async complete(cfg, prompt, opts = {}) {
    const url = `${cfg.endpoint}/v1/chat/completions`;
    const body = {
      model:    cfg.modelName,
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: prompt },
      ],
      ...(opts.maxTokens    ? { max_tokens:   opts.maxTokens  } : {}),
      temperature: opts.temperature !== undefined ? opts.temperature : 0.2,
    };
    let res;
    try {
      res = await httpRequestWithRetry(url, 'POST', body, cfg);
    } catch (e) {
      if (e instanceof LocalModelUnavailableError) throw e;
      throw new LocalModelUnavailableError(`OpenAI-compatible request failed: ${e.message}`);
    }
    if (res.status !== 200) {
      throw new LocalModelUnavailableError(`/v1/chat/completions returned ${res.status}: ${res.body.slice(0, 200)}`);
    }
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (_) {
      throw new LocalModelBadOutputError(`OpenAI-compatible host returned non-JSON`);
    }
    const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
    if (!content || content.trim().length === 0) {
      throw new LocalModelBadOutputError(`OpenAI-compatible host returned empty content`);
    }
    return content;
  },
};

// ─── Factory ─────────────────────────────────────────────────────────────────

const ADAPTER_MAP = {
  ollama:           OllamaAdapter,
  openai_compatible: OpenAICompatibleAdapter,
  // Community adapters: add entries here keyed by host_type string
  // e.g., custom: require('./adapters/custom-adapter'),
};

function getAdapter(hostType) {
  const adapter = ADAPTER_MAP[hostType];
  if (!adapter) {
    throw new Error(
      `Unknown local model host type: "${hostType}". ` +
      `Valid types: ${Object.keys(ADAPTER_MAP).join(', ')}`
    );
  }
  return adapter;
}

module.exports = {
  getAdapter,
  LocalModelUnavailableError,
  LocalModelBadOutputError,
  OllamaAdapter,
  OpenAICompatibleAdapter,
};
