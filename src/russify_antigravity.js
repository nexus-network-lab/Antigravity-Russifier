/*
 * NEXUS — русификатор Antigravity (версонезависимый патчер app.asar).
 *
 * 1) распаковывает app.asar менеджера Antigravity;
 * 2) внедряет в dist/utils.js рантайм-переводчик интерфейса (inject_block.js),
 *    который читает dictionary.ru.json из resources/ и переводит DOM на лету;
 * 3) заменяет статичные строки нативного меню/трея/обновления по словарю;
 * 4) переупаковывает app.asar, СОХРАНЯЯ вынесенные модули (app.asar.unpacked);
 * 5) кладёт dictionary.ru.json рядом с app.asar.
 *
 * Версонезависимо: точка внедрения и строки ищутся по содержимому, не по хешу.
 * После обновления Antigravity — запустить снова, пропатчит новую версию.
 *
 *   node russify_antigravity.js                 # пропатчить установленную
 *   node russify_antigravity.js --asar "<путь app.asar>"
 *   node russify_antigravity.js --out "<файл>"  # собрать в файл, не трогая установку (тест)
 *   node russify_antigravity.js --restore       # вернуть оригинал из бэкапа (целиком, вместе со всем, что добавлено после — например темой)
 *   node russify_antigravity.js --unpatch       # убрать ТОЛЬКО русификацию, не трогая остальное (тема остаётся)
 *   node russify_antigravity.js --force         # перепатчить, даже если уже русифицировано
 *   node russify_antigravity.js --status        # показать состояние: RU_V5 / RU_V4 / NONE (код выхода 0)
 *   node russify_antigravity.js --base "<папка>"  # где лежат dictionary*.json (по умолчанию ..\antigravity-base)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const asar = require('@electron/asar');

const argv = process.argv.slice(2);
const getArg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const has = (name) => argv.includes(name);

const DEFAULT_ASAR = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'resources', 'app.asar');
const ASAR = getArg('--asar') || DEFAULT_ASAR;
const RES = path.dirname(ASAR);
const UNPACKED = ASAR + '.unpacked';
const BACKUP = ASAR + '.nexus_orig';
const OUT = getArg('--out') || ASAR;
const HERE = __dirname;
const INJECT = path.join(HERE, 'inject_block.js');
const BASE = getArg('--base') || path.join(HERE, '..', 'antigravity-base');
const DICT = path.join(BASE, 'dictionary.ru.json');
const PATTERNS = path.join(BASE, 'dictionary.patterns.ru.json');
const STATIC_KEYS = path.join(BASE, 'dictionary.static_keys.json');
const MARK_V5 = '__NEXUS_RU_V5__';
const MARK_V4 = '__ANTIGRAVITY_RU_V4__';
const NATIVE_FILES = ['dist/main.js', 'dist/menu.js', 'dist/tray.js', 'dist/updater.js'];

const log = (...a) => console.log('[RU]', ...a);
const die = (m) => { console.error('[RU][ОШИБКА]', m); process.exit(1); };

if (!fs.existsSync(ASAR)) die('app.asar не найден: ' + ASAR);
if (has('--status')) {
  let u = '';
  try { u = asar.extractFile(ASAR, 'dist/utils.js').toString('utf8'); } catch (e) { die('не могу прочитать dist/utils.js: ' + e.message); }
  console.log(u.includes(MARK_V5) ? 'RU_V5' : u.includes(MARK_V4) ? 'RU_V4' : 'NONE');
  process.exit(0);
}
const REMOVE_ONLY = has('--restore') || has('--unpatch');
if (!REMOVE_ONLY && !fs.existsSync(INJECT)) die('нет inject_block.js рядом со скриптом');
if (!REMOVE_ONLY && !fs.existsSync(DICT)) die('нет dictionary.ru.json: ' + DICT);

function checkBackupVersion() {
  if (!fs.existsSync(BACKUP)) die('бэкап не найден: ' + BACKUP);
  try {
    const verOf = (f) => JSON.parse(asar.extractFile(f, 'package.json').toString('utf8')).version;
    const vb = verOf(BACKUP), vc = verOf(ASAR);
    if (vb !== vc && !has('--force')) die('резервная копия от версии ' + vb + ', а установлена ' + vc + '. Откат на старую версию сломает приложение — отменено (--force чтобы всё равно).');
  } catch (e) { if (!has('--force')) die('не смог сверить версии резервной копии и приложения: ' + e.message); }
}
function removeDictionaries() {
  for (const n of ['dictionary.ru.json', 'dictionary.patterns.ru.json']) {
    const dst = path.join(RES, n);
    if (fs.existsSync(dst)) fs.rmSync(dst);
  }
}
function restoreFull() {
  checkBackupVersion();
  fs.copyFileSync(BACKUP, ASAR);
  removeDictionaries();
  log('оригинал восстановлен из', path.basename(BACKUP));
}
if (has('--restore')) { restoreFull(); process.exit(0); }

function unpackGlobs() {
  const dirs = [];
  const nm = path.join(UNPACKED, 'node_modules');
  if (fs.existsSync(nm)) {
    for (const pkg of fs.readdirSync(nm)) {
      if (pkg.startsWith('@')) {
        for (const sub of fs.readdirSync(path.join(nm, pkg))) dirs.push(`node_modules/${pkg}/${sub}`);
      } else dirs.push(`node_modules/${pkg}`);
    }
  }
  return dirs;
}

function replaceLiterals(src, dict) {
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
  let out = src, count = 0;
  for (const k of keys) {
    const v = dict[k];
    if (typeof v !== 'string' || !k || !v || k === v) continue;
    if (/[`${}\\]/.test(k)) continue;
    for (const q of ['"', "'", '`']) {
      const needle = q + k + q;
      const repl = q + v.split(q).join('\\' + q) + q;
      const parts = out.split(needle);
      if (parts.length > 1) { count += parts.length - 1; out = parts.join(repl); }
    }
  }
  return { out, count };
}

const crypto = require('crypto');
function sha256(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

function stripOldBlocks(u) {
  // v5: между BEGIN/END
  for (;;) {
    const b = u.indexOf('// >>> NEXUS-RU-V5 BEGIN');
    if (b < 0) break;
    const eMark = u.indexOf('// <<< NEXUS-RU-V5 END', b);
    if (eMark < 0) break;
    const eLine = u.indexOf('\n', eMark);
    let rest = u.slice(eLine < 0 ? u.length : eLine + 1);
    if (rest.startsWith('\n')) rest = rest.slice(1); // пустая строка, которую добавлял инъектор
    u = u.slice(0, u.lastIndexOf('\n', b) + 1) + rest;
  }
  // v4: от «Russian UI translation v4» до конца обработчика did-finish-load
  const v4 = u.indexOf('// Russian UI translation v4');
  if (v4 >= 0) {
    const call = u.indexOf('void injectRussianUI();', v4);
    const close = call < 0 ? -1 : u.indexOf('});', call);
    if (close > 0) {
      const eLine = u.indexOf('\n', close);
      u = u.slice(0, u.lastIndexOf('\n', v4) + 1) + u.slice(eLine < 0 ? u.length : eLine + 1);
    }
  }
  return u;
}

const BOM = String.fromCharCode(0xFEFF);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ru-'));
const tmpOut = path.join(os.tmpdir(), 'nexus-ru-out-' + process.pid + '.asar');
const cleanup = () => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  try { if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut); } catch (_) {}
};

(async () => {
  if (has('--unpatch')) {
    const u0 = asar.extractFile(ASAR, 'dist/utils.js').toString('utf8');
    if (!u0.includes(MARK_V5) && !u0.includes(MARK_V4)) { log('русификации нет — убирать нечего'); cleanup(); process.exit(0); }
    // Хирургически: нативные файлы (main/menu/tray/updater) берём из бэкапа оригинала, из utils.js вырезаем блок перевода.
    // Всё остальное (в том числе загрузчик темы, если он есть) остаётся как есть.
    checkBackupVersion();
    const ub = asar.extractFile(BACKUP, 'dist/utils.js').toString('utf8');
    if (ub.includes(MARK_V5) || ub.includes(MARK_V4)) die('резервная копия сама русифицирована — безопасно убрать русификацию отдельно нельзя. Используйте --restore.');
    log('убираю русификацию, остальное не трогаю');
    asar.extractAll(ASAR, tmp);
    for (const rel of NATIVE_FILES) {
      let b = null;
      try { b = asar.extractFile(BACKUP, rel); } catch (_) {}
      if (b) fs.writeFileSync(path.join(tmp, rel.split('/').join(path.sep)), b);
    }
    fs.writeFileSync(path.join(tmp, 'dist', 'utils.js'), stripOldBlocks(u0), 'utf8');
    const dirsU = unpackGlobs();
    const optsU = { unpack: '**/*.node' };
    if (dirsU.length === 1) optsU.unpackDir = dirsU[0];
    else if (dirsU.length > 1) optsU.unpackDir = '{' + dirsU.join(',') + '}';
    await asar.createPackageWithOptions(tmp, tmpOut, optsU);
    fs.copyFileSync(tmpOut, OUT);
    if (OUT === ASAR) removeDictionaries();
    log('русификация убрана');
    cleanup();
    process.exit(0);
  }
  log('распаковываю', ASAR);
  asar.extractAll(ASAR, tmp);

  const utilsPath = path.join(tmp, 'dist', 'utils.js');
  if (!fs.existsSync(utilsPath)) die('в asar нет dist/utils.js — структура изменилась');
  let utils = fs.readFileSync(utilsPath, 'utf8');

  const wasPatched = utils.includes(MARK_V5) || utils.includes(MARK_V4);
  if (utils.includes(MARK_V5) && !has('--force')) {
    log('уже русифицировано (v5). --force для перепатча. Выхожу.'); cleanup(); process.exit(0);
  }

  // Бэкап: если сейчас asar чистый (не русифицирован) — всегда освежаем бэкап (после обновления Antigravity старый бэкап устаревает).
  if (OUT === ASAR && (!fs.existsSync(BACKUP) || !wasPatched)) {
    const same = fs.existsSync(BACKUP) && fs.statSync(BACKUP).size === fs.statSync(ASAR).size && sha256(BACKUP) === sha256(ASAR);
    if (!same) {
      fs.copyFileSync(ASAR, BACKUP);
      if (fs.statSync(BACKUP).size !== fs.statSync(ASAR).size) die('бэкап скопирован не полностью: ' + BACKUP);
      log('бэкап оригинала обновлён ->', path.basename(BACKUP));
    }
  }

  // Снимаем прежние блоки перевода (v4 и v5), чтобы не накапливались.
  utils = stripOldBlocks(utils);

  let raw = fs.readFileSync(DICT, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const dict = JSON.parse(raw);
  // Для статичной замены в main.js/menu.js/tray.js берём ТОЛЬКО исходные ключи словаря (иначе новые короткие слова
  // вроде "Model" или "Source" могут испортить идентификаторы основного процесса). Остальное переводит рантайм-переводчик.
  let staticDict = dict;
  if (fs.existsSync(STATIC_KEYS)) {
    try {
      const keys = JSON.parse(fs.readFileSync(STATIC_KEYS, 'utf8').replace(/^\uFEFF/, ''));
      staticDict = {};
      for (const k of keys) if (typeof dict[k] === 'string') staticDict[k] = dict[k];
      log('статичная замена: ' + Object.keys(staticDict).length + ' исходных ключей из ' + Object.keys(dict).length);
    } catch (e) { log('dictionary.static_keys.json не прочитан, использую весь словарь:', e.message); staticDict = dict; }
  } else log('нет dictionary.static_keys.json — статичная замена по всему словарю');

  const inject = fs.readFileSync(INJECT, 'utf8');
  let anchorIdx = utils.indexOf('void win.loadURL(url);');
  if (anchorIdx < 0) anchorIdx = utils.search(/\n[ \t]*(?:void )?win\.loadURL\(/);
  if (anchorIdx < 0) die('не нашёл точку внедрения (win.loadURL) в utils.js');
  const lineStart = utils.lastIndexOf('\n', anchorIdx) + 1;
  utils = utils.slice(0, lineStart) + inject + '\n' + utils.slice(lineStart);
  fs.writeFileSync(utilsPath, utils, 'utf8');
  log('движок перевода внедрён в dist/utils.js');

  let total = 0;
  for (const rel of NATIVE_FILES) {
    const p = path.join(tmp, rel.split('/').join(path.sep));
    if (!fs.existsSync(p)) continue;
    const r = replaceLiterals(fs.readFileSync(p, 'utf8'), staticDict);
    if (r.count > 0) { fs.writeFileSync(p, r.out, 'utf8'); total += r.count; log(`  ${rel}: заменено ${r.count}`); }
  }
  log('статичных замен всего:', total);

  const dirs = unpackGlobs();
  const opts = { unpack: '**/*.node' };
  if (dirs.length === 1) opts.unpackDir = dirs[0];
  else if (dirs.length > 1) opts.unpackDir = '{' + dirs.join(',') + '}';
  log('переупаковка; unpackDir =', opts.unpackDir || '(нет)');
  await asar.createPackageWithOptions(tmp, tmpOut, opts);

  fs.copyFileSync(tmpOut, OUT);
  const dictDst = path.join(path.dirname(OUT), 'dictionary.ru.json');
  fs.copyFileSync(DICT, dictDst);
  const patDst = path.join(path.dirname(OUT), 'dictionary.patterns.ru.json');
  if (fs.existsSync(PATTERNS)) { JSON.parse(fs.readFileSync(PATTERNS, 'utf8').replace(/^\uFEFF/, '')); fs.copyFileSync(PATTERNS, patDst); log('шаблоны ->', patDst); }
  else log('ВНИМАНИЕ: нет dictionary.patterns.ru.json — динамические строки (Ran…, Thought for…) переводиться не будут');
  log('ГОТОВО. app.asar ->', OUT);
  log('словарь ->', dictDst);
  if (OUT === ASAR) log('Перезапусти Antigravity. Откат: node russify_antigravity.js --restore');
  cleanup();
})().catch((e) => { console.error('[RU][СБОЙ]', e && e.message ? e.message : e); cleanup(); process.exit(1); });
