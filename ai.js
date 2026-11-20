// Обёртка над движком + уровни силы компьютера.
const LEVELS = [
  { elo: 250,  name: 'Новичок',      opt: { depth: 1, noise: 350, blunder: 0.35, blunderMargin: 2000, q: false } },
  { elo: 400,  name: 'Ученик',       opt: { depth: 1, noise: 220, blunder: 0.22, blunderMargin: 900, q: false } },
  { elo: 550,  name: 'Любитель',     opt: { depth: 2, noise: 150, blunder: 0.14, blunderMargin: 600 } },
  { elo: 700,  name: 'Любитель+',    opt: { depth: 2, noise: 90,  blunder: 0.09, blunderMargin: 400 } },
  { elo: 850,  name: 'Клубный',      opt: { depth: 3, noise: 60,  blunder: 0.06, blunderMargin: 300 } },
  { elo: 1000, name: '3 разряд',     opt: { depth: 3, noise: 35,  blunder: 0.03, blunderMargin: 250 } },
  { elo: 1150, name: '2 разряд',     opt: { depth: 4, noise: 20,  blunder: 0.015, blunderMargin: 200 } },
  { elo: 1300, name: '1 разряд',     opt: { depth: 4, noise: 10 } },
  { elo: 1450, name: 'Кандидат',     opt: { depth: 5, time: 1200 } },
  { elo: 1600, name: 'КМС',          opt: { depth: 6, time: 1800 } },
  { elo: 1750, name: 'Мастер',       opt: { depth: 7, time: 2500 } },
  { elo: 1900, name: 'Гроссмейстер', opt: { depth: 12, time: 4000 } }
];

const AI = {
  worker: null, seq: 0, pending: {},
  init() {
    this.worker = new Worker('engine.js');
    this.worker.onmessage = (e) => {
      const cb = this.pending[e.data.id];
      delete this.pending[e.data.id];
      if (cb) cb(e.data);
    };
  },
  ask(fen, opt, history) {
    if (!this.worker) this.init();
    const id = ++this.seq;
    return new Promise((res) => {
      this.pending[id] = res;
      this.worker.postMessage({ id, fen, opt, history: history || [] });
    });
  },
  // Ход компьютера заданного уровня (с небольшой паузой, чтобы выглядело естественно)
  async move(fen, levelIdx, history, ply) {
    let opt = LEVELS[levelIdx].opt;
    // Сильные уровни: немного разнообразия в дебюте
    if (opt.noise === undefined && ply < 8) opt = { depth: 4, noise: 18 };
    const t = Date.now();
    const r = await this.ask(fen, opt, history);
    const wait = 450 - (Date.now() - t);
    if (wait > 0) await new Promise(r2 => setTimeout(r2, wait));
    return r.move;
  },
  hint(fen, history) { return this.ask(fen, { depth: 6, time: 1500 }, history).then(r => r.move); },
  defend(fen) { return this.ask(fen, { depth: 6, time: 1000 }).then(r => r.move); }
};

// Подобрать уровень под рейтинг игрока: чуть сильнее его самого.
function levelForRating(rating) {
  let best = 0;
  for (let i = 0; i < LEVELS.length; i++) if (LEVELS[i].elo <= rating + 75) best = i;
  return best;
}
