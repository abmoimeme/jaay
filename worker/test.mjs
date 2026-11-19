// Run: node --test worker/test.mjs   (Node 18+)
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, verifyIdToken, pickRecipients, cleanHtml, buildHtml } from './index.js';

const P = 'jaay-69598', b64u = b => Buffer.from(b).toString('base64url');
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = Object.assign(await crypto.subtle.exportKey('jwk', kp.publicKey), { kid: 'k1', alg: 'RS256', use: 'sig' });
async function token(over = {}, key = kp.privateKey){
  const now = Math.floor(Date.now() / 1000), head = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const body = b64u(JSON.stringify(Object.assign({ iss: 'https://securetoken.google.com/' + P, aud: P, sub: 'u1', email: 'ab@example.com', iat: now - 10, exp: now + 3000 }, over)));
  const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + body))).toString('base64url');
  return head + '.' + body + '.' + sig;
}
const S = v => ({ stringValue: v }), M = o => ({ mapValue: { fields: o } });
const contact = (name, email, ok, extra = {}) => M(Object.assign({ name: S(name), type: S('Particulier') }, email ? { email: S(email) } : {}, ok ? { emailOk: S(ok) } : {}, extra));
function world({ role = 'manager', active = true } = {}){
  const calls = [];
  const f = async (url, init = {}) => {
    url = String(url); const m = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null; calls.push({ url, m, body, auth: (init.headers || {}).authorization, key: (init.headers || {})['api-key'] });
    const R = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if(url.includes('securetoken@system')) return R({ keys: [jwk] });
    if(url.includes('/members/')) return url.endsWith('/u1') ? R({ fields: { role: S(role), active: { booleanValue: active } } }) : R({}, 404);
    if(url.includes('/stores/pah/crm')) return R({ documents: [{ fields: { c: M({
      a1: contact('Moussa Diop', 'Moussa@Example.com', 'yes'), a2: contact('Awa Fall', 'awa@example.com', 'no'), a3: contact('Ibou Sy', 'ibou@example.com', 'unknown'),
      a4: contact('Fatou Ba', 'moussa@example.com', 'yes'), a5: contact('Sans Mail', '', 'yes'), a6: contact('Archive Un', 'arch@example.com', 'yes', { archived: { booleanValue: true } }), a7: contact('Jamais Demande', 'new@example.com', null) }) } }] });
    if(url.endsWith('/contacts/attributes')) return R({ attributes: [{ name: 'PRENOM' }, { name: 'NOM' }] });
    if(url.includes('/contacts/folders')) return R({ folders: [{ id: 7 }] });
    if(url.endsWith('/contacts/lists')) return R({ id: 55 });
    if(url.endsWith('/contacts/import')) return R({ processId: 9 });
    if(url.endsWith('/processes/9')) return R({ status: 'completed' });
    if(url.endsWith('/emailCampaigns') && m === 'POST') return R({ id: 321 });
    if(url.endsWith('/sendNow')) return new Response(null, { status: 204 });
    if(url.endsWith('/smtp/email')) return R({ messageId: 'x' }, 201);
    if(url.includes('statistics=globalStats')) return R({ status: 'sent', statistics: { globalStats: { sent: 10, delivered: 9, uniqueViews: 4, uniqueClicks: 2, unsubscriptions: 1, hardBounces: 1, softBounces: 0, complaints: 0 } } });
    if(url.includes('statistics=linksStats')) return R({ statistics: { linksStats: { 'https://wa.me/221787537676': 2 } } });
    if(url.includes('/contacts?limit=500')) return R({ contacts: [{ email: 'Awa@example.com', emailBlacklisted: true }, { email: 'ok@example.com', emailBlacklisted: false }] });
    return R({ message: 'unexpected ' + url }, 500);
  };
  return { f, calls };
}
const env = { FIREBASE_PROJECT: P, BREVO_KEY: 'k', SENDER_EMAIL: 'contact@planetautohub.com', ALLOWED_ORIGINS: 'https://app.planetautohub.com', DAILY_LIMIT: '300', LINK_SECRET: 'secret', PUBLIC_URL: 'https://w.example', OPTINS: (() => { const m = new Map(); return { put: async (k, v, o) => m.set(k, o.metadata), delete: async k => m.delete(k), list: async () => ({ keys: [...m].map(([name, metadata]) => ({ name, metadata })), list_complete: true }) }; })() };
const call = async (path, body, w, tok, origin = 'https://app.planetautohub.com') => {
  const r = await handle(new Request('https://w.example' + path, { method: 'POST', headers: { authorization: 'Bearer ' + (tok === undefined ? await token() : tok), origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, w.f);
  return { status: r.status, body: await r.json() };
};
const send = { store: 'pah', name: 'Promo', subject: 'Offre', html: '<p>Bonjour {prénom}</p><script>x()</script><a href="javascript:evil()" onclick="x()">go</a>', contactIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'zz'] };

test('token: valid, forged, expired, wrong project', async () => {
  const w = world(); assert.equal((await verifyIdToken(await token(), env, w.f)).uid, 'u1');
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  for(const t of [await token({}, other.privateKey), await token({ exp: 1 }), await token({ aud: 'other' }), await token({ iss: 'x' }), 'a.b.c', '']) await assert.rejects(verifyIdToken(t, env, w.f));
});
test('only owner and manager; inactive refused; bad origin refused; no token refused', async () => {
  for(const role of ['cashier', 'stock', 'accountant']) assert.equal((await call('/send', send, world({ role }))).status, 403);
  assert.equal((await call('/send', send, world({ active: false }))).status, 403);
  assert.equal((await call('/send', send, world(), 'junk')).status, 401);
  assert.equal((await call('/send', send, world(), undefined, 'https://evil.example')).status, 403);
  assert.equal((await call('/send', Object.assign({}, send, { store: 'Bad Store!' }), world())).status, 400);
});
test('recipients: consent only, no refusals, no duplicates, archived and no-email skipped', () => {
  const c = { a1: { name: 'A', type: 'Particulier', email: 'x@y.sn', emailOk: 'yes' }, a2: { name: 'B', email: 'b@y.sn', emailOk: 'no' }, a3: { name: 'C', email: 'c@y.sn' }, a4: { name: 'D', email: 'X@y.sn', emailOk: 'yes' } };
  const s = pickRecipients(c, ['a1', 'a2', 'a3', 'a4'], 'subscribed'); assert.deepEqual(s.list.map(r => r.id), ['a1']); assert.equal(s.skipped.noConsent, 2); assert.equal(s.skipped.duplicate, 1);
  const a = pickRecipients(c, ['a1', 'a2', 'a3', 'a4'], 'ask'); assert.deepEqual(a.list.map(r => r.id), ['a3']);
});
test('send now: server re-checks consent, imports, creates and sends the campaign', async () => {
  const w = world(), r = await call('/send', send, w);
  assert.equal(r.status, 200); assert.equal(r.body.recipients, 1); assert.equal(r.body.status, 'sent'); assert.equal(r.body.brevoId, 321);
  const imp = w.calls.find(c => c.url.endsWith('/contacts/import')).body; assert.deepEqual(imp.jsonBody.map(x => x.email), ['moussa@example.com']); assert.equal(imp.jsonBody[0].attributes.PRENOM, 'Moussa');
  const camp = w.calls.find(c => c.url.endsWith('/emailCampaigns') && c.m === 'POST').body;
  assert.ok(!/<script|javascript:|onclick/i.test(camp.htmlContent)); assert.ok(camp.htmlContent.includes('{{ contact.PRENOM }}')); assert.ok(camp.htmlContent.includes('{{ unsubscribe }}'));
  assert.equal(camp.sender.email, 'contact@planetautohub.com');
  const order = w.calls.map(c => c.url.split('/v3')[1] || '').filter(Boolean); assert.ok(order.indexOf('/processes/9') < order.indexOf('/emailCampaigns')); assert.ok(order.indexOf('/emailCampaigns') < order.findIndex(u => u.endsWith('/sendNow')));
  assert.ok(w.calls.filter(c => c.url.includes('firestore')).every(c => c.auth.startsWith('Bearer ')));
});
test('schedule: sent to Brevo with the time, not sent now; past time refused', async () => {
  const w = world(), at = new Date(Date.now() + 5 * 864e5).toISOString(), r = await call('/send', Object.assign({}, send, { scheduledAt: at }), w);
  assert.equal(r.body.status, 'scheduled'); assert.ok(!w.calls.some(c => c.url.endsWith('/sendNow'))); assert.equal(w.calls.find(c => c.url.endsWith('/emailCampaigns') && c.m === 'POST').body.scheduledAt, at);
  assert.equal((await call('/send', Object.assign({}, send, { scheduledAt: new Date(Date.now() - 1e3).toISOString() }), world())).status, 400);
});
test('daily limit and empty audience refused before anything is created', async () => {
  const w = world(); env.DAILY_LIMIT = '0'; const r = await call('/send', send, w); env.DAILY_LIMIT = '300';
  assert.equal(r.status, 400); assert.ok(!w.calls.some(c => c.url.includes('api.brevo.com') && c.m === 'POST'));
  assert.equal((await call('/send', Object.assign({}, send, { contactIds: ['a2', 'a5'] }), world())).status, 400);
});
test('invitation: only never-asked contacts, personal signed links, sent right away', async () => {
  const w = world(), r = await call('/send', Object.assign({}, send, { mode: 'ask', html: '<a href="{{optin}}">Oui</a> <a href="{{stop}}">Non</a> {prénom}' }), w);
  assert.equal(r.status, 200); assert.equal(r.body.kind, 'invite'); assert.equal(r.body.recipients, 2);
  const v = w.calls.find(c => c.url.endsWith('/smtp/email')).body.messageVersions; assert.deepEqual(v.map(x => x.to[0].email), ['ibou@example.com', 'new@example.com']);
  assert.match(v[0].params.optinUrl, /^https:\/\/w\.example\/o\?c=a3&a=yes&s=/); assert.ok(!w.calls.some(c => c.url.endsWith('/sendNow')));
  assert.equal((await call('/send', Object.assign({}, send, { mode: 'ask', scheduledAt: new Date(Date.now() + 864e5).toISOString() }), world())).status, 400);
});
test('invitation answers: signed link records the answer; forged link does nothing; staff collect and clear', async () => {
  const w = world(), v = (await call('/send', Object.assign({}, send, { mode: 'ask', html: '<a href="{{optin}}">x</a>' }), w)), url = new URL(w.calls.find(c => c.url.endsWith('/smtp/email')).body.messageVersions[0].params.optinUrl);
  assert.equal((await handle(new Request(url), env)).status, 200);
  const bad = new URL(url); bad.searchParams.set('a', 'no'); assert.match(await (await handle(new Request(bad), env)).text(), /invalid|valide/i);
  const o = await call('/optins', { store: 'pah' }, world()); assert.deepEqual(o.body.optins.map(x => [x.id, x.a]), [['a3', 'yes']]);
  await call('/optins/ack', { store: 'pah', ids: ['a3'] }, world()); assert.deepEqual((await call('/optins', { store: 'pah' }, world())).body.optins, []);
  assert.ok(v.status === 200);
});
test('test email may go to an address listed in TEST_EMAILS, and only to it', async () => {
  const w = world();
  assert.equal((await call('/test', { store: 'pah', subject: 'S', html: '<p>x {{unsubscribe}}</p>', to: 'owner@gmail.com' }, w)).status, 400);
  env.TEST_EMAILS = ' Owner@Gmail.com , other@example.org ';
  try{
    const ok = await call('/test', { store: 'pah', subject: 'S', html: '<p>x {{unsubscribe}}</p>', to: 'OWNER@gmail.com' }, w);
    assert.equal(ok.status, 200);
    assert.equal(w.calls.find(c => c.url.endsWith('/smtp/email')).body.to[0].email, 'owner@gmail.com');
    assert.equal((await call('/test', { store: 'pah', subject: 'S', html: '<p>x</p>', to: 'victim@example.com' }, world())).status, 400);
    assert.equal((await call('/test', { store: 'pah', subject: 'S', html: '<p>x</p>', to: 'not-an-address' }, world())).status, 400);
  } finally { delete env.TEST_EMAILS; }
});
test('test email goes only to the caller; stats and unsubscribes', async () => {
  const w = world();
  assert.equal((await call('/test', { store: 'pah', subject: 'S', html: '<p>{prénom} {{unsubscribe}}</p>', to: 'victim@example.com' }, w)).status, 400);
  const t = await call('/test', { store: 'pah', subject: 'S', html: '<p>{prénom} {{unsubscribe}}</p><script>1</script>' }, w); assert.equal(t.status, 200);
  const sent = w.calls.find(c => c.url.endsWith('/smtp/email')).body; assert.equal(sent.to[0].email, 'ab@example.com'); assert.ok(sent.subject.startsWith('[TEST]')); assert.ok(!sent.htmlContent.includes('<script')); assert.ok(sent.htmlContent.includes('Moussa'));
  const s = await call('/stats', { store: 'pah', ids: [321] }, world()); assert.deepEqual([s.body.stats[321].delivered, s.body.stats[321].opens, s.body.stats[321].clicks, s.body.stats[321].unsub], [9, 4, 2, 1]);
  assert.deepEqual((await call('/unsubs', { store: 'pah' }, world())).body.emails, ['awa@example.com']);
});
test('cleanHtml and buildHtml', () => {
  assert.equal(cleanHtml('<p onclick="x()">a</p><script>b</script><iframe src=x></iframe>'), '<p>a</p>');
  assert.match(buildHtml('<p>x</p>', { first: 'FIRSTNAME', last: 'LASTNAME' }, 'subscribed'), /\{\{ unsubscribe \}\}/);
});
