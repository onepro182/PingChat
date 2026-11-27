// PingChat Desktop (Electron) : fenetre + icone de zone de notification + pont WhatsApp integre.
// Le pont ecoute uniquement sur 127.0.0.1. La session WhatsApp est stockee dans le dossier AppData de l'utilisateur.
const fs = require('node:fs');
const { app, BrowserWindow, Tray, Menu, shell, session, nativeImage, Notification, dialog } = require('electron');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { pathToFileURL } = require('node:url');

// ---- Journal : %APPDATA%\PingChat\pingchat.log (jamais de secret dedans) ----
app.setName('PingChat');
let LOG = null;
try { app.setPath('userData', path.join(app.getPath('appData'), 'PingChat')); } catch {}
try {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  LOG = path.join(app.getPath('userData'), 'pingchat.log');
  try { if (fs.statSync(LOG).size > 500000) fs.renameSync(LOG, LOG + '.old'); } catch {}
} catch {}
function log(...a) {
  const line = new Date().toISOString() + ' ' + a.map((x) => (x instanceof Error ? (x.stack || x.message) : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  try { if (LOG) fs.appendFileSync(LOG, line + '\n'); } catch {}
}
log('--- demarrage PingChat', app.getVersion(), 'electron', process.versions.electron, 'node', process.versions.node, process.platform, process.arch, 'args', process.argv.slice(1));
let fatalShown = false;
function fatal(title, e) {
  log('FATAL', title, e);
  if (fatalShown) return; fatalShown = true;
  try { dialog.showErrorBox('PingChat : ' + title, String((e && (e.message || e)) || e) + '\n\nDetails dans : ' + (LOG || 'pingchat.log')); } catch {}
}
process.on('uncaughtException', (e) => { log('uncaughtException', e); if (!started) fatal('erreur au demarrage', e); });
process.on('unhandledRejection', (e) => log('unhandledRejection', e));
console.error = (...a) => log('console.error', ...a);
app.disableHardwareAcceleration(); // evite les fenetres invisibles avec certains pilotes graphiques

const PORT = 38211; // port fixe
const URL_ROOT = `http://127.0.0.1:${PORT}/`;
let win = null, tray = null, quitting = false, started = false, lastStatus = 'starting';

if (!app.requestSingleInstanceLock()) {
  log('une autre instance tourne deja : on la reveille et on quitte');
  app.quit();
} else {
  app.on('second-instance', () => { log('second-instance'); showWindow(); });
}

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
  log('userData', app.getPath('userData'), 'ui', process.env.PINGCHAT_ROOT, 'exists', fs.existsSync(path.join(process.env.PINGCHAT_ROOT, 'index.html')));
  if (!(await portFree(PORT))) throw new Error(`Le port ${PORT} est deja utilise par un autre programme.`);
  await import(pathToFileURL(path.join(__dirname, 'src', 'server.mjs')).href);
  started = true;
  log('pont demarre sur', URL_ROOT);
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
  win.loadURL(URL_ROOT).catch((e) => log('loadURL', e));
  const forceShow = () => { if (win && !win.isVisible() && !process.argv.includes('--hidden')) { log('affichage force'); win.show(); } };
  win.webContents.on('did-fail-load', (e, code, desc, url) => { log('did-fail-load', code, desc, url); forceShow(); });
  win.webContents.on('render-process-gone', (e, d) => log('render-process-gone', d));
  win.webContents.on('did-finish-load', () => log('page chargee'));
  setTimeout(forceShow, 6000);
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
    if (!url.startsWith(URL_ROOT)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
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
    { label: 'Ouvrir le journal (en cas de probleme)', click: () => { if (LOG) shell.showItemInFolder(LOG); } },
    { label: 'Quitter (arrete aussi le pont WhatsApp)', click: () => { quitting = true; app.quit(); } },
  ]));
}

if (app.hasSingleInstanceLock()) app.whenReady().then(async () => {
  // Micro autorise seulement pour l'interface locale (messages vocaux)
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const ok = ['media', 'notifications', 'clipboard-sanitized-write'].includes(permission) && (details.requestingUrl || '').startsWith(URL_ROOT);
    cb(ok);
  });
  log('app prete');
  try { await startBridge(); }
  catch (e) { fatal('impossible de demarrer', e); app.exit(1); return; }
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'build', 'tray.png')));
  tray.setToolTip('PingChat');
  tray.on('click', showWindow); tray.on('double-click', showWindow);
  buildMenu();
  setInterval(refreshTray, 5000);
  createWindow();
  log('fenetre creee');
}).catch((e) => { fatal('erreur inattendue', e); app.exit(1); });

app.on('child-process-gone', (e, d) => log('child-process-gone', d));
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* reste actif dans la zone de notification */ });
