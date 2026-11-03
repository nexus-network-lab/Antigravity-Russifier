// NEXUS — Русификатор Antigravity (exe-обёртка). Внутри: движок V5, словари, Node.js.
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const { say, ok, warn, bad, info, head, paint } = L;

const ENGINE = path.join(__dirname, 'russify_antigravity.js');
const BASE = path.join(__dirname, 'base');
const hide = (l) => /Откат:|Перезапусти|^\[RU\]\s*$/.test(l);

function describe(inst) {
  const s = L.inspectAsar(inst.asar);
  return { ...s, text: s.ru === 'RU_V5' ? 'русификация УСТАНОВЛЕНА (V5)' : s.ru === 'RU_V4' ? 'старая русификация (V4) — нужно обновить' : 'русификации нет (английский)' };
}
function showInstall(inst, s) {
  say();
  say('  Antigravity ' + paint('1;37', s.version) + paint(90, '   (' + inst.src + ')'));
  info('Папка:   ' + inst.dir);
  info('Состояние: ' + s.text + '; тема NEXUS: ' + (s.theme ? 'установлена' : 'нет'));
  if (L.isRunning()) warn('Antigravity сейчас запущена — для установки/удаления её придётся закрыть.');
}

function verifyDicts(res) {
  for (const n of ['dictionary.ru.json', 'dictionary.patterns.ru.json']) {
    const f = path.join(res, n);
    if (!fs.existsSync(f)) return 'нет файла ' + n + ' рядом с app.asar';
    try { JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return n + ' повреждён: ' + e.message; }
  }
  return null;
}

function apply(inst) {
  head('Установка русификации');
  if (!L.waitUntilClosed()) return false;
  const before = L.inspectAsar(inst.asar);
  info(`app.asar до: версия ${before.version}, ${before.files} файлов, русификация ${before.ru}, тема ${before.theme ? 'ЕСТЬ' : 'нет'}`);
  if (!fs.existsSync(inst.asar + '.unpacked')) { bad('нет папки app.asar.unpacked рядом с app.asar — установка Antigravity повреждена. Ничего не изменено.'); return false; }
  let bak;
  try { bak = L.backupAsar(inst.asar, before.version); } catch (e) { bad('не удалось сделать резервную копию: ' + e.message + ' Ничего не изменено.'); return false; }
  ok('резервная копия app.asar проверена (SHA-256): ' + bak);
  const args = ['--asar', inst.asar, '--base', BASE];
  if (before.ru !== 'NONE') args.push('--force');
  const r = L.runNode(ENGINE, args, true, hide);
  const fail = (why) => {
    bad(why);
    const back = L.rollback(inst.asar, bak);
    (back ? ok : bad)(back ? 'app.asar возвращён из резервной копии — Antigravity в прежнем состоянии.' : 'НЕ УДАЛОСЬ вернуть app.asar! Резервная копия: ' + bak);
    return false;
  };
  if (r.code !== 0) return fail('движок завершился с ошибкой (код ' + r.code + ').');
  let after;
  try { after = L.inspectAsar(inst.asar); } catch (e) { return fail('после патча app.asar не читается: ' + e.message); }
  if (after.ru !== 'RU_V5') return fail('после патча русификация не обнаружена.');
  if (after.version !== before.version) return fail('версия приложения внутри архива изменилась — странно.');
  if (after.files !== before.files) return fail(`число файлов в архиве изменилось (${before.files} -> ${after.files}).`);
  if (before.theme && !after.theme) return fail('тема NEXUS пропала при русификации.');
  const dErr = verifyDicts(inst.res);
  if (dErr) return fail(dErr);
  say();
  ok(paint('1;32', 'ГОТОВО: русификация установлена') + `; тема NEXUS: ${after.theme ? 'сохранена' : 'не установлена'}.`);
  info('Запустите Antigravity — интерфейс будет на русском.');
  return true;
}

function remove(inst) {
  head('Удаление русификации');
  const s = L.inspectAsar(inst.asar);
  if (s.ru === 'NONE') { ok('Русификации и так нет — менять нечего.'); return true; }
  if (!L.waitUntilClosed()) return false;
  let bak;
  try { bak = L.backupAsar(inst.asar, s.version); } catch (e) { bad('не удалось сделать резервную копию: ' + e.message); return false; }
  ok('резервная копия текущего app.asar: ' + bak);
  const r = L.runNode(ENGINE, ['--asar', inst.asar, '--unpatch'], true, hide);
  const fail = (why) => {
    bad(why);
    const back = L.rollback(inst.asar, bak);
    (back ? ok : bad)(back ? 'app.asar возвращён как был.' : 'НЕ УДАЛОСЬ вернуть app.asar! Копия: ' + bak);
    return false;
  };
  if (r.code !== 0) return fail('не получилось убрать русификацию (код ' + r.code + ').');
  const a = L.inspectAsar(inst.asar);
  if (a.ru !== 'NONE') return fail('русификация осталась в архиве.');
  if (s.theme && !a.theme) return fail('тема NEXUS пропала при удалении русификации.');
  if (a.files !== s.files) return fail('число файлов в архиве изменилось.');
  say();
  ok(paint('1;32', 'ГОТОВО: русификация убрана') + `; тема NEXUS: ${a.theme ? 'сохранена' : 'нет'}.`);
  info('Запустите Antigravity — интерфейс снова на английском.');
  return true;
}

(async () => {
  L.banner('NEXUS - Русификатор Antigravity', 'движок V5 · словарь ' + (() => { try { return Object.keys(JSON.parse(fs.readFileSync(path.join(BASE, 'dictionary.ru.json'), 'utf8').replace(/^\uFEFF/, ''))).length; } catch (_) { return '?'; } })() + ' строк');
  const installs = L.findInstalls();
  if (!installs.length) {
    bad('Не нашёл установленную Antigravity (app.asar).');
    info('Искал: %LOCALAPPDATA%\\Programs\\antigravity, Program Files, реестр, запущенные процессы.');
    info('Если она стоит в другом месте: запустите exe с параметром  --dir "C:\\путь\\к\\папке\\Antigravity"');
    await L.pause();
    process.exit(1);
  }
  const states = installs.map((i) => describe(i));
  installs.forEach((i, k) => showInstall(i, states[k]));

  let action = L.flag('--apply') ? '1' : L.flag('--remove') ? '2' : L.flag('--status') ? '0' : null;
  if (L.flag('--status')) { await L.pause(); process.exit(0); }
  if (!action) {
    say();
    say('  Что сделать?');
    say('    ' + paint('1;32', '1') + ' - установить / обновить русификацию');
    say('    ' + paint('1;33', '2') + ' - убрать русификацию (вернуть английский; тема останется)');
    say('    ' + paint('90', '0') + ' - выход');
    action = await L.ask('\n  Ваш выбор [1]: ');
    if (action === '') action = '1';
  }
  let allOk = true;
  if (action === '1') for (const i of installs) allOk = apply(i) && allOk;
  else if (action === '2') for (const i of installs) allOk = remove(i) && allOk;
  else { say('  Выход, ничего не изменено.'); }
  await L.pause();
  process.exit(allOk ? 0 : 1);
})().catch(async (e) => { bad('Непредвиденная ошибка: ' + (e && e.stack || e)); await L.pause(); process.exit(1); });
