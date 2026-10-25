'use strict';
// Servidor do clone: HTTP (API, uploads/arquivos) + WebSocket (gateway de eventos e sinalizacao WebRTC).
// Midia (voz, camera, tela) vai direto P2P entre os clientes; o servidor so troca as ofertas/ICE.
// So passa pela VPS quando o P2P falha (CGNAT) e o cliente cai no TURN (coturn), que tem limite de banda.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3478);
const ADMIN_TOKEN = process.env.REA_ADMIN_TOKEN || ''; // protege a API de convites; vazio = API desligada
const TRUST_PROXY = process.env.TRUST_PROXY === '1';   // atras do nginx: IP real vem do X-Real-IP
const TURN_SECRET = process.env.TURN_SECRET || '';     // mesmo valor do static-auth-secret do coturn
const TURN_HOST = process.env.TURN_HOST || '';         // ex.: discord.gendata.tech (vazio = sem TURN)
const TURN_TTL = 48 * 3600;                            // validade da credencial temporaria (s)
const FILES_QUOTA = Number(process.env.FILES_QUOTA_MB || 10240) * 1024 * 1024; // espaco total dos anexos
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'rea.db');
const LEGACY_JSON = path.join(DATA_DIR, 'db.json');
const FILES_DIR = path.join(DATA_DIR, 'files');
const MAX_UPLOAD = 50 * 1024 * 1024;
const PAGE_SIZE = 50;

fs.mkdirSync(FILES_DIR, { recursive: true });

const id = () => (BigInt(Date.now()) * 4096n + BigInt(crypto.randomInt(4096))).toString();

// ---------- banco SQLite (WAL: grava so o que mudou, leitura nao trava escrita) ----------
const sql = new DatabaseSync(DB_FILE);
sql.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, color TEXT NOT NULL, avatar TEXT,
    token TEXT NOT NULL UNIQUE, password TEXT, status TEXT NOT NULL DEFAULT 'online', created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS guilds (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT, owner_id TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY, guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
    name TEXT NOT NULL, type TEXT NOT NULL, position INTEGER NOT NULL, topic TEXT NOT NULL DEFAULT '');
  CREATE TABLE IF NOT EXISTS messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, author_id TEXT NOT NULL,
    content TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', reactions TEXT NOT NULL DEFAULT '{}',
    reply_to TEXT, created_at INTEGER NOT NULL, edited_at INTEGER);
  CREATE INDEX IF NOT EXISTS messages_by_channel ON messages(channel_id, seq);
  CREATE TABLE IF NOT EXISTS invites (
    code TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT);
  CREATE TABLE IF NOT EXISTS files (
    name TEXT PRIMARY KEY, size INTEGER NOT NULL, uploader_id TEXT, created_at INTEGER NOT NULL);
`);

function transaction(fn) {
  sql.exec('BEGIN');
  try { const r = fn(); sql.exec('COMMIT'); return r; } catch (e) { sql.exec('ROLLBACK'); throw e; }
}

const q = {
  userById: sql.prepare('SELECT * FROM users WHERE id = ?'),
  userByToken: sql.prepare('SELECT * FROM users WHERE token = ?'),
  userByName: sql.prepare('SELECT * FROM users WHERE name = ?'), // coluna e NOCASE
  allUsers: sql.prepare('SELECT * FROM users'),
  countUsers: sql.prepare('SELECT COUNT(*) AS n FROM users'),
  insertUser: sql.prepare('INSERT INTO users (id, name, color, avatar, token, password, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  setStatus: sql.prepare('UPDATE users SET status = ? WHERE id = ?'),

  allGuilds: sql.prepare('SELECT * FROM guilds ORDER BY created_at'),
  guild: sql.prepare('SELECT * FROM guilds WHERE id = ?'),
  insertGuild: sql.prepare('INSERT INTO guilds (id, name, icon, owner_id, created_at) VALUES (?, ?, ?, ?, ?)'),

  allChannels: sql.prepare('SELECT * FROM channels ORDER BY position'),
  channel: sql.prepare('SELECT * FROM channels WHERE id = ?'),
  countChannels: sql.prepare('SELECT COUNT(*) AS n FROM channels WHERE guild_id = ?'),
  insertChannel: sql.prepare('INSERT INTO channels (id, guild_id, name, type, position, topic) VALUES (?, ?, ?, ?, ?, ?)'),
  deleteChannel: sql.prepare('DELETE FROM channels WHERE id = ?'),

  message: sql.prepare('SELECT * FROM messages WHERE id = ? AND channel_id = ?'),
  messageSeq: sql.prepare('SELECT seq FROM messages WHERE id = ?'),
  page: sql.prepare('SELECT * FROM messages WHERE channel_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?'),
  insertMessage: sql.prepare('INSERT INTO messages (id, channel_id, author_id, content, attachments, reactions, reply_to, created_at, edited_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  editMessage: sql.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?'),
  setReactions: sql.prepare('UPDATE messages SET reactions = ? WHERE id = ?'),
  deleteMessage: sql.prepare('DELETE FROM messages WHERE id = ?'),
  channelAttachments: sql.prepare("SELECT attachments FROM messages WHERE channel_id = ? AND attachments <> '[]'"),

  invite: sql.prepare('SELECT * FROM invites WHERE code = ?'),
  allInvites: sql.prepare('SELECT i.*, u.name AS used_by_name FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC'),
  insertInvite: sql.prepare('INSERT INTO invites (code, note, created_at) VALUES (?, ?, ?)'),
  useInvite: sql.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE code = ? AND used_at IS NULL'),
  deleteInvite: sql.prepare('DELETE FROM invites WHERE code = ?'),

  filesUsage: sql.prepare('SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS n FROM files'),
  insertFile: sql.prepare('INSERT OR REPLACE INTO files (name, size, uploader_id, created_at) VALUES (?, ?, ?, ?)'),
  deleteFile: sql.prepare('DELETE FROM files WHERE name = ?'),
  countMessages: sql.prepare('SELECT COUNT(*) AS n FROM messages'),
};

const toGuild = (r) => ({ id: r.id, name: r.name, icon: r.icon, ownerId: r.owner_id, createdAt: r.created_at });
const toChannel = (r) => ({ id: r.id, guildId: r.guild_id, name: r.name, type: r.type, position: r.position, topic: r.topic });
const toMessage = (r) => ({
  id: r.id, channelId: r.channel_id, authorId: r.author_id, content: r.content,
  attachments: JSON.parse(r.attachments), createdAt: r.created_at, editedAt: r.edited_at,
  replyTo: r.reply_to, reactions: JSON.parse(r.reactions),
});
const toInvite = (r) => ({ code: r.code, note: r.note, createdAt: r.created_at, usedAt: r.used_at, usedBy: r.used_by, usedByName: r.used_by_name ?? null });

// importa o banco antigo em JSON (versoes anteriores) uma unica vez
function migrateLegacyJson() {
  if (!fs.existsSync(LEGACY_JSON) || q.countUsers.get().n || q.allGuilds.all().length) return;
  const old = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf8'));
  transaction(() => {
    for (const u of Object.values(old.users || {})) q.insertUser.run(u.id, u.name, u.color, u.avatar || null, u.token, u.password || null, u.status || 'online', u.createdAt || Date.now());
    for (const g of Object.values(old.guilds || {})) q.insertGuild.run(g.id, g.name, g.icon || null, g.ownerId || null, g.createdAt || Date.now());
    for (const c of Object.values(old.channels || {})) q.insertChannel.run(c.id, c.guildId, c.name, c.type, c.position, c.topic || '');
    for (const list of Object.values(old.messages || {})) {
      for (const m of list) q.insertMessage.run(m.id, m.channelId, m.authorId, m.content, JSON.stringify(m.attachments || []), JSON.stringify(m.reactions || {}), m.replyTo || null, m.createdAt, m.editedAt || null);
    }
    for (const i of Object.values(old.invites || {})) {
      q.insertInvite.run(i.code, i.note || '', i.createdAt);
      if (i.usedAt) q.useInvite.run(i.usedAt, i.usedBy, i.code);
    }
  });
  fs.renameSync(LEGACY_JSON, LEGACY_JSON + '.migrado');
  console.log('db.json antigo importado para o SQLite');
}
migrateLegacyJson();

// arquivos que ja estavam no disco entram na conta da cota
for (const name of fs.readdirSync(FILES_DIR)) {
  const st = fs.statSync(path.join(FILES_DIR, name));
  if (st.isFile()) sql.prepare('INSERT OR IGNORE INTO files (name, size, created_at) VALUES (?, ?, ?)').run(name, st.size, st.mtimeMs | 0);
}

function ensureDefaultGuild() {
  if (q.allGuilds.all().length) return;
  const gid = id();
  transaction(() => {
    q.insertGuild.run(gid, 'Nosso Servidor', null, null, Date.now());
    [['geral', 'text'], ['clipes', 'text'], ['Geral', 'voice'], ['Jogando', 'voice']].forEach(([name, type], i) => q.insertChannel.run(id(), gid, name, type, i, ''));
  });
}
ensureDefaultGuild();

// apaga do disco os anexos de mensagens excluidas
function removeAttachments(attachments) {
  for (const a of attachments) {
    if (typeof a?.url !== 'string' || !a.url.startsWith('/files/')) continue;
    const name = path.basename(a.url);
    fs.unlink(path.join(FILES_DIR, name), () => {});
    q.deleteFile.run(name);
  }
}

// ---------- TURN: credencial temporaria (padrao "TURN REST API" do coturn: use-auth-secret) ----------
function iceServersFor(userId) {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (!TURN_SECRET || !TURN_HOST) return servers;
  const username = `${Math.floor(Date.now() / 1000) + TURN_TTL}:${userId}`;
  const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
  servers.push({ urls: [`turn:${TURN_HOST}:3478?transport=udp`, `turn:${TURN_HOST}:3478?transport=tcp`], username, credential });
  return servers;
}

// ---------- contas: senha com scrypt, convite de uso unico ----------
const COLORS = ['#5865f2', '#eb459e', '#57f287', '#fee75c', '#ed4245', '#f47b67', '#3ba55c', '#faa61a'];
const MIN_PASSWORD = 8;

function scrypt(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(password, salt)).toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored || '').split('$');
  if (!salt || !hash) { await scrypt(password, 'dummy'); return false; } // mesmo custo, para nao vazar se o usuario existe
  return crypto.timingSafeEqual(await scrypt(password, Buffer.from(salt, 'hex')), Buffer.from(hash, 'hex'));
}

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I
function newInviteCode() {
  let s = '';
  for (let i = 0; i < 12; i++) s += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
  return s.match(/.{4}/g).join('-');
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');
const cleanName = (n) => String(n || '').trim().slice(0, 32);

// convite + nome ok? (usado na 1a etapa do cadastro e de novo no fim)
const BAD_INVITE = 'Codigo de convite invalido ou ja utilizado';
function checkInvite(code, name) {
  const inv = q.invite.get(normCode(code));
  if (!inv || inv.used_at) return BAD_INVITE;
  if (name.length < 2) return 'O nome precisa ter pelo menos 2 caracteres';
  if (q.userByName.get(name)) return 'Esse nome de usuario ja esta em uso';
  return null;
}

// limite de tentativas erradas por IP (login, convite)
const failures = new Map(); // ip -> { count, resetAt }
const MAX_FAILURES = 10;
const FAILURE_WINDOW = 15 * 60 * 1000;
const clientIp = (req) => (TRUST_PROXY && req.headers['x-real-ip']) || req.socket.remoteAddress;
function isBlocked(ip) {
  const f = failures.get(ip);
  if (f && f.resetAt < Date.now()) failures.delete(ip);
  return (failures.get(ip)?.count || 0) >= MAX_FAILURES;
}
function addFailure(ip) {
  const f = failures.get(ip) || { count: 0, resetAt: Date.now() + FAILURE_WINDOW };
  f.count++;
  failures.set(ip, f);
}
setInterval(() => { for (const [ip, f] of failures) if (f.resetAt < Date.now()) failures.delete(ip); }, FAILURE_WINDOW);

function readJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 10_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(obj));
}
function isAdmin(req) {
  const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  const want = Buffer.from(ADMIN_TOKEN);
  return ADMIN_TOKEN && got.length === want.length && crypto.timingSafeEqual(got, want);
}

const api = {
  // 1a etapa do cadastro: valida convite e nome sem gastar o convite
  async 'POST /api/invites/check'(req, res, ip) {
    const d = await readJson(req);
    const err = checkInvite(d.code, cleanName(d.name));
    if (err === BAD_INVITE) addFailure(ip); // so conta tentativa de adivinhar convite, nao nome repetido
    if (err) return sendJson(res, 400, { error: err });
    sendJson(res, 200, { ok: true });
  },

  async 'POST /api/register'(req, res, ip) {
    const d = await readJson(req);
    const name = cleanName(d.name);
    const password = String(d.password || '');
    if (password.length < MIN_PASSWORD) return sendJson(res, 400, { error: `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres` });
    let err = checkInvite(d.code, name);
    if (err === BAD_INVITE) addFailure(ip);
    if (err) return sendJson(res, 400, { error: err });
    const passwordHash = await hashPassword(password);
    // confere de novo depois do await: outro cadastro pode ter usado o convite/nome nesse meio tempo
    err = checkInvite(d.code, name);
    if (err) return sendJson(res, 400, { error: err });
    const user = { id: id(), name, token: crypto.randomBytes(24).toString('hex') };
    transaction(() => {
      q.insertUser.run(user.id, name, COLORS[q.countUsers.get().n % COLORS.length], null, user.token, passwordHash, 'online', Date.now());
      q.useInvite.run(Date.now(), user.id, normCode(d.code));
    });
    sendJson(res, 200, { token: user.token, name: user.name });
  },

  async 'POST /api/login'(req, res, ip) {
    const d = await readJson(req);
    const user = q.userByName.get(cleanName(d.name));
    const ok = await verifyPassword(String(d.password || ''), user?.password);
    if (!user || !ok) { addFailure(ip); return sendJson(res, 401, { error: 'Nome de usuario ou senha incorretos' }); }
    sendJson(res, 200, { token: user.token, name: user.name });
  },

  // ---- admin (Authorization: Bearer REA_ADMIN_TOKEN) ----
  async 'POST /api/admin/invites'(req, res) {
    const d = await readJson(req);
    const count = Math.min(Math.max(Number(d.count) || 1, 1), 50);
    const note = String(d.note || '').slice(0, 200);
    const created = [];
    transaction(() => {
      for (let i = 0; i < count; i++) {
        const inv = { code: newInviteCode(), note, createdAt: Date.now(), usedAt: null, usedBy: null };
        q.insertInvite.run(inv.code, inv.note, inv.createdAt);
        created.push(inv);
      }
    });
    sendJson(res, 201, count === 1 ? created[0] : { invites: created });
  },

  'GET /api/admin/invites'(req, res) {
    sendJson(res, 200, { invites: q.allInvites.all().map(toInvite) });
  },

  'GET /api/admin/stats'(req, res) {
    const files = q.filesUsage.get();
    sendJson(res, 200, {
      users: q.countUsers.get().n,
      online: sockets.size,
      inVoice: voice.size,
      connections: wss.clients.size,
      messages: q.countMessages.get().n,
      files: { count: files.n, usedMB: Math.round(files.bytes / 1048576), quotaMB: Math.round(FILES_QUOTA / 1048576) },
      memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      uptimeS: Math.round(process.uptime()),
    });
  },
};

// ---------- HTTP: API, upload e download de anexos ----------
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-filename, x-token, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
  if (req.method === 'OPTIONS') return res.end();

  const url = req.url.split('?')[0];
  if (url.startsWith('/api/')) {
    const ip = clientIp(req);
    if (url.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return sendJson(res, ADMIN_TOKEN ? 401 : 403, { error: ADMIN_TOKEN ? 'Nao autorizado' : 'Defina REA_ADMIN_TOKEN para usar a API de admin' });
      const m = url.match(/^\/api\/admin\/invites\/([A-Za-z0-9-]+)$/);
      if (req.method === 'DELETE' && m) { // revoga um convite nao usado
        const inv = q.invite.get(normCode(m[1]));
        if (!inv) return sendJson(res, 404, { error: 'Convite nao encontrado' });
        if (inv.used_at) return sendJson(res, 409, { error: 'Convite ja foi utilizado' });
        q.deleteInvite.run(inv.code);
        return sendJson(res, 200, { ok: true });
      }
    } else if (isBlocked(ip)) {
      return sendJson(res, 429, { error: 'Muitas tentativas. Tente de novo em alguns minutos.' });
    }
    const h = api[`${req.method} ${url}`];
    if (!h) return sendJson(res, 404, { error: 'Rota nao encontrada' });
    Promise.resolve(h(req, res, ip)).catch((e) => { console.error('erro em', url, e); sendJson(res, 500, { error: 'Erro interno' }); });
    return;
  }

  if (req.method === 'POST' && url === '/upload') {
    const user = q.userByToken.get(String(req.headers['x-token'] || ''));
    if (!user) return sendJson(res, 401, { error: 'Nao autorizado' });
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_UPLOAD) return sendJson(res, 413, { error: 'Arquivo maior que 50 MB' });
    const used = q.filesUsage.get().bytes;
    if (used + declared > FILES_QUOTA) return sendJson(res, 507, { error: 'O espaco para anexos do servidor acabou' });
    const original = path.basename(decodeURIComponent(req.headers['x-filename'] || 'arquivo')).slice(0, 120);
    const ext = path.extname(original).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const name = id() + ext;
    const dest = path.join(FILES_DIR, name);
    let size = 0;
    let aborted = false;
    const out = fs.createWriteStream(dest);
    req.on('data', (chunk) => {
      size += chunk.length;
      if (!aborted && (size > MAX_UPLOAD || used + size > FILES_QUOTA)) {
        aborted = true;
        req.unpipe(out); out.destroy(); fs.unlink(dest, () => {});
        sendJson(res, size > MAX_UPLOAD ? 413 : 507, { error: size > MAX_UPLOAD ? 'Arquivo maior que 50 MB' : 'O espaco para anexos do servidor acabou' });
        req.resume();
      }
    });
    req.pipe(out);
    out.on('finish', () => {
      if (aborted) return;
      q.insertFile.run(name, size, user.id, Date.now());
      sendJson(res, 200, { url: `/files/${name}`, name: original, size, type: MIME[ext] || req.headers['content-type'] || 'application/octet-stream' });
    });
    return;
  }

  if (req.method === 'GET' && url.startsWith('/files/')) {
    const file = path.join(FILES_DIR, path.basename(url.slice(7)));
    fs.stat(file, (err, st) => {
      if (err) { res.statusCode = 404; return res.end(); }
      res.setHeader('content-type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
      res.setHeader('content-length', st.size);
      res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      fs.createReadStream(file).pipe(res);
    });
    return;
  }

  res.statusCode = 404;
  res.end('discord-rea server');
});

// ---------- Gateway WebSocket ----------
const wss = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: 2 * 1024 * 1024 });
const sockets = new Map(); // userId -> Set<ws>
const voice = new Map();   // userId -> { channelId, muted, deafened, streaming, video, sessionWs }

const publicUser = (u) => ({ id: u.id, name: u.name, color: u.color, avatar: u.avatar || null, status: sockets.has(u.id) ? (u.status || 'online') : 'offline' });

function send(ws, op, d) { if (ws.readyState === 1) ws.send(JSON.stringify({ op, d })); }
function broadcast(op, d, exceptWs) {
  const msg = JSON.stringify({ op, d });
  for (const set of sockets.values()) for (const ws of set) if (ws !== exceptWs && ws.readyState === 1) ws.send(msg);
}
function sendToUser(userId, op, d) {
  const v = voice.get(userId);
  // sinalizacao vai so para a sessao que esta na call
  if (v && v.sessionWs && (op === 'signal')) return send(v.sessionWs, op, d);
  const set = sockets.get(userId);
  if (set) for (const ws of set) send(ws, op, d);
}

function voiceStates() {
  return [...voice.entries()].map(([userId, v]) => ({ userId, channelId: v.channelId, muted: v.muted, deafened: v.deafened, streaming: v.streaming, video: v.video }));
}

function leaveVoice(userId) {
  const v = voice.get(userId);
  if (!v) return;
  voice.delete(userId);
  broadcast('voice_state', { userId, channelId: null });
}

const handlers = {
  identify(ws, d) {
    // o token vem do /api/login ou /api/register
    const user = d.token && q.userByToken.get(String(d.token));
    if (!user) return send(ws, 'error', { code: 'bad_token', message: 'Sessao expirada. Entre novamente.' });
    ws.userId = user.id;
    const firstSocket = !sockets.has(user.id);
    if (firstSocket) sockets.set(user.id, new Set());
    sockets.get(user.id).add(ws);
    send(ws, 'ready', {
      user: { ...publicUser(user), token: user.token },
      users: q.allUsers.all().map(publicUser),
      guilds: q.allGuilds.all().map(toGuild),
      channels: q.allChannels.all().map(toChannel),
      voiceStates: voiceStates(),
      iceServers: iceServersFor(user.id),
    });
    if (firstSocket) broadcast('presence', publicUser(user), ws);
  },

  history(ws, d) {
    const before = d.before ? q.messageSeq.get(String(d.before))?.seq : null;
    const rows = q.page.all(String(d.channelId), before ?? Number.MAX_SAFE_INTEGER, PAGE_SIZE + 1);
    const hasMore = rows.length > PAGE_SIZE;
    const messages = rows.slice(0, PAGE_SIZE).reverse().map(toMessage);
    send(ws, 'history', { channelId: d.channelId, messages, hasMore, before: d.before || null });
  },

  message_create(ws, d) {
    const ch = q.channel.get(String(d.channelId));
    if (!ch || ch.type !== 'text') return;
    const content = String(d.content || '').slice(0, 4000);
    const attachments = Array.isArray(d.attachments) ? d.attachments.slice(0, 10) : [];
    if (!content.trim() && !attachments.length) return;
    const m = { id: id(), channelId: ch.id, authorId: ws.userId, content, attachments, createdAt: Date.now(), editedAt: null, replyTo: d.replyTo ? String(d.replyTo) : null, reactions: {} };
    q.insertMessage.run(m.id, m.channelId, m.authorId, m.content, JSON.stringify(m.attachments), '{}', m.replyTo, m.createdAt, null);
    broadcast('message_create', { ...m, nonce: d.nonce });
  },

  message_update(ws, d) {
    const row = q.message.get(String(d.id), String(d.channelId));
    if (!row || row.author_id !== ws.userId) return;
    const m = { ...toMessage(row), content: String(d.content || '').slice(0, 4000), editedAt: Date.now() };
    q.editMessage.run(m.content, m.editedAt, m.id);
    broadcast('message_update', m);
  },

  message_delete(ws, d) {
    const row = q.message.get(String(d.id), String(d.channelId));
    if (!row || row.author_id !== ws.userId) return;
    q.deleteMessage.run(row.id);
    removeAttachments(JSON.parse(row.attachments));
    broadcast('message_delete', { channelId: d.channelId, id: d.id });
  },

  reaction_toggle(ws, d) {
    const row = q.message.get(String(d.id), String(d.channelId));
    if (!row) return;
    const emoji = String(d.emoji || '').slice(0, 16);
    if (!emoji) return;
    const m = toMessage(row);
    const users = new Set(m.reactions[emoji] || []);
    users.has(ws.userId) ? users.delete(ws.userId) : users.add(ws.userId);
    if (users.size) m.reactions[emoji] = [...users]; else delete m.reactions[emoji];
    q.setReactions.run(JSON.stringify(m.reactions), m.id);
    broadcast('message_update', m);
  },

  typing(ws, d) { broadcast('typing', { channelId: d.channelId, userId: ws.userId }, ws); },

  guild_create(ws, d) {
    const name = String(d.name || '').trim().slice(0, 100);
    if (!name) return;
    const g = { id: id(), name, icon: null, ownerId: ws.userId, createdAt: Date.now() };
    const text = { id: id(), guildId: g.id, name: 'geral', type: 'text', position: 0, topic: '' };
    const vc = { id: id(), guildId: g.id, name: 'Geral', type: 'voice', position: 1, topic: '' };
    transaction(() => {
      q.insertGuild.run(g.id, g.name, null, g.ownerId, g.createdAt);
      for (const c of [text, vc]) q.insertChannel.run(c.id, c.guildId, c.name, c.type, c.position, c.topic);
    });
    broadcast('guild_create', { guild: g, channels: [text, vc] });
  },

  channel_create(ws, d) {
    if (!q.guild.get(String(d.guildId))) return;
    const type = d.type === 'voice' ? 'voice' : 'text';
    let name = String(d.name || '').trim().slice(0, 100);
    if (type === 'text') name = name.toLowerCase().replace(/\s+/g, '-');
    if (!name) return;
    const c = { id: id(), guildId: String(d.guildId), name, type, position: q.countChannels.get(String(d.guildId)).n, topic: '' };
    q.insertChannel.run(c.id, c.guildId, c.name, c.type, c.position, c.topic);
    broadcast('channel_create', c);
  },

  channel_delete(ws, d) {
    const c = q.channel.get(String(d.id));
    if (!c) return;
    const attachments = q.channelAttachments.all(c.id).flatMap((r) => JSON.parse(r.attachments));
    q.deleteChannel.run(c.id); // mensagens saem junto (ON DELETE CASCADE)
    removeAttachments(attachments);
    for (const [uid, v] of voice) if (v.channelId === c.id) leaveVoice(uid);
    broadcast('channel_delete', { id: c.id, guildId: c.guild_id });
  },

  status(ws, d) {
    if (!['online', 'idle', 'dnd', 'invisible'].includes(d.status)) return;
    q.setStatus.run(d.status, ws.userId);
    broadcast('presence', publicUser(q.userById.get(ws.userId)));
  },

  voice_join(ws, d) {
    const c = q.channel.get(String(d.channelId));
    if (!c || c.type !== 'voice') return;
    const prev = voice.get(ws.userId);
    if (prev) leaveVoice(ws.userId);
    const v = { channelId: c.id, muted: !!d.muted, deafened: !!d.deafened, streaming: false, video: false, sessionWs: ws };
    voice.set(ws.userId, v);
    // o novo participante recebe a lista de quem ja esta na sala e ele inicia as conexoes
    const peers = [...voice.entries()].filter(([uid, x]) => uid !== ws.userId && x.channelId === c.id).map(([uid]) => uid);
    send(ws, 'voice_ready', { channelId: c.id, peers });
    broadcast('voice_state', { userId: ws.userId, channelId: c.id, muted: v.muted, deafened: v.deafened, streaming: false, video: false });
  },

  voice_leave(ws) { if (voice.get(ws.userId)?.sessionWs === ws) leaveVoice(ws.userId); },

  voice_update(ws, d) {
    const v = voice.get(ws.userId);
    if (!v) return;
    for (const k of ['muted', 'deafened', 'streaming', 'video']) if (k in d) v[k] = !!d[k];
    broadcast('voice_state', { userId: ws.userId, channelId: v.channelId, muted: v.muted, deafened: v.deafened, streaming: v.streaming, video: v.video });
  },

  signal(ws, d) {
    const me = voice.get(ws.userId);
    const peer = voice.get(d.to);
    if (!me || !peer || me.channelId !== peer.channelId) return;
    sendToUser(d.to, 'signal', { from: ws.userId, data: d.data });
  },

  ping(ws) { send(ws, 'pong', { t: Date.now() }); },
};

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const h = handlers[msg.op];
    if (!h) return;
    if (msg.op !== 'identify' && !ws.userId) return;
    try { h(ws, msg.d || {}); } catch (e) { console.error('erro em', msg.op, e); }
  });
  ws.on('close', () => {
    const uid = ws.userId;
    if (!uid) return;
    if (voice.get(uid)?.sessionWs === ws) leaveVoice(uid);
    const set = sockets.get(uid);
    if (!set) return;
    set.delete(ws);
    if (!set.size) {
      sockets.delete(uid);
      const u = q.userById.get(uid);
      if (u) broadcast('presence', publicUser(u));
    }
  });
});

// derruba conexoes mortas
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// docker stop manda SIGTERM: fecha o banco (checkpoint do WAL) antes de sair
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    try { sql.close(); } catch (e) { console.error(e); }
    process.exit(0);
  });
}

server.listen(PORT, () => console.log(`Servidor Discord-REA ouvindo em http://localhost:${PORT}${ADMIN_TOKEN ? '' : ' (API de convites desligada: defina REA_ADMIN_TOKEN)'}${TURN_SECRET && TURN_HOST ? ` | TURN: ${TURN_HOST}` : ''}`));
