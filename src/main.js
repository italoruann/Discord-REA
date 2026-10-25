'use strict';
const { app, BrowserWindow, ipcMain, desktopCapturer, session, Tray, Menu, nativeImage, shell, Notification } = require('electron');
const path = require('path');

// ---------- desempenho / WebRTC ----------
// GPU de alto desempenho em notebooks hibridos e encoder/decoder por hardware.
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCEncoderSupport,WebRtcAllowH265Send,WebRtcAllowH265Receive');
// Nao deixa o Chromium reduzir a captura/encode quando a janela fica em segundo plano.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const isDev = process.argv.includes('--dev');
// endereco do servidor: fixo em producao; REA_SERVER sobrescreve (ex.: testar outra VPS sem recompilar)
const SERVER_URL = process.env.REA_SERVER || (isDev ? 'ws://localhost:3478' : 'wss://discord.gendata.tech');
let win = null;
let tray = null;
let pendingSource = null; // { id, audio } escolhido no seletor do renderer

if (!app.requestSingleInstanceLock() && !isDev) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 940,
    minHeight: 500,
    frame: false,
    backgroundColor: '#313338',
    show: false,
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: true,
      additionalArguments: [`--rea-server=${SERVER_URL}`, ...(isDev ? ['--rea-dev'] : [])],
    },
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  win.on('maximize', () => win.webContents.send('window:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('window:state', { maximized: false }));
  win.on('close', (e) => {
    if (!app.isQuitting) { e.preventDefault(); win.hide(); }
  });

  // links externos abrem no navegador
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
  });

  // Permissoes de midia apenas para a nossa propria pagina
  const ses = win.webContents.session;
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });

  // getDisplayMedia() do renderer -> usa a fonte escolhida no nosso seletor (estilo "Go Live")
  ses.setDisplayMediaRequestHandler((request, callback) => {
    const choice = pendingSource;
    pendingSource = null;
    if (!choice) return callback({});
    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }).then((sources) => {
      const src = sources.find((s) => s.id === choice.id);
      if (!src) return callback({});
      // 'loopback' captura o audio do sistema no Windows
      callback(choice.audio && process.platform === 'win32' ? { video: src, audio: 'loopback' } : { video: src });
    }).catch(() => callback({}));
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'renderer', 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Discord REA');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir', click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win.isVisible() && win.isFocused() ? win.hide() : (win.show(), win.focus()); });
}

// ---------- IPC ----------
ipcMain.on('window:minimize', () => win.minimize());
ipcMain.on('window:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('window:close', () => win.close());
ipcMain.on('window:flash', () => { if (!win.isFocused()) win.flashFrame(true); });
ipcMain.on('app:badge', (e, count) => {
  if (process.platform === 'win32') {
    win.setOverlayIcon(count ? nativeImage.createFromDataURL(badgeDataUrl(count)) : null, count ? `${count} nao lidas` : '');
  } else app.setBadgeCount(count);
});
ipcMain.on('notify', (e, { title, body }) => {
  if (win.isFocused() || !Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => { win.show(); win.focus(); });
  n.show();
});

ipcMain.handle('capture:sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.id.startsWith('screen') ? 'screen' : 'window',
    thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
    icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
  }));
});
ipcMain.handle('capture:select', (e, choice) => { pendingSource = choice; return true; });

// ---------- Pressionar para falar (global: funciona com o app em segundo plano / dentro de jogos) ----------
const ptt = { enabled: false, bind: null, down: false, recording: false, hook: null };
const sameBind = (a, b) => a && b && a.type === b.type && (a.type === 'key' ? a.code === b.code : a.button === b.button);

function onHookInput(bind, down) {
  if (ptt.recording && down) {
    ptt.recording = false;
    if (win) win.webContents.send('ptt:recorded', bind);
    return;
  }
  if (!ptt.enabled || !sameBind(bind, ptt.bind) || down === ptt.down) return;
  ptt.down = down;
  if (win) win.webContents.send('ptt:state', down);
}

function ensureHook() {
  if (ptt.hook) return true;
  try {
    const { uIOhook } = require('uiohook-napi');
    uIOhook.on('keydown', (e) => onHookInput({ type: 'key', code: e.keycode }, true));
    uIOhook.on('keyup', (e) => onHookInput({ type: 'key', code: e.keycode }, false));
    // botoes 1 e 2 (esquerdo/direito) nao podem ser atalho
    uIOhook.on('mousedown', (e) => e.button > 2 && onHookInput({ type: 'mouse', button: e.button }, true));
    uIOhook.on('mouseup', (e) => e.button > 2 && onHookInput({ type: 'mouse', button: e.button }, false));
    uIOhook.start();
    ptt.hook = uIOhook;
    return true;
  } catch (e) {
    console.error('hook global indisponivel', e);
    return false;
  }
}

ipcMain.handle('ptt:configure', (e, { enabled, bind }) => {
  ptt.enabled = !!enabled && !!bind;
  ptt.bind = bind;
  if (!ptt.enabled && ptt.down) { ptt.down = false; win.webContents.send('ptt:state', false); }
  return ptt.enabled ? ensureHook() : true;
});
ipcMain.handle('ptt:record', () => { ptt.recording = ensureHook(); return ptt.recording; });
ipcMain.handle('ptt:keynames', () => {
  try {
    const { UiohookKey } = require('uiohook-napi');
    return Object.fromEntries(Object.entries(UiohookKey).map(([name, code]) => [code, name]));
  } catch { return {}; }
});
app.on('will-quit', () => { if (ptt.hook) ptt.hook.stop(); });

function badgeDataUrl(count) {
  const text = count > 9 ? '9+' : String(count);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="#f23f43"/><text x="8" y="12" font-size="10" font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">${text}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.rea.discordclone');
  createWindow();
  createTray();
  // hook global ja ativo desde o inicio: o primeiro aperto do atalho nunca se perde
  ensureHook();
});
app.on('before-quit', () => { app.isQuitting = true; });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
