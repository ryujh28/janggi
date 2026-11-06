// 화면에서 호출하는 게임 기능. 맥 버전 janggi/api.py와 메서드 이름과 돌려주는 값이 같다.
import { Engine, EngineError, mateIn } from "./engine.js";
import { REVIEW_VERSION, analyze, frame, judge, legalMap } from "./review.js";
import { CHO, HAN, SETUPS, Game, opponent, startFen } from "./rules.js";
import { PLACEMENT_GAMES, Store } from "./store.js";

const PUZZLE_NODES = 20000;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class Api {
  static async create() {
    const api = new Api();
    api.store = await Store.open();
    api.levels = (await (await fetch("data/levels.json")).json()).levels;
    api.puzzles = await (await fetch("data/puzzles.json")).json();
    return api;
  }

  constructor() {
    this.engine = null;
    this.engineBoot = null;
    this.engineError = null;
    this.game = null;
    this.meta = {};
    this.result = null;
    this.lastGameId = null;
    this.reviewJob = {};
    this.puzzle = {};
    this.queue = Promise.resolve();
  }

  getEngine() {
    if (!this.engineBoot) {
      this.engineBoot = Engine.create().catch((error) => {
        this.engineBoot = null;
        throw error;
      });
    }
    return this.engineBoot;
  }

  // 엔진은 한 번에 한 작업만 처리한다
  withEngine(fn) {
    const run = this.queue.then(async () => fn(await this.getEngine()));
    this.queue = run.catch(() => {});
    return run;
  }

  async home() {
    const p = this.store.profile;
    const saved = this.store.current;
    const puzzles = {};
    for (const [k, v] of Object.entries(this.puzzles)) {
      puzzles[k] = { total: v.length, solved: Math.min(p.solved[k] || 0, v.length) };
    }
    return {
      levels: this.levels.map((l, index) => ({ index, name: l.name, group: l.group })),
      rank: p.rank, rank_name: this.levels[p.rank].name,
      ranked_games: p.ranked_games,
      placement_left: Math.max(0, PLACEMENT_GAMES - p.ranked_games),
      ladder: p.ladder.slice(-60), stats: p.stats, options: p.options,
      setups: Object.keys(SETUPS),
      mistakes_due: this.store.dueMistakes().length,
      puzzles,
      resume: saved ? { level_name: this.levels[saved.level].name, side: saved.side, plies: saved.moves.length } : null,
    };
  }

  async set_option(name, value) {
    this.store.profile.options[name] = value;
    await this.store.saveProfile();
    return this.store.profile.options;
  }

  async preview(side, setup, aiSetup = "random") {
    const mine = SETUPS[setup] ? setup : Object.keys(SETUPS)[0];
    const other = SETUPS[aiSetup] ? aiSetup : "masang-sangma";
    const [cho, han] = side !== HAN ? [mine, other] : [other, mine];
    return new Game(startFen(cho, han)).board();
  }

  async start(level, side, setup, aiSetup = "random") {
    const chosen = level === null || level === undefined ? this.store.profile.rank : Number(level);
    const index = Math.max(0, Math.min(chosen, this.levels.length - 1));
    if (side !== CHO && side !== HAN) side = pick([CHO, HAN]);
    const names = Object.keys(SETUPS);
    if (!SETUPS[setup]) setup = pick(names);
    if (!SETUPS[aiSetup]) aiSetup = pick(names);
    const [cho, han] = side === CHO ? [setup, aiSetup] : [aiSetup, setup];
    this.game = new Game(startFen(cho, han));
    this.meta = { level: index, side, undos: 0 };
    this.result = null;
    this.engineError = null;
    await this.autosave();
    try {
      await this.withEngine((engine) => engine.newGame());
    } catch (error) {
      this.engineError = String(error.message || error);
    }
    return this.state();
  }

  async resume() {
    const saved = this.store.current;
    if (!saved) return { error: "이어서 둘 대국이 없습니다" };
    this.game = new Game(saved.fen0, saved.moves);
    this.meta = { level: saved.level, side: saved.side, undos: saved.undos };
    this.result = null;
    this.engineError = null;
    return this.state();
  }

  async state() {
    const g = this.game;
    if (!g) return { error: "진행 중인 대국이 없습니다" };
    const { side, level, undos } = this.meta;
    const over = this.result;
    const myTurn = !over && g.turn === side;
    const options = this.store.profile.options;
    return {
      ...frame(g), side, my_turn: myTurn,
      legal: myTurn ? legalMap(g) : {},
      pass_move: myTurn ? g.passMove() : null,
      pass_ends_game: myTurn && g.passEndsGame(),
      threats: myTurn && options.threats ? g.threats(side) : [],
      check: !over && g.inCheck(),
      bikjang: !over && g.bikjang(),
      score: g.score(), captured: g.captured(), plies: g.moves.length,
      can_undo: myTurn && g.moves.length >= 2,
      undos, level, level_name: this.levels[level].name,
      ranked: level === this.store.profile.rank,
      over, engine_error: this.engineError,
    };
  }

  async play(move) {
    const g = this.game;
    if (!g || this.result || g.turn !== this.meta.side) return this.state();
    try {
      g.play(move);
    } catch (error) {
      return { ...(await this.state()), error: String(error.message) };
    }
    return this.afterMove();
  }

  async ai_move() {
    const g = this.game;
    if (!g || this.result || g.turn === this.meta.side) return this.state();
    this.engineError = null;
    try {
      const play = this.levels[this.meta.level].play;
      const move = await this.withEngine((engine) => engine.choose(g, play));
      if (!g.legal().includes(move)) throw new EngineError(`엔진이 둘 수 없는 수를 골랐습니다: ${move}`);
      g.moves.push(move);
    } catch (error) {
      this.engineError = String(error.message || error);
      return this.state();
    }
    return this.afterMove();
  }

  async undo() {
    const g = this.game;
    if (g && !this.result && g.turn === this.meta.side && g.moves.length >= 2) {
      g.moves.splice(-2);
      this.meta.undos += 1;
      await this.autosave();
    }
    return this.state();
  }

  async resign() {
    if (this.game && !this.result) await this.finish({ winner: opponent(this.meta.side), reason: "resign" });
    return this.state();
  }

  async history(limit = 40) {
    const store = this.store;
    const ladder = store.profile.ladder.slice(-60);
    return {
      games: store.history(limit),
      ladder: ladder.map((i) => this.levels[i].name),
      ladder_index: ladder,
      mistakes: store.mistakeCounts(),
    };
  }

  // 복기
  async review_start(gameId = null) {
    const id = gameId || this.lastGameId;
    const game = id ? await this.store.loadGame(id) : null;
    if (!game) return { error: "복기할 대국을 찾지 못했습니다" };
    let saved = await this.store.loadReview(id);
    if (saved && saved.version !== REVIEW_VERSION) saved = null;
    const job = { id, done: 0, total: game.plies + 1, result: saved || null, error: null };
    this.reviewJob = job;
    if (!saved) {
      this.withEngine(async (engine) => {
        const result = await analyze(game, engine, (done, total) => { job.done = done; job.total = total; });
        await this.store.saveReview(id, result);
        await this.store.addMistakes(id, result.moments, game.side);
        job.result = result;
      }).catch((error) => { job.error = String(error.message || error); });
    }
    return this.review_status();
  }

  async review_status() {
    return { ...this.reviewJob };
  }

  async review_try(index, move) {
    const moment = this.reviewJob.result.moments[Number(index)];
    const { side } = this.reviewJob.result;
    return this.withEngine((engine) => judge(engine, moment.fen, move, side));
  }

  // 문제
  async puzzle_next(kind) {
    if (kind === "mistake") {
      const due = this.store.dueMistakes();
      if (!due.length) return { empty: true };
      const item = due[0];
      this.puzzle = { kind, item, game: new Game(item.fen), side: item.side, tries: 0, left: due.length };
    } else {
      const items = this.puzzles[kind] || [];
      const index = this.store.profile.solved[kind] || 0;
      if (index >= items.length) return { empty: true };
      const item = items[index];
      this.puzzle = {
        kind, item, game: new Game(item.fen), side: item.side, remaining: item.n, tries: 0,
        number: index + 1, total: items.length,
      };
    }
    return this.puzzleState();
  }

  puzzleState(extra = {}) {
    const p = this.puzzle;
    const g = p.game;
    return {
      ...frame(g), kind: p.kind, side: p.side, legal: legalMap(g), n: p.item.n ?? null, text: p.item.text ?? null,
      tries: p.tries, number: p.number ?? null, total: p.total ?? null, left: p.left ?? null,
      check: g.inCheck(), ...extra,
    };
  }

  async puzzle_move(move) {
    const p = this.puzzle;
    if (p.kind === "mistake") return this.mistakeMove(move);
    const g = p.game;
    if (!g.legal().includes(move)) return this.puzzleState({ result: "illegal" });
    g.moves.push(move);
    const status = g.status();
    if (status) {
      const solved = status.winner === p.side;
      if (solved) await this.markSolved(p.kind);
      return this.puzzleState({ result: solved ? "solved" : "wrong" });
    }
    const { score, best } = await this.withEngine((engine) => engine.evaluate(g, PUZZLE_NODES));
    const mate = mateIn(score);
    if (mate === null || mate > 0 || -mate > p.remaining - 1) return this.puzzleState({ result: "wrong" });
    p.remaining -= 1;
    g.moves.push(best);
    return this.puzzleState({ result: "continue" });
  }

  async mistakeMove(move) {
    const p = this.puzzle;
    const { item } = p;
    const verdict = await this.withEngine((engine) => judge(engine, item.fen, move, item.side));
    const correct = verdict.verdict === "best" || verdict.verdict === "good";
    if (p.tries === 0) await this.store.answerMistake(item.id, correct);
    p.tries += 1;
    p.game.moves.push(move);
    return this.puzzleState({ result: correct ? "solved" : "wrong", best: verdict.best });
  }

  async markSolved(kind) {
    const { solved } = this.store.profile;
    solved[kind] = (solved[kind] || 0) + 1;
    await this.store.saveProfile();
  }

  async puzzle_retry() {
    const p = this.puzzle;
    p.game = new Game(p.item.fen);
    p.tries += 1;
    if (p.item.n !== undefined) p.remaining = p.item.n;
    return this.puzzleState();
  }

  async puzzle_answer() {
    const { item } = this.puzzle;
    const line = item.line || [item.best];
    const g = new Game(item.fen);
    const frames = [frame(g)];
    for (const move of line) {
      if (!g.legal().includes(move)) break;
      g.moves.push(move);
      frames.push(frame(g));
    }
    return { frames };
  }

  // 내부
  async afterMove() {
    const result = this.game.status();
    if (result) await this.finish(result);
    else await this.autosave();
    return this.state();
  }

  autosave() {
    return this.store.saveCurrent({ ...this.meta, fen0: this.game.fen0, moves: [...this.game.moves] });
  }

  async finish(result) {
    const g = this.game, meta = this.meta;
    const { side } = meta;
    const outcome = result.winner === null ? "draw" : result.winner === side ? "win" : "loss";
    const score = g.score();
    const change = await this.store.record({
      level: meta.level, level_name: this.levels[meta.level].name, side,
      fen0: g.fen0, moves: [...g.moves], outcome, winner: result.winner, reason: result.reason,
      score, plies: g.moves.length, undos: meta.undos,
    }, this.levels.length);
    this.lastGameId = change.id;
    this.result = {
      outcome, winner: result.winner, reason: result.reason, score, ranked: change.ranked,
      moved: change.rank - change.before, rank_name: this.levels[change.rank].name, game_id: change.id,
    };
  }
}
