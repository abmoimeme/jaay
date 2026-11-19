// Jaay email worker (Cloudflare Worker). Sends campaigns through Brevo for signed-in owners and managers.
//
// What it guarantees, whatever the browser sends:
//  - the caller must hold a valid Firebase sign-in for this project (RS256 token checked against Google's keys);
//  - the caller's role (owner or manager) is read from Firestore with THEIR OWN token, so the database rules apply;
//  - recipients are re-read from the customer list on the server: only contacts who agreed (or, for the one-time
//    invitation, who were never asked) and never anyone who refused; the browser only names contact ids;
//  - scripts and event handlers are stripped from the HTML; every campaign carries Brevo's unsubscribe link.
//
// Secrets (set in Cloudflare, never in GitHub): BREVO_KEY, LINK_SECRET.
// Variables (wrangler.toml): FIREBASE_PROJECT, SENDER_EMAIL, SENDER_NAME, REPLY_TO, ALLOWED_ORIGINS, DAILY_LIMIT.
// KV namespace binding: OPTINS (answers to the invitation email).

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/;
const STORE_RE = /^[a-z0-9]{3,20}$/;
const enc = new TextEncoder(), dec = new TextDecoder();

class HttpError extends Error { constructor(status, message){ super(message); this.status = status; } }

const b64uBytes = s => { const p = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(p + '='.repeat((4 - p.length % 4) % 4)), c => c.charCodeAt(0)); };
const b64uText = bytes => { let s = ''; for(const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

/* ---------- sign-in ---------- */
let jwks = { at: 0, keys: null };
async function googleKeys(f){
  if(jwks.keys && Date.now() - jwks.at < 3600e3) return jwks.keys;
  const r = await f(JWKS_URL); if(!r.ok) throw new HttpError(502, 'Could not read Google sign-in keys');
  jwks = { at: Date.now(), keys: (await r.json()).keys || [] }; return jwks.keys;
}
export async function verifyIdToken(token, env, f = fetch){
  const parts = String(token || '').split('.'); if(parts.length !== 3) throw new HttpError(401, 'Not signed in');
  let head, body; try{ head = JSON.parse(dec.decode(b64uBytes(parts[0]))); body = JSON.parse(dec.decode(b64uBytes(parts[1]))); }catch(e){ throw new HttpError(401, 'Not signed in'); }
  if(head.alg !== 'RS256') throw new HttpError(401, 'Not signed in');
  const jwk = (await googleKeys(f)).find(k => k.kid === head.kid); if(!jwk) throw new HttpError(401, 'Not signed in');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64uBytes(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
  const now = Math.floor(Date.now() / 1000), pid = env.FIREBASE_PROJECT;
  if(!ok || body.iss !== 'https://securetoken.google.com/' + pid || body.aud !== pid || !(body.exp > now) || body.iat > now + 60 || !body.sub) throw new HttpError(401, 'Not signed in');
  return { uid: body.sub, email: String(body.email || '').toLowerCase() };
}

/* ---------- Firestore (REST, with the caller's own token) ---------- */
function fv(v){
  if(!v) return null;
  if('stringValue' in v) return v.stringValue; if('integerValue' in v) return Number(v.integerValue); if('doubleValue' in v) return v.doubleValue;
  if('booleanValue' in v) return v.booleanValue; if('timestampValue' in v) return v.timestampValue;
  if('mapValue' in v) return fm(v.mapValue.fields || {}); if('arrayValue' in v) return (v.arrayValue.values || []).map(fv); return null;
}
const fm = fields => { const o = {}; for(const k in fields) o[k] = fv(fields[k]); return o; };
const fsBase = env => 'https://firestore.googleapis.com/v1/projects/' + env.FIREBASE_PROJECT + '/databases/(default)/documents/';
async function fsGet(env, f, token, path){
  const r = await f(fsBase(env) + path, { headers: { authorization: 'Bearer ' + token } });
  if(r.status === 404) return null;
  if(r.status === 401 || r.status === 403) throw new HttpError(403, 'Not allowed');
  if(!r.ok) throw new HttpError(502, 'Database error');
  return r.json();
}
async function authorize(req, body, env, f){
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const user = await verifyIdToken(token, env, f);
  const store = String(body.store || ''); if(!STORE_RE.test(store)) throw new HttpError(400, 'Bad store');
  const doc = await fsGet(env, f, token, 'stores/' + store + '/members/' + user.uid);
  const m = doc ? fm(doc.fields || {}) : null;
  if(!m || m.active !== true || !['owner', 'manager'].includes(m.role)) throw new HttpError(403, 'Only the owner and managers can send email');
  return Object.assign({ token, store, role: m.role }, user);
}
async function loadContacts(env, f, token, store){
  const out = {}; let page = '';
  for(let i = 0; i < 12; i++){
    const doc = await fsGet(env, f, token, 'stores/' + store + '/crm?pageSize=100' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    if(!doc) break;
    for(const d of doc.documents || []){ const c = (fm(d.fields || {}).c) || {}; for(const id in c) out[id] = c[id]; }
    page = doc.nextPageToken || ''; if(!page) break;
  }
  return out;
}

/* ---------- recipients ---------- */
const firstOf = c => { const n = String(c.name || '').trim(); return c.type === 'Particulier' ? n.split(/\s+/)[0] || '' : String(c.contact || n); };
const lastOf = c => { const n = String(c.name || '').trim().split(/\s+/); return c.type === 'Particulier' ? n.slice(1).join(' ') : ''; };
// mode 'subscribed': only contacts who agreed. mode 'ask': only contacts never asked (the one-time invitation). Refused: never.
export function pickRecipients(contacts, ids, mode){
  const seen = new Set(), list = [], skipped = { missing: 0, archived: 0, noEmail: 0, noConsent: 0, duplicate: 0 };
  for(const id of [...new Set(ids)]){
    const c = contacts[id];
    if(!c){ skipped.missing++; continue; }
    if(c.archived){ skipped.archived++; continue; }
    const email = String(c.email || '').trim().toLowerCase();
    if(!EMAIL_RE.test(email)){ skipped.noEmail++; continue; }
    const consent = c.emailOk || 'unknown';
    if(mode === 'ask' ? consent !== 'unknown' : consent !== 'yes'){ skipped.noConsent++; continue; }
    if(seen.has(email)){ skipped.duplicate++; continue; }
    seen.add(email); list.push({ id, email, first: firstOf(c), last: lastOf(c) });
  }
  return { list, skipped };
}

/* ---------- HTML ---------- */
export function cleanHtml(h){
  return String(h || '')
    .replace(/<(script|iframe|object|embed|form|style)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<\/?(script|iframe|object|embed|form|base|meta|link)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*(javascript|data|vbscript):[^"']*\2/gi, '$1=$2#$2');
}
const FOOTER = '<p style="font-size:12px;color:#6b7280;text-align:center;margin:24px 0 0"><a href="{{ unsubscribe }}" style="color:#6b7280">Unsubscribe / Se désabonner</a></p>';
export function buildHtml(html, attr, mode){
  let h = cleanHtml(html);
  if(mode === 'ask'){
    h = h.replace(/\{\{\s*optin\s*\}\}/g, '{{ params.optinUrl }}').replace(/\{\{\s*stop\s*\}\}/g, '{{ params.stopUrl }}').replace(/\{(prénom|prenom|first)\}/gi, '{{ params.FIRSTNAME }}').replace(/\{(nom|last)\}/gi, '{{ params.LASTNAME }}');
    return h;
  }
  h = h.replace(/\{(prénom|prenom|first)\}/gi, '{{ contact.' + attr.first + ' }}').replace(/\{(nom|last)\}/gi, '{{ contact.' + attr.last + ' }}');
  if(!/\{\{\s*unsubscribe\s*\}\}|\[UNSUBSCRIBE\]/i.test(h)) h = /<\/body>/i.test(h) ? h.replace(/<\/body>/i, FOOTER + '</body>') : h + FOOTER;
  return h;
}
const sample = (h, name) => cleanHtml(h).replace(/\{(prénom|prenom|first)\}/gi, name).replace(/\{(nom|last)\}/gi, 'Diop').replace(/\{\{\s*(unsubscribe|optin|stop)\s*\}\}/g, '#');

/* ---------- Brevo ---------- */
async function brevo(env, f, method, path, body){
  const r = await f('https://api.brevo.com/v3' + path, { method, headers: { 'api-key': env.BREVO_KEY, accept: 'application/json', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let j = {}; try{ j = text ? JSON.parse(text) : {}; }catch(e){ j = { message: text }; }
  if(!r.ok) throw new HttpError(502, 'Brevo: ' + (j.message || r.status));
  return j;
}
async function attrNames(env, f){
  const j = await brevo(env, f, 'GET', '/contacts/attributes'), names = (j.attributes || []).map(a => a.name);
  return { first: ['FIRSTNAME', 'PRENOM'].find(n => names.includes(n)) || 'FIRSTNAME', last: ['LASTNAME', 'NOM'].find(n => names.includes(n)) || 'LASTNAME' };
}
const sender = env => ({ name: env.SENDER_NAME || 'Planet Auto Hub', email: env.SENDER_EMAIL });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sendCampaign(env, f, who, b){
  const mode = b.mode === 'ask' ? 'ask' : 'subscribed';
  const subject = String(b.subject || '').trim().slice(0, 200), name = String(b.name || '').trim().slice(0, 120) || subject;
  if(!subject) throw new HttpError(400, 'Subject missing');
  if(!b.html || String(b.html).length > 300000) throw new HttpError(400, 'Content missing or too large');
  if(!Array.isArray(b.contactIds) || !b.contactIds.length) throw new HttpError(400, 'No recipients');
  const contacts = await loadContacts(env, f, who.token, who.store), pick = pickRecipients(contacts, b.contactIds, mode);
  const limit = Number(env.DAILY_LIMIT || 300);
  if(!pick.list.length) throw new HttpError(400, 'Nobody in this audience agreed to receive email');
  if(pick.list.length > limit) throw new HttpError(400, 'Too many recipients for one day (' + pick.list.length + '; the limit is ' + limit + '). Narrow the audience or send in batches.');
  const at = b.scheduledAt ? new Date(b.scheduledAt) : null;
  if(at && (isNaN(+at) || +at < Date.now() + 120e3 || +at > Date.now() + 365 * 864e5)) throw new HttpError(400, 'Choose a time in the future');
  const attr = await attrNames(env, f);

  if(mode === 'ask'){
    if(at) throw new HttpError(400, 'The invitation is sent right away');
    const base = String(env.PUBLIC_URL || '').replace(/\/$/, '');
    const html = buildHtml(b.html, attr, 'ask'), versions = [];
    for(const r of pick.list) versions.push({ to: [{ email: r.email, name: r.first || undefined }], params: { FIRSTNAME: r.first, LASTNAME: r.last, optinUrl: base + '/o?c=' + encodeURIComponent(r.id) + '&a=yes&s=' + await sig(env, r.id, 'yes'), stopUrl: base + '/o?c=' + encodeURIComponent(r.id) + '&a=no&s=' + await sig(env, r.id, 'no') } });
    let sent = 0;
    for(let i = 0; i < versions.length; i += 100){ await brevo(env, f, 'POST', '/smtp/email', { sender: sender(env), replyTo: env.REPLY_TO ? { email: env.REPLY_TO } : undefined, subject, htmlContent: html, messageVersions: versions.slice(i, i + 100), tags: ['jaay-invite'] }); sent += Math.min(100, versions.length - i); }
    return { kind: 'invite', recipients: sent, skipped: pick.skipped, status: 'sent' };
  }

  const folders = await brevo(env, f, 'GET', '/contacts/folders?limit=1&offset=0'), folderId = (folders.folders || [])[0] && folders.folders[0].id;
  if(!folderId) throw new HttpError(502, 'Brevo has no contact folder yet');
  const list = await brevo(env, f, 'POST', '/contacts/lists', { name: ('Jaay ' + name + ' ' + new Date().toISOString().slice(0, 10)).slice(0, 120), folderId });
  const imp = await brevo(env, f, 'POST', '/contacts/import', { listIds: [list.id], updateExistingContacts: true, emptyContactsAttributes: false, jsonBody: pick.list.map(r => ({ email: r.email, attributes: { [attr.first]: r.first, [attr.last]: r.last } })) });
  if(imp.processId){
    let done = false;
    for(let i = 0; i < 20 && !done; i++){ await sleep(i ? 1500 : 500); const p = await brevo(env, f, 'GET', '/processes/' + imp.processId); done = p.status === 'completed'; if(p.status === 'error' || p.status === 'failed') throw new HttpError(502, 'Brevo could not import the contacts'); }
    if(!done) throw new HttpError(504, 'Brevo is still importing the contacts. Nothing was sent; try again in a minute.');
  }
  const camp = await brevo(env, f, 'POST', '/emailCampaigns', Object.assign({ name, subject, sender: sender(env), htmlContent: buildHtml(b.html, attr, 'subscribed'), recipients: { listIds: [list.id] }, tag: 'jaay' },
    env.REPLY_TO ? { replyTo: env.REPLY_TO } : {}, at ? { scheduledAt: at.toISOString() } : {}));
  if(!at) await brevo(env, f, 'POST', '/emailCampaigns/' + camp.id + '/sendNow');
  return { kind: 'campaign', brevoId: camp.id, listId: list.id, recipients: pick.list.length, skipped: pick.skipped, status: at ? 'scheduled' : 'sent', scheduledAt: at ? at.toISOString() : '' };
}

async function sendTest(env, f, who, b){
  const subject = String(b.subject || '').trim().slice(0, 200); if(!subject || !b.html) throw new HttpError(400, 'Subject or content missing');
  const to = String(b.to || who.email).toLowerCase();
  if(to !== who.email) throw new HttpError(400, 'A test goes only to your own sign-in email');
  await brevo(env, f, 'POST', '/smtp/email', { sender: sender(env), to: [{ email: to }], subject: '[TEST] ' + subject, htmlContent: sample(b.html, 'Moussa'), tags: ['jaay-test'] });
  return { sent: 1, to };
}

async function stats(env, f, b){
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(n => n > 0).slice(0, 10), out = {};
  for(const id of ids){
    const g = await brevo(env, f, 'GET', '/emailCampaigns/' + id + '?statistics=globalStats'), l = await brevo(env, f, 'GET', '/emailCampaigns/' + id + '?statistics=linksStats');
    const s = ((g.statistics || {}).globalStats) || {}, links = ((l.statistics || {}).linksStats) || {};
    out[id] = { status: g.status || '', sent: s.sent || 0, delivered: s.delivered || 0, opens: s.uniqueViews || 0, clicks: s.uniqueClicks || 0, unsub: s.unsubscriptions || 0, bounces: (s.hardBounces || 0) + (s.softBounces || 0), complaints: s.complaints || 0, links };
  }
  return { stats: out };
}

async function unsubscribed(env, f, b){
  const since = b.since ? new Date(b.since) : new Date(Date.now() - 30 * 864e5), emails = [];
  for(let off = 0; off < 2000; off += 500){
    const j = await brevo(env, f, 'GET', '/contacts?limit=500&offset=' + off + '&modifiedSince=' + encodeURIComponent(since.toISOString()) + '&sort=desc'), cs = j.contacts || [];
    for(const c of cs) if(c.emailBlacklisted) emails.push(String(c.email).toLowerCase());
    if(cs.length < 500) break;
  }
  return { emails };
}

/* ---------- answers to the invitation (public page) ---------- */
async function sig(env, id, a){
  const key = await crypto.subtle.importKey('raw', enc.encode(env.LINK_SECRET || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64uText(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(id + '.' + a)))).slice(0, 24);
}
const page = (title, text) => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + '</title><body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;text-align:center"><h1 style="font-size:22px">' + title + '</h1><p style="color:#444">' + text + '</p></body>', { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
async function answer(env, url){
  const c = url.searchParams.get('c') || '', a = url.searchParams.get('a') || '', s = url.searchParams.get('s') || '';
  if(!/^[A-Za-z0-9_-]{2,40}$/.test(c) || !['yes', 'no'].includes(a) || s !== await sig(env, c, a)) return page('Lien invalide / Invalid link', 'Ce lien n’est pas valide. / This link is not valid.');
  await env.OPTINS.put('o:' + c, '', { metadata: { a, ts: Date.now() } });
  return a === 'yes' ? page('Merci ! / Thank you!', 'Vous recevrez les nouveautés et promotions de Planet Auto Hub. Vous pourrez vous désabonner à tout moment. / You will receive news and offers from Planet Auto Hub. You can unsubscribe at any time.')
    : page('C’est noté / Noted', 'Vous ne recevrez plus de promotions par e-mail. / You will not receive promotional emails.');
}
async function optins(env){
  const out = []; let cursor;
  for(let i = 0; i < 5; i++){ const l = await env.OPTINS.list({ prefix: 'o:', cursor }); for(const k of l.keys) if(k.metadata) out.push({ id: k.name.slice(2), a: k.metadata.a, ts: k.metadata.ts }); if(l.list_complete) break; cursor = l.cursor; }
  return { optins: out };
}
async function ack(env, b){ for(const id of (Array.isArray(b.ids) ? b.ids : []).slice(0, 500)) if(/^[A-Za-z0-9_-]{2,40}$/.test(id)) await env.OPTINS.delete('o:' + id); return { ok: true }; }

/* ---------- entry ---------- */
const json = (o, status, cors) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, cors) });
export async function handle(req, env, f = fetch){
  const url = new URL(req.url), origins = String(env.ALLOWED_ORIGINS || 'https://app.planetautohub.com').split(',').map(s => s.trim()), origin = req.headers.get('origin') || '';
  const cors = origins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
  if(req.method === 'GET' && url.pathname === '/o') return answer(env, url);
  if(req.method === 'GET' && url.pathname === '/health') return json({ ok: true, brevo: !!env.BREVO_KEY, sender: !!env.SENDER_EMAIL, kv: !!env.OPTINS }, 200, cors);
  if(req.method === 'OPTIONS') return new Response(null, { status: 204, headers: Object.assign({ 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400' }, cors) });
  if(req.method !== 'POST') return json({ error: 'Not found' }, 404, cors);
  if(origin && !origins.includes(origin)) return json({ error: 'Origin not allowed' }, 403, cors);
  try{
    let b = {}; try{ b = await req.json(); }catch(e){ throw new HttpError(400, 'Bad request'); }
    const who = await authorize(req, b, env, f);
    if(url.pathname === '/send') return json(await sendCampaign(env, f, who, b), 200, cors);
    if(url.pathname === '/test') return json(await sendTest(env, f, who, b), 200, cors);
    if(url.pathname === '/stats') return json(await stats(env, f, b), 200, cors);
    if(url.pathname === '/unsubs') return json(await unsubscribed(env, f, b), 200, cors);
    if(url.pathname === '/optins') return json(await optins(env), 200, cors);
    if(url.pathname === '/optins/ack') return json(await ack(env, b), 200, cors);
    return json({ error: 'Not found' }, 404, cors);
  }catch(e){
    const st = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof HttpError ? e.message : 'Server error' }, st, cors);
  }
}
export default { fetch: (req, env) => handle(req, env) };
