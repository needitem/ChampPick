'use strict';

const { app, BrowserWindow, ipcMain, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { getCredentials, request } = require('./lcu');

let win = null;
let creds = null;
let championNames = {};
let pollTimer = null;

// Phases during which the overlay must be fully hidden (a game is running).
const IN_GAME_PHASES = new Set([
  'GameStart',
  'InProgress',
  'Reconnect',
  'WaitingForStats',
  'PreEndOfGame',
  'EndOfGame',
]);

function setWindowVisible(visible) {
  if (!win || win.isDestroyed()) return;
  if (visible) {
    if (!win.isVisible()) win.showInactive();
  } else if (win.isVisible()) {
    win.hide();
  }
}

function createWindow() {
  const wb = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({
    width: 470,
    height: 410,
    x: wb.x + wb.width - 490,
    y: wb.y + 60,
    minWidth: 320,
    minHeight: 240,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    title: 'ChampPick',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Trust the LCU's self-signed cert and inject auth so the renderer can load
// champion icons directly from https://127.0.0.1:<port>/...
function setupLcuNetwork() {
  const ses = session.defaultSession;
  ses.setCertificateVerifyProc((req, callback) => {
    callback(req.hostname === '127.0.0.1' ? 0 : -3);
  });
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    if (creds && details.url.startsWith('https://127.0.0.1:' + creds.port + '/')) {
      details.requestHeaders['Authorization'] = creds.auth;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function refreshCreds() {
  const c = getCredentials();
  if (!c) {
    creds = null;
    return false;
  }
  try {
    await request(c, 'GET', '/lol-summoner/v1/current-summoner');
    creds = c;
    return true;
  } catch (e) {
    creds = null;
    return false;
  }
}

async function loadChampionNames() {
  if (Object.keys(championNames).length > 5) return;
  try {
    const summary = await request(
      creds,
      'GET',
      '/lol-game-data/assets/v1/champion-summary.json'
    );
    const map = {};
    for (const c of summary) if (c.id > 0) map[c.id] = c.name;
    championNames = map;
  } catch (e) {
    /* retry next poll */
  }
}

async function poll() {
  let connected = creds != null;
  if (connected) {
    try {
      await request(creds, 'GET', '/lol-gameflow/v1/gameflow-phase');
    } catch (e) {
      connected = false;
      creds = null;
    }
  }
  if (!connected) connected = await refreshCreds();
  if (!connected) {
    setWindowVisible(true);
    send('state', { status: 'no-client' });
    return;
  }

  await loadChampionNames();

  let phase;
  try {
    phase = await request(creds, 'GET', '/lol-gameflow/v1/gameflow-phase');
  } catch (e) {
    setWindowVisible(true);
    send('state', { status: 'no-client' });
    return;
  }

  if (phase !== 'ChampSelect') {
    // Hidden entirely once a game starts; visible in lobby/queue.
    setWindowVisible(!IN_GAME_PHASES.has(phase));
    send('state', { status: 'idle', phase });
    return;
  }

  let sess;
  try {
    sess = await request(creds, 'GET', '/lol-champ-select/v1/session');
  } catch (e) {
    setWindowVisible(!IN_GAME_PHASES.has(phase));
    send('state', { status: 'idle', phase });
    return;
  }

  setWindowVisible(true);
  send('state', buildState(sess));
}

function buildState(sess) {
  const localCellId = sess.localPlayerCellId;
  const myTeam = sess.myTeam || [];
  const me = myTeam.find((p) => p.cellId === localCellId) || {};
  const bench = (sess.benchChampions || [])
    .map((b) => b.championId)
    .filter((id) => id > 0);
  const team = myTeam.map((p) => ({
    championId: p.championId || 0,
    isLocal: p.cellId === localCellId,
  }));
  return {
    status: 'champ-select',
    port: creds.port,
    names: championNames,
    benchEnabled: !!sess.benchEnabled,
    myChampId: me.championId || 0,
    bench,
    team,
    rerolls: me.rerollsRemaining != null ? me.rerollsRemaining : 0,
  };
}

ipcMain.handle('swap', async (_e, championId) => {
  if (!creds) return { ok: false, error: '클라이언트 연결 없음' };
  try {
    await request(
      creds,
      'POST',
      '/lol-champ-select/v1/session/bench/swap/' + championId
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('reroll', async () => {
  if (!creds) return { ok: false, error: '클라이언트 연결 없음' };
  try {
    await request(creds, 'POST', '/lol-champ-select/v1/session/my-selection/reroll');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.on('close-app', () => app.quit());

app.whenReady().then(() => {
  setupLcuNetwork();
  createWindow();
  poll();
  pollTimer = setInterval(poll, 1000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (pollTimer) clearInterval(pollTimer);
  app.quit();
});
