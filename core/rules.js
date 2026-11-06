// 장기 규칙. 판정은 엔진과 같은 규칙 코드인 ffish에 맡긴다. 맥 버전 janggi/rules.py와 같은 동작을 한다.
import Module from "../vendor/ffish.js";

export const VARIANT = "janggi";
export const CHO = "cho";
export const HAN = "han";
export const PIECE_VALUE = { r: 13, c: 7, n: 5, b: 3, a: 3, p: 2 };
export const DEOM = 1.5;
export const SETUPS = {
  "masang-sangma": "nbbn", "sangma-masang": "bnnb",
  "masang-masang": "nbnb", "sangma-sangma": "bnbn",
};

let ffish = null;

export async function loadRules(base = "vendor/") {
  ffish = await Module({ locateFile: (file) => new URL(base + file, document.baseURI).href });
}

export const opponent = (side) => (side === CHO ? HAN : CHO);

export function splitMove(move) {
  const m = /^([a-i])(\d{1,2})([a-i])(\d{1,2})$/.exec(move);
  if (!m) throw new Error(`잘못된 수: ${move}`);
  return [m[1] + m[2], m[3] + m[4]];
}

export function isPass(move) {
  const [a, b] = splitMove(move);
  return a === b;
}

export function startFen(choSetup, hanSetup) {
  const row = (seq) => `r${seq.slice(0, 2)}a1a${seq.slice(2)}r`;
  const cho = row(SETUPS[choSetup]).toUpperCase();
  const han = row([...SETUPS[hanSetup]].reverse().join(""));
  return `${han}/4k4/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/4K4/${cho} w - - 0 1`;
}

// FEN 하나에서 바로 쓰는 도구들
export function withBoard(fen, moves, fn) {
  const board = new ffish.Board(VARIANT, fen);
  try {
    if (moves.length) board.pushMoves(moves.join(" "));
    return fn(board);
  } finally {
    board.delete();
  }
}

const parseMoves = (text) => (text ? text.split(" ").filter(Boolean) : []);

export function legalMovesOf(fen, moves = []) {
  return withBoard(fen, moves, (b) => parseMoves(b.legalMoves()).sort());
}

export function givesCheck(fen, moves) {
  return withBoard(fen, moves, (b) => b.isCheck());
}

export class Game {
  constructor(fen0, moves = []) {
    this.fen0 = fen0;
    this.moves = moves;
  }

  get turn() {
    const first = this.fen0.split(" ")[1] === "w" ? CHO : HAN;
    return this.moves.length % 2 === 0 ? first : opponent(first);
  }

  fen() {
    return withBoard(this.fen0, this.moves, (b) => b.fen());
  }

  board() {
    return this.fen().split(" ")[0].split("/").map((text) => {
      const row = [];
      for (const piece of text.match(/\d+|[a-zA-Z]/g)) {
        if (/\d/.test(piece)) row.push(...Array(Number(piece)).fill(""));
        else row.push(piece);
      }
      return row;
    });
  }

  legal() {
    if (this.status(true)) return [];
    return legalMovesOf(this.fen0, this.moves);
  }

  inCheck() {
    return givesCheck(this.fen0, this.moves);
  }

  play(move) {
    if (!this.legal().includes(move)) throw new Error(`둘 수 없는 수: ${move}`);
    this.moves.push(move);
  }

  bikjang() {
    const board = this.board();
    let cho = null, han = null;
    board.forEach((row, r) => row.forEach((p, c) => {
      if (p === "K") cho = [r, c];
      else if (p === "k") han = [r, c];
    }));
    if (!cho || !han || cho[1] !== han[1]) return false;
    for (let r = han[0] + 1; r < cho[0]; r++) if (board[r][cho[1]]) return false;
    return true;
  }

  score() {
    const total = { cho: 0, han: DEOM };
    for (const row of this.board()) {
      for (const p of row) {
        if (p) total[p === p.toUpperCase() ? CHO : HAN] += PIECE_VALUE[p.toLowerCase()] || 0;
      }
    }
    return total;
  }

  captured() {
    const left = new Game(this.fen0).board().flat().filter(Boolean);
    for (const p of this.board().flat()) {
      if (p) left.splice(left.indexOf(p), 1);
    }
    const byValue = (a, b) => (PIECE_VALUE[b.toLowerCase()] || 0) - (PIECE_VALUE[a.toLowerCase()] || 0);
    return {
      cho: left.filter((p) => p === p.toUpperCase()).sort(byValue),
      han: left.filter((p) => p !== p.toUpperCase()).sort(byValue),
    };
  }

  // quick이면 끝났는지만 본다
  status(quick = false) {
    const info = withBoard(this.fen0, this.moves, (b) => ({
      over: b.isGameOver(true), result: b.result(true), check: b.isCheck(),
      none: b.numberLegalMoves() === 0, clock: b.halfmoveClock(),
    }));
    if (!info.over) return null;
    if (quick && !info.none) return { quick: true };
    let reason;
    if (info.none) {
      reason = info.check ? "checkmate" : "stalemate";
      const last = this.moves.slice(-2);
      if (!info.check && this.moves.length && isPass(this.moves[this.moves.length - 1])) {
        reason = last.length === 2 && last.every(isPass) ? "double_pass" : (this.bikjang() ? "bikjang" : reason);
      }
    } else {
      reason = this.endReason(info.clock);
    }
    const winner = info.result === "1-0" ? CHO : info.result === "0-1" ? HAN : null;
    return { winner, reason };
  }

  endReason(clock) {
    const last = this.moves.slice(-2);
    if (last.length === 2 && last.every(isPass)) return "double_pass";
    if (this.moves.length && isPass(this.moves[this.moves.length - 1]) && this.bikjang()) return "bikjang";
    return clock >= 100 ? "no_progress" : "repetition";
  }

  passMove() {
    return this.legal().find(isPass) || null;
  }

  passEndsGame() {
    const move = this.passMove();
    if (!move) return false;
    return new Game(this.fen0, [...this.moves, move]).status() !== null;
  }

  threats(side) {
    if (this.turn !== side || this.inCheck()) return [];
    const parts = this.fen().split(" ");
    parts[1] = side === CHO ? "b" : "w";
    let replies;
    try {
      replies = legalMovesOf(parts.join(" "));
    } catch {
      return [];
    }
    const board = this.board();
    const found = new Set();
    for (const move of replies) {
      const [a, b] = splitMove(move);
      if (a === b) continue;
      const piece = board[10 - Number(b.slice(1))][b.charCodeAt(0) - 97];
      if (piece && (piece === piece.toUpperCase()) === (side === CHO)) found.add(b);
    }
    return [...found].sort();
  }
}
