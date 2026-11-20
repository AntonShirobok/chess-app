'use strict';
// Игра с друзьями через сервер на Google Apps Script.

let playMode = 'bot';   // 'bot' | 'friends'

const Online = {
  cfg() { return window.CHESS_CONFIG || {}; },
  enabled() { return !!this.cfg().API_URL; },
  pid() {
    if (!Store.data.pid) {
      const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      const arr = new Uint32Array(20);
      crypto.getRandomValues(arr);
      Store.data.pid = Array.from(arr, n => abc[n % abc.length]).join('');
      Store.save();
    }
    return Store.data.pid;
  },
  name() {
    const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
    return (u && (u.first_name || u.username)) || 'Игрок';
  },
  async call(a, params = {}) {
    const q = new URLSearchParams(Object.assign({ a, pid: this.pid() }, params));
    const r = await fetch(this.cfg().API_URL + '?' + q.toString(), { redirect: 'follow' });
    return r.json();
  },
  inviteLink(id) {
    const c = this.cfg();
    if (!c.BOT_USERNAME) return null;
    return c.APP_NAME ? `https://t.me/${c.BOT_USERNAME}/${c.APP_NAME}?startapp=g_${id}` : `https://t.me/${c.BOT_USERNAME}?startapp=g_${id}`;
  },
  share(id) {
    const link = this.inviteLink(id);
    const text = `Сыграем в шахматы? ♟ Жми на ссылку. Если не откроется — в приложении «Игра» → «С другом» введи код ${id}`;
    const url = 'https://t.me/share/url?url=' + encodeURIComponent(link || ' ') + '&text=' + encodeURIComponent(text);
    try { if (tg && tg.openTelegramLink && tg.platform !== 'unknown') { tg.openTelegramLink(url); return; } } catch (e) {}
    window.open(url, '_blank');
  },
  remember(st) {
    const list = Store.data.online || (Store.data.online = []);
    const opp = st.you === 'w' ? st.black : st.white;
    const item = { id: st.id, you: st.you, opp: opp || '', status: st.status, result: st.result || '', t: Date.now() };
    const i = list.findIndex(x => x.id === st.id);
    if (i >= 0) {
      const old = list[i];
      if (old.status === item.status && old.opp === item.opp && old.result === item.result) return;
      list.splice(i, 1);
    }
    list.unshift(item);
    Store.data.online = list.slice(0, 15);
    Store.save();
  }
};

function modeSegHtml(active) {
  return `<div class="seg" id="playSeg" style="margin-bottom:10px">
    <button data-p="bot" class="${active === 'bot' ? 'on' : ''}">🤖 Компьютер</button>
    <button data-p="friends" class="${active === 'friends' ? 'on' : ''}">👥 С другом</button></div>`;
}
function bindModeSeg() {
  document.querySelectorAll('#playSeg button').forEach(b => b.onclick = () => {
    playMode = b.dataset.p;
    playMode === 'friends' ? renderFriends() : renderPlay();
  });
}

function resultText(st) {
  if (st.status === 'waiting') return 'Ждём друга';
  if (st.status === 'active') return st.v % 2 === (st.you === 'w' ? 0 : 1) ? '🟢 Твой ход' : 'Ход соперника';
  if (st.reason === 'cancel') return 'Отменена';
  if (st.result === '1/2-1/2') return '🤝 Ничья';
  const won = (st.result === '1-0' && st.you === 'w') || (st.result === '0-1' && st.you === 'b');
  return won ? '🏆 Победа' : 'Поражение';
}

/* ---------- Экран «С другом» ---------- */
function renderFriends() {
  playMode = 'friends';
  setHeader('Игра с другом');
  const my = newScreen(`${modeSegHtml('friends')}<div id="fr"></div>`);
  bindModeSeg();
  if (!Online.enabled()) {
    $('#fr').innerHTML = `<div class="card">Игра с друзьями ещё не включена. Нужно один раз настроить сервер — инструкция в файле <b>ИНСТРУКЦИЯ.md</b>, раздел «Игра с друзьями».</div>`;
    return;
  }
  const list = Store.data.online || [];
  $('#fr').innerHTML = `
    <div class="card">
      <div><b>Позвать друга</b></div>
      <div class="section-hint">Создай партию и отправь приглашение в любой чат Telegram.</div>
      <div class="seg" id="fColor"><button data-c="w" class="on">⚪ Белыми</button><button data-c="r">🎲 Случайно</button><button data-c="b">⚫ Чёрными</button></div>
      <div class="btn-row"><button class="btn" id="fCreate">📨 Создать партию и позвать</button></div>
    </div>
    <div class="card">
      <div><b>Есть код от друга?</b></div>
      <div class="btn-row"><input id="fCode" class="code-input" maxlength="6" placeholder="Например, K7QM2X" autocapitalize="characters">
        <button class="btn" id="fJoin" style="flex:0 0 auto">Войти</button></div>
      <div class="feedback bad" id="fErr"></div>
    </div>
    ${list.length ? '<h3>Мои партии с друзьями</h3>' : ''}
    <div id="fList"></div>`;
  let color = 'w';
  document.querySelectorAll('#fColor button').forEach(b => b.onclick = () => {
    color = b.dataset.c;
    document.querySelectorAll('#fColor button').forEach(x => x.classList.toggle('on', x === b));
  });
  $('#fCreate').onclick = async () => {
    $('#fCreate').disabled = true; $('#fCreate').textContent = 'Создаю…';
    try {
      const st = await Online.call('create', { name: Online.name(), color });
      if (!st.ok) throw new Error(st.error);
      Online.remember(st);
      openOnline(st.id, st);
    } catch (e) {
      $('#fCreate').disabled = false; $('#fCreate').textContent = '📨 Создать партию и позвать';
      $('#fErr').textContent = 'Не удалось связаться с сервером. Проверь интернет и попробуй ещё раз.';
    }
  };
  $('#fJoin').onclick = () => {
    const code = $('#fCode').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { $('#fErr').textContent = 'Введи код из приглашения.'; return; }
    joinOnline(code, (msg) => { if (my === token) $('#fErr').textContent = msg; });
  };
  const drawList = () => {
    $('#fList').innerHTML = (Store.data.online || []).map(g => `
      <button class="list-item" data-id="${g.id}">
        <span class="ic">${g.you === 'w' ? '♔' : '♚'}</span>
        <span class="grow"><div class="t">${g.opp ? 'против ' + escapeHtml(g.opp) : 'Ждём друга'}</div>
          <div class="s">Код ${g.id} · ${g.status === 'active' ? 'Идёт партия' : resultText(g)}</div></span>
      </button>`).join('');
    document.querySelectorAll('#fList .list-item').forEach(b => b.onclick = () => openOnline(b.dataset.id));
  };
  drawList();
  // Обновить статусы идущих партий
  (Store.data.online || []).filter(g => g.status !== 'over').slice(0, 5).forEach(async (g) => {
    try {
      const st = await Online.call('state', { id: g.id });
      if (st.ok) Online.remember(st);
      if (my === token && st.ok) {
        drawList();
        const el = document.querySelector(`#fList [data-id="${g.id}"] .s`);
        if (el) el.textContent = `Код ${g.id} · ${resultText(st)}`;
      }
    } catch (e) {}
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function joinOnline(id, onErr) {
  try {
    const st = await Online.call('join', { id, name: Online.name() });
    if (!st.ok) {
      const msg = st.error === 'not found' ? 'Партия с таким кодом не найдена.' : st.error === 'full' ? 'В этой партии уже играют двое.' : 'Ошибка: ' + st.error;
      onErr && onErr(msg);
      return;
    }
    Online.remember(st);
    openOnline(st.id, st);
  } catch (e) { onErr && onErr('Не удалось связаться с сервером. Проверь интернет.'); }
}

/* ---------- Партия с другом ---------- */
function openOnline(id, first) {
  playMode = 'friends';
  setHeader('Партия с другом', renderFriends);
  const my = newScreen(`
    <div class="opp"><span id="oppName">…</span><span class="muted" id="youSide"></span></div>
    <div id="inviteBox"></div>
    <div id="drawBox"></div>
    <div id="bwrap"></div>
    <div class="status" id="status">Загружаю…</div>
    <div class="btn-row" id="oBtns">
      <button class="btn sec" id="oDraw">🤝 Ничья</button>
      <button class="btn sec" id="oResign">🏳 Сдаться</button>
    </div>
    <div class="moves" id="moves"></div>
    <div class="section-hint" style="margin-top:12px">Код партии: <b>${id}</b>. Партия сохраняется — можно закрыть приложение и вернуться позже.</div>`);
  const alive = () => my === token;
  const board = new Board($('#bwrap'));
  const ch = new Chess();
  let st = null, sending = false, shownEnd = false, timer = null, fails = 0;

  const myTurn = () => st && st.status === 'active' && st.you === ch.turn() && !sending;
  const refresh = () => {
    const h = ch.history({ verbose: true });
    syncBoard(board, ch, h[h.length - 1]);
    const sans = ch.history();
    $('#moves').innerHTML = sans.map((s, i) => (i % 2 === 0 ? `<b>${i / 2 + 1}.</b> ` : '') + `<span class="${i === sans.length - 1 ? 'cur' : ''}">${s}</span>`).join(' ');
    $('#moves').scrollTop = 1e6;
    if (!st) return;
    const opp = st.you === 'w' ? st.black : st.white;
    $('#oppName').innerHTML = `👤 <b>${opp ? escapeHtml(opp) : 'Ждём друга…'}</b>`;
    $('#youSide').textContent = st.you === 'w' ? 'ты: белые' : st.you === 'b' ? 'ты: чёрные' : 'зритель';
    let s;
    if (st.status === 'waiting') s = 'Отправь приглашение другу';
    else if (st.status === 'over') s = endText();
    else if (sending) s = 'Отправляю ход…';
    else if (myTurn()) s = ch.in_check() ? '⚠️ Шах! Твой ход' : '🟢 Твой ход';
    else s = '⏳ Ход соперника…';
    $('#status').textContent = s;
    $('#oBtns').classList.toggle('hidden', st.status !== 'active');
    // Приглашение
    if (st.status === 'waiting') {
      if (!$('#inviteShare')) {
        $('#inviteBox').innerHTML = `<div class="card" style="text-align:center">
          <div class="muted">Код для друга</div><div class="code-big">${st.id}</div>
          <div class="btn-row"><button class="btn" id="inviteShare">📨 Отправить приглашение</button></div>
          <div class="btn-row"><button class="btn sec" id="inviteCancel">Отменить партию</button></div></div>`;
        $('#inviteShare').onclick = () => Online.share(st.id);
        $('#inviteCancel').onclick = async () => {
          if (!(await confirmBox('Отменить партию?'))) return;
          const r = await Online.call('cancel', { id }).catch(() => null);
          if (r && r.ok) Online.remember(r);
          renderFriends();
        };
      }
    } else $('#inviteBox').innerHTML = '';
    // Предложение ничьей
    if (st.status === 'active' && st.draw && st.draw !== st.you) {
      if (!$('#drawYes')) {
        $('#drawBox').innerHTML = `<div class="card" style="text-align:center"><b>Соперник предлагает ничью</b>
          <div class="btn-row"><button class="btn sec" id="drawNo">Отказаться</button><button class="btn" id="drawYes">Принять</button></div></div>`;
        $('#drawYes').onclick = () => act('draw', {});
        $('#drawNo').onclick = () => act('draw', { answer: 'no' });
      }
    } else if (st.status === 'active' && st.draw === st.you) {
      $('#drawBox').innerHTML = '<div class="card muted" style="text-align:center">Ты предложил ничью. Ждём ответа…</div>';
    } else $('#drawBox').innerHTML = '';
  };
  const reasonText = () => ({ resign: 'Партия закончилась сдачей', agreement: 'Ничья по согласию', checkmate: 'Мат', stalemate: 'Пат', repetition: 'Позиция повторилась три раза', material: 'Нечем ставить мат', fifty: 'Правило 50 ходов' }[st.reason] || '');
  const endText = () => st.reason === 'cancel' ? 'Партия отменена' : `${resultText(st)} · ${reasonText()}`;
  const showEndModal = () => {
    if (shownEnd || st.status !== 'over' || st.reason === 'cancel') return;
    shownEnd = true;
    const txt = resultText(st);
    haptic(txt.includes('Победа') ? 'good' : 'tap');
    showModal(`<div class="big">${txt.split(' ')[0]}</div><h2>${txt.replace(/^\S+\s/, '')}</h2><p class="muted">${reasonText()}</p>
      <div class="btn-row"><button class="btn" id="oAgain">Ещё партию</button></div>
      <div class="btn-row"><button class="btn sec" id="oClose">Посмотреть доску</button></div>`);
    $('#oAgain').onclick = () => { hideModal(); renderFriends(); };
    $('#oClose').onclick = hideModal;
  };

  // Применить состояние с сервера
  const apply = (s) => {
    if (!s || !s.ok) return;
    const before = ch.history().length;
    if (s.moves.length < before || s.moves.slice(0, before).some((m, i) => m !== ch.history()[i])) {
      ch.reset();          // расхождение — переигрываем с нуля
    }
    for (let i = ch.history().length; i < s.moves.length; i++) {
      if (!ch.move(s.moves[i], { sloppy: true })) break;
    }
    if (ch.history().length > before && st && st.status === 'active' && ch.turn() === s.you) haptic('tap');
    st = s;
    Online.remember(s);
    board.flipped = s.you === 'b';
    refresh();
    showEndModal();
  };

  const poll = async () => {
    if (!alive()) return;
    try {
      if (!sending) { apply(await Online.call('state', { id })); fails = 0; }
    } catch (e) {
      fails++;
      if (fails >= 3 && alive()) $('#status').textContent = '📡 Нет связи с сервером, пробую снова…';
    }
    if (!alive() || (st && st.status === 'over')) return;
    timer = setTimeout(poll, st && myTurn() ? 5000 : 2000);
  };

  const act = async (a, params) => {
    try { const r = await Online.call(a, Object.assign({ id }, params)); if (alive()) apply(r.state || r); } catch (e) {}
  };

  attachMover(board, {
    chess: () => ch, color: () => st && st.you, canMove: myTurn,
    onMove: async (mv) => {
      const v = ch.history().length;
      const m = ch.move(mv);
      if (!m) return;
      const params = { id, san: m.san, v };
      if (ch.game_over()) {
        if (ch.in_checkmate()) { params.end = 'checkmate'; params.result = ch.turn() === 'w' ? '0-1' : '1-0'; }
        else {
          params.result = '1/2-1/2';
          params.end = ch.in_stalemate() ? 'stalemate' : ch.in_threefold_repetition() ? 'repetition' : ch.insufficient_material() ? 'material' : 'fifty';
        }
      }
      sending = true; refresh();
      try {
        const r = await Online.call('move', params);
        sending = false;
        if (!alive()) return;
        if (!r.ok && r.state) { ch.reset(); apply(r.state); $('#status').textContent = 'Позиция обновлена с сервера'; }
        else apply(r);
      } catch (e) {
        sending = false;
        if (!alive()) return;
        ch.undo(); refresh();
        $('#status').textContent = '📡 Ход не отправился — проверь интернет и сходи ещё раз';
      }
    }
  });
  $('#oResign').onclick = async () => { if (await confirmBox('Сдаться?')) act('resign', {}); };
  $('#oDraw').onclick = async () => { if (await confirmBox('Предложить ничью?')) act('draw', {}); };

  board.setFen(ch.fen());
  if (first) apply(first);
  poll();
  return () => clearTimeout(timer);
}

// Открыть партию из ссылки-приглашения (startapp=g_XXXXXX)
function handleStartParam() {
  const sp = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
  if (!sp || !/^g_[A-Z0-9]{4,8}$/i.test(sp) || !Online.enabled()) return false;
  currentTab = 'play';
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === 'play'));
  renderFriends();
  joinOnline(sp.slice(2).toUpperCase(), (msg) => { const e = $('#fErr'); if (e) e.textContent = msg; });
  return true;
}
