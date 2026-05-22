'use strict';

// Minimal client for the League Client Update (LCU) API.
// The running League client exposes a local HTTPS server; its port and
// password live in a "lockfile" inside the install directory.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const DEFAULT_LOCKFILE = 'C:\\Riot Games\\League of Legends\\lockfile';

function findLockfile() {
  if (fs.existsSync(DEFAULT_LOCKFILE)) return DEFAULT_LOCKFILE;
  // Fallback: locate LeagueClientUx.exe and derive the install dir from it.
  try {
    const out = execSync(
      'powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name=\'LeagueClientUx.exe\'\\").ExecutablePath"',
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (out) {
      const lf = path.join(path.dirname(out), 'lockfile');
      if (fs.existsSync(lf)) return lf;
    }
  } catch (e) {
    /* client not running */
  }
  return null;
}

// Returns { port, password, auth } or null when the client is not running.
function getCredentials() {
  const lf = findLockfile();
  if (!lf) return null;
  let raw;
  try {
    raw = fs.readFileSync(lf, 'utf8');
  } catch (e) {
    return null;
  }
  const parts = raw.trim().split(':');
  if (parts.length < 5) return null;
  const port = parseInt(parts[2], 10);
  const password = parts[3];
  if (!port || !password) return null;
  return {
    port,
    password,
    auth: 'Basic ' + Buffer.from('riot:' + password).toString('base64'),
  };
}

// Promise-based HTTPS request to the LCU. Self-signed cert is expected.
function request(creds, method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const headers = {
      Authorization: creds.auth,
      Accept: 'application/json',
    };
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = https.request(
      {
        host: '127.0.0.1',
        port: creds.port,
        path: apiPath,
        method,
        headers,
        rejectUnauthorized: false,
        timeout: 4000,
      },
      (res) => {
        let chunks = '';
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            if (!chunks) return resolve(null);
            try {
              resolve(JSON.parse(chunks));
            } catch (e) {
              resolve(chunks);
            }
          } else {
            reject(new Error('HTTP ' + res.statusCode + ' ' + chunks.slice(0, 200)));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

module.exports = { getCredentials, request };
