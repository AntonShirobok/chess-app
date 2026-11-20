// Отрисовка доски и общие помощники для ходов.
const FILES = 'abcdefgh';

class Board {
  constructor(container) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'board-wrap';
    this.el = document.createElement('div');
    this.el.className = 'board';
    this.wrap.appendChild(this.el);
    container.appendChild(this.wrap);
    this.flipped = false;
    this.pieces = {};        // { e4: 'wP' }
    this.hl = {};            // selected, targets[], last[], check, marks[], hint[], good, wrong
    this.stars = new Set();
    this.onSquare = null;
    this.el.addEventListener('click', (e) => {
      const sq = e.target.closest('.sq');
      if (sq && this.onSquare) this.onSquare(sq.dataset.sq);
    });
  }
  setFen(fen) {
    this.pieces = {};
    const rows = fen.split(' ')[0].split('/');
    rows.forEach((row, i) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { f += +ch; continue; }
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        this.pieces[FILES[f] + (8 - i)] = color + ch.toUpperCase();
        f++;
      }
    });
    this.render();
  }
  render() {
    const h = this.hl, out = [];
    const targets = new Map((h.targets || []).map(t => [t.sq, t.cap]));
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const r = this.flipped ? i + 1 : 8 - i;
        const f = this.flipped ? 7 - j : j;
        const sq = FILES[f] + r;
        const light = (f + r) % 2 === 0;  // a1 (f=0, r=1) — тёмное поле
        const cls = ['sq', light ? 'l' : 'd'];
        if (h.last && h.last.includes(sq)) cls.push('last');
        if (h.marks && h.marks.includes(sq)) cls.push('mark');
        if (h.hint && h.hint.includes(sq)) cls.push('hint');
        if (h.selected === sq) cls.push('sel');
        if (h.check === sq) cls.push('check');
        if (h.good === sq) cls.push('good');
        if (h.wrong === sq) cls.push('wrong');
        let inner = '';
        if (j === 0) inner += `<span class="coord r">${r}</span>`;
        if (i === 7) inner += `<span class="coord f">${FILES[f]}</span>`;
        const p = this.pieces[sq];
        if (p) inner += `<img src="pieces/${p}.svg" alt="">`;
        if (this.stars.has(sq)) inner += '<span class="star">⭐</span>';
        if (targets.has(sq)) inner += targets.get(sq) ? '<span class="ring"></span>' : '<span class="dot"></span>';
        out.push(`<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`);
      }
    }
    this.el.innerHTML = out.join('');
  }
  flash(kind, sq, ms = 600) {
    this.hl[kind] = sq; this.render();
    setTimeout(() => { if (this.hl[kind] === sq) { this.hl[kind] = null; this.render(); } }, ms);
  }
}

// Найти клетку короля под шахом.
function checkSquare(chess) {
  if (!chess.in_check()) return null;
  const turn = chess.turn();
  const b = chess.board();
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const p = b[i][j];
    if (p && p.type === 'k' && p.color === turn) return FILES[j] + (8 - i);
  }
  return null;
}

// Синхронизировать доску с объектом chess.js
function syncBoard(board, chess, lastMove) {
  board.hl.last = lastMove ? [lastMove.from, lastMove.to] : board.hl.last;
  board.hl.check = checkSquare(chess);
  board.setFen(chess.fen());
}

// Выбор фигуры при превращении пешки
function askPromotion(color) {
  return new Promise((resolve) => {
    const pcs = ['q', 'r', 'b', 'n'];
    showModal(`<h2>Во что превратить пешку?</h2><div class="promo">${pcs.map(p =>
      `<button data-p="${p}"><img src="pieces/${color}${p.toUpperCase()}.svg" alt=""></button>`).join('')}</div>`);
    document.querySelectorAll('.promo button').forEach(b => b.onclick = () => { hideModal(); resolve(b.dataset.p); });
  });
}

// Ход мышкой/пальцем: тап по фигуре, тап по клетке.
function attachMover(board, o) {
  let sel = null;
  const clear = () => { sel = null; board.hl.selected = null; board.hl.targets = []; };
  board.onSquare = async (sq) => {
    if (!o.canMove()) return;
    const ch = o.chess();
    if (sel) {
      const ms = ch.moves({ square: sel, verbose: true }).filter(m => m.to === sq);
      if (ms.length) {
        const from = sel;
        clear(); board.render();
        let promotion;
        if (ms[0].flags.includes('p')) promotion = await askPromotion(ch.turn());
        o.onMove({ from, to: sq, promotion });
        return;
      }
    }
    const p = ch.get(sq);
    if (p && p.color === ch.turn() && p.color === o.color() && sel !== sq) {
      sel = sq;
      board.hl.selected = sq;
      board.hl.targets = ch.moves({ square: sq, verbose: true }).map(m => ({ sq: m.to, cap: !!m.captured }));
      haptic('select');
    } else clear();
    board.render();
  };
  return { clear };
}
