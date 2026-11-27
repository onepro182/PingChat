// PingChat - pont WhatsApp Web (NON OFFICIEL, local uniquement)
// Utilise la bibliotheque Baileys. Ecoute seulement sur 127.0.0.1.
// Les fichiers de session (data/) contiennent l'acces a ton WhatsApp : ne les partage jamais.
import makeWASocket, {
  useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, normalizeMessageContent, jidNormalizedUser, Browsers,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Variables d'environnement (utilisees par l'application Windows) : sinon valeurs par defaut du dossier bridge/
const ROOT = path.resolve(process.env.PINGCHAT_ROOT || path.join(HERE, '..'));   // index.html, css, js, assets
const DATA = path.resolve(process.env.PINGCHAT_DATA || path.join(HERE, 'data')); // session WhatsApp + sauvegarde locale
const AUTH = path.join(DATA, 'auth');
const STORE_FILE = path.join(DATA, 'store.json');
const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const MAX_MSGS = 300;
fs.mkdirSync(AUTH, { recursive: true });

// ---------- Etat en memoire (sauvegarde locale) ----------
const state = { status: 'starting', qr: null, me: null, error: null };
let chats = new Map();     // jid -> { id, name, unread, ts, group }
let msgs = new Map();      // jid -> [ { id, fromMe, text, ts, status } ]
let contacts = new Map();  // jid -> nom enregistre dans ton telephone
let notifies = new Map();  // jid -> nom choisi par le contact (pushName)
let lidPn = new Map();     // identifiant @lid -> numero @s.whatsapp.net
try {
  const s = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
  chats = new Map(s.chats); msgs = new Map(s.msgs); contacts = new Map(s.contacts);
  notifies = new Map(s.notifies || []); lidPn = new Map(s.lidPn || []);
  // ancien texte d'erreur des versions precedentes : on le retire (le contenu est re-affiche quand il est recu a nouveau)
  for (const [k, v] of msgs) msgs.set(k, v.filter((m) => m.text !== '[message non pris en charge]'));
} catch {}
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(STORE_FILE, JSON.stringify({ chats: [...chats], msgs: [...msgs], contacts: [...contacts], notifies: [...notifies], lidPn: [...lidPn] })); } catch {}
  }, 1500);
}

// ---------- Evenements vers le navigateur (SSE) ----------
const clients = new Set();
function emit(type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const res of clients) res.write(line);
}

// ---------- Utilitaires ----------
const isGroup = (j) => j.endsWith('@g.us');
const phoneOf = (j) => (j.endsWith('@s.whatsapp.net') ? '+' + j.split('@')[0] : null);
const canon = (j) => (j && j.endsWith('@lid') && lidPn.get(j)) || j;
function nameOf(jid) {
  const n = chats.get(jid)?.name || contacts.get(jid) || notifies.get(jid);
  if (n) return n;
  if (isGroup(jid)) return 'Groupe';
  const p = phoneOf(jid);
  if (p) return p;
  return 'Contact ...' + jid.split('@')[0].slice(-4);   // @lid sans numero connu
}
// Relie un identifiant @lid a son vrai numero et fusionne les doublons
function learn(lid, pn) {
  if (!lid || !pn || !lid.endsWith('@lid')) return;
  pn = jidNormalizedUser(pn);
  if (!pn.endsWith('@s.whatsapp.net') || lidPn.get(lid) === pn) return;
  lidPn.set(lid, pn);
  if (contacts.has(lid) && !contacts.has(pn)) contacts.set(pn, contacts.get(lid));
  if (notifies.has(lid) && !notifies.has(pn)) notifies.set(pn, notifies.get(lid));
  const a = chats.get(lid);
  if (a) {
    const b = ensureChat(pn);
    if (!b.name && a.name) b.name = a.name;
    b.unread = (b.unread || 0) + (a.unread || 0); b.ts = Math.max(b.ts || 0, a.ts || 0);
    chats.delete(lid);
  }
  const ma = msgs.get(lid);
  if (ma) {
    const mb = msgs.get(pn) || []; const ids = new Set(mb.map((x) => x.id));
    for (const m of ma) if (!ids.has(m.id)) mb.push(m);
    mb.sort((x, y) => x.ts - y.ts); msgs.set(pn, mb); msgs.delete(lid);
  }
  saveSoon(); emit('chats', {});
}
function learnFrom(o) {
  if (!o) return;
  const ids = [o.id, o.lid, o.lidJid, o.phoneNumber, o.pnJid].filter(Boolean);
  const lid = ids.find((x) => x.endsWith('@lid')); const pn = ids.find((x) => x.endsWith('@s.whatsapp.net') || x.endsWith('@c.us'));
  if (lid && pn) learn(lid, pn);
}
function setName(id, saved, notify) {
  if (saved) contacts.set(id, saved);
  else if (notify && !contacts.has(id)) notifies.set(id, notify);
}
async function resolveLids() {
  const repo = sock?.signalRepository?.lidMapping;
  if (!repo) return;
  for (const jid of [...chats.keys(), ...msgs.keys()]) {
    if (!jid.endsWith('@lid') || lidPn.has(jid)) continue;
    try { const pn = await repo.getPNForLID(jid); if (pn) learn(jid, pn); } catch {}
  }
}
const TEXT_KEYS = ['conversation', 'text', 'caption', 'contentText', 'hydratedContentText', 'bodyText', 'selectedDisplayText', 'title', 'description', 'name', 'singleSelectReply'];
function findText(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 4) return null;
  for (const k of TEXT_KEYS) if (typeof o[k] === 'string' && o[k].trim()) return o[k];
  for (const k of Object.keys(o)) {
    if (k === 'contextInfo' || k === 'messageContextInfo' || k.endsWith('Key') || /thumbnail|jpeg|mediaKey|sha256|url/i.test(k)) continue;
    const r = findText(o[k], depth + 1); if (r) return r;
  }
  return null;
}
function textOf(m) {
  const c = normalizeMessageContent(m.message);
  if (!c) return null;
  if (c.conversation) return c.conversation;
  if (c.extendedTextMessage?.text) return c.extendedTextMessage.text;
  if (c.imageMessage) return '[image]' + (c.imageMessage.caption ? ' ' + c.imageMessage.caption : '');
  if (c.videoMessage) return '[video]' + (c.videoMessage.caption ? ' ' + c.videoMessage.caption : '');
  if (c.audioMessage) return c.audioMessage.ptt ? '[message vocal]' : '[audio]';
  if (c.documentMessage) return '[document] ' + (c.documentMessage.fileName || '');
  if (c.stickerMessage) return '[sticker]';
  if (c.contactMessage) return '[contact] ' + (c.contactMessage.displayName || '');
  if (c.contactsArrayMessage) return '[contacts]';
  if (c.locationMessage || c.liveLocationMessage) return '[position]';
  if (c.pollCreationMessage || c.pollCreationMessageV2 || c.pollCreationMessageV3) {
    const p = c.pollCreationMessage || c.pollCreationMessageV2 || c.pollCreationMessageV3; return '[sondage] ' + (p.name || '');
  }
  if (c.reactionMessage || c.protocolMessage || c.senderKeyDistributionMessage || c.pollUpdateMessage || c.albumMessage || c.keepInChatMessage) return null;
  const keys = Object.keys(c).filter((k) => k !== 'messageContextInfo');
  if (!keys.length) return null;
  // Messages WhatsApp Business (boutons, listes, modeles, interactifs...) : on cherche le texte dedans
  const t = findText(c);
  if (t) return t;
  return '[message WhatsApp Business ou special : ' + keys[0].replace(/Message$/, '') + ']';
}
const STATUS = { 0: 'failed', 1: 'sent', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'read' };
function ensureChat(jid) {
  if (!chats.has(jid)) chats.set(jid, { id: jid, name: '', unread: 0, ts: 0, group: isGroup(jid) });
  return chats.get(jid);
}
function addMessage(m, live) {
  if (m.key?.remoteJid?.endsWith('@lid') && m.key.remoteJidAlt) learn(m.key.remoteJid, m.key.remoteJidAlt);
  const jid = canon(m.key?.remoteJid);
  if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;
  const text = textOf(m);
  if (text === null) return;
  const list = msgs.get(jid) || [];
  if (list.some((x) => x.id === m.key.id)) return;
  const ts = Number(m.messageTimestamp?.toNumber ? m.messageTimestamp.toNumber() : m.messageTimestamp) || Math.floor(Date.now() / 1000);
  const msg = { id: m.key.id, fromMe: !!m.key.fromMe, text, ts, status: m.key.fromMe ? (STATUS[m.status] || 'sent') : 'delivered' };
  if (isGroup(jid) && !msg.fromMe && m.pushName) msg.sender = m.pushName;
  list.push(msg);
  list.sort((a, b) => a.ts - b.ts);
  if (list.length > MAX_MSGS) list.splice(0, list.length - MAX_MSGS);
  msgs.set(jid, list);
  const ch = ensureChat(jid);
  if (ts >= ch.ts) ch.ts = ts;
  if (!msg.fromMe && m.pushName && !isGroup(jid)) setName(jid, null, m.pushName);
  if (jid.endsWith('@lid') && !lidPn.has(jid)) sock?.signalRepository?.lidMapping?.getPNForLID(jid).then((pn) => pn && learn(jid, pn)).catch(() => {});
  if (live && !msg.fromMe) ch.unread = (ch.unread || 0) + 1;
  saveSoon();
  if (live) { emit('message', { jid, msg }); emit('chat', chatView(jid)); }
}
function chatView(jid) {
  const c = ensureChat(jid);
  const list = msgs.get(jid) || [];
  const last = list[list.length - 1];
  return { jid, name: nameOf(jid), phone: phoneOf(jid), group: !!c.group, unread: c.unread || 0, ts: c.ts || last?.ts || 0, last: last ? last.text : '' };
}

// ---------- Connexion WhatsApp ----------
let sock = null;
let stopping = false;
async function start() {
  state.status = 'starting'; state.error = null; emit('state', publicState());
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH);
  let version;
  try { version = (await fetchLatestBaileysVersion()).version; } catch {}
  sock = makeWASocket({
    version, auth,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: false,       // ne te montre pas "en ligne"
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u) => {
    if (u.qr) {
      state.status = 'qr';
      state.qr = await QRCode.toDataURL(u.qr, { margin: 1, scale: 8 });
      emit('state', publicState());
    }
    if (u.connection === 'open') {
      state.status = 'open'; state.qr = null;
      resolveLids();
      state.me = sock.user ? { id: jidNormalizedUser(sock.user.id), name: sock.user.name || '' } : null;
      emit('state', publicState());
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      state.qr = null;
      if (code === DisconnectReason.loggedOut) {
        // deconnecte depuis le telephone : on efface la session et on redemande un QR
        state.status = 'logged_out';
        try { fs.rmSync(AUTH, { recursive: true, force: true }); fs.mkdirSync(AUTH, { recursive: true }); } catch {}
        chats = new Map(); msgs = new Map(); contacts = new Map(); notifies = new Map(); lidPn = new Map(); saveSoon();
        emit('state', publicState());
        setTimeout(start, 1500);
      } else if (!stopping) {
        state.status = 'reconnecting'; emit('state', publicState());
        setTimeout(start, 2500);
      }
    }
  });
  sock.ev.on('messaging-history.set', ({ chats: cs, contacts: ct, messages, lidPnMappings }) => {
    for (const mp of lidPnMappings || []) learn(mp.lid, mp.pn);
    for (const c of ct || []) learnFrom(c);
    for (const c of cs || []) learnFrom(c);
    for (const c of cs || []) {
      c.id = canon(c.id);
      const e = ensureChat(c.id);
      if (c.name) e.name = c.name;
      if (c.unreadCount) e.unread = c.unreadCount;
      const t = Number(c.conversationTimestamp?.toNumber ? c.conversationTimestamp.toNumber() : c.conversationTimestamp);
      if (t) e.ts = Math.max(e.ts, t);
    }
    for (const c of ct || []) setName(canon(c.id), c.name, c.notify);
    for (const m of messages || []) addMessage(m, false);
    saveSoon(); emit('chats', {});
  });
  sock.ev.on('chats.upsert', (cs) => { for (const c of cs) learnFrom(c); for (const c of cs) { const e = ensureChat(canon(c.id)); if (c.name) e.name = c.name; } saveSoon(); emit('chats', {}); });
  sock.ev.on('chats.update', (us) => {
    for (const u of us) learnFrom(u);
    for (const u of us) { const e = ensureChat(canon(u.id)); if (u.name) e.name = u.name; if (typeof u.unreadCount === 'number') e.unread = u.unreadCount; }
    saveSoon(); emit('chats', {});
  });
  sock.ev.on('contacts.upsert', (ct) => { for (const c of ct) { learnFrom(c); setName(canon(c.id), c.name, c.notify); } saveSoon(); emit('chats', {}); });
  sock.ev.on('contacts.update', (ct) => { for (const c of ct) { learnFrom(c); if (c.id) setName(canon(c.id), c.name, c.notify); } saveSoon(); emit('chats', {}); });
  sock.ev.on('lid-mapping.update', (mp) => learn(mp.lid, mp.pn));
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const m of messages) addMessage(m, type === 'notify' || !!m.key.fromMe);
  });
  sock.ev.on('messages.update', (ups) => {
    for (const u of ups) {
      const jid = u.key?.remoteJid; const list = msgs.get(jid); if (!list) continue;
      const m = list.find((x) => x.id === u.key.id);
      if (m && u.update?.status !== undefined && m.fromMe) { m.status = STATUS[u.update.status] || m.status; emit('status', { jid, id: m.id, status: m.status }); saveSoon(); }
    }
  });
}
const publicState = () => ({ status: state.status, qr: state.qr, me: state.me });

// ---------- Serveur HTTP local ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const ALLOWED_DIRS = ['css', 'js', 'assets'];
function hostOk(req) {
  const h = (req.headers.host || '').toLowerCase();
  return h === `localhost:${PORT}` || h === `127.0.0.1:${PORT}`;
}
function originOk(req) {
  const o = req.headers.origin; if (!o) return true;
  return o === `http://localhost:${PORT}` || o === `http://127.0.0.1:${PORT}`;
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((ok, ko) => {
    let b = ''; req.on('data', (d) => { b += d; if (b.length > 100000) { ko(new Error('trop gros')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  if (!hostOk(req) || !originOk(req)) { res.writeHead(403); return res.end('forbidden'); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p.startsWith('/api/')) {
    if (req.method === 'POST' && req.headers['x-pingchat'] !== '1') return json(res, 403, { ok: false, error: 'forbidden' });
    if (p === '/api/state') return json(res, 200, { ok: true, bridge: 'baileys', ...publicState() });
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (p === '/api/chats') {
      const list = [...chats.keys()].map(chatView).filter((c) => c.ts || c.last).sort((a, b) => b.ts - a.ts);
      return json(res, 200, { ok: true, chats: list });
    }
    if (p === '/api/messages') {
      const jid = canon(url.searchParams.get('jid') || '');
      const ch = chats.get(jid); if (ch) { ch.unread = 0; saveSoon(); }
      return json(res, 200, { ok: true, messages: msgs.get(jid) || [] });
    }
    if (p === '/api/send' && req.method === 'POST') {
      const b = await readBody(req);
      let jid = canon(String(b.jid || ''));
      if (!jid && b.phone) jid = String(b.phone).replace(/\D+/g, '') + '@s.whatsapp.net';
      const text = String(b.text || '').trim();
      if (!/^[\w.:-]+@(s\.whatsapp\.net|g\.us|lid)$/.test(jid) || !text) return json(res, 400, { ok: false, error: 'jid ou texte invalide' });
      if (state.status !== 'open' || !sock) return json(res, 409, { ok: false, error: 'WhatsApp non connecte' });
      try {
        const sent = await sock.sendMessage(jid, { text });
        addMessage(sent, true);
        return json(res, 200, { ok: true, id: sent.key.id });
      } catch (e) { return json(res, 502, { ok: false, error: String(e.message || e) }); }
    }
    if (p === '/api/logout' && req.method === 'POST') {
      try { await sock?.logout(); } catch {}
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { ok: false });
  }

  // Fichiers de l'interface PingChat (liste blanche stricte)
  let rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
  const top = rel.split('/')[0];
  if (rel !== 'index.html' && !ALLOWED_DIRS.includes(top)) { res.writeHead(404); return res.end('not found'); }
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Le port ${PORT} est deja utilise (le pont tourne peut-etre deja).`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  if (!process.env.PINGCHAT_QUIET) console.log(`\n PingChat (pont WhatsApp) pret : http://localhost:${PORT}/\n Laisse cette fenetre ouverte. Ctrl+C pour arreter.\n`);
});
process.on('SIGINT', () => { stopping = true; process.exit(0); });
start().catch((e) => { console.error('Erreur de demarrage :', e); state.status = 'error'; state.error = String(e.message || e); });

process.on('uncaughtException', (e) => console.error('Erreur :', e));
process.on('unhandledRejection', (e) => console.error('Erreur :', e));
