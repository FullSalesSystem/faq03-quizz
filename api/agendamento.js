/* api/agendamento.js — tag de "nao agendou" do Calendly qualificado.

   Chamado por sendBeacon da pagina playbook-calendly (faq03-calendly):
     { status: 'nao-agendou' } -> lead saiu da pagina sem agendar
                                  -> ADICIONA a tag TAG_NAO_AGENDADO
     { status: 'agendou' }     -> lead tinha saido, voltou e agendou
                                  -> REMOVE a tag TAG_NAO_AGENDADO

   Travas para nao disparar mensagem errada:
     - so contato com a tag 'qualificado' (o semi nao passa por aqui);
     - se o contato ja tem agendamento ativo, nao adiciona;
     - so mexe nesta UMA tag (POST/DELETE /contacts/:id/tags), nunca
       substitui o conjunto de tags do contato. */

const TAG_NAO_AGENDADO = 'playbook-não-agendado-trigger';
const TAG_QUALIFICADO = 'qualificado';

const ALLOWED_ORIGINS = new Set([
  'https://playbook-calendly.fullsalessystem.com',
]);

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;
const ipBucket = new Map();

/* O contato pode ainda nao existir se o lead foi muito rapido (CRM cria
   ~30 s depois da LP). Espera ate CONTACT_WAIT_MS. Soma < maxDuration. */
const POLL_MS = 3000;
const CONTACT_WAIT_MS = 40000;

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function applyCors(req, res) {
  res.setHeader('Vary', 'Origin');
  const origin = req.headers.origin;
  if (typeof origin === 'string' && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}

function parseBody(req) {
  /* sendBeacon manda text/plain: a Vercel entrega o body como string. */
  const body = req.body;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch (err) { return {}; }
  }
  if (body && Buffer.isBuffer(body)) {
    try { return JSON.parse(body.toString('utf8')); } catch (err) { return {}; }
  }
  return body || {};
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipBucket.get(ip);
  if (!entry || now > entry.resetAt) {
    ipBucket.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

function sanitizeText(value, maxLen) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLen);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ghl(ghlBaseUrl, pitToken) {
  const base = ghlBaseUrl.replace(/\/+$/, '');
  const headers = {
    Authorization: `Bearer ${pitToken}`,
    Accept: 'application/json',
    Version: '2021-07-28',
    'Content-Type': 'application/json',
  };
  return async (path, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  };
}

/* So match exato (a busca do GHL e fuzzy). Devolve o contato com tags. */
async function findContact(call, locationId, email, phone) {
  const phoneDigits = phone.replace(/\D/g, '');
  const lookups = [
    email && [email, (c) => String(c.email || '').toLowerCase() === email],
    phoneDigits && [`+${phoneDigits}`, (c) => String(c.phone || '').replace(/\D/g, '') === phoneDigits],
  ].filter(Boolean);
  for (const [query, matches] of lookups) {
    const qs = new URLSearchParams({ locationId, query, limit: '10' });
    const r = await call(`/contacts/?${qs}`);
    if (!r.ok) throw new Error(`search_http_${r.status}`);
    const match = (r.data?.contacts || []).find(matches);
    if (match) return match;
  }
  return null;
}

/* Agendamento ativo = nao cancelado e com inicio de 2 h atras em diante. */
async function hasActiveAppointment(call, contactId) {
  const r = await call(`/contacts/${contactId}/appointments`);
  if (!r.ok) return false;
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  return (r.data?.events || []).some((ev) => {
    const status = String(ev.appointmentStatus || ev.status || '').toLowerCase();
    if (status === 'cancelled' || status === 'canceled' || status === 'invalid') return false;
    const start = Date.parse(ev.startTime || '');
    return !Number.isFinite(start) || start >= cutoff;
  });
}

async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  if (isRateLimited(getClientIp(req))) return json(res, 429, { error: 'too_many_requests' });

  const pitToken = process.env.GHL_PIT_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  const ghlBaseUrl = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
  if (!pitToken || !locationId) return json(res, 500, { error: 'server_not_configured' });

  const input = parseBody(req);
  const status = sanitizeText(input.status, 20);
  const email = sanitizeText(input.email, 254).toLowerCase();
  const phone = sanitizeText(input.phone, 32);
  if (status !== 'nao-agendou' && status !== 'agendou') return json(res, 400, { error: 'invalid_status' });
  if (!email && !phone.replace(/\D/g, '')) return json(res, 400, { error: 'invalid_contact' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'invalid_email' });

  const call = ghl(ghlBaseUrl, pitToken);
  const startedAt = Date.now();
  let contact = null;
  try {
    while (!contact) {
      contact = await findContact(call, locationId, email, phone);
      if (contact || Date.now() - startedAt + POLL_MS > CONTACT_WAIT_MS) break;
      await sleep(POLL_MS);
    }
  } catch (err) {
    console.error('[agendamento] search falhou', { message: err && err.message });
    return json(res, 502, { error: 'upstream_unreachable' });
  }
  if (!contact) {
    console.warn('[agendamento] contato nao encontrado', { status, has_email: Boolean(email), waited_ms: Date.now() - startedAt });
    return json(res, 404, { error: 'contact_not_found' });
  }

  try {
    if (status === 'agendou') {
      /* DELETE e idempotente: nao depende das tags da busca (indice atrasado). */
      const r = await call(`/contacts/${contact.id}/tags`, 'DELETE', { tags: [TAG_NAO_AGENDADO] });
      console.log('[agendamento] tag removida', { contactId: contact.id, status: r.status });
      return json(res, r.ok ? 200 : 502, { ok: r.ok, removed: r.ok });
    }

    /* Tags frescas do contato (a busca pode vir com indice atrasado). */
    const full = await call(`/contacts/${contact.id}`);
    const tags = ((full.ok && full.data?.contact?.tags) || contact.tags || [])
      .map((t) => String(t).normalize('NFC').toLowerCase());
    if (!tags.includes(TAG_QUALIFICADO)) return json(res, 200, { ok: true, skipped: 'nao_qualificado' });
    if (await hasActiveAppointment(call, contact.id)) return json(res, 200, { ok: true, skipped: 'ja_agendado' });

    const r = await call(`/contacts/${contact.id}/tags`, 'POST', { tags: [TAG_NAO_AGENDADO] });
    console.log('[agendamento] tag adicionada', { contactId: contact.id, status: r.status });
    return json(res, r.ok ? 200 : 502, { ok: r.ok, added: r.ok });
  } catch (err) {
    console.error('[agendamento] write falhou', { message: err && err.message });
    return json(res, 502, { error: 'upstream_unreachable' });
  }
}

module.exports = handler;
