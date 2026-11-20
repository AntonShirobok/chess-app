/**
 * Шахматы с нуля — сервер для игры с друзьями (Google Apps Script).
 * Вставляется в новую Google-таблицу: «Расширения → Apps Script».
 * Партии хранятся в листе «Партии», свежие — ещё и в быстром кэше.
 * Настраивать ничего не нужно.
 */

var SHEET = 'Партии';
var HEAD = ['id', 'создана', 'обновлена', 'статус', 'white_pid', 'белые', 'black_pid', 'чёрные', 'ходы', 'результат', 'причина', 'ничья'];
var CACHE_SEC = 21600; // 6 часов

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    return json_(handle_(p));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function handle_(p) {
  var a = p.a, pid = String(p.pid || '');
  if (a === 'ping') return { ok: true };
  if (!/^[A-Za-z0-9]{12,40}$/.test(pid)) return { ok: false, error: 'bad pid' };
  if (a === 'create') return withLock_(function () { return create_(pid, name_(p.name), p.color); });
  var id = String(p.id || '').toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(id)) return { ok: false, error: 'bad id' };
  if (a === 'state') { var g = load_(id); return g ? view_(g, pid) : { ok: false, error: 'not found' }; }
  return withLock_(function () {
    var g = load_(id);
    if (!g) return { ok: false, error: 'not found' };
    var you = seat_(g, pid);
    if (a === 'join') {
      if (!you) {
        if (g.status !== 'waiting') return { ok: false, error: 'full' };
        if (!g.wp) { g.wp = pid; g.wn = name_(p.name); } else { g.bp = pid; g.bn = name_(p.name); }
        g.status = 'active';
        save_(g);
      }
      return view_(g, pid);
    }
    if (!you) return { ok: false, error: 'not a player' };
    if (a === 'move') {
      if (g.status !== 'active') return { ok: false, error: 'not active', state: view_(g, pid) };
      var turn = g.moves.length % 2 === 0 ? 'w' : 'b';
      if (turn !== you || Number(p.v) !== g.moves.length) return { ok: false, error: 'out of sync', state: view_(g, pid) };
      var san = String(p.san || '');
      if (!/^[A-Za-z0-9=+#\-]{2,8}$/.test(san)) return { ok: false, error: 'bad move' };
      g.moves.push(san);
      g.draw = '';
      if (p.end) { g.status = 'over'; g.result = String(p.result || ''); g.reason = String(p.end); }
      save_(g);
      return view_(g, pid);
    }
    if (a === 'resign') {
      if (g.status === 'active') {
        g.status = 'over'; g.result = you === 'w' ? '0-1' : '1-0'; g.reason = 'resign';
        save_(g);
      }
      return view_(g, pid);
    }
    if (a === 'cancel') {
      if (g.status === 'waiting') { g.status = 'over'; g.reason = 'cancel'; save_(g); }
      return view_(g, pid);
    }
    if (a === 'draw') {
      if (g.status !== 'active') return view_(g, pid);
      if (p.answer === 'no') { if (g.draw && g.draw !== you) g.draw = ''; }
      else if (g.draw && g.draw !== you) { g.status = 'over'; g.result = '1/2-1/2'; g.reason = 'agreement'; g.draw = ''; }
      else g.draw = you;
      save_(g);
      return view_(g, pid);
    }
    return { ok: false, error: 'unknown action' };
  });
}

function create_(pid, name, color) {
  if (color !== 'w' && color !== 'b') color = Math.random() < 0.5 ? 'w' : 'b';
  var id;
  do { id = newId_(); } while (load_(id));
  var g = { id: id, created: Date.now(), status: 'waiting', wp: '', wn: '', bp: '', bn: '', moves: [], result: '', reason: '', draw: '' };
  if (color === 'w') { g.wp = pid; g.wn = name; } else { g.bp = pid; g.bn = name; }
  save_(g);
  return view_(g, pid);
}

function view_(g, pid) {
  return {
    ok: true, id: g.id, status: g.status, you: seat_(g, pid),
    white: g.wn || '', black: g.bn || '', moves: g.moves,
    result: g.result, reason: g.reason, draw: g.draw, v: g.moves.length
  };
}

function seat_(g, pid) { return g.wp === pid ? 'w' : g.bp === pid ? 'b' : null; }
function name_(n) { return String(n || 'Игрок').replace(/[<>]/g, '').slice(0, 32) || 'Игрок'; }
function newId_() {
  var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 6; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return s;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- Хранение ----------
function sheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
  }
  return sh;
}

function load_(id) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('g_' + id);
  if (hit) return JSON.parse(hit);
  var sh = sheet_();
  var cell = sh.getRange('A:A').createTextFinder(id).matchEntireCell(true).findNext();
  if (!cell) return null;
  var r = sh.getRange(cell.getRow(), 1, 1, HEAD.length).getValues()[0];
  var g = {
    id: String(r[0]), created: Number(r[1]) || 0, status: String(r[3]),
    wp: String(r[4]), wn: String(r[5]), bp: String(r[6]), bn: String(r[7]),
    moves: String(r[8]).split(' ').filter(String), result: String(r[9]), reason: String(r[10]), draw: String(r[11]),
    row: cell.getRow()
  };
  cache.put('g_' + id, JSON.stringify(g), CACHE_SEC);
  return g;
}

function save_(g) {
  var sh = sheet_();
  var row = [g.id, g.created, Date.now(), g.status, g.wp, g.wn, g.bp, g.bn, g.moves.join(' '), g.result, g.reason, g.draw];
  if (!g.row) {
    var cell = sh.getRange('A:A').createTextFinder(g.id).matchEntireCell(true).findNext();
    g.row = cell ? cell.getRow() : sh.getLastRow() + 1;
  }
  sh.getRange(g.row, 1, 1, row.length).setNumberFormat('@').setValues([row.map(String)]);
  CacheService.getScriptCache().put('g_' + g.id, JSON.stringify(g), CACHE_SEC);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Запусти один раз вручную (▶ Выполнить), чтобы выдать доступ и создать лист.
function setup() {
  sheet_();
  Logger.log('Готово! Лист «' + SHEET + '» на месте. Теперь сделай развертывание веб-приложения.');
}
