// PingChat - pont WhatsApp Web (NON OFFICIEL, local uniquement)
// Utilise la bibliotheque Baileys. Ecoute seulement sur 127.0.0.1.
// Les fichiers de session (data/) contiennent l'acces a ton WhatsApp : ne les partage jamais.
import makeWASocket, {
  downloadMediaMessage,
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
const ACC_FILE = path.join(DATA, 'accounts.json');
const MAX_ACCOUNTS = 10;
const SETTINGS_FILE = path.join(DATA, 'settings.json');
let settings = { readReceipts: true, typing: true };
try { settings = { ...settings, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch {}
const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const MAX_MSGS = 300;
fs.mkdirSync(DATA, { recursive: true });


// ---------- Medias ----------
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'application/pdf': 'pdf' };
const SERVE_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', '3gp': 'video/3gpp', webm: 'video/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', pdf: 'application/pdf' };
const MAX_MEDIA = 30 * 1024 * 1024;
const safeName = (x) => String(x).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
function extFor(mime, name) {
  const base = String(mime || '').split(';')[0].trim().toLowerCase();
  if (EXT[base]) return EXT[base];
  const e = (String(name || '').match(/\.([A-Za-z0-9]{1,8})$/) || [])[1];
  return e ? e.toLowerCase() : 'bin';
}
const num = (x) => Number(x?.toNumber ? x.toNumber() : x) || 0;
function mediaOf(c) {
  const pick = (k, type) => (c[k] ? { type, node: c[k] } : null);
  const r = pick('imageMessage', 'image') || pick('videoMessage', 'video') || pick('stickerMessage', 'sticker') || pick('documentMessage', 'document')
    || (c.audioMessage ? { type: c.audioMessage.ptt ? 'voice' : 'audio', node: c.audioMessage } : null);
  if (!r) return null;
  const n = r.node;
  const thumb = n.jpegThumbnail && n.jpegThumbnail.length < 20000 ? 'data:image/jpeg;base64,' + Buffer.from(n.jpegThumbnail).toString('base64') : '';
  return { type: r.type, mime: n.mimetype || '', name: n.fileName || '', size: num(n.fileLength), dur: num(n.seconds), w: n.width || 0, h: n.height || 0, thumb, caption: n.caption || '', node: n };
}
function previewOfContent(c) {
  if (!c) return '';
  if (c.conversation) return c.conversation;
  if (c.extendedTextMessage?.text) return c.extendedTextMessage.text;
  const md = mediaOf(c);
  if (md) return ({ image: '📷 Photo', video: '🎥 Video', sticker: 'Sticker', voice: '🎤 Message vocal', audio: '🎵 Audio', document: '📄 ' + (md.name || 'Document') }[md.type]) + (md.caption ? ' ' + md.caption : '');
  return findText(c) || '';
}
function ctxOf(c) {
  for (const k of Object.keys(c)) { const ci = c[k]?.contextInfo; if (ci?.quotedMessage) return ci; }
  return null;
}

// ---------- Un compte WhatsApp = une session + une sauvegarde ----------
function createAccount(id, dir) {
  const AUTH = path.join(dir, 'auth');
  const STORE_FILE = path.join(dir, 'store.json');
  const MEDIA = path.join(dir, 'media');
  fs.mkdirSync(AUTH, { recursive: true });
  const state = { status: 'starting', qr: null, me: null, error: null };
  const emit = (type, data) => { gEmit(type, { ...(data || {}), acc: id }); changed(); };
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
    if (removed) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { fs.writeFileSync(STORE_FILE, JSON.stringify({ chats: [...chats], msgs: [...msgs], contacts: [...contacts], notifies: [...notifies], lidPn: [...lidPn] })); } catch {}
    }, 1500);
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
  function addMessage(m, live, opts = {}) {
    if (m.key?.remoteJid?.endsWith('@lid') && m.key.remoteJidAlt) learn(m.key.remoteJid, m.key.remoteJidAlt);
    if (m.key?.remoteJid === 'status@broadcast') return addStatus(m, live, opts);
    const jid = canon(m.key?.remoteJid);
    if (!jid || jid === 'status@broadcast' || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return;
    const content = normalizeMessageContent(m.message);
    // reaction recue ou envoyee depuis un autre appareil
    if (content?.reactionMessage) {
      const rk = content.reactionMessage.key; const list0 = msgs.get(jid);
      const target = list0?.find((x) => x.id === rk?.id);
      if (target) {
        const who = m.key.fromMe ? 'me' : (m.key.participant || m.key.remoteJid);
        target.reactions = target.reactions || {};
        if (content.reactionMessage.text) target.reactions[who] = content.reactionMessage.text; else delete target.reactions[who];
        saveSoon(); emit('reaction', { jid, id: target.id, reactions: target.reactions });
      }
      return;
    }
    const pm = content?.protocolMessage;
    if (pm && (pm.type === 0 || pm.type === 'REVOKE' || pm.type === 14 || pm.type === 'MESSAGE_EDIT')) {
      const tid = pm.key?.id; const tgt = (msgs.get(jid) || []).find((x) => x.id === tid);
      if (tgt) {
        if (pm.type === 0 || pm.type === 'REVOKE') { tgt.deleted = true; tgt.text = ''; tgt.caption = ''; }
        else { const nt = previewOfContent(normalizeMessageContent(pm.editedMessage)); if (nt) { tgt.text = nt; if (tgt.caption !== undefined) tgt.caption = nt; tgt.edited = true; } }
        saveSoon(); emit('msgupdate', { jid, msg: tgt }); emit('chat', chatView(jid));
      }
      return;
    }
    const text = textOf(m);
    if (text === null) return;
    const list = msgs.get(jid) || [];
    if (list.some((x) => x.id === m.key.id)) return;
    const ts = Number(m.messageTimestamp?.toNumber ? m.messageTimestamp.toNumber() : m.messageTimestamp) || Math.floor(Date.now() / 1000);
    const msg = { id: m.key.id, fromMe: !!m.key.fromMe, text, ts, status: m.key.fromMe ? (STATUS[m.status] || 'sent') : 'delivered', k: { rj: m.key.remoteJid, p: m.key.participant || '' } };
    if (isGroup(jid) && !msg.fromMe) {
      const pj = canon(m.key.participant || ''); msg.sj = pj;
      msg.sender = contacts.get(pj) || m.pushName || notifies.get(pj) || phoneOf(pj) || '';
    }
    const lc = content?.locationMessage || content?.liveLocationMessage;
    if (lc && typeof lc.degreesLatitude === 'number') msg.loc = { lat: lc.degreesLatitude, lng: lc.degreesLongitude, name: lc.name || '', addr: lc.address || '' };
    const md = content ? mediaOf(content) : null;
    if (md) {
      msg.type = md.type; msg.caption = md.caption;
      msg.media = { mime: md.mime, name: md.name, size: md.size, dur: md.dur, w: md.w, h: md.h, thumb: md.thumb, file: '' };
    }
    const ci = content ? ctxOf(content) : null;
    if (ci) {
      const qc = normalizeMessageContent(ci.quotedMessage);
      msg.q = { id: ci.stanzaId || '', text: previewOfContent(qc), mine: !!ci.participant && ci.participant === jidNormalizedUser(sock?.user?.id || '') };
    }
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
    if (live) { emit('message', { jid, msg, name: nameOf(jid) }); emit('chat', chatView(jid)); }
    if (md) {
      if (opts.buf) storeMedia(jid, msg, opts.buf);
      else if (live && !msg.fromMe && md.size <= MAX_MEDIA) {
        downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage })
          .then((buf) => storeMedia(jid, msg, buf)).catch((e) => console.error('telechargement media', String(e.message || e)));
      }
    }
  }
  function storeMedia(jid, msg, buf) {
    try {
      fs.mkdirSync(MEDIA, { recursive: true });
      const file = safeName(msg.id) + '.' + extFor(msg.media.mime, msg.media.name);
      fs.writeFileSync(path.join(MEDIA, file), buf);
      msg.media.file = file; msg.media.size = buf.length;
      saveSoon(); emit('msgupdate', { jid, msg });
    } catch (e) { console.error('ecriture media', e); }
  }
  async function loadGroups() {
    try {
      const all = await sock.groupFetchAllParticipating();
      for (const [gid, g] of Object.entries(all || {})) { const e = ensureChat(gid); if (g.subject) e.name = g.subject; groupCache.set(gid, { t: Date.now(), g }); }
      saveSoon(); emit('chats', {});
    } catch (e) { console.error('groupes', String(e.message || e)); }
  }
  const groupCache = new Map();
  function chatView(jid) {
    const c = ensureChat(jid);
    const list = (msgs.get(jid) || []).filter((m) => !m.hidden);
    const last = list[list.length - 1];
    return { jid, name: nameOf(jid), phone: phoneOf(jid), group: !!c.group, pinned: !!c.pinned, archived: !!c.archived, muted: !!(c.muteUntil && c.muteUntil > Date.now()), unread: c.unread || 0, ts: c.ts || last?.ts || 0, last: last ? (last.deleted ? '🚫 Message supprime' : last.type ? ({ image: '📷 Photo', video: '🎥 Video', sticker: 'Sticker', voice: '🎤 Message vocal', audio: '🎵 Audio', document: '📄 Document' }[last.type] || last.text) + (last.caption ? ' ' + last.caption : '') : last.text) : '' };
  }

  // ---------- Connexion WhatsApp ----------
  let sock = null;
  let stopping = false;
    let removed = false;
  async function start() {
    if (removed) return;
    state.status = 'starting'; state.error = null; emit('state', publicState());
    const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH);
    let version;
    try { version = (await fetchLatestBaileysVersion()).version; } catch {}
    if (removed) return;
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
        resolveLids(); loadGroups();
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
          if (!removed) setTimeout(start, 1500);
        } else if (!stopping && !removed) {
          state.status = 'reconnecting'; emit('state', publicState());
          if (!removed) setTimeout(start, 2500);
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
    sock.ev.on('call', (calls) => {
    for (const c of calls || []) {
      const from = c.chatId || c.from; const jid = canon(from);
      emit('call', { id: c.id, from, status: c.status, video: !!c.isVideo, name: nameOf(jid) || phoneOf(jid) || 'Contact' });
      if (['timeout', 'reject'].includes(c.status) && jid && !isGroup(jid)) {
        const list = msgs.get(jid) || []; const id = 'call-' + c.id;
        if (!list.some((x) => x.id === id)) {
          const msg = { id, fromMe: false, text: (c.isVideo ? '📞 Appel video' : '📞 Appel vocal') + (c.status === 'timeout' ? ' manque' : ' refuse'), ts: Math.floor(Date.now() / 1000), status: 'delivered', type: 'call' };
          list.push(msg); msgs.set(jid, list); const ch = ensureChat(jid); ch.ts = msg.ts; ch.unread = (ch.unread || 0) + 1;
          saveSoon(); emit('message', { jid, msg, name: nameOf(jid) }); emit('chat', chatView(jid));
        }
      }
    }
  });
  sock.ev.on('lid-mapping.update', (mp) => learn(mp.lid, mp.pn));
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      for (const m of messages) addMessage(m, type === 'notify' || !!m.key.fromMe);
    });
    sock.ev.on('presence.update', ({ id, presences }) => {
      for (const [who, pr] of Object.entries(presences || {})) {
        const st = pr?.lastKnownPresence;
        emit('presence', { jid: canon(id), state: st || '', last: pr?.lastSeen || 0, who: isGroup(id) ? (nameOf(canon(who)) || phoneOf(canon(who)) || '') : '' });
      }
    });
    sock.ev.on('messages.update', (ups) => {
      for (const u of ups) {
        const jid = canon(u.key?.remoteJid); const list = msgs.get(jid); if (!list) continue;
        const m = list.find((x) => x.id === u.key.id);
        if (m && u.update?.status !== undefined && m.fromMe) { m.status = STATUS[u.update.status] || m.status; emit('status', { jid, id: m.id, status: m.status }); saveSoon(); }
      }
    });
  }
  const publicState = () => ({ status: state.status, qr: state.qr, me: state.me });
  const unreadTotal = () => { let n = 0; for (const c of chats.values()) n += c.unread || 0; return n; };
  function quotedFor(jid, quotedId) {
    if (!quotedId) return undefined;
    const q = (msgs.get(jid) || []).find((x) => x.id === quotedId);
    if (!q) return undefined;
    return { key: { remoteJid: q.k?.rj || jid, id: q.id, fromMe: q.fromMe, participant: q.k?.p || undefined }, message: { conversation: q.text || q.caption || '' } };
  }
  function ready() {
    if (state.status !== 'open' || !sock) throw Object.assign(new Error('WhatsApp non connecte'), { code: 409 });
  }
  async function send(rawJid, text, quotedId) {
    const jid = canon(rawJid); ready();
    const sent = await sock.sendMessage(jid, { text }, { quoted: quotedFor(jid, quotedId) });
    addMessage(sent, true);
    return sent.key.id;
  }
  async function sendMedia(rawJid, o) {
    const jid = canon(rawJid); ready();
    const buf = Buffer.from(String(o.data || ''), 'base64');
    if (!buf.length || buf.length > MAX_MEDIA) throw Object.assign(new Error('Fichier vide ou trop gros (30 Mo max)'), { code: 400 });
    const mime = String(o.mime || 'application/octet-stream').slice(0, 100); const caption = String(o.caption || '').slice(0, 1000) || undefined;
    let content;
    if (o.kind === 'image') content = { image: buf, caption, mimetype: mime };
    else if (o.kind === 'video') content = { video: buf, caption, mimetype: mime };
    else if (o.kind === 'voice') content = { audio: buf, ptt: true, mimetype: mime };
    else if (o.kind === 'audio') content = { audio: buf, mimetype: mime };
    else content = { document: buf, mimetype: mime, fileName: String(o.name || 'fichier').slice(0, 120), caption };
    const sent = await sock.sendMessage(jid, content, { quoted: quotedFor(jid, o.quotedId) });
    addMessage(sent, true, { buf });
    return sent.key.id;
  }
  async function react(rawJid, id, emoji) {
    const jid = canon(rawJid); ready();
    const msg = (msgs.get(jid) || []).find((x) => x.id === id);
    if (!msg) throw Object.assign(new Error('message introuvable'), { code: 404 });
    const key = { remoteJid: msg.k?.rj || jid, id: msg.id, fromMe: msg.fromMe, participant: msg.k?.p || undefined };
    await sock.sendMessage(key.remoteJid, { react: { text: emoji || '', key } });
    msg.reactions = msg.reactions || {};
    if (emoji) msg.reactions.me = emoji; else delete msg.reactions.me;
    saveSoon(); emit('reaction', { jid, id, reactions: msg.reactions });
  }
  async function markRead(jid) {
    if (!settings.readReceipts || state.status !== 'open' || !sock) return;
    const keys = (msgs.get(jid) || []).filter((m) => !m.fromMe && !m.read).slice(-50);
    if (!keys.length) return;
    keys.forEach((m) => { m.read = true; });
    saveSoon();
    try { await sock.readMessages(keys.map((m) => ({ remoteJid: m.k?.rj || jid, id: m.id, fromMe: false, participant: m.k?.p || undefined }))); } catch (e) { console.error('accuse de lecture', String(e.message || e)); }
  }
  async function rejectCall(id, from) { ready(); await sock.rejectCall(String(id), String(from)); }
  const findMsg = (jid, id) => (msgs.get(canon(jid)) || []).find((x) => x.id === id);
  const keyOf = (jid, m) => ({ remoteJid: m.k?.rj || canon(jid), id: m.id, fromMe: m.fromMe, participant: m.k?.p || undefined });
  async function deleteForAll(rawJid, id) {
    const jid = canon(rawJid); ready();
    const m = findMsg(jid, id);
    if (!m || !m.fromMe) throw Object.assign(new Error('Seuls tes propres messages peuvent etre supprimes pour tous'), { code: 400 });
    await sock.sendMessage(keyOf(jid, m).remoteJid, { delete: keyOf(jid, m) });
    m.deleted = true; m.text = ''; m.caption = ''; saveSoon(); emit('msgupdate', { jid, msg: m }); emit('chat', chatView(jid));
  }
  function deleteForMe(rawJid, id) {
    const jid = canon(rawJid); const m = findMsg(jid, id); if (!m) return;
    m.hidden = true; saveSoon(); emit('chat', chatView(jid));
  }
  async function editMsg(rawJid, id, text) {
    const jid = canon(rawJid); ready();
    const m = findMsg(jid, id); text = String(text || '').trim();
    if (!m || !m.fromMe || m.type || !text) throw Object.assign(new Error('Seuls tes messages texte peuvent etre modifies'), { code: 400 });
    if (Date.now() / 1000 - m.ts > 15 * 60) throw Object.assign(new Error('Modification possible pendant 15 minutes seulement'), { code: 400 });
    await sock.sendMessage(keyOf(jid, m).remoteJid, { text, edit: keyOf(jid, m) });
    m.text = text; m.edited = true; saveSoon(); emit('msgupdate', { jid, msg: m }); emit('chat', chatView(jid));
  }
  async function forward(rawTo, fromJid, id) {
    const to = canon(rawTo); ready();
    const m = findMsg(fromJid, id); if (!m || m.deleted) throw Object.assign(new Error('message introuvable'), { code: 404 });
    if (m.media?.file) {
      const full = mediaFile(m.media.file); if (!full) throw Object.assign(new Error('fichier absent'), { code: 404 });
      const buf = fs.readFileSync(full); const mime = m.media.mime || 'application/octet-stream';
      let content;
      if (m.type === 'image') content = { image: buf, caption: m.caption || undefined, mimetype: mime };
      else if (m.type === 'video') content = { video: buf, caption: m.caption || undefined, mimetype: mime };
      else if (m.type === 'voice') content = { audio: buf, ptt: true, mimetype: mime };
      else if (m.type === 'audio') content = { audio: buf, mimetype: mime };
      else if (m.type === 'sticker') content = { sticker: buf };
      else content = { document: buf, mimetype: mime, fileName: m.media.name || 'fichier' };
      const sent = await sock.sendMessage(to, content); addMessage(sent, true, { buf }); return sent.key.id;
    }
    if (m.type) throw Object.assign(new Error('Ce type de message ne peut pas etre transfere'), { code: 400 });
    const sent = await sock.sendMessage(to, { text: m.text }); addMessage(sent, true); return sent.key.id;
  }
  function star(rawJid, id, on) {
    const m = findMsg(rawJid, id); if (!m) return;
    if (on) m.star = true; else delete m.star;
    saveSoon(); emit('msgupdate', { jid: canon(rawJid), msg: m });
  }
  function starred() {
    const out = [];
    for (const [jid, list] of msgs) for (const m of list) if (m.star && !m.deleted && !m.hidden) out.push({ jid, name: nameOf(jid), id: m.id, ts: m.ts, fromMe: m.fromMe, text: m.text });
    return out.sort((a, b) => b.ts - a.ts).slice(0, 200);
  }
  function search(q) {
    q = String(q || '').toLowerCase().trim(); if (q.length < 2) return [];
    const out = [];
    for (const [jid, list] of msgs) for (const m of list) {
      if (m.deleted || m.hidden) continue;
      const hay = ((m.text || '') + ' ' + (m.caption || '') + ' ' + (m.media?.name || '')).toLowerCase();
      if (hay.includes(q)) out.push({ jid, id: m.id, ts: m.ts, text: m.text || m.caption || m.media?.name || '' });
    }
    return out.sort((a, b) => b.ts - a.ts).slice(0, 80);
  }
  async function groupInfo(jid) {
    ready();
    let c = groupCache.get(jid);
    if (!c || Date.now() - c.t > 5 * 60 * 1000) { c = { t: Date.now(), g: await sock.groupMetadata(jid) }; groupCache.set(jid, c); }
    const g = c.g;
    const myj = canon(jidNormalizedUser(state.me?.id || ''));
    const meP = (g.participants || []).find((p) => canon(p.phoneNumber || p.id) === myj || canon(p.id) === myj);
    return { jid, meAdmin: !!meP?.admin, name: g.subject || nameOf(jid), desc: g.desc || '', size: (g.participants || []).length, owner: g.owner ? phoneOf(canon(g.owner)) || '' : '',
      participants: (g.participants || []).map((p) => { const pj = canon(p.phoneNumber || p.id); return { jid: pj, name: contacts.get(pj) || notifies.get(pj) || '', phone: phoneOf(pj) || phoneOf(canon(p.id)) || '', admin: !!p.admin }; }) };
  }
  async function typing(rawJid, on) {
    if (!settings.typing || state.status !== 'open' || !sock) return;
    try { await sock.sendPresenceUpdate(on ? 'composing' : 'paused', canon(rawJid)); } catch {}
  }
  // photos de profil : telechargees une fois, gardees dans le dossier du compte (file d'attente lente pour ne pas surcharger WhatsApp)
  const AV = path.join(dir, 'avatars'); const avTry = new Map(); let avQueue = Promise.resolve();
  const avFile = (jid) => path.join(AV, safeName(jid) + '.jpg');
  function avatar(rawJid) {
    const jid = canon(rawJid); const f = avFile(jid);
    if (fs.existsSync(f)) return f;
    const last = avTry.get(jid); if (last && Date.now() - last < 6 * 3600 * 1000) return null;
    if (state.status !== 'open' || !sock) return null;
    avTry.set(jid, Date.now());
    avQueue = avQueue.then(async () => {
      try {
        const u = await sock.profilePictureUrl(jid, 'preview');
        const h = new URL(u).hostname;
        if (!/^https:/.test(u) || !/(whatsapp\.net|fbcdn\.net|whatsapp\.com)$/.test(h)) return;
        const r = await fetch(u); if (!r.ok) return;
        const b = Buffer.from(await r.arrayBuffer()); if (!b.length || b.length > 2e6) return;
        fs.mkdirSync(AV, { recursive: true }); fs.writeFileSync(f, b); emit('avatar', { jid });
      } catch {}
      await new Promise((ok) => setTimeout(ok, 600));
    });
    return null;
  }

  // ---------- v1.4 : epingler / archiver / muet (local + synchro WhatsApp en essayant) ----------
  async function chatFlag(rawJid, o) {
    const jid = canon(rawJid); const c = ensureChat(jid);
    const lastMsg = (msgs.get(jid) || []).slice(-1)[0];
    const lm = lastMsg ? [{ key: keyOf(jid, lastMsg), messageTimestamp: lastMsg.ts }] : [];
    const sync = async (mod) => { if (state.status === 'open' && sock) { try { await sock.chatModify(mod, jid); } catch (e) { console.error('chatModify', String(e.message || e)); } } };
    if (typeof o.pin === 'boolean') { c.pinned = o.pin; await sync({ pin: o.pin }); }
    if (typeof o.archive === 'boolean') { c.archived = o.archive; await sync({ archive: o.archive, lastMessages: lm }); }
    if (o.mute !== undefined) {
      const h = Number(o.mute);
      if (h > 0) { c.muteUntil = Date.now() + h * 3600 * 1000; await sync({ mute: c.muteUntil }); }
      else if (h < 0) { c.muteUntil = Date.now() + 365 * 24 * 3600 * 1000; await sync({ mute: c.muteUntil }); }
      else { c.muteUntil = 0; await sync({ mute: null }); }
    }
    saveSoon(); emit('chat', chatView(jid)); return chatView(jid);
  }
  // ---------- v1.4 : galerie medias / liens / documents ----------
  function gallery(rawJid) {
    const jid = canon(rawJid); const out = { media: [], docs: [], links: [] };
    for (const m of [...(msgs.get(jid) || [])].reverse()) {
      if (m.deleted || m.hidden) continue;
      if (m.media && (m.type === 'image' || m.type === 'video') ) out.media.push({ id: m.id, type: m.type, file: m.media.file, thumb: m.media.thumb, ts: m.ts, caption: m.caption || '' });
      else if (m.media && m.type === 'document') out.docs.push({ id: m.id, name: m.media.name || 'Document', size: m.media.size, file: m.media.file, ts: m.ts });
      const txt = (m.text || '') + ' ' + (m.caption || '');
      for (const u of txt.match(/https?:\/\/[^\s<>"']+/g) || []) out.links.push({ id: m.id, url: u.slice(0, 300), ts: m.ts });
    }
    out.media = out.media.slice(0, 300); out.docs = out.docs.slice(0, 200); out.links = out.links.slice(0, 200);
    return out;
  }
  // ---------- v1.4 : position ----------
  async function sendLocation(rawJid, o) {
    const jid = canon(rawJid); ready();
    const lat = Number(o.lat), lng = Number(o.lng);
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw Object.assign(new Error('Position invalide'), { code: 400 });
    const sent = await sock.sendMessage(jid, { location: { degreesLatitude: lat, degreesLongitude: lng, name: String(o.name || '').slice(0, 100) || undefined } });
    addMessage(sent, true); return sent.key.id;
  }
  // ---------- v1.4 : statuts ----------
  const STATUS_FILE = path.join(dir, 'statuses.json'); const STMEDIA = MEDIA;
  let statuses = []; try { statuses = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8')); } catch {}
  const pruneStatuses = () => { const lim = Date.now() / 1000 - 24 * 3600; statuses = statuses.filter((s) => s.ts > lim); };
  let stTimer = null; const saveStatuses = () => { clearTimeout(stTimer); stTimer = setTimeout(() => { try { pruneStatuses(); fs.writeFileSync(STATUS_FILE, JSON.stringify(statuses)); } catch {} }, 1000); };
  function addStatus(m, live, opts = {}) {
    const content = normalizeMessageContent(m.message); if (!content) return;
    if (content.protocolMessage) { const pm = content.protocolMessage; if ((pm.type === 0 || pm.type === 'REVOKE') && pm.key?.id) { statuses = statuses.filter((s) => s.id !== pm.key.id); saveStatuses(); emit('statuses', {}); } return; }
    if (content.reactionMessage) return;
    const id = m.key.id; if (statuses.some((s) => s.id === id)) return;
    const ts = Number(m.messageTimestamp?.toNumber ? m.messageTimestamp.toNumber() : m.messageTimestamp) || Math.floor(Date.now() / 1000);
    if (ts < Date.now() / 1000 - 24 * 3600) return;
    const who = m.key.fromMe ? 'me' : canon(m.key.participant || m.participant || '');
    const st = { id, who, name: m.key.fromMe ? 'Moi' : (contacts.get(who) || m.pushName || notifies.get(who) || phoneOf(who) || ''), ts, fromMe: !!m.key.fromMe, text: '' };
    const md = mediaOf(content);
    if (md && (md.type === 'image' || md.type === 'video')) { st.type = md.type; st.caption = md.caption; st.media = { mime: md.mime, thumb: md.thumb, file: '' }; }
    else { const tx = content.conversation || content.extendedTextMessage?.text; if (!tx) return; st.type = 'text'; st.text = tx; st.bg = content.extendedTextMessage?.backgroundArgb ? '#' + (content.extendedTextMessage.backgroundArgb >>> 0).toString(16).padStart(8, '0').slice(2) : ''; }
    statuses.push(st); saveStatuses(); emit('statuses', {});
    if (st.media) {
      const fin = (buf) => { try { fs.mkdirSync(MEDIA, { recursive: true }); const f = 'st_' + safeName(id) + '.' + extFor(st.media.mime, ''); fs.writeFileSync(path.join(MEDIA, f), buf); st.media.file = f; saveStatuses(); emit('statuses', {}); } catch {} };
      if (opts.buf) fin(opts.buf);
      else if (!st.fromMe) downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }).then(fin).catch((e) => console.error('statut media', String(e.message || e)));
    }
  }
  function statusList() {
    pruneStatuses();
    const by = new Map();
    for (const s of statuses) { const g = by.get(s.who) || { who: s.who, name: s.name, fromMe: s.fromMe, items: [] }; g.items.push(s); by.set(s.who, g); }
    return [...by.values()].map((g) => { g.items.sort((a, b) => a.ts - b.ts); g.ts = g.items[g.items.length - 1].ts; return g; }).sort((a, b) => (b.fromMe ? 1 : 0) - (a.fromMe ? 1 : 0) || b.ts - a.ts);
  }
  async function postStatus(o) {
    ready();
    const audience = [...chats.keys()].filter((j) => j.endsWith('@s.whatsapp.net')).slice(0, 1000);
    if (state.me?.id) audience.push(jidNormalizedUser(state.me.id));
    if (audience.length < 1) throw Object.assign(new Error('Aucun contact pour le statut'), { code: 400 });
    let content; const opt = { statusJidList: [...new Set(audience)] };
    if (o.kind === 'image' || o.kind === 'video') {
      const buf = Buffer.from(String(o.data || ''), 'base64');
      if (!buf.length || buf.length > MAX_MEDIA) throw Object.assign(new Error('Fichier vide ou trop gros (30 Mo max)'), { code: 400 });
      const mime = String(o.mime || (o.kind === 'image' ? 'image/jpeg' : 'video/mp4')).slice(0, 100); const caption = String(o.caption || '').slice(0, 700) || undefined;
      content = o.kind === 'image' ? { image: buf, caption, mimetype: mime } : { video: buf, caption, mimetype: mime };
      const sent = await sock.sendMessage('status@broadcast', content, opt); addStatus(sent, true, { buf }); return sent.key.id;
    }
    const text = String(o.text || '').trim().slice(0, 700); if (!text) throw Object.assign(new Error('Texte vide'), { code: 400 });
    opt.backgroundColor = /^#[0-9a-fA-F]{6}$/.test(o.bg || '') ? o.bg : '#312e81'; opt.font = 1;
    const sent = await sock.sendMessage('status@broadcast', { text }, opt); addStatus(sent, true); return sent.key.id;
  }
  async function deleteStatus(id) {
    ready(); const s = statuses.find((x) => x.id === id && x.fromMe); if (!s) throw Object.assign(new Error('statut introuvable'), { code: 404 });
    await sock.sendMessage('status@broadcast', { delete: { remoteJid: 'status@broadcast', id, fromMe: true } }, { statusJidList: [jidNormalizedUser(state.me?.id || '')] });
    statuses = statuses.filter((x) => x.id !== id); saveStatuses(); emit('statuses', {});
  }
  // ---------- v1.4 : groupes ----------
  const toJids = (arr) => (Array.isArray(arr) ? arr : []).map((x) => String(x)).map((x) => (x.includes('@') ? x : x.replace(/\D+/g, '') + '@s.whatsapp.net')).filter((x) => /^\d{5,20}@s\.whatsapp\.net$|^[\w.:-]+@lid$/.test(x)).slice(0, 256);
  async function groupCreate(subject, parts) {
    ready(); subject = String(subject || '').trim().slice(0, 100); const js = toJids(parts);
    if (!subject) throw Object.assign(new Error('Nom du groupe vide'), { code: 400 });
    if (!js.length) throw Object.assign(new Error('Ajoute au moins un participant'), { code: 400 });
    const g = await sock.groupCreate(subject, js);
    const e = ensureChat(g.id); e.name = subject; e.group = true; e.ts = Math.floor(Date.now() / 1000); groupCache.set(g.id, { t: Date.now(), g }); saveSoon(); emit('chats', {});
    return { jid: g.id };
  }
  async function groupManage(jid, o) {
    ready(); if (!isGroup(jid)) throw Object.assign(new Error('Pas un groupe'), { code: 400 });
    const act = String(o.action || ''); const js = toJids(o.participants);
    if (['add', 'remove', 'promote', 'demote'].includes(act)) { if (!js.length) throw Object.assign(new Error('Aucun participant'), { code: 400 }); await sock.groupParticipantsUpdate(jid, js, act); }
    else if (act === 'subject') { const s = String(o.value || '').trim().slice(0, 100); if (!s) throw Object.assign(new Error('Nom vide'), { code: 400 }); await sock.groupUpdateSubject(jid, s); ensureChat(jid).name = s; }
    else if (act === 'desc') await sock.groupUpdateDescription(jid, String(o.value || '').slice(0, 2000));
    else if (act === 'leave') { await sock.groupLeave(jid); }
    else throw Object.assign(new Error('action inconnue'), { code: 400 });
    groupCache.delete(jid); saveSoon(); emit('chats', {});
    return act === 'leave' ? {} : { group: await groupInfo(jid) };
  }
  function mediaFile(f) {
    if (!/^[A-Za-z0-9_-]+\.[a-z0-9]{1,8}$/.test(f || '')) return null;
    const full = path.join(MEDIA, f);
    return fs.existsSync(full) ? full : null;
  }
  async function destroy(wipe) {
    removed = true; stopping = true; clearTimeout(saveTimer);
    try { if (wipe) await sock?.logout(); } catch {}
    try { sock?.end(undefined); } catch {}
    if (wipe) { const rm = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }; rm(); setTimeout(rm, 3000); }
  }
  start().catch((e) => { console.error('Erreur de demarrage :', e); state.status = 'error'; state.error = String(e.message || e); emit('state', publicState()); });
  return {
    id, publicState, unreadTotal, canon, destroy,
    chatList: () => [...chats.keys()].map(chatView).filter((c) => c.ts || c.last).sort((a, b) => b.ts - a.ts),
    messages: (jid) => { jid = canon(jid); const ch = chats.get(jid); if (ch) { ch.unread = 0; saveSoon(); emit('chat', chatView(jid)); } markRead(jid); if (!isGroup(jid) && sock && state.status === 'open') sock.presenceSubscribe(jid).catch(() => {}); return (msgs.get(jid) || []).filter((m) => !m.hidden); },
    deleteForAll, deleteForMe, editMsg, forward, star, starred, search, groupInfo, typing, avatar,
    chatFlag, gallery, sendLocation, statusList, postStatus, deleteStatus, groupCreate, groupManage,
    send, sendMedia, react, rejectCall, mediaFile,
    logout: async () => { try { await sock?.logout(); } catch {} },
  };
}


// ---------- Evenements vers le navigateur (SSE) ----------
const clients = new Set();
function gEmit(type, data) {
  const line = `event: ${type}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const res of clients) res.write(line);
}
// ---------- Liste des comptes ----------
// Migration : l'ancienne version (1.0.0) gardait une seule session dans DATA/auth + DATA/store.json.
// On la deplace dans DATA/accounts/a1/ sans rien perdre (meme session, pas de nouveau QR).
let meta = [];
function loadMeta() {
  try { meta = JSON.parse(fs.readFileSync(ACC_FILE, 'utf8')); return; } catch {}
  meta = [];
  const legacyAuth = path.join(DATA, 'auth');
  if (fs.existsSync(legacyAuth)) {
    const dir = path.join(DATA, 'accounts', 'a1');
    fs.mkdirSync(dir, { recursive: true });
    try { fs.renameSync(legacyAuth, path.join(dir, 'auth')); } catch { fs.cpSync(legacyAuth, path.join(dir, 'auth'), { recursive: true }); }
    const ls = path.join(DATA, 'store.json');
    if (fs.existsSync(ls)) { try { fs.renameSync(ls, path.join(dir, 'store.json')); } catch { fs.copyFileSync(ls, path.join(dir, 'store.json')); } }
    meta = [{ id: 'a1', label: '' }];
  } else {
    meta = [{ id: 'a1', label: '' }];
  }
  saveMeta();
}
function saveMeta() { try { fs.writeFileSync(ACC_FILE, JSON.stringify(meta)); } catch {} }
const accounts = new Map();
const accDir = (id) => path.join(DATA, 'accounts', id);
let changeTimer = null;
function changed() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => gEmit('accounts', { accounts: accountList() }), 300);
}
function accountList() {
  return meta.map((m) => {
    const a = accounts.get(m.id); const st = a?.publicState() || { status: 'starting', me: null };
    return { id: m.id, label: m.label || '', status: st.status, me: st.me, phone: st.me?.id ? '+' + st.me.id.split('@')[0].split(':')[0] : '', unread: a?.unreadTotal() || 0 };
  });
}
loadMeta();
for (const m of meta) accounts.set(m.id, createAccount(m.id, accDir(m.id)));
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
function readBody(req, max = 100000) {
  return new Promise((ok, ko) => {
    let b = ''; req.on('data', (d) => { b += d; if (b.length > max) { ko(new Error('trop gros')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  if (!hostOk(req) || !originOk(req)) { res.writeHead(403); return res.end('forbidden'); }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  if (p.startsWith('/api/')) {
    if (req.method === 'POST' && req.headers['x-pingchat'] !== '1') return json(res, 403, { ok: false, error: 'forbidden' });
    const accId = (b) => { const id = url.searchParams.get('acc') || b?.acc || meta[0]?.id; return accounts.has(id) ? id : null; };
    const A = () => accounts.get(accId());
    if (p === '/api/accounts') return json(res, 200, { ok: true, accounts: accountList() });
    if (p === '/api/accounts/add' && req.method === 'POST') {
      const b = await readBody(req);
      if (meta.length >= MAX_ACCOUNTS) return json(res, 400, { ok: false, error: 'Maximum ' + MAX_ACCOUNTS + ' comptes' });
      let n = 1; while (accounts.has('a' + n) || fs.existsSync(accDir('a' + n))) n++;
      const id = 'a' + n;
      meta.push({ id, label: String(b.label || '').trim().slice(0, 30) }); saveMeta();
      accounts.set(id, createAccount(id, accDir(id)));
      changed();
      return json(res, 200, { ok: true, id, accounts: accountList() });
    }
    if (p === '/api/accounts/rename' && req.method === 'POST') {
      const b = await readBody(req); const m = meta.find((x) => x.id === b.acc);
      if (!m) return json(res, 404, { ok: false });
      m.label = String(b.label || '').trim().slice(0, 30); saveMeta(); changed();
      return json(res, 200, { ok: true, accounts: accountList() });
    }
    if (p === '/api/accounts/remove' && req.method === 'POST') {
      const b = await readBody(req); const a = accounts.get(b.acc);
      if (!a) return json(res, 404, { ok: false });
      await a.destroy(true);
      accounts.delete(b.acc); meta = meta.filter((x) => x.id !== b.acc); saveMeta();
      gEmit('account-removed', { acc: b.acc }); changed();
      return json(res, 200, { ok: true, accounts: accountList() });
    }
    if (p === '/api/state') { const a = A(); return json(res, 200, { ok: true, bridge: 'baileys', multi: true, accounts: accountList(), ...(a ? a.publicState() : { status: 'none' }) }); }
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: accounts\ndata: ${JSON.stringify({ accounts: accountList() })}\n\n`);
      clients.add(res); res.on('close', () => clients.delete(res)); return;
    }
    if (p === '/api/chats') { const a = A(); return json(res, 200, { ok: true, chats: a ? a.chatList() : [] }); }
    if (p === '/api/messages') { const a = A(); return json(res, 200, { ok: true, messages: a ? a.messages(url.searchParams.get('jid') || '') : [] }); }
    if (p === '/api/send' && req.method === 'POST') {
      const b = await readBody(req); const a = accounts.get(b.acc || meta[0]?.id);
      if (!a) return json(res, 404, { ok: false, error: 'compte inconnu' });
      let jid = String(b.jid || '');
      if (!jid && b.phone) jid = String(b.phone).replace(/\D+/g, '') + '@s.whatsapp.net';
      const text = String(b.text || '').trim();
      if (!/^[\w.:-]+@(s\.whatsapp\.net|g\.us|lid)$/.test(jid) || !text) return json(res, 400, { ok: false, error: 'jid ou texte invalide' });
      try { return json(res, 200, { ok: true, id: await a.send(jid, text, b.quotedId) }); }
      catch (e) { return json(res, e.code === 409 ? 409 : 502, { ok: false, error: String(e.message || e) }); }
    }
    if (p === '/api/send-media' && req.method === 'POST') {
      let b; try { b = await readBody(req, 45 * 1024 * 1024); } catch { return json(res, 413, { ok: false, error: 'fichier trop gros' }); }
      const a = accounts.get(b.acc || meta[0]?.id); if (!a) return json(res, 404, { ok: false, error: 'compte inconnu' });
      const jid = String(b.jid || '');
      if (!/^[\w.:-]+@(s\.whatsapp\.net|g\.us|lid)$/.test(jid)) return json(res, 400, { ok: false, error: 'jid invalide' });
      try { return json(res, 200, { ok: true, id: await a.sendMedia(jid, b) }); }
      catch (e) { return json(res, e.code || 502, { ok: false, error: String(e.message || e) }); }
    }
    if (p === '/api/react' && req.method === 'POST') {
      const b = await readBody(req); const a = accounts.get(b.acc || meta[0]?.id); if (!a) return json(res, 404, { ok: false });
      try { await a.react(String(b.jid || ''), String(b.id || ''), String(b.emoji || '').slice(0, 16)); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, e.code || 502, { ok: false, error: String(e.message || e) }); }
    }
    if (p === '/api/call/reject' && req.method === 'POST') {
      const b = await readBody(req); const a = accounts.get(b.acc || meta[0]?.id); if (!a) return json(res, 404, { ok: false });
      try { await a.rejectCall(b.id, b.from); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, e.code || 502, { ok: false, error: String(e.message || e) }); }
    }
    if (p === '/api/settings') {
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (typeof b.readReceipts === 'boolean') settings.readReceipts = b.readReceipts;
        if (typeof b.typing === 'boolean') settings.typing = b.typing;
        try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings)); } catch {}
      }
      return json(res, 200, { ok: true, ...settings });
    }
    const wrapA = async (fn) => { try { return json(res, 200, { ok: true, ...(await fn()) }); } catch (e) { return json(res, e.code || 502, { ok: false, error: String(e.message || e) }); } };
    if (req.method === 'POST' && ['/api/delete', '/api/delete-me', '/api/edit', '/api/forward', '/api/star', '/api/typing'].includes(p)) {
      const b = await readBody(req); const a = accounts.get(b.acc || meta[0]?.id); if (!a) return json(res, 404, { ok: false });
      const jid = String(b.jid || ''); const id = String(b.id || '');
      if (p === '/api/delete') return wrapA(async () => { await a.deleteForAll(jid, id); return {}; });
      if (p === '/api/delete-me') return wrapA(async () => { a.deleteForMe(jid, id); return {}; });
      if (p === '/api/edit') return wrapA(async () => { await a.editMsg(jid, id, b.text); return {}; });
      if (p === '/api/forward') return wrapA(async () => { await a.forward(String(b.to || ''), jid, id); return {}; });
      if (p === '/api/star') return wrapA(async () => { a.star(jid, id, !!b.on); return {}; });
      if (p === '/api/typing') return wrapA(async () => { await a.typing(jid, !!b.on); return {}; });
    }
    if (req.method === 'POST' && ['/api/chat-flag', '/api/location', '/api/group-create', '/api/group-manage', '/api/status-delete'].includes(p)) {
      const b = await readBody(req); const a = accounts.get(b.acc || meta[0]?.id); if (!a) return json(res, 404, { ok: false });
      const jid = String(b.jid || ''); const jidOk = /^[\w.:-]+@(s\.whatsapp\.net|g\.us|lid)$/.test(jid);
      const w = async (fn) => { try { return json(res, 200, { ok: true, ...(await fn()) }); } catch (e) { return json(res, e.code || 502, { ok: false, error: String(e.message || e) }); } };
      if (p === '/api/group-create') return w(() => a.groupCreate(b.name, b.participants));
      if (p === '/api/status-delete') return w(async () => { await a.deleteStatus(String(b.id || '')); return {}; });
      if (!jidOk) return json(res, 400, { ok: false, error: 'jid invalide' });
      if (p === '/api/chat-flag') return w(async () => ({ chat: await a.chatFlag(jid, b) }));
      if (p === '/api/location') return w(async () => ({ id: await a.sendLocation(jid, b) }));
      if (p === '/api/group-manage') return w(() => a.groupManage(jid, b));
    }
    if (p === '/api/status-post' && req.method === 'POST') {
      let b; try { b = await readBody(req, 45 * 1024 * 1024); } catch { return json(res, 413, { ok: false, error: 'fichier trop gros' }); }
      const a = accounts.get(b.acc || meta[0]?.id); if (!a) return json(res, 404, { ok: false });
      try { return json(res, 200, { ok: true, id: await a.postStatus(b) }); } catch (e) { return json(res, e.code || 502, { ok: false, error: String(e.message || e) }); }
    }
    if (p === '/api/statuses') { const a = A(); return json(res, 200, { ok: true, statuses: a ? a.statusList() : [] }); }
    if (p === '/api/gallery') { const a = A(); return json(res, 200, { ok: true, ...(a ? a.gallery(url.searchParams.get('jid') || '') : { media: [], docs: [], links: [] }) }); }
    if (p === '/api/starred') { const a = A(); return json(res, 200, { ok: true, items: a ? a.starred() : [] }); }
    if (p === '/api/search') { const a = A(); return json(res, 200, { ok: true, items: a ? a.search(url.searchParams.get('q')) : [] }); }
    if (p === '/api/group') { const a = A(); if (!a) return json(res, 404, { ok: false }); return wrapA(async () => ({ group: await a.groupInfo(url.searchParams.get('jid') || '') })); }
    if (p === '/api/avatar') {
      const a = A(); const f = a ? a.avatar(url.searchParams.get('jid') || '') : null;
      if (!f) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(f).pipe(res);
    }
    if (p === '/api/media') {
      const a = A(); const f = a?.mediaFile(url.searchParams.get('f') || '');
      if (!f) { res.writeHead(404); return res.end('not found'); }
      const ext = path.extname(f).slice(1); const mime = SERVE_MIME[ext];
      const h = { 'Content-Type': mime || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' };
      if (!mime) h['Content-Disposition'] = 'attachment';
      const size = fs.statSync(f).size; h['Accept-Ranges'] = 'bytes';
      const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (rg && (rg[1] || rg[2])) {
        let st = rg[1] ? Number(rg[1]) : Math.max(0, size - Number(rg[2])); let en = rg[1] && rg[2] ? Number(rg[2]) : size - 1;
        en = Math.min(en, size - 1);
        if (st > en) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); return res.end(); }
        h['Content-Range'] = `bytes ${st}-${en}/${size}`; h['Content-Length'] = en - st + 1;
        res.writeHead(206, h); return fs.createReadStream(f, { start: st, end: en }).pipe(res);
      }
      h['Content-Length'] = size;
      res.writeHead(200, h); return fs.createReadStream(f).pipe(res);
    }
    if (p === '/api/logout' && req.method === 'POST') {
      const b = await readBody(req); await accounts.get(b.acc || meta[0]?.id)?.logout();
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
process.on('SIGINT', () => process.exit(0));

process.on('uncaughtException', (e) => console.error('Erreur :', e));
process.on('unhandledRejection', (e) => console.error('Erreur :', e));
