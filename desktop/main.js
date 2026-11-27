// PingChat Desktop (Electron) : fenetre + icone de zone de notification + pont WhatsApp integre.
// Le pont ecoute uniquement sur 127.0.0.1. La session WhatsApp est stockee dans le dossier AppData de l'utilisateur.
const { app, BrowserWindow, Tray, Menu, shell, session, nativeImage, Notification } = require('electron');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

const PORT = 38211; // port fixe (garde la meme origine : theme, statuts, reglages conserves)
let win = null, tray = null, quitting = false, started = false, lastStatus = 'starting';

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => showWindow());

function portFree(p) {
  return new Promise((ok) => {
    const s = net.createServer().once('error', () => ok(false)).once('listening', () => s.close(() => ok(true))).listen(p, '127.0.0.1');
  });
}

async function startBridge() {
  process.env.PORT = String(PORT);
  process.env.PINGCHAT_QUIET = '1';
  process.env.PINGCHAT_ROOT = path.join(__dirname, 'src', 'ui');
  process.env.PINGCHAT_DATA = path.join(app.getPath('userData'), 'whatsapp-data');
  if (!(await portFree(PORT))) throw new Error(`Le port ${PORT} est deja utilise par un autre programme.`);
  await import(pathToFileURL(path.join(__dirname, 'src', 'server.mjs')).href);
  started = true;
}

function getState() {
  return new Promise((ok) => {
    const r = http.get({ host: '127.0.0.1', port: PORT, path: '/api/state', headers: { Host: `127.0.0.1:${PORT}` }, timeout: 2000 }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => { try { ok(JSON.parse(b)); } catch { ok(null); } });
    });
    r.on('error', () => ok(null)); r.on('timeout', () => { r.destroy(); ok(null); });
  });
}
const LABEL = { open: 'WhatsApp connecte', qr: 'en attente du scan QR', reconnecting: 'reconnexion...', starting: 'demarrage...', logged_out: 'deconnecte' };
async function refreshTray() {
  const s = await getState();
  lastStatus = s ? s.status : 'arrete';
  if (tray) { tray.setToolTip('PingChat - ' + (LABEL[lastStatus] || lastStatus)); buildMenu(); }
}

function showWindow() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 420, minHeight: 560,
    title: 'PingChat', icon: path.join(__dirname, 'build', 'tray.png'), backgroundColor: '#111b21', show: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`http://localhost:${PORT}/`);
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  // On ne quitte pas en fermant : on reste dans la zone de notification
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); win.hide();
    if (!global.__hintShown && Notification.isSupported()) {
      global.__hintShown = true;
      new Notification({ title: 'PingChat', body: 'PingChat continue en arriere-plan. Clic droit sur l\'icone pres de l\'horloge pour quitter.' }).show();
    }
  });
  win.on('closed', () => { win = null; });
  // Navigation : uniquement l'interface locale ; les liens externes s'ouvrent dans le navigateur
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://localhost:${PORT}/`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
}

function buildMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir PingChat', click: showWindow },
    { label: 'Etat : ' + (LABEL[lastStatus] || lastStatus), enabled: false },
    { type: 'separator' },
    { label: 'Demarrer avec Windows', type: 'checkbox', checked: login,
      click: (item) => { app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }); buildMenu(); } },
    { type: 'separator' },
    { label: 'Quitter (arrete aussi le pont WhatsApp)', click: () => { quitting = true; app.quit(); } },
  ]));
}

app.whenReady().then(async () => {
  // Micro autorise seulement pour l'interface locale (messages vocaux)
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const ok = ['media', 'notifications', 'clipboard-sanitized-write'].includes(permission) && (details.requestingUrl || '').startsWith(`http://localhost:${PORT}/`);
    cb(ok);
  });
  try { await startBridge(); }
  catch (e) {
    const { dialog } = require('electron');
    dialog.showErrorBox('PingChat', 'Impossible de demarrer : ' + (e.message || e));
    app.exit(1); return;
  }
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png')));
  tray.setToolTip('PingChat');
  tray.on('click', showWindow); tray.on('double-click', showWindow);
  buildMenu();
  setInterval(refreshTray, 5000);
  createWindow();
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* reste actif dans la zone de notification */ });
