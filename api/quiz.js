const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;
const ipBucket = new Map();
const LEAD_SOURCE = 'FAQ03 - Playbook Quiz';

const ALLOWED_Q1 = new Set([
  'equipe-call',
  'eu-call',
  'chat-email',
  'whatsapp',
  'fisico',
]);

const ALLOWED_Q2 = new Set([
  'conversao-treinamento',
  'gestao-numeros',
  'baixo-reunioes',
  'falta-resposta',
  'todos',
]);

const ALLOWED_Q3 = new Set(['sempre', 'as-vezes', 'quase-nunca']);

const ALLOWED_Q4 = new Set([
  'apenas-eu',
  '1-5',
  '5-10',
  '10-20',
  '20-50',
  'acima-50',
]);

const ALLOWED_Q5 = new Set(['1', '2', '3', '4', '5']);

const Q1_LABELS = {
  'equipe-call': 'Tenho equipe comercial que fecha por call/meeting',
  'eu-call': 'Eu mesmo fecho por call/meeting',
  'chat-email': 'Vendo mais por chat/e-mail',
  'whatsapp': 'Utilizo o WhatsApp para fechar minhas vendas',
  'fisico': 'Tenho negócio físico e vendo pessoalmente',
};

const Q2_LABELS = {
  'conversao-treinamento': 'Conversão e Treinamento dos Vendedores',
  'gestao-numeros': 'Gestão dos números do negócio',
  'baixo-reunioes': 'Baixo volume de reuniões diárias',
  'falta-resposta': 'Falta de resposta dos leads',
  'todos': 'Todos acima',
};

const Q3_LABELS = {
  'sempre': 'Sempre',
  'as-vezes': 'Às vezes',
  'quase-nunca': 'Quase nunca',
};

const Q4_LABELS = {
  'apenas-eu': 'Apenas eu',
  '1-5': 'De 1 a 5',
  '5-10': 'De 5 a 10',
  '10-20': 'De 10 a 20',
  '20-50': 'De 20 a 50',
  'acima-50': 'Acima de 50',
};

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
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
  if (entry.count > MAX_REQUESTS_PER_WINDOW) return true;
  return false;
}

function sanitizeText(value, maxLen) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLen);
}

function normalizeWhatsapp(value) {
  const raw = sanitizeText(value, 32);
  const digits = raw.replace(/\D+/g, '');
  if (!digits) return '';
  // Garante DDI 55 quando vier só DDD+número (10 ou 11 dígitos).
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

function validatePayload(input) {
  const q2Raw = Array.isArray(input.q2) ? input.q2 : [];
  const payload = {
    submission_id: sanitizeText(input.submission_id, 80),
    submitted_at: sanitizeText(input.submitted_at, 40),
    page: sanitizeText(input.page, 500),
    email: sanitizeText(input.email, 254).toLowerCase(),
    whatsapp: normalizeWhatsapp(input.whatsapp),
    nome: sanitizeText(input.nome, 120),
    classification: sanitizeText(input.classification, 40),
    q1: sanitizeText(input.q1, 40),
    q2: q2Raw.map((v) => sanitizeText(v, 40)).filter(Boolean),
    q3: sanitizeText(input.q3, 40),
    q4: sanitizeText(input.q4, 40),
    q5: sanitizeText(input.q5, 4),
  };

  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(payload.submission_id)) return null;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(payload.submitted_at)) return null;
  if (!payload.email && !payload.whatsapp) return null;
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return null;
  if (!ALLOWED_Q1.has(payload.q1)) return null;
  if (payload.q2.length === 0 || payload.q2.length > 5) return null;
  for (const v of payload.q2) if (!ALLOWED_Q2.has(v)) return null;
  if (!ALLOWED_Q3.has(payload.q3)) return null;
  if (!ALLOWED_Q4.has(payload.q4)) return null;
  if (!ALLOWED_Q5.has(payload.q5)) return null;

  return payload;
}

function buildNoteBody(payload) {
  const q2Text = payload.q2.map((v) => `> ${Q2_LABELS[v] || v}`).join('\n');
  const lines = [
    'Quiz FAQ03 — Playbook (Descoberta de Gargalo Comercial)',
    `Enviado em: ${payload.submitted_at}`,
    `Página: ${payload.page}`,
    payload.classification ? `Classificação prévia: ${payload.classification}` : null,
    '',
    'P1 — Como a sua empresa vende hoje?',
    `> ${Q1_LABELS[payload.q1] || payload.q1}`,
    '',
    'P2 — Principais obstáculos nas vendas:',
    q2Text,
    '',
    'P3 — Faz perguntas antes de apresentar?',
    `> ${Q3_LABELS[payload.q3] || payload.q3}`,
    '',
    'P4 — Número de colaboradores:',
    `> ${Q4_LABELS[payload.q4] || payload.q4}`,
    '',
    'P5 — Disposição para profissionalizar o comercial (1-5):',
    `> ${payload.q5}`,
  ];
  return lines.filter((l) => l !== null).join('\n');
}

async function searchContactByEmail(ghlBaseUrl, pitToken, locationId, email) {
  const query = new URLSearchParams({ locationId, query: email, limit: '5' });
  const endpoint = `${ghlBaseUrl.replace(/\/+$/, '')}/contacts/?${query.toString()}`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${pitToken}`,
      Accept: 'application/json',
      Version: '2021-07-28',
    },
  });
  if (!response.ok) {
    console.warn('[ghl] search by email failed', { status: response.status });
    return null;
  }
  const data = await response.json().catch(() => null);
  const contacts = (data && (data.contacts || data.contact)) || [];
  const list = Array.isArray(contacts) ? contacts : [contacts];
  const match = list.find((c) => c && typeof c.email === 'string' && c.email.toLowerCase() === email);
  return (match && match.id) || (list[0] && list[0].id) || null;
}

async function searchContactByPhone(ghlBaseUrl, pitToken, locationId, phone) {
  const query = new URLSearchParams({ locationId, query: phone, limit: '5' });
  const endpoint = `${ghlBaseUrl.replace(/\/+$/, '')}/contacts/?${query.toString()}`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${pitToken}`,
      Accept: 'application/json',
      Version: '2021-07-28',
    },
  });
  if (!response.ok) {
    console.warn('[ghl] search by phone failed', { status: response.status });
    return null;
  }
  const data = await response.json().catch(() => null);
  const contacts = (data && (data.contacts || data.contact)) || [];
  const list = Array.isArray(contacts) ? contacts : [contacts];
  return (list[0] && list[0].id) || null;
}

async function addContactNote(ghlBaseUrl, pitToken, contactId, body) {
  const endpoint = `${ghlBaseUrl.replace(/\/+$/, '')}/contacts/${contactId}/notes`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pitToken}`,
      Accept: 'application/json',
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('[ghl] add note failed', { status: response.status, error: text.slice(0, 300) });
  }
  return response.ok;
}

async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const ip = getClientIp(req);
  if (isRateLimited(ip)) return json(res, 429, { error: 'too_many_requests' });

  const pitToken = process.env.GHL_PIT_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  const ghlBaseUrl = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';
  if (!pitToken || !locationId) return json(res, 500, { error: 'server_not_configured' });

  const payload = validatePayload(req.body || {});
  if (!payload) return json(res, 400, { error: 'invalid_payload' });

  console.log('[quiz] received', {
    submission_id: payload.submission_id,
    has_email: Boolean(payload.email),
    has_whatsapp: Boolean(payload.whatsapp),
    classification: payload.classification,
  });

  let contactId = null;
  try {
    if (payload.email) {
      contactId = await searchContactByEmail(ghlBaseUrl, pitToken, locationId, payload.email);
    }
    if (!contactId && payload.whatsapp) {
      contactId = await searchContactByPhone(ghlBaseUrl, pitToken, locationId, payload.whatsapp);
    }
  } catch (err) {
    console.error('[ghl] search threw', { message: err && err.message });
    return json(res, 502, { error: 'upstream_unreachable' });
  }

  if (!contactId) {
    console.warn('[quiz] contact not found', {
      email: payload.email,
      whatsapp: payload.whatsapp,
    });
    return json(res, 404, { error: 'contact_not_found' });
  }

  const noteBody = buildNoteBody(payload);

  try {
    const noteOk = await addContactNote(ghlBaseUrl, pitToken, contactId, noteBody);
    if (!noteOk) return json(res, 502, { error: 'upstream_rejected' });
    return json(res, 202, { ok: true, contactId, noteOk });
  } catch (err) {
    console.error('[ghl] write threw', { message: err && err.message });
    return json(res, 502, { error: 'upstream_unreachable' });
  }
}

module.exports = handler;
