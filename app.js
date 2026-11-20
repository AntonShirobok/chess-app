'use strict';
const tg = window.Telegram && window.Telegram.WebApp;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const $ = (s) => document.querySelector(s);
const screen = $('#screen');
const strip = (s) => s.replace(/[+#!?]/g, '');
const fenOf = (f) => (f === 'start' ? START_FEN : f);
let token = 0;           // меняется при каждом переходе — отменяет «старые» асинхронные действия
let backFn = null;

/* ---------- Хранилище прогресса ---------- */
const Store = {
  key: 'chess_profile_v1',
  data: null,
  defaults() {
    return { rating: 400, games: 0, w: 0, l: 0, d: 0, lessons: {}, mode: 'auto', manual: 0, hist: [400], updated: 0, game: null, pid: '', online: [] };
  },
  load() {
    try { this.data = Object.assign(this.defaults(), JSON.parse(localStorage.getItem(this.key) || '{}')); }
    catch (e) { this.data = this.defaults(); }
    this.pullCloud();
  },
  save() {
    this.data.updated = Date.now();
    try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
    this.pushCloud();
    updateChip();
  },
  cloudOk() { return tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9'); },
  pushCloud() {
    if (!this.cloudOk()) return;
    const { game, ...rest } = this.data;           // текущую партию храним только на устройстве
    try { tg.CloudStorage.setItem('profile', JSON.stringify(rest)); } catch (e) {}
  },
  pullCloud() {
    if (!this.cloudOk()) return;
    try {
      tg.CloudStorage.getItem('profile', (err, val) => {
        if (err || !val) return;
        const remote = JSON.parse(val);
        if ((remote.updated || 0) > (this.data.updated || 0)) {
          this.data = Object.assign(this.defaults(), remote, { game: this.data.game });
          try { localStorage.setItem(this.key, JSON.stringify(this.data)); } catch (e) {}
          updateChip();
          if (currentTab === 'learn' && !backFn) renderLearn();
        }
      });
    } catch (e) {}
  }
};

/* ---------- Общие помощники ---------- */
function haptic(kind) {
  const h = tg && tg.HapticFeedback;
  if (!h) return;
  try {
    if (kind === 'select') h.selectionChanged();
    else if (kind === 'good') h.notificationOccurred('success');
    else if (kind === 'bad') h.notificationOccurred('error');
    else h.impactOccurred('light');
  } catch (e) {}
}
function showModal(html) { $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden'); }
function hideModal() { $('#modal').classList.add('hidden'); }
function confirmBox(text) {
  return new Promise((res) => {
    showModal(`<h2>${text}</h2><div class="btn-row"><button class="btn sec" id="cNo">Нет</button><button class="btn" id="cYes">Да</button></div>`);
    $('#cNo').onclick = () => { hideModal(); res(false); };
    $('#cYes').onclick = () => { hideModal(); res(true); };
  });
}
function updateChip() { $('#ratingChip').textContent = '★ ' + Store.data.rating; }
function setHeader(title, back) {
  $('#title').textContent = title;
  backFn = back || null;
  const inTg = tg && tg.platform && tg.platform !== 'unknown';
  $('#backBtn').classList.toggle('hidden', !back || inTg);
  if (tg && tg.BackButton) { try { back ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) {} }
}
function newScreen(html) { token++; hideModal(); screen.innerHTML = html; screen.scrollTop = 0; return token; }

/* ---------- Вкладки ---------- */
let currentTab = 'learn';
function openTab(tab) {
  currentTab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'learn') renderLearn();
  if (tab === 'play') (playMode === 'friends' ? renderFriends() : renderPlay());
  if (tab === 'legends') renderLegends();
}

/* =================== ОБУЧЕНИЕ =================== */
function renderLearn() {
  setHeader('Учимся с нуля');
  const done = LESSONS.filter(l => Store.data.lessons[l.id]).length;
  const next = LESSONS.findIndex(l => !Store.data.lessons[l.id]);
  newScreen(`
    <div class="card">
      <div><b>Пройдено ${done} из ${LESSONS.length} уроков</b></div>
      <div class="progress"><div style="width:${done / LESSONS.length * 100}%"></div></div>
      ${next >= 0 ? `<button class="btn" id="contBtn" style="width:100%">${done ? 'Продолжить' : 'Начать с первого урока'} →</button>`
        : '<div class="muted">Курс пройден! Играй с компьютером, чтобы расти дальше 💪</div>'}
    </div>
    <div id="lessonList"></div>`);
  if (next >= 0) $('#contBtn').onclick = () => openLesson(next);
  $('#lessonList').innerHTML = LESSONS.map((l, i) => `
    <button class="list-item" data-i="${i}">
      <span class="ic">${l.icon}</span>
      <span class="grow"><div class="t">${i + 1}. ${l.title}</div><div class="s">${l.steps.length} шагов</div></span>
      ${Store.data.lessons[l.id] ? '<span class="done">✓</span>' : ''}
    </button>`).join('');
  document.querySelectorAll('#lessonList .list-item').forEach(b => b.onclick = () => openLesson(+b.dataset.i));
}

function openLesson(li, si = 0) {
  const L = LESSONS[li];
  setHeader(L.title, renderLearn);
  const my = newScreen(`
    <div class="progress"><div id="lprog"></div></div>
    <div class="card lesson-text" id="ltext"></div>
    <div id="bwrap"></div>
    <div class="feedback" id="fb"></div>
    <div class="btn-row" id="lbtns"></div>`);
  const board = new Board($('#bwrap'));
  const st = L.steps[si];
  const isLast = si === L.steps.length - 1;
  $('#lprog').style.width = ((si + 1) / L.steps.length * 100) + '%';
  $('#ltext').innerHTML = st.text;
  const fb = (t, cls) => { const e = $('#fb'); e.textContent = t; e.className = 'feedback ' + (cls || ''); };
  const alive = () => my === token;

  const goNext = () => {
    if (!isLast) return openLesson(li, si + 1);
    Store.data.lessons[L.id] = true; Store.save(); haptic('good');
    const hasNext = li + 1 < LESSONS.length;
    showModal(`<div class="big">🎉</div><h2>Урок пройден!</h2><p class="muted">«${L.title}»</p>
      <div class="btn-row">${hasNext ? '<button class="btn" id="mNext">Следующий урок</button>' : '<button class="btn" id="mPlay">Играть!</button>'}</div>
      <div class="btn-row"><button class="btn sec" id="mList">К списку уроков</button></div>`);
    if (hasNext) $('#mNext').onclick = () => openLesson(li + 1);
    else $('#mPlay').onclick = () => openTab('play');
    $('#mList').onclick = renderLearn;
  };

  // Кнопки
  const btns = [];
  if (si > 0) btns.push('<button class="btn sec" id="bPrev">← Назад</button>');
  if (['puzzle', 'play'].includes(st.type)) btns.push('<button class="btn sec" id="bHint">💡 Совет</button>');
  if (st.type === 'play' || st.type === 'stars') btns.push('<button class="btn sec" id="bRetry">↻ Заново</button>');
  btns.push(`<button class="btn" id="bNext" ${st.type === 'text' ? '' : 'disabled'}>${isLast ? 'Завершить' : 'Дальше →'}</button>`);
  $('#lbtns').innerHTML = btns.join('');
  if (si > 0) $('#bPrev').onclick = () => openLesson(li, si - 1);
  $('#bNext').onclick = goNext;
  if ($('#bRetry')) $('#bRetry').onclick = () => openLesson(li, si);
  const solved = (msg) => {
    fb(msg || 'Отлично! ✅', 'good'); haptic('good');
    $('#bNext').disabled = false;
  };

  if (st.type === 'text') {
    board.hl.marks = st.squares || [];
    board.setFen(fenOf(st.fen));
  }

  if (st.type === 'square') {
    board.setFen(fenOf(st.fen));
    let ok = false;
    board.onSquare = (sq) => {
      if (ok) return;
      if (sq === st.answer) {
        ok = true; board.hl.good = sq; board.render(); solved('Верно! ✅');
        setTimeout(() => { if (alive()) goNext(); }, 800);
      } else {
        board.flash('wrong', sq); haptic('bad');
        fb(`Это поле ${sq}. Найди ${st.answer}.`, 'bad');
      }
    };
  }

  if (st.type === 'stars') runStars(board, st, fb, solved);
  if (st.type === 'puzzle') runPuzzle(board, st, fb, solved, alive);
  if (st.type === 'play') runPlayStep(board, st, fb, solved, alive);
}

// Собери звёздочки: простая механика ходов одной фигурой
function starTargets(type, from, enemies) {
  const f = FILES.indexOf(from[0]), r = +from[1];
  const out = [];
  const inside = (x, y) => x >= 0 && x < 8 && y >= 1 && y <= 8;
  const name = (x, y) => FILES[x] + y;
  const dirs = { R: [[1,0],[-1,0],[0,1],[0,-1]], B: [[1,1],[1,-1],[-1,1],[-1,-1]] };
  dirs.Q = dirs.R.concat(dirs.B); dirs.K = dirs.Q;
  if (type === 'N') {
    for (const [dx, dy] of [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]])
      if (inside(f + dx, r + dy)) out.push(name(f + dx, r + dy));
  } else if (type === 'P') {
    if (inside(f, r + 1) && !enemies.has(name(f, r + 1))) {
      out.push(name(f, r + 1));
      if (r === 2 && !enemies.has(name(f, 4))) out.push(name(f, 4));
    }
    for (const dx of [-1, 1]) if (inside(f + dx, r + 1) && enemies.has(name(f + dx, r + 1))) out.push(name(f + dx, r + 1));
  } else {
    for (const [dx, dy] of dirs[type]) {
      let x = f + dx, y = r + dy;
      while (inside(x, y)) {
        out.push(name(x, y));
        if (enemies.has(name(x, y)) || type === 'K') break;
        x += dx; y += dy;
      }
    }
  }
  return out;
}
function runStars(board, st, fb, solved) {
  let pos = st.from, moves = 0, sel = false, done = false;
  const stars = new Set(st.stars || []), enemies = new Set(st.enemies || []);
  const draw = () => {
    board.pieces = { [pos]: 'w' + st.piece };
    enemies.forEach(s => board.pieces[s] = 'bP');
    board.stars = stars;
    board.hl.selected = sel ? pos : null;
    board.hl.targets = sel ? starTargets(st.piece, pos, enemies).map(s => ({ sq: s, cap: enemies.has(s) })) : [];
    board.render();
  };
  fb('Нажми на фигуру, затем на клетку, куда пойти.');
  board.onSquare = (sq) => {
    if (done) return;
    if (sq === pos) { sel = !sel; draw(); return; }
    if (!sel) { sel = true; draw(); }
    const t = starTargets(st.piece, pos, enemies);
    if (!t.includes(sq)) { board.flash('wrong', sq, 400); fb('Так эта фигура не ходит.', 'bad'); return; }
    board.hl.last = [pos, sq];
    pos = sq; moves++;
    stars.delete(sq); enemies.delete(sq);
    sel = true; haptic('select');
    if (!stars.size && !enemies.size) { done = true; sel = false; draw(); solved(`Отлично! Готово за ${moves} ${plural(moves, 'ход', 'хода', 'ходов')} ✅`); return; }
    fb(`Ходов: ${moves}. Осталось: ${stars.size + enemies.size}`);
    draw();
  };
  draw();
}
function plural(n, a, b, c) { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c; }

function runPuzzle(board, st, fb, solved, alive) {
  const ch = new Chess(fenOf(st.fen));
  const color = ch.turn();
  board.flipped = color === 'b';
  let idx = 0, busy = false, done = false;
  syncBoard(board, ch);
  fb(color === 'w' ? 'Ход белых. Нажми на фигуру.' : 'Ход чёрных. Нажми на фигуру.');
  const expected = () => { const e = st.solution[idx]; return Array.isArray(e) ? e : [e]; };
  attachMover(board, {
    chess: () => ch, color: () => color, canMove: () => !busy && !done,
    onMove: async (mv) => {
      const m = ch.move(mv);
      if (!m) return;
      let ok;
      if (st.goal === 'mate') ok = ch.in_checkmate();
      else if (st.goal === 'check') ok = ch.in_check();
      else if (st.goal === 'avoid') ok = !st.avoid.includes(strip(m.san));
      else ok = expected().map(strip).includes(strip(m.san));
      board.hl.hint = null;
      syncBoard(board, ch, m);
      if (!ok) {
        busy = true; haptic('bad');
        let msg = 'Не то. Попробуй ещё раз!';
        if (st.goal === 'mate' && ch.in_stalemate()) msg = 'Это пат — ничья! Нужен мат.';
        else if (st.goal === 'mate' && ch.in_check()) msg = 'Шах есть, но король может спастись. Ищи мат!';
        else if (st.hint) msg = st.hint;
        fb(msg, 'bad');
        board.flash('wrong', m.to, 800);
        setTimeout(() => { if (!alive()) return; ch.undo(); board.hl.last = null; syncBoard(board, ch); busy = false; }, 850);
        return;
      }
      idx++;
      if (st.goal || idx >= st.solution.length) { done = true; solved(ch.in_checkmate() ? 'Мат! Великолепно! ✅' : 'Отлично! ✅'); return; }
      if (st.solution[idx] === '*') {
        busy = true; fb('Верно! Соперник отвечает…', 'good');
        const r = await AI.defend(ch.fen());
        if (!alive()) return;
        const om = ch.move(r);
        syncBoard(board, ch, om);
        idx++; busy = false;
        fb('А теперь добивай!');
        if (idx >= st.solution.length) { done = true; solved(); }
      } else fb('Верно! Продолжай.', 'good');
    }
  });
  $('#bHint').onclick = () => {
    let mv;
    const all = ch.moves({ verbose: true });
    if (st.goal === 'mate') mv = all.find(m => m.san.includes('#'));
    else if (st.goal === 'check') mv = all.find(m => m.san.includes('+'));
    else if (st.goal === 'avoid') { fb(st.hint || 'Подумай, что защищает эту фигуру.'); return; }
    else mv = all.find(m => expected().map(strip).includes(strip(m.san)));
    if (!mv) return;
    // Сначала показываем фигуру, со второго раза — и клетку
    board.hl.hint = board.hl.hint && board.hl.hint[0] === mv.from ? [mv.from, mv.to] : [mv.from];
    fb(board.hl.hint.length === 1 ? 'Ходить нужно этой фигурой.' : 'Вот сюда!');
    board.render();
  };
}

function runPlayStep(board, st, fb, solved, alive) {
  const ch = new Chess(fenOf(st.fen));
  const color = ch.turn();
  let busy = false, done = false;
  syncBoard(board, ch);
  fb('Твой ход.');
  const checkEnd = () => {
    if (ch.in_checkmate()) {
      done = true;
      if (ch.turn() !== color) solved(`Мат! Ты справился за ${Math.ceil(ch.history().length / 2)} ходов 🏆`);
      else fb('Тебе поставили мат… Жми «Заново».', 'bad');
      return true;
    }
    if (ch.in_draw() || ch.in_stalemate()) {
      done = true; haptic('bad');
      fb(ch.in_stalemate() ? 'Пат — ничья! Оставляй королю хотя бы одно поле. Жми «Заново».' : 'Ничья — фигура потеряна или позиция повторилась. Жми «Заново».', 'bad');
      return true;
    }
    return false;
  };
  attachMover(board, {
    chess: () => ch, color: () => color, canMove: () => !busy && !done && ch.turn() === color,
    onMove: async (mv) => {
      const m = ch.move(mv);
      if (!m) return;
      board.hl.hint = null;
      syncBoard(board, ch, m);
      if (checkEnd()) return;
      busy = true; fb('Компьютер думает…');
      const r = await AI.defend(ch.fen());
      if (!alive()) return;
      await new Promise(res => setTimeout(res, 300));
      const om = ch.move(r);
      syncBoard(board, ch, om);
      busy = false;
      if (!checkEnd()) fb(ch.in_check() ? 'Шах тебе!' : 'Твой ход.');
    }
  });
  $('#bHint').onclick = async () => {
    if (busy || done) return;
    fb('Думаю над подсказкой…');
    const mv = await AI.hint(ch.fen());
    if (!alive() || !mv) return;
    board.hl.hint = [mv.from, mv.to]; board.render();
    fb('Попробуй этот ход.');
  };
}

/* =================== ИГРА С КОМПЬЮТЕРОМ =================== */
let G = null;   // текущая партия { ch, color, level, hints, takebacks, fens, thinking }

function currentLevel() {
  const p = Store.data;
  return p.mode === 'auto' ? levelForRating(p.rating) : p.manual;
}
function restoreGame() {
  const s = Store.data.game;
  if (!s) return null;
  const ch = new Chess();
  if (!ch.load_pgn(s.pgn || '')) return null;
  const fens = [], tmp = new Chess();
  fens.push(tmp.fen());
  for (const san of ch.history()) { tmp.move(san); fens.push(tmp.fen()); }
  return { ch, color: s.color, level: s.level, hints: s.hints || 0, takebacks: s.takebacks || 0, fens, thinking: false };
}
function saveGame() {
  Store.data.game = G ? { pgn: G.ch.pgn(), color: G.color, level: G.level, hints: G.hints, takebacks: G.takebacks } : null;
  Store.save();
}

function renderPlay() {
  playMode = 'bot';
  setHeader('Игра с компьютером');
  if (!G) G = restoreGame();
  const p = Store.data;
  const lvl = G ? G.level : currentLevel();
  const L = LEVELS[lvl];
  const lessonsDone = Object.keys(p.lessons).length;
  const my = newScreen(`
    ${modeSegHtml('bot')}
    ${lessonsDone < 3 && !G ? '<div class="card">Совсем новичок? Сначала загляни во вкладку <b>🎓 Учиться</b> — там все правила с нуля.</div>' : ''}
    <div class="opp"><span>🤖 <b>${L.name}</b> <span class="muted">· уровень ${lvl + 1} · ≈${L.elo}</span></span>
      <span class="muted" id="youColor"></span></div>
    <div id="bwrap"></div>
    <div class="status" id="status"></div>
    <div id="controls"></div>
    <div class="moves" id="moves"></div>
    <h3>Твой прогресс</h3>
    <div class="stats">
      <div><b>${p.rating}</b><span>рейтинг</span></div>
      <div><b>${p.w}</b><span>побед</span></div>
      <div><b>${p.d}</b><span>ничьих</span></div>
      <div><b>${p.l}</b><span>поражений</span></div>
    </div>
    <div id="spark"></div>
    <h3>Сила компьютера</h3>
    <div class="seg" id="modeSeg">
      <button data-m="auto" class="${p.mode === 'auto' ? 'on' : ''}">🌱 Авто</button>
      <button data-m="manual" class="${p.mode === 'manual' ? 'on' : ''}">🎚 Вручную</button>
    </div>
    <div class="section-hint" id="modeHint"></div>
    <div class="lvl ${p.mode === 'manual' ? '' : 'hidden'}" id="lvlBox">
      <input type="range" min="0" max="${LEVELS.length - 1}" value="${p.manual}" id="lvlRange">
      <span id="lvlLabel"></span>
    </div>`);
  bindModeSeg();
  const board = new Board($('#bwrap'));
  const alive = () => my === token;
  drawSpark();

  // Режим силы
  const modeHint = () => {
    $('#modeHint').textContent = p.mode === 'auto'
      ? 'Компьютер подбирает силу под твой рейтинг: выигрываешь — он становится сильнее, проигрываешь — чуть слабее.'
      : 'Сила будет применена со следующей партии. Рейтинг всё равно считается.';
  };
  modeHint();
  const lvlLabel = () => { const l = LEVELS[+$('#lvlRange').value]; $('#lvlLabel').textContent = `${+$('#lvlRange').value + 1}. ${l.name} (≈${l.elo})`; };
  lvlLabel();
  document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => {
    p.mode = b.dataset.m; Store.save();
    document.querySelectorAll('#modeSeg button').forEach(x => x.classList.toggle('on', x === b));
    $('#lvlBox').classList.toggle('hidden', p.mode !== 'manual');
    modeHint();
  });
  $('#lvlRange').oninput = lvlLabel;
  $('#lvlRange').onchange = () => { p.manual = +$('#lvlRange').value; Store.save(); };

  if (!G) {
    board.setFen(START_FEN);
    $('#status').textContent = 'Выбери цвет и начинай';
    $('#controls').innerHTML = `
      <div class="seg" id="colorSeg">
        <button data-c="w" class="on">⚪ Белыми</button><button data-c="r">🎲 Случайно</button><button data-c="b">⚫ Чёрными</button>
      </div>
      <div class="btn-row"><button class="btn" id="startBtn">Начать партию</button></div>`;
    let pick = 'w';
    document.querySelectorAll('#colorSeg button').forEach(b => b.onclick = () => {
      pick = b.dataset.c;
      document.querySelectorAll('#colorSeg button').forEach(x => x.classList.toggle('on', x === b));
    });
    $('#startBtn').onclick = () => {
      const color = pick === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : pick;
      const ch = new Chess();
      G = { ch, color, level: currentLevel(), hints: 0, takebacks: 0, fens: [ch.fen()], thinking: false };
      saveGame();
      renderPlay();
    };
    return;
  }

  // Партия идёт
  const g = G;
  board.flipped = g.color === 'b';
  $('#youColor').textContent = g.color === 'w' ? 'ты: белые' : 'ты: чёрные';
  $('#controls').innerHTML = `<div class="btn-row">
    <button class="btn sec" id="hintBtn">💡 Совет</button>
    <button class="btn sec" id="undoBtn">↶ Назад</button>
    <button class="btn sec" id="resignBtn">🏳 Сдаться</button></div>`;
  const last = () => { const h = g.ch.history({ verbose: true }); return h[h.length - 1]; };
  const refresh = () => {
    syncBoard(board, g.ch, last());
    const h = g.ch.history();
    $('#moves').innerHTML = h.map((s, i) => (i % 2 === 0 ? `<b>${i / 2 + 1}.</b> ` : '') + `<span class="${i === h.length - 1 ? 'cur' : ''}">${s}</span>`).join(' ');
    $('#moves').scrollTop = 1e6;
    let s = g.thinking ? '🤖 Компьютер думает…' : 'Твой ход';
    if (!g.thinking && g.ch.in_check()) s = '⚠️ Шах! Спасай короля';
    $('#status').textContent = s;
  };
  const finish = () => {
    const ch = g.ch;
    if (!ch.game_over()) return false;
    let S, title, why;
    if (ch.in_checkmate()) {
      const userWon = ch.turn() !== g.color;
      S = userWon ? 1 : 0; title = userWon ? 'Победа! 🏆' : 'Поражение';
      why = userWon ? 'Ты поставил мат!' : 'Тебе поставили мат.';
    } else {
      S = 0.5; title = 'Ничья 🤝';
      why = ch.in_stalemate() ? 'Пат.' : ch.in_threefold_repetition() ? 'Позиция повторилась три раза.' : ch.insufficient_material() ? 'Нечем ставить мат.' : 'Правило 50 ходов.';
    }
    endGame(S, title, why);
    return true;
  };
  const endGame = (S, title, why) => {
    const before = currentLevel();
    const delta = applyResult(S, g.level, g.hints + g.takebacks > 0);
    G = null; saveGame();
    const after = currentLevel();
    let lvlMsg = '';
    if (Store.data.mode === 'auto' && after > before) lvlMsg = `<p>📈 Компьютер стал сильнее: <b>${LEVELS[after].name}</b> (уровень ${after + 1})</p>`;
    if (Store.data.mode === 'auto' && after < before) lvlMsg = `<p>Компьютер немного сбавит силу: <b>${LEVELS[after].name}</b></p>`;
    haptic(S === 1 ? 'good' : S === 0 ? 'bad' : 'tap');
    showModal(`<div class="big">${S === 1 ? '🏆' : S === 0 ? '😔' : '🤝'}</div><h2>${title}</h2><p class="muted">${why}</p>
      <p>Рейтинг: <b>${Store.data.rating}</b> (${delta >= 0 ? '+' : ''}${delta})</p>${lvlMsg}
      ${g.hints + g.takebacks > 0 ? '<p class="muted" style="font-size:13px">С подсказками и возвратами рейтинг меняется вдвое меньше.</p>' : ''}
      <div class="btn-row"><button class="btn" id="againBtn">Новая партия</button></div>`);
    $('#againBtn').onclick = () => { hideModal(); renderPlay(); };
  };
  const engineTurn = async () => {
    if (g.ch.game_over() || g.ch.turn() === g.color || g.thinking) return;
    g.thinking = true; refresh();
    const mv = await AI.move(g.ch.fen(), g.level, g.fens, g.ch.history().length);
    g.thinking = false;
    if (G !== g) return;
    if (mv) { g.ch.move(mv); g.fens.push(g.ch.fen()); saveGame(); }
    if (!alive()) return;
    board.hl.hint = null;
    refresh();
    finish();
  };
  attachMover(board, {
    chess: () => g.ch, color: () => g.color, canMove: () => !g.thinking && !g.ch.game_over() && g.ch.turn() === g.color,
    onMove: (mv) => {
      const m = g.ch.move(mv);
      if (!m) return;
      g.fens.push(g.ch.fen());
      board.hl.hint = null;
      saveGame(); refresh();
      if (!finish()) engineTurn();
    }
  });
  $('#hintBtn').onclick = async () => {
    if (g.thinking || g.ch.turn() !== g.color) return;
    $('#status').textContent = '💡 Ищу хороший ход…';
    const mv = await AI.hint(g.ch.fen(), g.fens);
    if (!alive() || G !== g || !mv) return;
    g.hints++; saveGame();
    board.hl.hint = [mv.from, mv.to]; refresh();
    $('#status').textContent = '💡 Попробуй ход, подсвеченный зелёным';
  };
  $('#undoBtn').onclick = () => {
    if (g.thinking) return;
    const h = g.ch.history();
    if (h.length < (g.color === 'w' ? 1 : 2)) return;
    g.ch.undo(); g.fens.pop();
    if (g.ch.turn() !== g.color) { g.ch.undo(); g.fens.pop(); }
    g.takebacks++; board.hl.hint = null; saveGame(); refresh();
  };
  $('#resignBtn').onclick = async () => {
    if (await confirmBox('Сдаться?')) endGame(0, 'Поражение', 'Ты сдался. В следующий раз получится!');
  };
  refresh();
  engineTurn();
}

function applyResult(S, lvl, assisted) {
  const p = Store.data;
  const E = 1 / (1 + Math.pow(10, (LEVELS[lvl].elo - p.rating) / 400));
  let K = p.games < 10 ? 60 : 32;
  if (assisted) K /= 2;
  const delta = Math.round(K * (S - E));
  p.rating = Math.max(100, p.rating + delta);
  p.games++;
  if (S === 1) p.w++; else if (S === 0) p.l++; else p.d++;
  p.hist.push(p.rating);
  if (p.hist.length > 40) p.hist = p.hist.slice(-40);
  Store.save();
  return delta;
}

function drawSpark() {
  const h = Store.data.hist;
  if (h.length < 3) return;
  const w = 300, ht = 50, min = Math.min(...h) - 10, max = Math.max(...h) + 10;
  const pts = h.map((v, i) => `${(i / (h.length - 1) * w).toFixed(1)},${(ht - (v - min) / (max - min) * ht).toFixed(1)}`).join(' ');
  $('#spark').innerHTML = `<div class="card"><div class="muted" style="font-size:13px">Рейтинг за последние ${h.length - 1} партий</div>
    <svg viewBox="0 0 ${w} ${ht}" width="100%" height="50" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg></div>`;
}

/* =================== ЛЕГЕНДАРНЫЕ ПАРТИИ =================== */
const DIFF = ['', 'Для новичка', 'Средне', 'Для опытных'];
function renderLegends() {
  setHeader('Легендарные партии');
  newScreen(`<div class="section-hint">Лучшие партии чемпионов мира и великих мастеров. Смотри с комментариями или попробуй <b>угадать ходы</b> победителя.</div>
    <div id="glist"></div>`);
  $('#glist').innerHTML = GAMES.map((g, i) => `
    <button class="list-item" data-i="${i}">
      <span class="ic">${g.result === '0-1' ? '♚' : '♔'}</span>
      <span class="grow"><div class="t">${g.title}</div>
        <div class="s">${g.white} — ${g.black}, ${g.year}</div>
        <div class="s">${DIFF[g.level]}${Store.data['g_' + g.id] ? ' · угадано ' + Store.data['g_' + g.id] + '%' : ''}</div></span>
    </button>`).join('');
  document.querySelectorAll('#glist .list-item').forEach(b => b.onclick = () => openGame(+b.dataset.i));
}

function openGame(gi) {
  const g = GAMES[gi];
  setHeader(g.title, renderLegends);
  const my = newScreen(`
    <div class="card"><div><b>⚪ ${g.white}</b> — <b>⚫ ${g.black}</b></div>
      <div class="muted" style="font-size:13px">${g.place}, ${g.year} · ${g.result}</div>
      <div style="margin-top:6px">${g.about}</div></div>
    <div class="seg" id="vmode"><button data-m="watch" class="on">👀 Смотреть</button><button data-m="guess">🎯 Угадай ход</button></div>
    <div style="height:10px"></div>
    <div id="bwrap"></div>
    <div class="status" id="status"></div>
    <div class="card note hidden" id="note"></div>
    <div class="btn-row" id="nav">
      <button class="btn sec" id="nFirst">⏮</button><button class="btn sec" id="nPrev">◀</button>
      <button class="btn" id="nPlay">▶ Авто</button>
      <button class="btn sec" id="nNext">▶</button><button class="btn sec" id="nLast">⏭</button>
    </div>
    <div class="moves" id="moves" style="max-height:110px"></div>`);
  const alive = () => my === token;
  const board = new Board($('#bwrap'));
  // Подготовка: все позиции партии
  const sans = g.pgn.replace(/\d+\./g, ' ').trim().split(/\s+/);
  const tmp = new Chess();
  const fens = [tmp.fen()], mv = [null];
  for (const s of sans) { mv.push(tmp.move(s, { sloppy: true })); fens.push(tmp.fen()); }
  const n = sans.length;
  let ply = 0, timer = null, mode = 'watch';
  const guess = { color: g.result === '0-1' ? 'b' : 'w', right: 0, total: 0, busy: false };
  let ch = new Chess();

  const noteKey = (i) => `${Math.ceil(i / 2)}${i % 2 === 1 ? 'w' : 'b'}`;
  const show = () => {
    ch = new Chess(fens[ply]);
    board.hl.last = mv[ply] ? [mv[ply].from, mv[ply].to] : null;
    board.hl.hint = null;
    syncBoard(board, ch);
    const nt = ply > 0 && g.notes[noteKey(ply)];
    $('#note').classList.toggle('hidden', !nt);
    if (nt) $('#note').innerHTML = `<b>${Math.ceil(ply / 2)}.${ply % 2 === 0 ? '..' : ''} ${mv[ply].san}</b> — ${nt}`;
    $('#moves').innerHTML = mv.slice(1).map((m, i) => (i % 2 === 0 ? `<b>${i / 2 + 1}.</b> ` : '') +
      `<span data-p="${i + 1}" class="${i + 1 === ply ? 'cur' : ''}" style="cursor:pointer">${m.san}${g.notes[noteKey(i + 1)] ? '💬' : ''}</span>`).join(' ');
    document.querySelectorAll('#moves span').forEach(s => s.onclick = () => { if (mode === 'watch') { stop(); ply = +s.dataset.p; show(); } });
    const cur = document.querySelector('#moves .cur');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
    if (mode === 'watch') $('#status').textContent = ply === n ? `Конец партии: ${g.result}` : `Ход ${Math.ceil((ply + 1) / 2)} из ${Math.ceil(n / 2)}`;
  };
  const stop = () => { if (timer) clearInterval(timer); timer = null; $('#nPlay').textContent = '▶ Авто'; };
  const step = (d) => { ply = Math.max(0, Math.min(n, ply + d)); show(); };
  $('#nFirst').onclick = () => { stop(); ply = 0; show(); };
  $('#nPrev').onclick = () => { stop(); step(-1); };
  $('#nNext').onclick = () => { stop(); step(1); };
  $('#nLast').onclick = () => { stop(); ply = n; show(); };
  $('#nPlay').onclick = () => {
    if (timer) return stop();
    if (ply === n) ply = 0;
    $('#nPlay').textContent = '⏸ Пауза';
    timer = setInterval(() => {
      if (!alive()) return clearInterval(timer);
      step(1);
      if (ply === n) stop();
      else if (g.notes[noteKey(ply)]) { stop(); }   // остановиться на комментарии
    }, 1300);
  };

  // Режим «Угадай ход»
  const guessStatus = (extra) => {
    $('#status').innerHTML = (extra ? extra + '<br>' : '') +
      `<span class="muted">Ты играешь за ${guess.color === 'w' ? 'белых' : 'чёрных'} · угадано ${guess.right} из ${guess.total}</span>`;
  };
  const autoOpp = () => {
    // ходы соперника играются сами
    if (ply < n && (ply % 2 === 0 ? 'w' : 'b') !== guess.color) {
      guess.busy = true;
      setTimeout(() => { if (!alive() || mode !== 'guess') return; ply++; show(); guess.busy = false; afterPly(); }, 700);
    } else afterPly();
  };
  const afterPly = () => {
    if (ply >= n) {
      const pct = guess.total ? Math.round(guess.right / guess.total * 100) : 0;
      Store.data['g_' + g.id] = Math.max(pct, Store.data['g_' + g.id] || 0); Store.save();
      guessStatus(`🏁 Партия окончена! Ты угадал <b>${pct}%</b> ходов чемпиона.`);
      return;
    }
    if ((ply % 2 === 0 ? 'w' : 'b') === guess.color) guessStatus('Твой ход: как сыграл бы чемпион?');
    else autoOpp();
  };
  attachMover(board, {
    chess: () => ch, color: () => guess.color,
    canMove: () => mode === 'guess' && !guess.busy && ply < n && (ply % 2 === 0 ? 'w' : 'b') === guess.color,
    onMove: (m) => {
      const real = mv[ply + 1];
      guess.total++;
      const ok = m.from === real.from && m.to === real.to && (!real.promotion || m.promotion === real.promotion);
      guess.busy = true;
      if (ok) {
        guess.right++; haptic('good');
        ply++; show(); board.hl.good = real.to; board.render();
        guessStatus(`✅ Точно как у чемпиона: <b>${real.san}</b>`);
      } else {
        haptic('bad');
        const tried = ch.move(m);
        syncBoard(board, ch); board.hl.wrong = m.to; board.render();
        guessStatus(`Ты сыграл ${tried ? tried.san : '?'}, а чемпион — <b>${real.san}</b>`);
        setTimeout(() => { if (!alive()) return; board.hl.wrong = null; ply++; show(); }, 900);
      }
      setTimeout(() => { if (!alive() || mode !== 'guess') return; board.hl.good = null; guess.busy = false; autoOpp(); }, ok ? 1000 : 2200);
    }
  });

  document.querySelectorAll('#vmode button').forEach(b => b.onclick = () => {
    stop();
    mode = b.dataset.m;
    document.querySelectorAll('#vmode button').forEach(x => x.classList.toggle('on', x === b));
    $('#nav').classList.toggle('hidden', mode === 'guess');
    if (mode === 'guess') {
      guess.right = 0; guess.total = 0; guess.busy = false;
      board.flipped = guess.color === 'b';
      ply = 0; show(); autoOpp();
    } else { board.flipped = false; show(); }
  });
  show();
}

/* ---------- Запуск ---------- */
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => openTab(b.dataset.tab));
$('#backBtn').onclick = () => backFn && backFn();
$('#modal').onclick = (e) => { if (e.target.id === 'modal' && !document.querySelector('.promo')) hideModal(); };
if (tg) {
  try { tg.ready(); tg.expand(); } catch (e) {}
  try { tg.BackButton.onClick(() => backFn && backFn()); } catch (e) {}
  if (tg.colorScheme) document.documentElement.dataset.theme = tg.colorScheme;
}
Store.load();
updateChip();
if (!handleStartParam()) openTab(Store.data.game ? 'play' : 'learn');
