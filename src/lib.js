// NEXUS — общая библиотека для exe-упаковщиков (поиск Antigravity, проверки, бэкапы, вывод по-русски).
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');
const readline = require('readline');

const IS_WIN = process.platform === 'win32';
const A = process.argv.slice(2);
const flag = (n) => A.includes(n);
const argVal = (n) => { const i = A.indexOf(n); return i >= 0 && i + 1 < A.length ? A[i + 1] : null; };

const COL = process.stdout.isTTY || process.env.NEXUS_COLOR === '1';
const paint = (c, s) => (COL ? `\x1b[${c}m${s}\x1b[0m` : s);
const say = (s = '') => console.log(s);
const ok = (s) => say(paint(32, '  [OK] ') + s);
const warn = (s) => say(paint(33, '  [!]  ') + s);
const bad = (s) => say(paint(31, '  [X]  ') + s);
const info = (s) => say('       ' + s);
const head = (s) => { say(); say(paint('1;36', '  ' + s)); say(paint(36, '  ' + '-'.repeat(Math.min(70, s.length + 2)))); };
const banner = (title, sub) => {
  say();
  say(paint('1;36', '  ======================================================'));
  say(paint('1;37', '   ' + title));
  if (sub) say(paint(90, '   ' + sub));
  say(paint('1;36', '  ======================================================'));
};

const sha256f = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) { const t = Date.now() + ms; while (Date.now() < t) {} } };
const stamp = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

// ---------- asar (только чтение заголовка) ----------
function asarParse(buf) {
  if (buf.length < 16) throw new Error('файл слишком мал для asar');
  const sizeB = buf.readUInt32LE(4);
  const jlen = buf.readUInt32LE(12);
  const header = JSON.parse(buf.slice(16, 16 + jlen).toString('utf8'));
  return { header, dataStart: 8 + sizeB };
}
function entryOf(header, p) {
  let n = header;
  for (const part of p.split('/')) { if (!n.files || !n.files[part]) return null; n = n.files[part]; }
  return n;
}
function countFiles(node) { let c = 0; for (const v of Object.values(node.files || {})) c += v.files ? countFiles(v) : 1; return c; }
function readAsar(asarPath) {
  const buf = fs.readFileSync(asarPath);
  const { header, dataStart } = asarParse(buf);
  const get = (rel) => {
    const e = entryOf(header, rel);
    if (!e || e.offset === undefined || e.unpacked) return null;
    const off = dataStart + Number(e.offset);
    return buf.slice(off, off + e.size);
  };
  return { header, get, files: countFiles(header) };
}

const MARK_V5 = '__NEXUS_RU_V5__';
const MARK_V4 = '__ANTIGRAVITY_RU_V4__';
const THEME_BEGIN = '// >>> NEXUS-THEME-FINAL BEGIN';

function inspectAsar(asarPath) {
  const a = readAsar(asarPath);
  const u = a.get('dist/utils.js');
  if (!u) throw new Error('в app.asar нет dist/utils.js');
  const code = u.toString('utf8');
  let version = '?';
  try { version = JSON.parse(a.get('package.json').toString('utf8')).version || '?'; } catch (_) {}
  return {
    version,
    files: a.files,
    ru: code.includes(MARK_V5) ? 'RU_V5' : code.includes(MARK_V4) ? 'RU_V4' : 'NONE',
    theme: code.includes(THEME_BEGIN),
    anchor: code.includes('win.loadURL('),
  };
}

// ---------- поиск установки Antigravity ----------
function psLines(cmd) {
  if (!IS_WIN) return [];
  try {
    const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; ' + cmd], { encoding: 'utf8', timeout: 25000, windowsHide: true });
    return (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (_) { return []; }
}
function candidateDirs() {
  const map = new Map();
  const add = (d, src) => {
    if (!d) return;
    d = String(d).trim().replace(/^"+|"+$/g, '').replace(/[\\/]+$/, '');
    if (!d) return;
    const k = d.toLowerCase();
    if (!map.has(k)) map.set(k, { dir: d, src });
  };
  const env = process.env;
  const forced = argVal('--dir') || env.NEXUS_AG_DIR;
  if (forced) { add(forced, 'указано вручную'); return [...map.values()]; }
  const la = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  add(path.join(la, 'Programs', 'antigravity'), 'стандартная папка');
  add(path.join(la, 'Programs', 'Antigravity'), 'стандартная папка');
  add(path.join(la, 'Antigravity'), 'стандартная папка');
  if (env.ProgramFiles) add(path.join(env.ProgramFiles, 'Antigravity'), 'Program Files');
  if (env['ProgramFiles(x86)']) add(path.join(env['ProgramFiles(x86)'], 'Antigravity'), 'Program Files');
  // запущенные процессы и реестр (после переустановки путь мог измениться)
  const lines = psLines(
    "Get-Process -Name Antigravity -ErrorAction SilentlyContinue | ForEach-Object { 'P|' + $_.Path }; " +
    "Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | " +
    "Where-Object { $_.DisplayName -match '^Antigravity(\\s+[0-9][0-9.]*)?$' } | ForEach-Object { 'R|' + $_.InstallLocation; 'R|' + $_.DisplayIcon; 'R|' + $_.UninstallString }"
  );
  for (const l of lines) {
    const m = /^([PR])\|(.*)$/.exec(l);
    if (!m || !m[2]) continue;
    let v = m[2].replace(/,\d+$/, '').trim();
    if (/\.exe/i.test(v)) { const mm = /^"?([^"]*?\.exe)/i.exec(v); if (mm) v = path.dirname(mm[1]); }
    add(v, m[1] === 'P' ? 'запущенная Antigravity' : 'реестр Windows');
  }
  return [...map.values()];
}
function findInstalls() {
  const res = [];
  for (const c of candidateDirs()) {
    const asarPath = path.join(c.dir, 'resources', 'app.asar');
    if (!fs.existsSync(asarPath)) continue;
    try {
      const st = inspectAsar(asarPath);
      if (!st.anchor) continue; // не тот продукт / неизвестная структура
      res.push({ dir: c.dir, src: c.src, asar: asarPath, res: path.join(c.dir, 'resources') });
    } catch (_) { /* не Antigravity-менеджер */ }
  }
  return res;
}

// ---------- процесс ----------
function isRunning() {
  if (process.env.NEXUS_FAKE_RUNNING === '1') return true;
  if (process.env.NEXUS_FAKE_RUNNING === '0' && process.env.NEXUS_AG_DIR) return false; // только для тестов на копии
  if (!IS_WIN) return false;
  try {
    const out = cp.execSync('tasklist /FI "IMAGENAME eq Antigravity.exe" /NH', { encoding: 'utf8', windowsHide: true });
    return /Antigravity\.exe/i.test(out);
  } catch (_) { return false; }
}
// Ждёт, пока пользователь сам закроет Antigravity. Ничего не закрывает принудительно.
function waitUntilClosed(maxMin = 20) {
  if (!isRunning()) return true;
  say();
  warn(paint('1;33', 'Antigravity сейчас запущена.'));
  info('Сохраните работу и ЗАКРОЙТЕ её полностью: окно и значок в трее (правой кнопкой -> Выход).');
  info('Я ничего не закрываю принудительно. Жду, пока вы закроете её сами (Ctrl+C - отмена)...');
  const t0 = Date.now();
  let dots = 0;
  while (isRunning()) {
    if (Date.now() - t0 > maxMin * 60000) { say(); bad(`Antigravity не закрыта за ${maxMin} мин. Ничего не изменено. Закройте её и запустите программу снова.`); return false; }
    sleep(2000);
    process.stdout.write('.'); if (++dots % 60 === 0) process.stdout.write('\n');
  }
  say();
  ok('Antigravity закрыта. Даю секунду на освобождение файлов...');
  sleep(3000);
  return true;
}

// ---------- резервные копии ----------
function dataDir() {
  const base = process.env.NEXUS_DATA || (IS_WIN ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'NEXUS_Tools') : path.join(os.homedir(), '.nexus_tools'));
  fs.mkdirSync(base, { recursive: true });
  return base;
}
function backupAsar(asarPath, version) {
  const dir = path.join(dataDir(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const h = sha256f(asarPath);
  const name = `app.asar.v${version}.${h.slice(0, 8)}.bak`;
  const dst = path.join(dir, name);
  if (fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(asarPath).size && sha256f(dst) === h) return dst;
  fs.copyFileSync(asarPath, dst);
  if (sha256f(dst) !== h) { try { fs.rmSync(dst); } catch (_) {} throw new Error('резервная копия не совпала по SHA-256: ' + dst); }
  // оставляем 5 последних
  const list = fs.readdirSync(dir).filter((n) => n.startsWith('app.asar.v') && n.endsWith('.bak'))
    .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const x of list.slice(5)) { try { fs.rmSync(path.join(dir, x.n)); } catch (_) {} }
  return dst;
}
function rollback(asarPath, bak) {
  try {
    fs.copyFileSync(bak, asarPath);
    return sha256f(asarPath) === sha256f(bak);
  } catch (_) { return false; }
}

// ---------- запуск вспомогательных js ----------
function runNode(script, args, echo = true, filter = null) {
  const r = cp.spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NEXUS_NO_RUNNING_CHECK: '' } });
  const out = ((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).filter((l) => l.trim());
  if (echo) for (const l of out) { if (filter && filter(l)) continue; info(paint(90, l)); }
  return { code: r.status === null ? 1 : r.status, out: out.join('\n') };
}

// ---------- ввод ----------
function ask(q) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    rl.on('close', () => { if (!done) resolve(''); });
    rl.question(q, (a) => { done = true; rl.close(); resolve(String(a || '').trim()); });
  });
}
async function pause() {
  if (flag('--no-pause') || process.env.NEXUS_NO_PAUSE === '1') return;
  if (!process.stdin.isTTY) return;
  await ask('\n  Нажмите Enter, чтобы закрыть окно... ');
}
const homeDirData = () => (IS_WIN ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')) : path.join(os.homedir(), '.config'));

module.exports = {
  A, flag, argVal, say, ok, warn, bad, info, head, banner, paint, sleep, stamp, sha256f,
  inspectAsar, findInstalls, isRunning, waitUntilClosed, backupAsar, rollback, runNode, ask, pause, dataDir, homeDirData,
  IS_WIN, MARK_V5,
};
