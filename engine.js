// Шахматный движок (Web Worker). Доска 0x88, альфа-бета + форсированные варианты.
// Сила регулируется глубиной, «шумом» в оценке и вероятностью зевка.
'use strict';
const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
const VAL = [0, 100, 320, 330, 500, 900, 0];
const MATE = 100000, INF = 1000000;

const PST = {
  1: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
  2: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
  3: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
  4: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
  5: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  6: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  7: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50]
};

const DN = [33, 31, 18, 14, -33, -31, -18, -14];
const DB = [15, 17, -15, -17];
const DR = [16, -16, 1, -1];
const DK = [15, 16, 17, 1, -1, -15, -16, -17];

let board = new Int8Array(128), side = 1, castle = 0, ep = -1;
let kingSq = { 1: 4, '-1': 116 };
const CMASK = new Uint8Array(128).fill(15);
CMASK[0] = 13; CMASK[7] = 14; CMASK[4] = 12; CMASK[112] = 7; CMASK[119] = 11; CMASK[116] = 3;

function sqName(s) { return 'abcdefgh'[s & 7] + ((s >> 4) + 1); }
function sqIdx(n) { return (n.charCodeAt(1) - 49) * 16 + (n.charCodeAt(0) - 97); }

function loadFen(fen) {
  board.fill(0);
  const [pos, stm, cas, e] = fen.split(' ');
  let r = 7, f = 0;
  for (const ch of pos) {
    if (ch === '/') { r--; f = 0; continue; }
    if (ch >= '1' && ch <= '8') { f += +ch; continue; }
    const t = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1;
    const c = ch === ch.toUpperCase() ? 1 : -1;
    const s = r * 16 + f;
    board[s] = t * c;
    if (t === K) kingSq[c] = s;
    f++;
  }
  side = stm === 'w' ? 1 : -1;
  castle = 0;
  if (cas.includes('K')) castle |= 1;
  if (cas.includes('Q')) castle |= 2;
  if (cas.includes('k')) castle |= 4;
  if (cas.includes('q')) castle |= 8;
  ep = e && e !== '-' ? sqIdx(e) : -1;
}

function posKey() {
  let s = '';
  for (let i = 0; i < 128; i++) if (!(i & 0x88)) s += String.fromCharCode(board[i] + 70);
  return s + side;
}

function attacked(sq, by) {
  // пешки
  const pd = by === 1 ? -16 : 16;
  for (const d of [pd - 1, pd + 1]) {
    const s = sq + d;
    if (!(s & 0x88) && board[s] === P * by) return true;
  }
  for (const d of DN) { const s = sq + d; if (!(s & 0x88) && board[s] === N * by) return true; }
  for (const d of DK) { const s = sq + d; if (!(s & 0x88) && board[s] === K * by) return true; }
  for (const d of DB) {
    let s = sq + d;
    while (!(s & 0x88)) {
      const p = board[s];
      if (p) { if (p === B * by || p === Q * by) return true; break; }
      s += d;
    }
  }
  for (const d of DR) {
    let s = sq + d;
    while (!(s & 0x88)) {
      const p = board[s];
      if (p) { if (p === R * by || p === Q * by) return true; break; }
      s += d;
    }
  }
  return false;
}

function gen(capsOnly) {
  const ms = [], us = side;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const p = board[s];
    if (!p || Math.sign(p) !== us) continue;
    const t = Math.abs(p);
    if (t === P) {
      const d = us === 1 ? 16 : -16, r = s >> 4;
      const promoRank = us === 1 ? 6 : 1, startRank = us === 1 ? 1 : 6;
      const one = s + d;
      if (!(one & 0x88) && !board[one]) {
        if (r === promoRank) { for (const pp of [Q, N, R, B]) ms.push({ f: s, t: one, c: 0, p: pp, fl: 0 }); }
        else if (!capsOnly) {
          ms.push({ f: s, t: one, c: 0, p: 0, fl: 0 });
          if (r === startRank && !board[one + d]) ms.push({ f: s, t: one + d, c: 0, p: 0, fl: 3 });
        }
      }
      for (const dd of [d - 1, d + 1]) {
        const tg = s + dd;
        if (tg & 0x88) continue;
        if (board[tg] && Math.sign(board[tg]) === -us) {
          if (r === promoRank) { for (const pp of [Q, N, R, B]) ms.push({ f: s, t: tg, c: board[tg], p: pp, fl: 0 }); }
          else ms.push({ f: s, t: tg, c: board[tg], p: 0, fl: 0 });
        } else if (tg === ep) ms.push({ f: s, t: tg, c: -us * P, p: 0, fl: 1 });
      }
    } else if (t === N || t === K) {
      for (const d of (t === N ? DN : DK)) {
        const tg = s + d;
        if (tg & 0x88) continue;
        const q = board[tg];
        if (!q) { if (!capsOnly) ms.push({ f: s, t: tg, c: 0, p: 0, fl: 0 }); }
        else if (Math.sign(q) === -us) ms.push({ f: s, t: tg, c: q, p: 0, fl: 0 });
      }
    } else {
      const dirs = t === B ? DB : t === R ? DR : DK;
      for (const d of dirs) {
        let tg = s + d;
        while (!(tg & 0x88)) {
          const q = board[tg];
          if (!q) { if (!capsOnly) ms.push({ f: s, t: tg, c: 0, p: 0, fl: 0 }); }
          else { if (Math.sign(q) === -us) ms.push({ f: s, t: tg, c: q, p: 0, fl: 0 }); break; }
          tg += d;
        }
      }
    }
  }
  if (!capsOnly) {
    if (us === 1 && board[4] === K) {
      if ((castle & 1) && !board[5] && !board[6] && board[7] === R && !attacked(4, -1) && !attacked(5, -1) && !attacked(6, -1)) ms.push({ f: 4, t: 6, c: 0, p: 0, fl: 2 });
      if ((castle & 2) && !board[3] && !board[2] && !board[1] && board[0] === R && !attacked(4, -1) && !attacked(3, -1) && !attacked(2, -1)) ms.push({ f: 4, t: 2, c: 0, p: 0, fl: 2 });
    } else if (us === -1 && board[116] === -K) {
      if ((castle & 4) && !board[117] && !board[118] && board[119] === -R && !attacked(116, 1) && !attacked(117, 1) && !attacked(118, 1)) ms.push({ f: 116, t: 118, c: 0, p: 0, fl: 2 });
      if ((castle & 8) && !board[115] && !board[114] && !board[113] && board[112] === -R && !attacked(116, 1) && !attacked(115, 1) && !attacked(114, 1)) ms.push({ f: 116, t: 114, c: 0, p: 0, fl: 2 });
    }
  }
  return ms;
}

const stack = [];
function make(m) {
  stack.push([castle, ep]);
  const p = board[m.f];
  board[m.t] = m.p ? m.p * side : p;
  board[m.f] = 0;
  if (m.fl === 1) board[m.t - 16 * side] = 0;
  else if (m.fl === 2) {
    if (m.t === m.f + 2) { board[m.f + 1] = board[m.f + 3]; board[m.f + 3] = 0; }
    else { board[m.f - 1] = board[m.f - 4]; board[m.f - 4] = 0; }
  }
  if (Math.abs(p) === K) kingSq[side] = m.t;
  castle &= CMASK[m.f] & CMASK[m.t];
  ep = m.fl === 3 ? m.f + 16 * side : -1;
  side = -side;
}
function unmake(m) {
  side = -side;
  [castle, ep] = stack.pop();
  const p = m.p ? P * side : board[m.t];
  board[m.f] = p;
  if (m.fl === 1) { board[m.t] = 0; board[m.t - 16 * side] = -side * P; }
  else board[m.t] = m.fl === 1 ? 0 : m.c;
  if (m.fl === 2) {
    if (m.t === m.f + 2) { board[m.f + 3] = board[m.f + 1]; board[m.f + 1] = 0; }
    else { board[m.f - 4] = board[m.f - 1]; board[m.f - 1] = 0; }
  }
  if (Math.abs(p) === K) kingSq[side] = m.f;
}

function evaluate() {
  let mg = 0, npm = { 1: 0, '-1': 0 }, pawns = { 1: 0, '-1': 0 };
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const p = board[s];
    if (!p) continue;
    const c = Math.sign(p), t = Math.abs(p);
    if (t !== K && t !== P) npm[c] += VAL[t];
    if (t === P) pawns[c]++;
  }
  const endgame = npm[1] + npm[-1] <= 2600;
  for (let s = 0; s < 128; s++) {
    if (s & 0x88) { s += 7; continue; }
    const p = board[s];
    if (!p) continue;
    const c = Math.sign(p), t = Math.abs(p);
    const r = s >> 4, f = s & 7;
    const idx = c === 1 ? (7 - r) * 8 + f : r * 8 + f;
    const tbl = t === K && endgame ? PST[7] : PST[t];
    mg += c * (VAL[t] + tbl[idx]);
  }
  // Добивание одинокого короля: прижать к краю, подвести своего короля.
  for (const c of [1, -1]) {
    if (npm[-c] === 0 && pawns[-c] === 0 && npm[c] >= 500) {
      const ek = kingSq[-c], ok = kingSq[c];
      const ef = ek & 7, er = ek >> 4;
      const centerDist = Math.max(3 - ef, ef - 4) + Math.max(3 - er, er - 4);
      const kd = Math.abs((ok & 7) - ef) + Math.abs((ok >> 4) - er);
      mg += c * (centerDist * 40 + (14 - kd) * 12);
    }
  }
  return mg * side;
}

function score(m, killers) {
  if (m.c) return 100000 + VAL[Math.abs(m.c)] * 10 - VAL[Math.abs(board[m.f])] / 10;
  if (m.p) return 90000;
  if (killers && (same(m, killers[0]) || same(m, killers[1]))) return 80000;
  return 0;
}
function same(a, b) { return b && a.f === b.f && a.t === b.t && a.p === b.p; }
function order(ms, killers, first) {
  for (const m of ms) m.s = same(m, first) ? 1e9 : score(m, killers);
  ms.sort((a, b) => b.s - a.s);
}

let nodes = 0, deadline = 0, stopped = false, useQ = true;
const killersAt = [];
function timeCheck() {
  if ((++nodes & 1023) === 0 && Date.now() > deadline) stopped = true;
}

function qsearch(alpha, beta, ply) {
  timeCheck();
  const stand = evaluate();
  if (!useQ || ply > 30) return stand;
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  const ms = gen(true);
  order(ms);
  for (const m of ms) {
    make(m);
    if (attacked(kingSq[-side], side)) { unmake(m); continue; }
    const sc = -qsearch(-beta, -alpha, ply + 1);
    unmake(m);
    if (stopped) return 0;
    if (sc >= beta) return beta;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

function search(depth, alpha, beta, ply) {
  timeCheck();
  if (stopped) return 0;
  const inCheck = attacked(kingSq[side], -side);
  if (inCheck && ply < 12) depth++;
  if (depth <= 0) return qsearch(alpha, beta, ply);
  const ms = gen(false);
  const kl = killersAt[ply] || (killersAt[ply] = [null, null]);
  order(ms, kl);
  let legal = 0;
  for (const m of ms) {
    make(m);
    if (attacked(kingSq[-side], side)) { unmake(m); continue; }
    legal++;
    const sc = -search(depth - 1, -beta, -alpha, ply + 1);
    unmake(m);
    if (stopped) return 0;
    if (sc >= beta) {
      if (!m.c) { kl[1] = kl[0]; kl[0] = m; }
      return beta;
    }
    if (sc > alpha) alpha = sc;
  }
  if (!legal) return inCheck ? -MATE + ply : 0;
  return alpha;
}

function legalRoot() {
  const out = [];
  for (const m of gen(false)) {
    make(m);
    if (!attacked(kingSq[-side], side)) out.push(m);
    unmake(m);
  }
  return out;
}

// Оценить все ходы корня (для слабых уровней — честная оценка каждого хода).
function scoreAll(ms, depth) {
  const res = [];
  for (const m of ms) {
    make(m);
    const sc = -search(depth - 1, -INF, INF, 1);
    unmake(m);
    res.push({ m, sc });
  }
  return res;
}

function bestMove(fen, opt, history) {
  const seen = new Set((history || []).map(f => { loadFen(f); return posKey(); }));
  loadFen(fen);
  const ms = legalRoot();
  if (!ms.length) return null;
  nodes = 0; stopped = false; useQ = opt.q !== false;
  killersAt.length = 0;
  deadline = Date.now() + (opt.time || 6000);
  const repPenalty = (m) => { make(m); const rep = seen.has(posKey()); unmake(m); return rep; };

  if (opt.noise !== undefined) {
    const res = scoreAll(ms, opt.depth);
    for (const r of res) {
      r.adj = r.sc + (Math.random() * 2 - 1) * opt.noise;
      if (r.sc > 200 && repPenalty(r.m)) r.adj -= 300;
    }
    res.sort((a, b) => b.adj - a.adj);
    let pick = res[0];
    if (Math.random() < (opt.blunder || 0)) {
      const pool = res.filter(r => r.sc > res[0].sc - (opt.blunderMargin || 400) && r.sc > -MATE / 2);
      pick = pool[Math.floor(Math.random() * pool.length)] || pick;
    }
    return { move: pick.m, score: pick.sc };
  }

  // Сильные уровни: итеративное углубление.
  let best = ms[0], bestSc = -INF;
  for (let d = 1; d <= opt.depth; d++) {
    order(ms, null, best);
    let alpha = -INF, curBest = null;
    for (const m of ms) {
      make(m);
      let sc = -search(d - 1, -INF, -alpha, 1);
      if (sc > 200 && seen.has(posKey())) sc -= 300;
      unmake(m);
      if (stopped) break;
      if (sc > alpha) { alpha = sc; curBest = m; }
    }
    if (stopped && !curBest) break;
    if (curBest) { best = curBest; bestSc = alpha; }
    if (stopped || bestSc > MATE / 2) break;
  }
  return { move: best, score: bestSc };
}

if (typeof self !== "undefined") self.onmessage = (e) => {
  const { id, fen, opt, history } = e.data;
  const r = bestMove(fen, opt, history);
  if (!r) { self.postMessage({ id, move: null }); return; }
  const m = r.move;
  self.postMessage({
    id,
    move: { from: sqName(m.f), to: sqName(m.t), promotion: m.p ? ' pnbrq'[m.p] : undefined },
    score: r.score
  });
};

// Экспорт для тестов в node
if (typeof module !== 'undefined') module.exports = { bestMove, loadFen, legalRoot, make, unmake, posKey, gen, attacked, kingSq: () => kingSq, sqName };
