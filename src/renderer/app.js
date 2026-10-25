'use strict';
/* global REA_RTC */

// =====================================================================
// Utilidades
// =====================================================================
const $ = (s, root = document) => root.querySelector(s);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (name) => (name || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const fmtTime = (t) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function fmtStamp(t) {
  const d = new Date(t); const now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return `Hoje as ${fmtTime(t)}`;
  if (d.toDateString() === yest.toDateString()) return `Ontem as ${fmtTime(t)}`;
  return `${d.toLocaleDateString('pt-BR')} ${fmtTime(t)}`;
}
const fmtDay = (t) => new Date(t).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(2) + ' MB' : (b / 1024).toFixed(1) + ' KB');
const sz = (svg, n) => svg.replace(/width="d+" height="d+"/, `width="${n}" height="${n}"`);
const nonce = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

const I = {
  hash: '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M10.99 3.16A1 1 0 1 0 9 2.84L8.15 8H4a1 1 0 0 0 0 2h3.82l-.67 4H3a1 1 0 1 0 0 2h3.82l-.8 4.84a1 1 0 0 0 1.97.32L8.85 16h4.97l-.8 4.84a1 1 0 0 0 1.97.32l.86-5.16H20a1 1 0 1 0 0-2h-3.82l.67-4H21a1 1 0 1 0 0-2h-3.82l.8-4.84a1 1 0 1 0-1.97-.32L15.15 8h-4.97l.8-4.84ZM14.15 14l.67-4H9.85l-.67 4h4.97Z"/></svg>',
  speaker: '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3a1 1 0 0 0-1-1h-.06a1 1 0 0 0-.74.32L5.92 7H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2.92l4.28 4.68a1 1 0 0 0 .74.32H11a1 1 0 0 0 1-1V3ZM15.1 20.75c-.58.14-1.1-.33-1.1-.92v-.03c0-.5.37-.92.85-1.05a7 7 0 0 0 0-13.5A1.11 1.11 0 0 1 14 4.2v-.03c0-.6.52-1.06 1.1-.92a9 9 0 0 1 0 17.5Z"/><path fill="currentColor" d="M15.16 16.51c-.57.28-1.16-.2-1.16-.83v-.14c0-.43.28-.8.63-1.02a3 3 0 0 0 0-5.04c-.35-.23-.63-.6-.63-1.02v-.14c0-.63.59-1.1 1.16-.83a5 5 0 0 1 0 9.02Z"/></svg>',
  mic: '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Z"/><path fill="currentColor" d="M6 10a1 1 0 0 0-2 0 8 8 0 0 0 7 7.94V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.06A8 8 0 0 0 20 10a1 1 0 1 0-2 0 6 6 0 0 1-12 0Z"/></svg>',
  micOff: '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Z"/><path fill="currentColor" d="M6 10a1 1 0 0 0-2 0 8 8 0 0 0 7 7.94V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.06A8 8 0 0 0 20 10a1 1 0 1 0-2 0 6 6 0 0 1-12 0Z"/><path fill="var(--red)" d="M2.7 2.7a1 1 0 0 1 1.4 0l17.2 17.2a1 1 0 0 1-1.4 1.4L2.7 4.1a1 1 0 0 1 0-1.4Z"/></svg>',
  head: '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3a9 9 0 0 0-8.95 10h1.87a5 5 0 0 1 4.1 2.13l1.37 1.97a3.1 3.1 0 0 1-.17 3.78 2.85 2.85 0 0 1-3.55.74 11 11 0 1 1 10.66 0c-1.27.71-2.73.23-3.55-.74a3.1 3.1 0 0 1-.17-3.78l1.38-1.97a5 5 0 0 1 4.1-2.13h1.86A9 9 0 0 0 12 3Z"/></svg>',
  headOff: '<svg width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3a9 9 0 0 0-8.95 10h1.87a5 5 0 0 1 4.1 2.13l1.37 1.97a3.1 3.1 0 0 1-.17 3.78 2.85 2.85 0 0 1-3.55.74 11 11 0 1 1 10.66 0c-1.27.71-2.73.23-3.55-.74a3.1 3.1 0 0 1-.17-3.78l1.38-1.97a5 5 0 0 1 4.1-2.13h1.86A9 9 0 0 0 12 3Z"/><path fill="var(--red)" d="M2.7 2.7a1 1 0 0 1 1.4 0l17.2 17.2a1 1 0 0 1-1.4 1.4L2.7 4.1a1 1 0 0 1 0-1.4Z"/></svg>',
  cam: '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M4 6a2 2 0 0 0-2 2v8c0 1.1.9 2 2 2h10a2 2 0 0 0 2-2v-2.4l4.4 2.9c.7.4 1.6 0 1.6-.8V8.3c0-.8-.9-1.2-1.6-.8L16 10.4V8a2 2 0 0 0-2-2z"/></svg>',
  screen: '<svg width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M4 3a2 2 0 0 0-2 2v10c0 1.1.9 2 2 2h7v2H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2h7a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm8 3.5 4 3.5h-3v3h-2v-3H8z"/></svg>',
  full: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/></svg>',
  stats: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M4 20V10h3v10zm6.5 0V4h3v16zM17 20v-7h3v7z"/></svg>',
  stop: '<svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>',
  logo: '<svg viewBox="0 0 48 48" width="30" height="30"><path fill="currentColor" d="M24 6c-9.9 0-18 6.7-18 15 0 4.6 2.5 8.7 6.4 11.5L11 40l7.7-4.4c1.7.4 3.5.6 5.3.6 9.9 0 18-6.7 18-15S33.9 6 24 6Zm-7 18a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Zm14 0a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"/></svg>',
};

const EMOJIS = '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👻 👽 🤖 😺 😸 😹 😻 😼 🙀 😿 😾 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💯 💢 💥 💫 💦 💨 👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🙏 💪 🔥 ⭐ ✨ 🎉 🎊 🎮 🕹️ 🏆 ⚽ 🏀 🍕 🍔 🍟 🌭 🍿 🍺 🍻 ☕ 🚀 💻 🖥️ 📱 🎧 🎤 📺 ✅ ❌ ⚠️ ❓ ❗ 👀 🗿'.split(' ');

// =====================================================================
// Sons (gerados na hora, sem arquivos)
// =====================================================================
const Sounds = (() => {
  let ctx;
  const tone = (freqs, dur = 0.09, type = 'sine', vol = 0.12) => {
    if (!state.settings.sounds) return;
    ctx ||= new AudioContext();
    let t = ctx.currentTime;
    for (const f of freqs) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur);
      t += dur * 0.8;
    }
  };
  return {
    join: () => tone([523, 784], 0.11), leave: () => tone([784, 523], 0.11),
    mute: () => tone([400], 0.07, 'triangle'), unmute: () => tone([600], 0.07, 'triangle'),
    pttOn: () => tone([700], 0.04, 'sine', 0.05), pttOff: () => tone([500], 0.04, 'sine', 0.05),
    message: () => tone([880, 1175], 0.07, 'sine', 0.08), streamStart: () => tone([523, 659, 784], 0.09), streamStop: () => tone([784, 659, 523], 0.09),
  };
})();

// =====================================================================
// Estado
// =====================================================================
const DEFAULT_SETTINGS = {
  inputDevice: '', outputDevice: '', videoDevice: '',
  inputVolume: 1, outputVolume: 1,
  inputMode: 'vad', pttBind: null, pttReleaseDelay: 20,
  autoSensitivity: true, vadThresholdDb: -50,
  noiseSuppression: 'krisp', echoCancellation: true, advancedVad: true, autoGainControl: true,
  qos: true, codec: 'H264',
  streamResolution: '1080', streamFps: 60, streamAudio: true, streamHint: 'auto',
  sounds: true, notifications: true, showMembers: true,
};

const state = {
  settings: { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('rea.settings') || '{}') },
  user: null,
  users: new Map(),
  guilds: new Map(),
  channels: new Map(),
  voiceStates: new Map(),
  messages: new Map(), // channelId -> { list: [], loaded: bool, hasMore: bool, loading: bool }
  activeGuild: localStorage.getItem('rea.guild'),
  activeChannel: null,
  lastText: JSON.parse(localStorage.getItem('rea.lastText') || '{}'), // guildId -> channelId
  unread: new Set(JSON.parse(localStorage.getItem('rea.unread') || '[]')),
  typing: new Map(),
  selfMute: false,
  selfDeaf: false,
  voice: null,          // VoiceSession
  voiceChannel: null,
  watching: new Set(),  // userIds cuja transmissao estou assistindo
  focusTile: null,
  showStats: new Set(),
  replyTo: null,
  uploads: [],
  httpBase: '',
};
if (typeof state.settings.noiseSuppression === 'boolean') state.settings.noiseSuppression = state.settings.noiseSuppression ? 'krisp' : 'none';
delete state.settings.voiceThreshold;
const saveSettings = () => localStorage.setItem('rea.settings', JSON.stringify(state.settings));
const saveUnread = () => { localStorage.setItem('rea.unread', JSON.stringify([...state.unread])); window.native.setBadge(state.unread.size); };

// =====================================================================
// Gateway
// =====================================================================
class Gateway {
  constructor() { this.handlers = {}; this.ws = null; this.backoff = 500; this.closedByUser = false; }
  on(op, cb) { this.handlers[op] = cb; }
  connect(url, identify) {
    this.url = url; this.identify = identify; this.closedByUser = false;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { this.backoff = 500; this.send('identify', this.identify()); };
    ws.onmessage = (e) => { const { op, d } = JSON.parse(e.data); const fn = this.handlers[op]; if (fn) fn(d); };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.handlers.__close && this.handlers.__close();
      if (this.closedByUser) return;
      setTimeout(() => this.connect(this.url, this.identify), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 10000);
    };
  }
  send(op, d) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ op, d })); }
  close() { this.closedByUser = true; if (this.ws) this.ws.close(); }
}
const gw = new Gateway();

// =====================================================================
// Login
// =====================================================================
function showScreen(id) { for (const s of ['login', 'connecting', 'app']) $('#' + s).classList.toggle('hidden', s !== id); }

// a senha nunca fica salva: o login/cadastro (HTTP) devolve um token, e o gateway so usa o token
const httpBaseOf = (server) => server.replace(/^ws/, 'http').replace(/\/$/, '');
const getAuth = () => JSON.parse(localStorage.getItem('rea.auth') || 'null');

function showLoginForm(id) {
  for (const f of ['login-form', 'register-form']) $('#' + f).classList.toggle('hidden', f !== id);
  $(`#${id} input`).focus();
}

function startConnection() {
  const auth = getAuth();
  if (!auth?.token) { showScreen('login'); showLoginForm('login-form'); return; }
  if (!window.native.config.dev) auth.server = window.native.config.server;
  state.httpBase = httpBaseOf(auth.server);
  showScreen('connecting');
  gw.connect(auth.server, () => ({ token: getAuth()?.token }));
}

async function authRequest(form, server, route, body) {
  const err = $('.error', form);
  const btn = $('button[type=submit]', form);
  err.textContent = '';
  btn.disabled = true;
  try {
    const res = await fetch(httpBaseOf(server) + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { err.textContent = data.error || `Erro ${res.status}`; return null; }
    return data;
  } catch {
    err.textContent = 'Nao foi possivel conectar ao servidor';
    return null;
  } finally {
    btn.disabled = false;
  }
}

function loggedIn(server, data) {
  localStorage.setItem('rea.auth', JSON.stringify({ server, name: data.name, token: data.token }));
  for (const id of ['login-password', 'reg-password', 'reg-password2', 'reg-code']) $('#' + id).value = '';
  startConnection();
}

for (const a of document.querySelectorAll('.login-switch a')) a.onclick = () => showLoginForm(a.dataset.goto);
// em producao o endereco e fixo (wss://discord.gendata.tech) e o campo fica escondido; com --dev ele aparece
for (const input of document.querySelectorAll('.server-input')) {
  input.value = window.native.config.server;
  input.closest('.server-field').classList.toggle('hidden', !window.native.config.dev);
  input.oninput = () => { for (const other of document.querySelectorAll('.server-input')) if (other !== input) other.value = input.value; };
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const server = $('#login-server').value.trim() || window.native.config.server;
  const data = await authRequest(e.target, server, '/api/login', { name: $('#login-name').value.trim(), password: $('#login-password').value });
  if (data) loggedIn(server, data);
});

// cadastro em 2 etapas: (1) convite + nome, (2) senha + confirmar senha
function resetRegisterStep() {
  $('#reg-step2').classList.add('hidden');
  $('#register-form button[type=submit]').textContent = 'Continuar';
  for (const id of ['reg-password', 'reg-password2']) $('#' + id).required = false;
}
$('#reg-code').addEventListener('input', resetRegisterStep);
$('#reg-name').addEventListener('input', resetRegisterStep);

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const server = $('#reg-server').value.trim() || window.native.config.server;
  const code = $('#reg-code').value.trim();
  const name = $('#reg-name').value.trim();
  if ($('#reg-step2').classList.contains('hidden')) {
    if (!(await authRequest(form, server, '/api/invites/check', { code, name }))) return;
    $('#reg-step2').classList.remove('hidden');
    for (const id of ['reg-password', 'reg-password2']) $('#' + id).required = true;
    $('button[type=submit]', form).textContent = 'Criar conta';
    $('#reg-password').focus();
    return;
  }
  const password = $('#reg-password').value;
  if (password !== $('#reg-password2').value) { $('.error', form).textContent = 'As senhas nao coincidem'; return; }
  const data = await authRequest(form, server, '/api/register', { code, name, password });
  if (data) loggedIn(server, data);
});

function logout() {
  leaveVoice();
  gw.close();
  localStorage.removeItem('rea.auth');
  closeSettings();
  showScreen('login');
  showLoginForm('login-form');
}

// =====================================================================
// Eventos do gateway
// =====================================================================
gw.on('error', (d) => {
  const auth = getAuth();
  gw.close();
  if (auth) {
    localStorage.setItem('rea.auth', JSON.stringify({ ...auth, token: null }));
    $('#login-name').value = auth.name;
    if (window.native.config.dev) for (const input of document.querySelectorAll('.server-input')) input.value = auth.server;
  }
  showScreen('login');
  showLoginForm('login-form');
  $('#login-form .error').textContent = d.message;
});

gw.on('__close', () => {
  if (state.voice) { state.rejoinVoice = state.voiceChannel; teardownVoiceLocal(); }
  if (state.user) showScreen('connecting');
});

gw.on('ready', (d) => {
  const auth = JSON.parse(localStorage.getItem('rea.auth'));
  localStorage.setItem('rea.auth', JSON.stringify({ ...auth, token: d.user.token, name: d.user.name }));
  state.user = d.user;
  state.iceServers = d.iceServers;
  state.users = new Map(d.users.map((u) => [u.id, u]));
  state.guilds = new Map(d.guilds.map((g) => [g.id, g]));
  state.channels = new Map(d.channels.map((c) => [c.id, c]));
  state.voiceStates = new Map(d.voiceStates.map((v) => [v.userId, v]));
  state.messages.clear();
  if (!state.guilds.has(state.activeGuild)) state.activeGuild = [...state.guilds.keys()][0];
  showScreen('app');
  selectGuild(state.activeGuild);
  renderUserPanel();
  configurePTT();
  if (state.rejoinVoice && state.channels.has(state.rejoinVoice)) { joinVoice(state.rejoinVoice); }
  state.rejoinVoice = null;
});

gw.on('presence', (u) => {
  state.users.set(u.id, { ...state.users.get(u.id), ...u });
  renderMembers();
  if (u.id === state.user.id) { state.user = { ...state.user, ...u }; renderUserPanel(); }
});

gw.on('history', (d) => {
  const box = state.messages.get(d.channelId) || { list: [] };
  box.list = d.before ? [...d.messages, ...box.list] : d.messages;
  box.loaded = true; box.hasMore = d.hasMore; box.loading = false;
  state.messages.set(d.channelId, box);
  if (d.channelId === state.activeChannel) renderMessages(!!d.before);
});

gw.on('message_create', (m) => {
  const box = state.messages.get(m.channelId);
  if (box && box.loaded) {
    const pend = m.authorId === state.user.id ? box.list.findIndex((x) => x.pending && x.nonce === m.nonce) : -1;
    if (pend >= 0) box.list[pend] = m; else box.list.push(m);
  }
  clearTyping(m.channelId, m.authorId);
  const isMine = m.authorId === state.user.id;
  const visible = m.channelId === state.activeChannel && document.hasFocus();
  if (m.channelId === state.activeChannel) renderMessages(true);
  if (!isMine && !visible) {
    state.unread.add(m.channelId); saveUnread(); renderGuilds(); renderChannels();
    const author = state.users.get(m.authorId);
    const ch = state.channels.get(m.channelId);
    Sounds.message();
    if (state.settings.notifications && state.user.status !== 'dnd') { window.native.notify(`${author?.name || '?'} (#${ch?.name})`, m.content || '📎 Anexo'); window.native.window.flash(); }
  }
});

gw.on('message_update', (m) => {
  const box = state.messages.get(m.channelId);
  if (!box) return;
  const i = box.list.findIndex((x) => x.id === m.id);
  if (i >= 0) box.list[i] = m;
  if (m.channelId === state.activeChannel) renderMessages(true);
});

gw.on('message_delete', ({ channelId, id }) => {
  const box = state.messages.get(channelId);
  if (!box) return;
  box.list = box.list.filter((x) => x.id !== id);
  if (channelId === state.activeChannel) renderMessages(true);
});

gw.on('typing', ({ channelId, userId }) => {
  if (!state.typing.has(channelId)) state.typing.set(channelId, new Map());
  const m = state.typing.get(channelId);
  clearTimeout(m.get(userId));
  m.set(userId, setTimeout(() => clearTyping(channelId, userId), 10000));
  if (channelId === state.activeChannel) renderTyping();
});
function clearTyping(channelId, userId) {
  const m = state.typing.get(channelId);
  if (!m || !m.has(userId)) return;
  clearTimeout(m.get(userId)); m.delete(userId);
  if (channelId === state.activeChannel) renderTyping();
}

gw.on('guild_create', ({ guild, channels }) => {
  state.guilds.set(guild.id, guild);
  for (const c of channels) state.channels.set(c.id, c);
  renderGuilds();
  if (guild.ownerId === state.user.id) selectGuild(guild.id);
});
gw.on('channel_create', (c) => {
  state.channels.set(c.id, c);
  renderChannels();
  if (c.guildId === state.activeGuild && state.pendingChannelSelect === c.name) { state.pendingChannelSelect = null; if (c.type === 'text') selectChannel(c.id); }
});
gw.on('channel_delete', ({ id, guildId }) => {
  state.channels.delete(id); state.messages.delete(id);
  if (state.activeChannel === id) { const first = channelsOf(guildId).find((c) => c.type === 'text'); selectChannel(first ? first.id : null); }
  renderChannels();
});

gw.on('voice_state', (v) => {
  const prev = state.voiceStates.get(v.userId);
  if (v.channelId) state.voiceStates.set(v.userId, v); else state.voiceStates.delete(v.userId);
  if (state.voice && v.userId !== state.user.id) {
    const wasHere = prev && prev.channelId === state.voiceChannel;
    const isHere = v.channelId === state.voiceChannel;
    if (wasHere && !isHere) { state.voice.removePeer(v.userId); setWatching(v.userId, false); Sounds.leave(); }
    if (!wasHere && isHere) Sounds.join();
    if (prev && prev.streaming && !v.streaming) setWatching(v.userId, false);
  }
  renderChannels(); renderCall();
});

gw.on('voice_ready', async ({ channelId, peers }) => {
  if (!state.voice) {
    state.voice = new REA_RTC.VoiceSession(gw, state.user.id, state.settings, state.iceServers);
    state.voice.on('speaking', () => updateSpeaking());
    state.voice.on('remote-streams', () => renderCall());
    state.voice.on('local-streams', () => { renderVoicePanel(); renderCall(); });
    state.voice.on('speaking-while-muted', () => showMutedHint());
    state.voice.on('no-input', () => toast('Nao detectamos nenhum som do seu microfone. Confira o dispositivo de entrada em Configuracoes > Voz e video.'));
    state.voice.on('relay', ({ userId, relayed }) => {
      if (relayed && state.voice?.screen) toast(`A conexao com ${state.users.get(userId)?.name || '?'} passa pelo servidor (rede restrita): para essa pessoa a transmissao fica limitada a 720p 30fps.`);
    });
    state.voice.on('mic-error', (e) => toast('Nao foi possivel acessar o microfone: ' + e.message));
    state.voice.on('peer-state', ({ state: s }) => { const el = $('#vp-status-text'); if (el) { const bad = s === 'checking' || s === 'new'; $('.vp-status').classList.toggle('connecting', bad); el.textContent = bad ? 'Conectando RTC...' : 'Voz conectada'; } });
  }
  state.voice.setMuted(state.selfMute || state.selfDeaf);
  state.voice.setDeafened(state.selfDeaf);
  await state.voice.join(channelId, peers);
  Sounds.join();
  renderVoicePanel(); renderChannels(); renderCall();
});

gw.on('signal', ({ from, data }) => { if (state.voice) state.voice.onSignal(from, data); });

// =====================================================================
// Navegacao
// =====================================================================
const channelsOf = (gid) => [...state.channels.values()].filter((c) => c.guildId === gid).sort((a, b) => a.position - b.position);

function selectGuild(gid) {
  state.activeGuild = gid;
  localStorage.setItem('rea.guild', gid);
  const list = channelsOf(gid);
  const remembered = state.lastText[gid] && state.channels.get(state.lastText[gid]);
  const ch = remembered || list.find((c) => c.type === 'text') || list[0];
  renderGuilds();
  selectChannel(ch ? ch.id : null);
}

function selectChannel(cid) {
  state.activeChannel = cid;
  const ch = state.channels.get(cid);
  if (ch && ch.type === 'text') {
    state.lastText[ch.guildId] = cid;
    localStorage.setItem('rea.lastText', JSON.stringify(state.lastText));
    if (state.unread.delete(cid)) saveUnread();
    const box = state.messages.get(cid);
    if (!box || !box.loaded) { state.messages.set(cid, { list: [], loaded: false, hasMore: false, loading: true }); gw.send('history', { channelId: cid }); }
  }
  state.replyTo = null; renderReply();
  renderGuilds(); renderChannels(); renderHeader(); renderMain();
}

function renderMain() {
  const ch = state.channels.get(state.activeChannel);
  const isVoice = ch && ch.type === 'voice';
  $('#chat').classList.toggle('hidden', !!isVoice);
  $('#call').classList.toggle('hidden', !isVoice);
  $('#members').classList.toggle('hidden', !!isVoice || !state.settings.showMembers);
  if (isVoice) renderCall();
  else { renderMessages(); renderTyping(); renderMembers(); $('#input').placeholder = ch ? `Conversar em #${ch.name}` : ''; if (ch) $('#input').focus(); }
}

// =====================================================================
// Render: servidores / canais / membros / paineis
// =====================================================================
function guildUnread(gid) { return channelsOf(gid).some((c) => state.unread.has(c.id)); }

function renderGuilds() {
  const nav = $('#guilds');
  nav.innerHTML = '';
  nav.append(h(`<div class="guild home-icon" data-tip="Discord REA"><div class="pill"></div><div class="gicon" style="background:var(--brand);color:#fff;border-radius:16px">${I.logo}</div></div>`));
  nav.append(h('<div class="guild-sep"></div>'));
  for (const g of state.guilds.values()) {
    const el = h(`<div class="guild ${g.id === state.activeGuild ? 'active' : ''} ${guildUnread(g.id) ? 'unread' : ''}" data-tip="${esc(g.name)}"><div class="pill"></div><div class="gicon">${esc(initials(g.name))}</div></div>`);
    el.onclick = () => selectGuild(g.id);
    nav.append(el);
  }
  const add = h('<div class="guild add" data-tip="Adicionar um servidor"><div class="pill"></div><div class="gicon">+</div></div>');
  add.onclick = openCreateGuild;
  nav.append(add);
}

function renderChannels() {
  const g = state.guilds.get(state.activeGuild);
  $('#guild-name').textContent = g ? g.name : '';
  const box = $('#channels');
  box.innerHTML = '';
  if (!g) return;
  const list = channelsOf(g.id);
  for (const [type, label] of [['text', 'Canais de texto'], ['voice', 'Canais de voz']]) {
    const cat = h(`<div class="cat"><svg width="12" height="12" viewBox="0 0 24 24"><path fill="currentColor" d="M7 10l5 5 5-5z"/></svg>${label}<span class="cat-add" data-tip="Criar canal">+</span></div>`);
    $('.cat-add', cat).onclick = (e) => { e.stopPropagation(); openCreateChannel(type); };
    box.append(cat);
    for (const c of list.filter((x) => x.type === type)) {
      const el = h(`<div class="channel ${c.id === state.activeChannel ? 'active' : ''} ${state.unread.has(c.id) ? 'unread' : ''}">${type === 'text' ? sz(I.hash, 20) : sz(I.speaker, 20)}<span class="cname">${esc(c.name)}</span><span class="ch-del" data-tip="Excluir canal">✕</span></div>`);
      el.onclick = () => {
        if (type === 'voice') { if (state.voiceChannel !== c.id) joinVoice(c.id); selectChannel(c.id); } else selectChannel(c.id);
      };
      $('.ch-del', el).onclick = (e) => { e.stopPropagation(); confirmModal(`Excluir ${type === 'text' ? '#' : ''}${c.name}`, 'Tem certeza? Isso nao pode ser desfeito.', 'Excluir canal', () => gw.send('channel_delete', { id: c.id })); };
      box.append(el);
      if (type === 'voice') {
        const users = [...state.voiceStates.values()].filter((v) => v.channelId === c.id);
        if (users.length) {
          const vu = h('<div class="voice-users"></div>');
          for (const v of users) {
            const u = state.users.get(v.userId) || { name: '?', color: '#555' };
            const speaking = state.voice && state.voice.speaking.has(v.userId);
            const row = h(`<div class="vuser" data-uid="${v.userId}"><div class="avatar ${speaking ? 'speaking' : ''}" style="background:${u.color}">${esc(initials(u.name))}</div><span class="vname">${esc(u.name)}</span><span class="icons">${v.streaming ? '<span class="live-badge">Ao vivo</span>' : ''}${v.video ? sz(I.cam, 16) : ''}${v.deafened ? sz(I.headOff, 16) : v.muted ? sz(I.micOff, 16) : ''}</span></div>`);
            row.onclick = (e) => { e.stopPropagation(); if (v.streaming && v.userId !== state.user.id && state.voiceChannel === c.id) { setWatching(v.userId, true); selectChannel(c.id); } else openProfile(v.userId, row); };
            row.oncontextmenu = (e) => userContext(e, v.userId);
            vu.append(row);
          }
          box.append(vu);
        }
      }
    }
  }
}

function updateSpeaking() {
  const sp = state.voice ? state.voice.speaking : new Set();
  document.querySelectorAll('.vuser').forEach((el) => $('.avatar', el).classList.toggle('speaking', sp.has(el.dataset.uid)));
  document.querySelectorAll('.tile[data-uid][data-kind="user"]').forEach((el) => el.classList.toggle('speaking', sp.has(el.dataset.uid)));
}

function renderMembers() {
  const box = $('#members');
  if (box.classList.contains('hidden')) return;
  const users = [...state.users.values()].sort((a, b) => a.name.localeCompare(b.name));
  const online = users.filter((u) => u.status !== 'offline' && u.status !== 'invisible');
  const offline = users.filter((u) => u.status === 'offline' || u.status === 'invisible');
  box.innerHTML = '';
  const row = (u) => {
    const v = state.voiceStates.get(u.id);
    const sub = v && v.streaming ? 'Transmitindo' : v ? 'Em chamada de voz' : '';
    const el = h(`<div class="member ${u.status === 'offline' || u.status === 'invisible' ? 'offline' : ''}"><div class="avatar" style="background:${u.color}">${esc(initials(u.name))}<span class="status ${u.status}"></span></div><div style="min-width:0"><div class="mname" style="color:${u.color}">${esc(u.name)}</div>${sub ? `<div class="msub">${sub}</div>` : ''}</div></div>`);
    el.onclick = () => openProfile(u.id, el);
    el.oncontextmenu = (e) => userContext(e, u.id);
    return el;
  };
  if (online.length) { box.append(h(`<div class="mgroup">Disponivel — ${online.length}</div>`)); online.forEach((u) => box.append(row(u))); }
  if (offline.length) { box.append(h(`<div class="mgroup">Offline — ${offline.length}</div>`)); offline.forEach((u) => box.append(row(u))); }
}

const STATUS_LABEL = { online: 'Disponivel', idle: 'Ausente', dnd: 'Nao perturbar', invisible: 'Invisivel', offline: 'Offline' };
function renderUserPanel() {
  const u = state.user;
  if (!u) return;
  $('#me').innerHTML = `<div class="avatar" style="background:${u.color}">${esc(initials(u.name))}<span class="status ${u.status}"></span></div><div class="names"><div class="n1">${esc(u.name)}</div><div class="n2">${STATUS_LABEL[u.status] || 'Disponivel'}</div></div>`;
  $('#btn-mute').innerHTML = state.selfMute || state.selfDeaf ? I.micOff : I.mic;
  $('#btn-mute').dataset.tip = state.selfMute ? 'Reativar microfone' : 'Silenciar';
  $('#btn-deafen').innerHTML = state.selfDeaf ? I.headOff : I.head;
  $('#btn-deafen').dataset.tip = state.selfDeaf ? 'Reativar audio' : 'Desativar audio';
}

function renderVoicePanel() {
  const vp = $('#voice-panel');
  if (!state.voiceChannel) { vp.classList.add('hidden'); return; }
  vp.classList.remove('hidden');
  const c = state.channels.get(state.voiceChannel);
  const g = c && state.guilds.get(c.guildId);
  $('#vp-channel').textContent = c ? `${c.name} / ${g ? g.name : ''}` : '';
  $('#vp-camera').classList.toggle('on', !!(state.voice && state.voice.camera));
  $('#vp-screen').classList.toggle('on', !!(state.voice && state.voice.screen));
}

function renderHeader() {
  const ch = state.channels.get(state.activeChannel);
  $('#ch-icon').innerHTML = ch ? (ch.type === 'voice' ? I.speaker : I.hash) : '';
  $('#ch-name').textContent = ch ? ch.name : '';
  $('#ch-topic').textContent = ch ? ch.topic || '' : '';
  $('#btn-members').classList.toggle('hidden', !ch || ch.type === 'voice');
  $('#btn-members').classList.toggle('active', state.settings.showMembers);
}

// =====================================================================
// Mensagens
// =====================================================================
function md(text) {
  const blocks = [];
  const keep = (html) => `\u0000${blocks.push(html) - 1}\u0000`;
  let s = String(text);
  s = s.replace(/```(?:(\w+)\n)?([\s\S]*?)```/g, (_, lang, code) => keep(`<pre><code>${esc(code.replace(/^\n/, ''))}</code></pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${esc(code)}</code>`));
  s = s.replace(/https?:\/\/[^\s<]+[^\s<.,:;"')\]]/g, (url) => keep(`<a href="${esc(url)}" target="_blank">${esc(url)}</a>`));
  s = esc(s);
  s = s.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>');
  const names = [...state.users.values()].map((u) => u.name).sort((a, b) => b.length - a.length);
  for (const n of names) s = s.split('@' + esc(n)).join(`<span class="mention">@${esc(n)}</span>`);
  s = s.replace(/@(everyone|here)\b/g, '<span class="mention">@$1</span>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
}
const isJumbo = (t) => t && t.length <= 40 && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\s|‍|️)+$/u.test(t);
const mentionsMe = (m) => m.authorId !== state.user.id && (m.content.includes('@' + state.user.name) || /@(everyone|here)\b/.test(m.content));
const fileUrl = (u) => (u.startsWith('/') ? state.httpBase + u : u);

function renderAttachments(atts) {
  if (!atts || !atts.length) return '';
  return `<div class="attachments">${atts.map((a) => {
    const url = fileUrl(a.url);
    if (/^image\//.test(a.type)) return `<img src="${esc(url)}" loading="lazy" data-lightbox="${esc(url)}" alt="${esc(a.name)}">`;
    if (/^video\//.test(a.type)) return `<video src="${esc(url)}" controls preload="metadata"></video>`;
    if (/^audio\//.test(a.type)) return `<audio src="${esc(url)}" controls preload="metadata"></audio>`;
    return `<div class="file-att">📄<div><a href="${esc(url)}" target="_blank">${esc(a.name)}</a><div class="fsize">${fmtSize(a.size)}</div></div></div>`;
  }).join('')}</div>`;
}

function renderReactions(m) {
  const r = m.reactions || {};
  const keys = Object.keys(r);
  if (!keys.length) return '';
  return `<div class="reactions">${keys.map((e) => `<button class="reaction ${r[e].includes(state.user.id) ? 'me' : ''}" data-react="${esc(e)}" data-tip="${esc(r[e].map((id) => state.users.get(id)?.name || '?').join(', '))}">${esc(e)}<span class="rc">${r[e].length}</span></button>`).join('')}</div>`;
}

function messageEl(m, prev) {
  const u = state.users.get(m.authorId) || { name: 'Desconhecido', color: '#555' };
  const replied = m.replyTo && state.messages.get(m.channelId)?.list.find((x) => x.id === m.replyTo);
  const groupStart = !prev || prev.authorId !== m.authorId || m.createdAt - prev.createdAt > 7 * 60000 || m.replyTo || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
  const content = m.content ? `<div class="mcontent ${isJumbo(m.content) ? 'jumbo' : ''}">${md(m.content)}${m.editedAt ? '<span class="edited" data-tip="' + esc(fmtStamp(m.editedAt)) + '">(editado)</span>' : ''}</div>` : '';
  const mine = m.authorId === state.user.id;
  const el = h(`<div class="msg ${groupStart ? 'group-start' : ''} ${m.pending ? 'pending' : ''} ${mentionsMe(m) ? 'mentioned' : ''}" data-id="${m.id}">
    ${m.replyTo ? `<div class="reply-ref" data-jump="${m.replyTo}">${replied ? `<b>@${esc(state.users.get(replied.authorId)?.name || '?')}</b> ${esc(replied.content.slice(0, 120)) || '<i>Clique para ver o anexo</i>'}` : '<i>A mensagem original foi excluida</i>'}</div>` : ''}
    ${groupStart ? `<div class="avatar" style="background:${u.color}" data-profile="${m.authorId}">${esc(initials(u.name))}</div><div class="mhead"><span class="author" style="color:${u.color}" data-profile="${m.authorId}">${esc(u.name)}</span><span class="ts">${fmtStamp(m.createdAt)}</span></div>` : `<span class="side-ts">${fmtTime(m.createdAt)}</span>`}
    ${content}${renderAttachments(m.attachments)}${renderReactions(m)}
    ${m.pending ? '' : `<div class="msg-actions"><button data-act="react" data-tip="Adicionar reacao">😀</button><button data-act="reply" data-tip="Responder">↩</button>${mine ? '<button data-act="edit" data-tip="Editar">✎</button><button data-act="delete" class="danger" data-tip="Excluir">🗑</button>' : ''}</div>`}
  </div>`);
  return el;
}

let lastRenderedChannel = null;
function renderMessages(keepScroll) {
  const inner = $('#messages-inner');
  const ch = state.channels.get(state.activeChannel);
  if (!ch || ch.type !== 'text') { inner.innerHTML = ''; return; }
  const box = state.messages.get(ch.id) || { list: [] };
  const scroller = $('#messages');
  const atBottom = scroller.scrollTop > -50;
  const frag = document.createDocumentFragment();
  if (box.loaded && !box.hasMore) frag.append(h(`<div class="welcome"><div class="wicon">${sz(I.hash, 42)}</div><h2>Boas-vindas a #${esc(ch.name)}!</h2><p>Este e o comeco do canal #${esc(ch.name)}.</p></div>`));
  if (box.hasMore) frag.append(h('<div class="load-more">Carregando mensagens antigas...</div>'));
  let prev = null;
  for (const m of box.list) {
    if (!prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()) frag.append(h(`<div class="divider"><span>${fmtDay(m.createdAt)}</span></div>`));
    frag.append(messageEl(m, prev));
    prev = m;
  }
  inner.replaceChildren(frag);
  if (!keepScroll || lastRenderedChannel !== ch.id || atBottom) scroller.scrollTop = 0;
  lastRenderedChannel = ch.id;
}

$('#messages').addEventListener('scroll', (e) => {
  const el = e.currentTarget;
  if (el.scrollHeight - el.clientHeight + el.scrollTop < 300) {
    const box = state.messages.get(state.activeChannel);
    if (box && box.hasMore && !box.loading && box.list.length) { box.loading = true; gw.send('history', { channelId: state.activeChannel, before: box.list[0].id }); }
  }
}, { passive: true });

$('#messages-inner').addEventListener('click', (e) => {
  const t = e.target;
  const msgEl = t.closest('.msg');
  const box = state.messages.get(state.activeChannel);
  const m = msgEl && box && box.list.find((x) => x.id === msgEl.dataset.id);
  if (t.dataset.lightbox) return openLightbox(t.dataset.lightbox);
  if (t.classList.contains('spoiler')) return t.classList.add('shown');
  if (t.closest('[data-profile]')) return openProfile(t.closest('[data-profile]').dataset.profile, t);
  if (t.closest('[data-jump]')) { const target = $(`.msg[data-id="${t.closest('[data-jump]').dataset.jump}"]`); if (target) { target.scrollIntoView({ block: 'center' }); target.animate([{ background: 'rgba(88,101,242,.3)' }, { background: 'transparent' }], 1500); } return; }
  const react = t.closest('[data-react]');
  if (react && m) return gw.send('reaction_toggle', { channelId: m.channelId, id: m.id, emoji: react.dataset.react });
  const act = t.closest('[data-act]');
  if (!act || !m) return;
  const a = act.dataset.act;
  if (a === 'react') openEmojiPicker(act, (emoji) => gw.send('reaction_toggle', { channelId: m.channelId, id: m.id, emoji }));
  if (a === 'reply') { state.replyTo = m; renderReply(); $('#input').focus(); }
  if (a === 'edit') startEdit(m, msgEl);
  if (a === 'delete') { if (e.shiftKey) gw.send('message_delete', { channelId: m.channelId, id: m.id }); else confirmModal('Excluir mensagem', 'Tem certeza que deseja excluir esta mensagem? (Dica: segure Shift para pular)', 'Excluir', () => gw.send('message_delete', { channelId: m.channelId, id: m.id })); }
});

$('#messages-inner').addEventListener('contextmenu', (e) => {
  const msgEl = e.target.closest('.msg');
  if (!msgEl) return;
  const box = state.messages.get(state.activeChannel);
  const m = box && box.list.find((x) => x.id === msgEl.dataset.id);
  if (!m || m.pending) return;
  const mine = m.authorId === state.user.id;
  const sel = window.getSelection().toString();
  contextMenu(e, [
    sel && { label: 'Copiar', fn: () => navigator.clipboard.writeText(sel) },
    { label: 'Adicionar reacao', fn: () => openEmojiPicker(msgEl, (emoji) => gw.send('reaction_toggle', { channelId: m.channelId, id: m.id, emoji })) },
    mine && { label: 'Editar mensagem', fn: () => startEdit(m, msgEl) },
    { label: 'Responder', fn: () => { state.replyTo = m; renderReply(); $('#input').focus(); } },
    { label: 'Copiar texto', fn: () => navigator.clipboard.writeText(m.content) },
    mine && 'sep',
    mine && { label: 'Excluir mensagem', danger: true, fn: () => gw.send('message_delete', { channelId: m.channelId, id: m.id }) },
  ]);
});

function startEdit(m, msgEl) {
  const content = $('.mcontent', msgEl);
  const ta = h('<textarea class="edit-box" rows="1"></textarea>');
  ta.value = m.content;
  const hint = h('<div class="edit-hint">esc para <a data-x="cancel">cancelar</a> • enter para <a data-x="save">salvar</a></div>');
  const wrap = h('<div></div>'); wrap.append(ta, hint);
  if (content) content.replaceWith(wrap); else msgEl.append(wrap);
  $('.msg-actions', msgEl)?.remove();
  const autosize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  autosize(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  const done = (save) => {
    if (save && ta.value.trim() && ta.value !== m.content) gw.send('message_update', { channelId: m.channelId, id: m.id, content: ta.value });
    else if (save && !ta.value.trim()) gw.send('message_delete', { channelId: m.channelId, id: m.id });
    renderMessages(true);
  };
  ta.oninput = autosize;
  ta.onkeydown = (e) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); } };
  hint.onclick = (e) => { if (e.target.dataset.x) done(e.target.dataset.x === 'save'); };
}

function renderTyping() {
  const m = state.typing.get(state.activeChannel);
  const names = m ? [...m.keys()].map((id) => state.users.get(id)?.name).filter(Boolean) : [];
  const el = $('#typing');
  if (!names.length) { el.innerHTML = ''; return; }
  const who = names.length === 1 ? `<b>${esc(names[0])}</b> esta digitando...` : names.length < 4 ? `${names.map((n) => `<b>${esc(n)}</b>`).join(', ')} estao digitando...` : 'Varias pessoas estao digitando...';
  el.innerHTML = `<span class="dots"><i></i><i></i><i></i></span>${who}`;
}

function renderReply() {
  const bar = $('#reply-bar');
  if (!state.replyTo) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('#reply-text').innerHTML = `Respondendo a <b>${esc(state.users.get(state.replyTo.authorId)?.name || '?')}</b>`;
}
$('#reply-cancel').onclick = () => { state.replyTo = null; renderReply(); };

// ---------- composer ----------
const input = $('#input');
let lastTypingSent = 0;
input.addEventListener('input', () => {
  input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.5) + 'px';
  if (input.value && Date.now() - lastTypingSent > 8000) { lastTypingSent = Date.now(); gw.send('typing', { channelId: state.activeChannel }); }
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  if (e.key === 'Escape' && state.replyTo) { state.replyTo = null; renderReply(); }
  if (e.key === 'ArrowUp' && !input.value) {
    const box = state.messages.get(state.activeChannel);
    const last = box && [...box.list].reverse().find((m) => m.authorId === state.user.id && !m.pending);
    const el = last && $(`.msg[data-id="${last.id}"]`);
    if (el) { e.preventDefault(); startEdit(last, el); }
  }
});
input.addEventListener('paste', (e) => {
  const files = [...e.clipboardData.files];
  if (files.length) { e.preventDefault(); addUploads(files); }
});
$('#btn-attach').onclick = () => $('#file-input').click();
$('#file-input').onchange = (e) => { addUploads([...e.target.files]); e.target.value = ''; };
$('#btn-emoji').onclick = (e) => openEmojiPicker(e.currentTarget, (emoji) => { input.setRangeText(emoji, input.selectionStart, input.selectionEnd, 'end'); input.focus(); }, true);
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); const ch = state.channels.get(state.activeChannel); if (ch && ch.type === 'text' && e.dataTransfer.files.length) addUploads([...e.dataTransfer.files]); });

function addUploads(files) {
  for (const f of files) state.uploads.push({ file: f, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : null });
  renderUploads();
  input.focus();
}
function renderUploads() {
  const box = $('#upload-preview');
  box.classList.toggle('hidden', !state.uploads.length);
  box.innerHTML = '';
  state.uploads.forEach((u, i) => {
    const el = h(`<div class="up-item">${u.url ? `<img src="${u.url}">` : '<div style="height:110px;display:grid;place-items:center;font-size:48px">📄</div>'}<div class="up-name">${esc(u.file.name)}</div><button title="Remover">🗑</button></div>`);
    $('button', el).onclick = () => { if (u.url) URL.revokeObjectURL(u.url); state.uploads.splice(i, 1); renderUploads(); };
    box.append(el);
  });
}

async function uploadFile(file) {
  const auth = JSON.parse(localStorage.getItem('rea.auth'));
  const res = await fetch(state.httpBase + '/upload', { method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name), 'x-token': auth.token, 'content-type': file.type || 'application/octet-stream' }, body: file });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'upload falhou: ' + res.status);
  return res.json();
}

async function sendMessage() {
  const content = input.value;
  const ch = state.channels.get(state.activeChannel);
  if (!ch || ch.type !== 'text') return;
  if (!content.trim() && !state.uploads.length) return;
  const uploads = state.uploads; state.uploads = []; renderUploads();
  const n = nonce();
  const replyTo = state.replyTo ? state.replyTo.id : null;
  input.value = ''; input.style.height = 'auto';
  state.replyTo = null; renderReply();
  const box = state.messages.get(ch.id);
  const pending = { id: 'p' + n, nonce: n, pending: true, channelId: ch.id, authorId: state.user.id, content, attachments: [], createdAt: Date.now(), replyTo, reactions: {} };
  if (box) { box.list.push(pending); renderMessages(); }
  let attachments = [];
  try {
    attachments = await Promise.all(uploads.map((u) => uploadFile(u.file)));
  } catch (e) {
    toast('Falha ao enviar arquivo: ' + e.message);
    if (box) { box.list = box.list.filter((x) => x !== pending); renderMessages(true); }
    return;
  }
  uploads.forEach((u) => u.url && URL.revokeObjectURL(u.url));
  gw.send('message_create', { channelId: ch.id, content, attachments, replyTo, nonce: n });
  lastTypingSent = 0;
}

// =====================================================================
// Voz
// =====================================================================
function joinVoice(channelId) {
  if (state.voiceChannel === channelId) return;
  if (state.voiceChannel) leaveVoice(true);
  state.voiceChannel = channelId;
  gw.send('voice_join', { channelId, muted: state.selfMute || state.selfDeaf, deafened: state.selfDeaf });
  renderVoicePanel();
}

function setWatching(userId, on) {
  on ? state.watching.add(userId) : state.watching.delete(userId);
  if (state.voice) state.voice.setWatching(userId, on);
}

function teardownVoiceLocal() {
  if (state.voice) state.voice.leave();
  state.voice = null;
  state.voiceChannel = null;
  state.watching.clear();
  state.focusTile = null;
  renderVoicePanel(); renderChannels(); renderCall();
}

function leaveVoice(switching) {
  if (!state.voiceChannel) return;
  gw.send('voice_leave', {});
  teardownVoiceLocal();
  if (!switching) Sounds.leave();
}

function toggleMute() {
  if (state.selfDeaf) { state.selfDeaf = false; state.selfMute = false; } else state.selfMute = !state.selfMute;
  (state.selfMute ? Sounds.mute : Sounds.unmute)();
  applyVoiceFlags();
}
function toggleDeafen() {
  state.selfDeaf = !state.selfDeaf;
  (state.selfDeaf ? Sounds.mute : Sounds.unmute)();
  applyVoiceFlags();
}
function applyVoiceFlags() {
  if (state.voice) { state.voice.setMuted(state.selfMute || state.selfDeaf); state.voice.setDeafened(state.selfDeaf); }
  if (state.voiceChannel) gw.send('voice_update', { muted: state.selfMute || state.selfDeaf, deafened: state.selfDeaf });
  renderUserPanel(); renderCall();
}

async function toggleCamera() {
  if (!state.voice) return toast('Entre em um canal de voz primeiro');
  try {
    if (state.voice.camera) state.voice.stopCamera(); else await state.voice.startCamera();
    gw.send('voice_update', { video: !!state.voice.camera });
  } catch (e) { toast('Nao foi possivel abrir a camera: ' + e.message); }
}

async function toggleScreen() {
  if (!state.voice) return toast('Entre em um canal de voz para transmitir');
  if (state.voice.screen) { state.voice.stopScreen(); gw.send('voice_update', { streaming: false }); Sounds.streamStop(); return; }
  openGoLive();
}

function configurePTT() {
  const s = state.settings;
  window.native.ptt.configure(s.inputMode === 'ptt', s.pttBind).then((ok) => { if (!ok && s.inputMode === 'ptt') toast('Nao foi possivel registrar o atalho global de pressionar para falar.'); });
}
window.native.ptt.onState((down) => {
  if (state.voice) state.voice.setPTT(down);
  if (settingsProc) settingsProc.setPTT(down);
  if (state.voice && !(state.selfMute || state.selfDeaf)) (down ? Sounds.pttOn : Sounds.pttOff)();
});
window.native.ptt.onRecorded((bind) => {
  state.settings.pttBind = bind; saveSettings(); configurePTT();
  const btn = settingsEl && $('[data-record]', settingsEl);
  if (btn) { btn.textContent = bindName(bind); btn.classList.remove('recording'); }
});
let keyNames = {};
window.native.ptt.keyNames().then((k) => { keyNames = k; });
const bindName = (b) => (!b ? 'Nenhum atalho' : b.type === 'mouse' ? `Botao do mouse ${b.button}` : (keyNames[b.code] || `Tecla ${b.code}`));

let mutedHintTimer = null;
function showMutedHint() {
  let el = $('#muted-hint');
  if (!el) { el = h('<div id="muted-hint">Voce esta silenciado</div>'); document.body.append(el); }
  const r = $('#btn-mute').getBoundingClientRect();
  el.style.left = r.left + r.width / 2 + 'px'; el.style.top = r.top - 8 + 'px';
  el.classList.add('show');
  clearTimeout(mutedHintTimer);
  mutedHintTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

$('#btn-mute').onclick = toggleMute;
$('#btn-deafen').onclick = toggleDeafen;
$('#vp-disconnect').onclick = () => leaveVoice();
$('#vp-camera').onclick = toggleCamera;
$('#vp-screen').onclick = toggleScreen;
$('#cc-mute').onclick = toggleMute;
$('#cc-camera').onclick = toggleCamera;
$('#cc-screen').onclick = toggleScreen;
$('#cc-leave').onclick = () => leaveVoice();
$('#cj-btn').onclick = () => joinVoice(state.activeChannel);

// ---------- tela da chamada ----------
const videoCache = new Map(); // key -> <video>
function videoFor(key, stream, muted = true) {
  let v = videoCache.get(key);
  if (!v) { v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.muted = true; videoCache.set(key, v); }
  v.muted = muted;
  if (v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}); }
  return v;
}

function renderCall() {
  const callEl = $('#call');
  const ch = state.channels.get(state.activeChannel);
  if (!ch || ch.type !== 'voice' || callEl.classList.contains('hidden')) return;
  const inThis = state.voiceChannel === ch.id;
  const participants = [...state.voiceStates.values()].filter((v) => v.channelId === ch.id);
  $('#call-join').classList.toggle('hidden', inThis);
  $('#call-controls').classList.toggle('hidden', !inThis);
  if (!inThis) {
    $('.cj-title', callEl).textContent = ch.name;
    $('.cj-sub', callEl).textContent = participants.length ? participants.map((v) => state.users.get(v.userId)?.name).join(', ') + ' na chamada' : 'Ninguem esta na chamada no momento';
  }
  const grid = $('#call-grid');
  const tiles = [];
  const sess = state.voice;
  const used = new Set();
  for (const v of participants) {
    const u = state.users.get(v.userId) || { name: '?', color: '#555' };
    const self = v.userId === state.user.id;
    const peer = sess && !self ? sess.peers.get(v.userId) : null;
    const camStream = self ? sess && sess.camera : peer && peer.remoteStreams.camera;
    const userTile = h(`<div class="tile" data-uid="${v.userId}" data-kind="user"><div class="tlabel">${esc(u.name)}</div>${v.deafened ? `<div class="tmuted">${sz(I.headOff, 16)}</div>` : v.muted ? `<div class="tmuted">${sz(I.micOff, 16)}</div>` : ''}</div>`);
    if (camStream && inThis) { const key = v.userId + ':camera'; used.add(key); userTile.prepend(videoFor(key, camStream)); } else userTile.prepend(h(`<div class="avatar" style="background:${u.color}">${esc(initials(u.name))}</div>`));
    if (sess && sess.speaking.has(v.userId)) userTile.classList.add('speaking');
    userTile.oncontextmenu = (e) => userContext(e, v.userId);
    tiles.push(userTile);

    if (v.streaming && inThis) {
      const key = v.userId + ':screen';
      const tile = h(`<div class="tile" data-uid="${v.userId}" data-kind="screen"><div class="tlabel"><span class="live-badge">Ao vivo</span>${esc(u.name)}</div><div class="tstats"></div><div class="tbtns"></div></div>`);
      const screenStream = self ? sess && sess.screen : peer && peer.remoteStreams.screen;
      const watching = self || state.watching.has(v.userId);
      if (screenStream && watching) {
        used.add(key);
        tile.prepend(videoFor(key, screenStream));
        const btns = $('.tbtns', tile);
        if (!self) { const st = h(`<button data-tip="Estatisticas">${I.stats}</button>`); st.onclick = (e) => { e.stopPropagation(); state.showStats.has(key) ? state.showStats.delete(key) : state.showStats.add(key); tile.classList.toggle('show-stats'); }; btns.append(st); }
        if (self) { const sp = h(`<button data-tip="Parar transmissao">${I.stop}</button>`); sp.onclick = (e) => { e.stopPropagation(); toggleScreen(); }; btns.append(sp); }
        else { const sw = h(`<button data-tip="Parar de assistir">${I.stop}</button>`); sw.onclick = (e) => { e.stopPropagation(); setWatching(v.userId, false); if (state.focusTile === key) state.focusTile = null; renderCall(); }; btns.append(sw); }
        const fs = h(`<button data-tip="Tela cheia">${I.full}</button>`); fs.onclick = (e) => { e.stopPropagation(); tile.requestFullscreen(); }; btns.append(fs);
        if (state.showStats.has(key)) tile.classList.add('show-stats');
      } else {
        tile.classList.add('stream-preview');
        tile.prepend(h(`<button class="watch">${watching ? 'Conectando a transmissao...' : 'Assistir transmissao'}</button>`));
        tile.onclick = () => { setWatching(v.userId, true); state.focusTile = key; renderCall(); };
      }
      tile.dataset.key = key;
      tiles.push(tile);
    }
  }
  // libera videos que nao estao mais na tela (economiza decodificacao)
  for (const [key, v] of videoCache) if (!used.has(key)) { v.srcObject = null; videoCache.delete(key); }

  grid.classList.toggle('focus', !!state.focusTile && tiles.some((t) => t.dataset.key === state.focusTile));
  if (grid.classList.contains('focus')) {
    const main = tiles.find((t) => t.dataset.key === state.focusTile);
    main.classList.add('focused');
    const strip = h('<div class="focus-strip"></div>');
    tiles.filter((t) => t !== main).forEach((t) => strip.append(t));
    grid.replaceChildren(main, strip);
  } else grid.replaceChildren(...tiles);
  for (const v of videoCache.values()) if (v.paused) v.play().catch(() => {});
  for (const t of tiles) {
    if (t.onclick) continue;
    t.onclick = () => { const key = t.dataset.key || t.dataset.uid + ':user'; state.focusTile = state.focusTile === key ? null : key; renderCall(); };
    t.ondblclick = () => t.dataset.kind === 'screen' && t.requestFullscreen();
  }

  const muted = state.selfMute || state.selfDeaf;
  $('#cc-mute').innerHTML = muted ? sz(I.micOff, 24) : sz(I.mic, 24);
  $('#cc-mute').classList.toggle('off', muted);
  $('#cc-camera').innerHTML = I.cam; $('#cc-camera').classList.toggle('on', !!(sess && sess.camera));
  $('#cc-screen').innerHTML = I.screen; $('#cc-screen').classList.toggle('on', !!(sess && sess.screen));
}

// estatisticas da transmissao (resolucao, fps, bitrate, codec)
setInterval(async () => {
  if (!state.voice) return;
  for (const key of state.showStats) {
    const [uid, kind] = key.split(':');
    const s = await state.voice.stats(uid, kind);
    const el = $(`.tile[data-key="${key}"] .tstats`);
    if (s && el) el.textContent = `${s.width}x${s.height} @ ${s.fps}fps\n${(s.kbps / 1000).toFixed(1)} Mbps  ${s.codec}\nperdidos: ${s.lost}\n${s.decoder || ''}`;
  }
}, 1000);

// =====================================================================
// Go Live (seletor de tela + qualidade)
// =====================================================================
async function openGoLive() {
  const s = state.settings;
  const opts = { sourceId: null, resolution: s.streamResolution, fps: s.streamFps, audio: s.streamAudio, codec: s.codec, hint: s.streamHint };
  let tab = 'screen';
  const sources = await window.native.capture.getSources();
  const codecs = (RTCRtpSender.getCapabilities('video')?.codecs || []).map((c) => c.mimeType.split('/')[1].toUpperCase()).filter((c, i, a) => ['H264', 'VP8', 'VP9', 'AV1', 'H265'].includes(c) && a.indexOf(c) === i);
  const m = modal(`
    <div class="modal-head"><h2>Compartilhamento de tela</h2></div>
    <div class="modal-body">
      <div class="tabs"><button data-tab="screen">Telas</button><button data-tab="window">Aplicativos</button></div>
      <div class="sources"></div>
      <div class="quality">
        <div class="qgroup"><h4>Resolucao</h4><div class="chips" data-q="resolution">
          <button class="chip" data-v="720">720p</button><button class="chip" data-v="1080">1080p</button><button class="chip" data-v="1440">1440p</button><button class="chip" data-v="2160">4K</button><button class="chip" data-v="source">Fonte</button></div></div>
        <div class="qgroup"><h4>Taxa de quadros</h4><div class="chips" data-q="fps">
          <button class="chip" data-v="15">15 FPS</button><button class="chip" data-v="30">30 FPS</button><button class="chip" data-v="60">60 FPS</button></div></div>
        <div class="qgroup"><h4>Codec de video</h4><div class="chips" data-q="codec">${codecs.map((c) => `<button class="chip" data-v="${c}">${c}</button>`).join('')}</div></div>
        <div class="qgroup"><h4>Otimizar para</h4><div class="chips" data-q="hint">
          <button class="chip" data-v="auto">Auto</button><button class="chip" data-v="motion">Fluidez</button><button class="chip" data-v="detail">Nitidez</button></div></div>
      </div>
      <div class="toggle-row"><span>Compartilhar audio do sistema</span><div class="switch" data-toggle="audio"></div></div>
      <div class="hint">H264 usa o encoder de hardware da sua placa de video (menor uso de CPU). AV1/VP9 dao mais qualidade por bit, mas pesam mais na CPU se nao houver encoder de hardware.</div>
    </div>
    <div class="modal-foot"><button class="btn-link" data-close>Cancelar</button><button class="btn-brand" data-go disabled>Ao vivo</button></div>`, 'wide');
  const renderSources = () => {
    $('.sources', m).innerHTML = '';
    m.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('sel', b.dataset.tab === tab));
    for (const src of sources.filter((x) => x.type === tab)) {
      const el = h(`<div class="source ${opts.sourceId === src.id ? 'sel' : ''}">${src.thumbnail ? `<img src="${src.thumbnail}">` : '<img>'}<div class="sname">${src.icon ? `<img src="${src.icon}">` : ''}${esc(src.name)}</div></div>`);
      el.onclick = () => { opts.sourceId = src.id; renderSources(); $('[data-go]', m).disabled = false; };
      el.ondblclick = () => { opts.sourceId = src.id; go(); };
      $('.sources', m).append(el);
    }
  };
  const renderQ = () => {
    m.querySelectorAll('.chips').forEach((c) => c.querySelectorAll('.chip').forEach((b) => b.classList.toggle('sel', String(opts[c.dataset.q]) === b.dataset.v)));
    $('[data-toggle="audio"]', m).classList.toggle('on', opts.audio);
  };
  m.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderSources(); }));
  m.querySelectorAll('.chips').forEach((c) => c.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; opts[c.dataset.q] = c.dataset.q === 'fps' ? Number(b.dataset.v) : b.dataset.v; renderQ(); }));
  $('[data-toggle="audio"]', m).onclick = () => { opts.audio = !opts.audio; renderQ(); };
  const go = async () => {
    if (!opts.sourceId) return;
    Object.assign(state.settings, { streamResolution: opts.resolution, streamFps: opts.fps, streamAudio: opts.audio, codec: opts.codec, streamHint: opts.hint });
    saveSettings();
    closeModal();
    try {
      await state.voice.startScreen({ sourceId: opts.sourceId, resolution: opts.resolution, fps: opts.fps, audio: opts.audio, codec: opts.codec, contentHint: opts.hint === 'auto' ? undefined : opts.hint });
      gw.send('voice_update', { streaming: true });
      state.focusTile = state.user.id + ':screen';
      Sounds.streamStart();
      renderCall();
    } catch (e) { toast('Falha ao iniciar a transmissao: ' + e.message); }
  };
  $('[data-go]', m).onclick = go;
  renderSources(); renderQ();
}

// =====================================================================
// Modais, menus, popups
// =====================================================================
function modal(html, cls = '') {
  const root = $('#modal-root');
  const bd = h(`<div class="backdrop"><div class="modal ${cls}">${html}</div></div>`);
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) closeModal(); });
  bd.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
  root.replaceChildren(bd);
  return $('.modal', bd);
}
function closeModal() { $('#modal-root').replaceChildren(); }

function confirmModal(title, text, btn, fn) {
  const m = modal(`<div class="modal-head" style="text-align:left"><h2 style="font-size:20px">${esc(title)}</h2></div><div class="modal-body"><p style="margin:0">${esc(text)}</p></div><div class="modal-foot"><button class="btn-link" data-close>Cancelar</button><button class="btn-red" data-ok>${esc(btn)}</button></div>`);
  $('[data-ok]', m).onclick = () => { closeModal(); fn(); };
  $('[data-ok]', m).focus();
}

function openCreateGuild() {
  const m = modal(`<div class="modal-head"><h2>Personalize o seu servidor</h2><p>Deixe seu novo servidor com a sua cara dando um nome a ele.</p></div>
    <div class="modal-body"><label class="field">Nome do servidor<input id="ng-name" value="Servidor de ${esc(state.user.name)}" maxlength="100"></label></div>
    <div class="modal-foot"><button class="btn-link" data-close>Voltar</button><button class="btn-brand" data-ok>Criar</button></div>`);
  const inp = $('#ng-name', m); inp.select();
  const ok = () => { if (inp.value.trim()) { gw.send('guild_create', { name: inp.value.trim() }); closeModal(); } };
  $('[data-ok]', m).onclick = ok;
  inp.onkeydown = (e) => e.key === 'Enter' && ok();
}

function openCreateChannel(type = 'text') {
  const m = modal(`<div class="modal-head" style="text-align:left"><h2 style="font-size:20px">Criar canal</h2></div>
    <div class="modal-body">
      <label class="field">Tipo de canal</label>
      <div class="radio-card" data-type="text">${I.hash}<div>Texto<small>Envie mensagens, imagens, GIFs, emojis, opinioes e piadas</small></div></div>
      <div class="radio-card" data-type="voice">${I.speaker}<div>Voz<small>Converse com voz, video e compartilhamento de tela</small></div></div>
      <label class="field">Nome do canal<input id="nc-name" placeholder="novo-canal" maxlength="100"></label>
    </div>
    <div class="modal-foot"><button class="btn-link" data-close>Cancelar</button><button class="btn-brand" data-ok>Criar canal</button></div>`);
  const sel = () => m.querySelectorAll('.radio-card').forEach((c) => c.classList.toggle('sel', c.dataset.type === type));
  m.querySelectorAll('.radio-card').forEach((c) => (c.onclick = () => { type = c.dataset.type; sel(); }));
  sel();
  const inp = $('#nc-name', m); inp.focus();
  const ok = () => {
    let name = inp.value.trim();
    if (!name) return;
    if (type === 'text') name = name.toLowerCase().replace(/\s+/g, '-');
    state.pendingChannelSelect = name;
    gw.send('channel_create', { guildId: state.activeGuild, name, type });
    closeModal();
  };
  $('[data-ok]', m).onclick = ok;
  inp.onkeydown = (e) => e.key === 'Enter' && ok();
}

const ctx = $('#ctx-menu');
function contextMenu(e, items) {
  e.preventDefault();
  ctx.innerHTML = '';
  for (const it of items.filter(Boolean)) {
    if (it === 'sep') { ctx.append(h('<div class="sep"></div>')); continue; }
    if (it.el) { ctx.append(it.el); continue; }
    const b = h(`<button class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`);
    b.onclick = () => { hideCtx(); it.fn(); };
    ctx.append(b);
  }
  ctx.classList.remove('hidden');
  const r = ctx.getBoundingClientRect();
  ctx.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + 'px';
  ctx.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + 'px';
}
function hideCtx() { ctx.classList.add('hidden'); }
document.addEventListener('mousedown', (e) => {
  if (!ctx.contains(e.target)) hideCtx();
  const pop = $('.emoji-picker, .profile-pop');
  if (pop && !pop.contains(e.target)) pop.remove();
});

function userContext(e, userId) {
  const u = state.users.get(userId);
  if (!u) return;
  const items = [{ label: 'Perfil', fn: () => openProfile(userId, e.target) }, { label: 'Mencionar', fn: () => { input.value += `@${u.name} `; input.focus(); } }];
  if (userId !== state.user.id && state.voice) {
    const mk = (kind, label) => {
      const vol = Math.round(state.voice.audio.volumeFor(userId, kind) * 100);
      const el = h(`<div class="ctx-item" style="display:block"><div class="ctx-label">${label}: <span>${vol}%</span></div><input type="range" min="0" max="200" value="${vol}"></div>`);
      $('input', el).oninput = (ev) => { state.voice.audio.setVolume(userId, kind, ev.target.value / 100); $('span', el).textContent = ev.target.value + '%'; };
      return { el };
    };
    items.push('sep', mk('mic', 'Volume do usuario'));
    const lm = state.voice.audio.isLocalMuted(userId);
    items.push({ label: lm ? 'Reativar som (so para mim)' : 'Silenciar (so para mim)', fn: () => { state.voice.audio.setLocalMute(userId, !lm); renderCall(); } });
    const vs = state.voiceStates.get(userId);
    if (vs && vs.streaming) items.push(mk('screen', 'Volume da transmissao'));
  }
  contextMenu(e, items);
}

function openEmojiPicker(anchor, onPick, keepOpen) {
  $('.emoji-picker')?.remove();
  const p = h('<div class="emoji-picker"></div>');
  for (const em of EMOJIS) { const b = h(`<button>${em}</button>`); b.onclick = () => { onPick(em); if (!keepOpen) p.remove(); }; p.append(b); }
  document.body.append(p);
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(r.right - 352, innerWidth - 360)) + 'px';
  p.style.top = Math.max(30, r.top - 308) + 'px';
}

function openProfile(userId, anchor) {
  $('.profile-pop')?.remove();
  const u = state.users.get(userId);
  if (!u) return;
  const v = state.voiceStates.get(userId);
  const p = h(`<div class="profile-pop"><div class="banner" style="background:${u.color}"></div><div class="avatar" style="background:${u.color}">${esc(initials(u.name))}<span class="status ${u.status}" style="width:24px;height:24px;border-width:5px;border-color:var(--bg-floating)"></span></div><div class="pbody"><div class="pname">${esc(u.name)}</div><div style="color:var(--header-secondary);font-size:14px;margin-top:4px">${STATUS_LABEL[u.status] || ''}${v ? ' • Em chamada: ' + esc(state.channels.get(v.channelId)?.name || '') : ''}</div></div></div>`);
  document.body.append(p);
  const r = anchor.getBoundingClientRect();
  const pr = p.getBoundingClientRect();
  let left = r.left - pr.width - 16; if (left < 8) left = r.right + 16;
  p.style.left = Math.min(left, innerWidth - pr.width - 8) + 'px';
  p.style.top = Math.max(30, Math.min(r.top, innerHeight - pr.height - 8)) + 'px';
}

function openLightbox(url) {
  const lb = h(`<div class="lightbox"><img src="${esc(url)}"></div>`);
  lb.onclick = () => lb.remove();
  document.body.append(lb);
}

function toast(text) {
  const t = h(`<div class="toast">${esc(text)}</div>`);
  document.body.append(t);
  setTimeout(() => t.remove(), 4000);
}

// tooltips leves (um unico elemento, delegacao)
const tip = $('#tooltip');
document.addEventListener('mouseover', (e) => {
  const el = e.target.closest('[data-tip]');
  if (!el) { tip.classList.add('hidden'); return; }
  tip.textContent = el.dataset.tip;
  tip.classList.remove('hidden');
  const r = el.getBoundingClientRect(); const tr = tip.getBoundingClientRect();
  if (el.closest('#guilds')) { tip.style.left = r.right + 12 + 'px'; tip.style.top = r.top + r.height / 2 - tr.height / 2 + 'px'; }
  else { tip.style.left = Math.max(4, Math.min(r.left + r.width / 2 - tr.width / 2, innerWidth - tr.width - 4)) + 'px'; tip.style.top = r.top - tr.height - 8 + 'px'; }
});

// status pelo painel do usuario
$('#me').onclick = (e) => contextMenu(e, ['online', 'idle', 'dnd', 'invisible'].map((s) => ({ label: STATUS_LABEL[s], fn: () => gw.send('status', { status: s }) })));
$('#guild-header').onclick = (e) => contextMenu(e, [
  { label: 'Criar canal', fn: () => openCreateChannel('text') },
  { label: 'Criar servidor', fn: openCreateGuild },
]);
$('#btn-members').onclick = () => { state.settings.showMembers = !state.settings.showMembers; saveSettings(); renderHeader(); renderMain(); };

// =====================================================================
// Configuracoes
// =====================================================================
let settingsEl = null;
let testStream = null; let testTimer = null;
let settingsProc = null; let settingsCtx = null;
function activeProc() { return (state.voice && state.voice.proc) || settingsProc; }
function stopVoiceTest() {
  clearInterval(testTimer); testTimer = null;
  if (testStream) testStream.getTracks().forEach((t) => t.stop());
  testStream = null;
  const p = activeProc();
  if (p) p.setLoopback(false);
  if (settingsProc) { settingsProc.stop(); settingsCtx.close().catch(() => {}); }
  settingsProc = null; settingsCtx = null;
}
function closeSettings() {
  stopVoiceTest();
  if (settingsEl) settingsEl.remove();
  settingsEl = null;
}
$('#btn-settings').onclick = () => openSettings('voice');

async function openSettings(page) {
  closeSettings();
  settingsEl = h(`<div class="settings"><div class="settings-nav"><nav>
    <h3>Configuracoes de usuario</h3>
    <button data-p="account">Minha conta</button>
    <h3 style="margin-top:16px">Configuracoes do app</h3>
    <button data-p="voice">Voz e video</button>
    <button data-p="stream">Transmissao</button>
    <button data-p="notif">Notificacoes</button>
    <div style="height:1px;background:var(--bg-mod-hover);margin:8px 10px"></div>
    <button data-p="logout" class="logout">Sair</button>
  </nav></div><div class="settings-content"><div class="sc"></div><button class="settings-close" title="Fechar (Esc)">✕</button></div></div>`);
  document.body.append(settingsEl);
  $('.settings-close', settingsEl).onclick = closeSettings;
  settingsEl.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => (b.dataset.p === 'logout' ? logout() : showPage(b.dataset.p))));
  showPage(page);
}

async function showPage(page) {
  settingsEl.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('sel', b.dataset.p === page));
  stopVoiceTest();
  const sc = $('.sc', settingsEl);
  const s = state.settings;
  const toggleRow = (key, label, hint = '') => `<div class="toggle-row"><span>${label}</span><div class="switch ${s[key] ? 'on' : ''}" data-set="${key}"></div></div>${hint ? `<div class="hint">${hint}</div>` : ''}`;
  if (page === 'account') {
    const u = state.user;
    const auth = JSON.parse(localStorage.getItem('rea.auth'));
    sc.innerHTML = `<h2>Minha conta</h2><div style="background:var(--bg-tertiary);border-radius:8px;overflow:hidden"><div style="height:100px;background:${u.color}"></div><div style="padding:16px;display:flex;align-items:center;gap:16px"><div class="avatar" style="background:${u.color};width:80px;height:80px;font-size:32px;margin-top:-50px;border:6px solid var(--bg-tertiary);box-sizing:content-box">${esc(initials(u.name))}</div><div style="font-size:20px;font-weight:700;color:var(--header-primary)">${esc(u.name)}</div></div></div>
      <h5>Servidor</h5><div>${esc(auth.server)}</div><h5>ID do usuario</h5><div style="font-family:var(--mono)">${esc(u.id)}</div>`;
  }
  if (page === 'voice') {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const opt = (kind, cur) => `<option value="">Padrao</option>` + devices.filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || d.deviceId.slice(0, 8))}</option>`).join('');
    const radio = (key, val, title, sub = '') => `<div class="radio-card ${s[key] === val ? 'sel' : ''}" data-radio="${key}" data-v="${val}"><span class="rdot"></span><div>${title}${sub ? `<small>${sub}</small>` : ''}</div></div>`;
    sc.innerHTML = `<h2>Voz e video</h2>
      <h4 class="sec">Configuracoes de voz</h4>
      <div class="cols"><div><h5>Dispositivo de entrada</h5><select data-sel="inputDevice">${opt('audioinput', s.inputDevice)}</select></div>
      <div><h5>Dispositivo de saida</h5><select data-sel="outputDevice">${opt('audiooutput', s.outputDevice)}</select></div></div>
      <div class="cols"><div><h5>Volume de entrada <span class="val" data-val="inputVolume"></span></h5><input type="range" min="0" max="2" step="0.01" value="${s.inputVolume}" data-range="inputVolume"></div>
      <div><h5>Volume de saida <span class="val" data-val="outputVolume"></span></h5><input type="range" min="0" max="2" step="0.01" value="${s.outputVolume}" data-range="outputVolume"></div></div>

      <h5>Teste de microfone</h5>
      <div class="hint" style="margin:0 0 8px">Esta com problemas no microfone? Comece um teste e diga algo engracado. Vamos reproduzir sua voz para voce.</div>
      <div class="mictest"><button class="btn-brand" data-mictest>Vamos checar</button><div class="vu"><i></i></div></div>

      <h5>Modo de entrada</h5>
      ${radio('inputMode', 'vad', 'Deteccao de voz')}
      ${radio('inputMode', 'ptt', 'Pressionar para falar')}
      <div data-show="ptt" class="cols" style="margin-top:8px">
        <div><h5>Atalho</h5><button class="keybind" data-record>${esc(bindName(s.pttBind))}</button><div class="hint">Funciona mesmo com o app em segundo plano ou dentro de jogos. Aceita teclas e botoes laterais do mouse.</div></div>
        <div><h5>Atraso ao soltar <span class="val" data-val="pttReleaseDelay"></span></h5><input type="range" min="0" max="2000" step="10" value="${s.pttReleaseDelay}" data-range="pttReleaseDelay"></div>
      </div>
      <div data-show="vad">
        <h5>Sensibilidade de entrada</h5>
        <div class="toggle-row" style="margin-top:0"><span>Determinar automaticamente a sensibilidade de entrada</span><div class="switch ${s.autoSensitivity ? 'on' : ''}" data-set="autoSensitivity"></div></div>
        <div class="sens"><div class="vu big"><i></i><b class="thr"></b></div><input type="range" min="-100" max="0" step="1" value="${s.vadThresholdDb}" data-range="vadThresholdDb"></div>
        <div class="hint" data-senshint></div>
      </div>

      <h4 class="sec">Processamento de voz</h4>
      <h5>Supressao de ruido</h5>
      <div class="hint" style="margin:0 0 4px">Remove ruido de fundo (teclado, ventilador, cachorro latindo...) da sua voz.</div>
      ${radio('noiseSuppression', 'krisp', 'IA (RNNoise)', 'Supressao de ruido por rede neural, equivalente ao Krisp do Discord. Recomendado.')}
      ${radio('noiseSuppression', 'standard', 'Padrao', 'Supressao de ruido classica do WebRTC.')}
      ${radio('noiseSuppression', 'none', 'Nenhum', 'Nenhum processamento. Bom para microfones de estudio.')}
      ${toggleRow('echoCancellation', 'Cancelamento de eco')}
      ${toggleRow('advancedVad', 'Deteccao avancada de voz', 'Usa a IA para so abrir o microfone quando for voz humana, ignorando sons de fundo mesmo acima da sensibilidade.')}
      ${toggleRow('autoGainControl', 'Controle automatico de ganho')}
      <div class="hint" data-rnnerr style="color:var(--red)"></div>

      <h4 class="sec">Qualidade de servico</h4>
      ${toggleRow('qos', 'Ativar qualidade de servico com prioridade alta de pacotes', 'Indica ao seu roteador que os pacotes de voz/video tem prioridade. Desative se tiver problemas de conexao.')}

      <h4 class="sec">Configuracoes de video</h4>
      <h5>Camera</h5><select data-sel="videoDevice">${opt('videoinput', s.videoDevice)}</select>
      <div style="margin-top:12px"><button class="btn-brand" data-test-cam>Testar video</button></div><div class="cam-prev" style="margin-top:12px"></div>`;

    const syncVals = () => {
      sc.querySelectorAll('[data-val]').forEach((el) => { const k = el.dataset.val; el.textContent = k === 'pttReleaseDelay' ? s[k] + ' ms' : Math.round(s[k] * 100) + '%'; });
      sc.querySelectorAll('[data-show]').forEach((el) => el.classList.toggle('hidden', el.dataset.show !== s.inputMode));
      const r = $('[data-range="vadThresholdDb"]', sc); if (r) r.disabled = s.autoSensitivity;
    };
    sc.__syncVals = syncVals;
    syncVals();

    // microfone de teste (fora da chamada) com o mesmo processamento usado na chamada
    if (!(state.voice && state.voice.proc)) {
      try {
        settingsCtx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
        settingsProc = new window.REA_AUDIO.MicProcessor(settingsCtx, s);
        await settingsProc.start();
      } catch (e) { $('[data-senshint]', sc).textContent = 'Microfone indisponivel: ' + e.message; }
    }
    const shownProc = activeProc();
    if (shownProc && shownProc.rnnError) $('[data-rnnerr]', sc).textContent = 'Supressao por IA indisponivel: ' + shownProc.rnnError;
    const toPct = (db) => Math.max(0, Math.min(100, db + 100));
    testTimer = setInterval(() => {
      const p = activeProc();
      if (!p || !settingsEl) return;
      const lvl = toPct(p.lastDb);
      const on = p.transmitting;
      sc.querySelectorAll('.vu i').forEach((bar) => { bar.style.width = lvl + '%'; bar.style.background = on ? 'var(--green)' : 'var(--yellow)'; });
      const thr = $('.vu .thr', sc); if (thr) thr.style.left = toPct(p.threshold()) + '%';
      const hint = $('[data-senshint]', sc);
      if (hint && s.autoSensitivity) hint.textContent = `Ajustada automaticamente para ${Math.round(p.threshold())} dB conforme o ruido do ambiente.`;
      else if (hint) hint.textContent = '';
    }, 50);

    $('[data-mictest]', sc).onclick = (e) => {
      const p = activeProc(); if (!p) return;
      const on = !p.loopback;
      p.setLoopback(on);
      e.currentTarget.textContent = on ? 'Parar teste' : 'Vamos checar';
      e.currentTarget.className = on ? 'btn-red' : 'btn-brand';
    };
    sc.querySelectorAll('[data-radio]').forEach((rc) => (rc.onclick = () => {
      const k = rc.dataset.radio; s[k] = rc.dataset.v; saveSettings();
      sc.querySelectorAll(`[data-radio="${k}"]`).forEach((x) => x.classList.toggle('sel', x === rc));
      if (k === 'inputMode') configurePTT();
      if (k === 'noiseSuppression') { const p = activeProc(); if (p) p.acquire().then(() => { $('[data-rnnerr]', sc).textContent = p.rnnError ? 'Supressao por IA indisponivel: ' + p.rnnError : ''; }).catch(() => {}); }
      syncVals();
    }));
    $('[data-record]', sc).onclick = async (e) => {
      const btn = e.currentTarget;
      btn.textContent = 'Pressione uma tecla ou botao do mouse...'; btn.classList.add('recording');
      if (!(await window.native.ptt.record())) { btn.textContent = 'Atalho global indisponivel'; btn.classList.remove('recording'); }
    };
    $('[data-test-cam]', sc).onclick = async () => {
      const prev = $('.cam-prev', sc);
      const st = await navigator.mediaDevices.getUserMedia({ video: { deviceId: s.videoDevice ? { exact: s.videoDevice } : undefined, width: 1280, height: 720 } });
      const v = h('<video autoplay muted playsinline style="width:100%;max-width:480px;border-radius:8px;background:#000"></video>');
      v.srcObject = st; prev.replaceChildren(v);
      testStream = st;
    };
  }
  if (page === 'stream') {
    const codecs = (RTCRtpSender.getCapabilities('video')?.codecs || []).map((c) => c.mimeType.split('/')[1].toUpperCase()).filter((c, i, a) => ['H264', 'VP8', 'VP9', 'AV1', 'H265'].includes(c) && a.indexOf(c) === i);
    sc.innerHTML = `<h2>Transmissao</h2>
      <h5>Resolucao padrao</h5><select data-sel="streamResolution">${[['720', '720p'], ['1080', '1080p (Full HD)'], ['1440', '1440p (2K)'], ['2160', '2160p (4K)'], ['source', 'Fonte (resolucao nativa)']].map(([v, l]) => `<option value="${v}" ${s.streamResolution === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <h5>Taxa de quadros padrao</h5><select data-sel="streamFps" data-num>${[15, 30, 60].map((v) => `<option value="${v}" ${s.streamFps === v ? 'selected' : ''}>${v} FPS</option>`).join('')}</select>
      <h5>Codec de video preferido</h5><select data-sel="codec">${codecs.map((c) => `<option ${s.codec === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <div class="hint">Codecs disponiveis neste PC: ${codecs.join(', ')}. O outro lado precisa conseguir decodificar o mesmo codec (todos os clientes deste app suportam H264, VP8 e VP9).</div>
      ${toggleRow('streamAudio', 'Transmitir audio do sistema por padrao')}
      <h5 style="margin-top:32px">Bitrate maximo por resolucao</h5>
      <div class="hint">720p: 6 Mbps • 1080p: 12 Mbps • 1440p: 20 Mbps • 4K: 35 Mbps • Fonte: 25 Mbps. A qualidade real depende do seu upload — para 1080p60 recomendamos pelo menos 15 Mbps de upload.</div>`;
  }
  if (page === 'notif') {
    sc.innerHTML = `<h2>Notificacoes</h2>${toggleRow('notifications', 'Ativar notificacoes na area de trabalho')}${toggleRow('sounds', 'Sons do aplicativo', 'Entrar/sair de canal, silenciar, mensagens e transmissao.')}`;
  }
  sc.querySelectorAll('[data-set]').forEach((sw) => (sw.onclick = () => {
    const k = sw.dataset.set; s[k] = !s[k]; sw.classList.toggle('on', s[k]); saveSettings();
    if (['echoCancellation', 'autoGainControl', 'advancedVad'].includes(k)) { const p = activeProc(); if (p) p.acquire().catch(() => {}); }
    if (k === 'qos' && state.voice) state.voice.retuneAudio();
    if (sc.__syncVals) sc.__syncVals();
  }));
  sc.querySelectorAll('[data-sel]').forEach((sel) => (sel.onchange = () => {
    const k = sel.dataset.sel; s[k] = sel.hasAttribute('data-num') ? Number(sel.value) : sel.value; saveSettings();
    if (k === 'inputDevice') { const p = activeProc(); if (p) p.acquire().catch((e) => toast('Falha ao abrir o microfone: ' + e.message)); }
    if (k === 'outputDevice' && state.voice) state.voice.audio.setOutputDevice(s.outputDevice);
  }));
  sc.querySelectorAll('[data-range]').forEach((r) => (r.oninput = () => {
    const k = r.dataset.range; s[k] = Number(r.value); saveSettings();
    if (k === 'inputVolume') { const p = activeProc(); if (p) p.setInputVolume(s[k]); }
    if (k === 'outputVolume' && state.voice) state.voice.audio.setOutputVolume(s[k]);
    if (sc.__syncVals) sc.__syncVals();
  }));
}

// =====================================================================
// Teclado / janela
// =====================================================================
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (settingsEl) closeSettings(); else if ($('#modal-root').children.length) closeModal(); hideCtx(); $('.emoji-picker, .profile-pop, .lightbox')?.remove(); }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyM') { e.preventDefault(); toggleMute(); }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyD') { e.preventDefault(); toggleDeafen(); }
  // digitar em qualquer lugar foca o campo de mensagem, como no Discord
  if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !settingsEl && !$('#modal-root').children.length && !$('#chat').classList.contains('hidden')) input.focus();
});
window.addEventListener('focus', () => {
  const ch = state.channels.get(state.activeChannel);
  if (ch && state.unread.delete(ch.id)) { saveUnread(); renderGuilds(); renderChannels(); }
});

$('#tb-min').onclick = () => window.native.window.minimize();
$('#tb-max').onclick = () => window.native.window.maximize();
$('#tb-close').onclick = () => window.native.window.close();

startConnection();
