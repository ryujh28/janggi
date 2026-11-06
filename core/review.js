// 끝난 대국을 엔진으로 분석해 복기 자료를 만든다. 맥 버전 janggi/review.py를 옮긴 것이다.
import { at, josa, lesson, material, pieceName } from "./commentary.js";
import { mateIn } from "./engine.js";
import { PROBE_NODES, describe, probe } from "./intent.js";
import { CHO, Game, PIECE_VALUE, isPass, splitMove } from "./rules.js";

export const REVIEW_VERSION = 4;
const ANALYSIS_NODES = 10000;  // 휴대폰에 맞춰 맥 버전의 절반으로 읽는다
const EXTEND_NODES = 4000;
const MOMENTS = 3;
const LINE_PLIES = 16;
const GOOD_ENOUGH = 40;

const winRate = (score) => 1 / (1 + 10 ** (-Math.max(-3000, Math.min(3000, score)) / 400));
const labelOf = (drop) => (drop >= 0.3 ? "큰 실수" : drop >= 0.15 ? "실수" : "아쉬운 수");

export function frame(game) {
  let last = null;
  if (game.moves.length) {
    const [a, b] = splitMove(game.moves[game.moves.length - 1]);
    last = { from: a, to: b, pass: a === b };
  }
  return { board: game.board(), last, turn: game.turn };
}

export function legalMap(game) {
  const found = {};
  for (const move of game.legal()) {
    if (!isPass(move)) {
      const [a, b] = splitMove(move);
      (found[a] = found[a] || []).push(b);
    }
  }
  return found;
}

function applyTo(board, move) {
  const [a, b] = splitMove(move);
  const out = board.map((row) => row.slice());
  if (a !== b) {
    const ra = 10 - Number(a.slice(1)), ca = a.charCodeAt(0) - 97;
    const rb = 10 - Number(b.slice(1)), cb = b.charCodeAt(0) - 97;
    out[rb][cb] = out[ra][ca];
    out[ra][ca] = "";
  }
  return out;
}

function endsInMate(fen, line) {
  const game = new Game(fen, []);
  for (const move of line) {
    if (game.status() !== null || !game.legal().includes(move)) break;
    game.moves.push(move);
  }
  const status = game.status();
  return status !== null && status.reason === "checkmate";
}

export function classify(board, played, best, line, before, after, fen, bestLine) {
  const mateBefore = mateIn(before), mateAfter = mateIn(after);
  if (mateBefore && mateBefore > 0 && !(mateAfter && mateAfter > 0)) {
    if (endsInMate(fen, bestLine)) return ["missed_mate", `${mateBefore}수 안에 외통으로 끝낼 수 있었습니다.`];
    return ["missed_win", `${mateBefore}수 안에 점수 판정으로 이길 수 있었습니다.`];
  }
  if (mateAfter && mateAfter < 0 && !(mateBefore && mateBefore < 0)) {
    if (endsInMate(fen, line)) return ["allowed_mate", `이 수 뒤에 ${-mateAfter}수 안에 외통을 당합니다.`];
    return ["allowed_loss", `이 수 뒤에 ${-mateAfter}수 안에 점수 판정으로 집니다.`];
  }
  const afterBoard = applyTo(board, played);
  const reply = line.length > 1 ? line[1] : null;
  if (reply && !isPass(reply)) {
    const spot = splitMove(reply)[1];
    const taken = at(afterBoard, spot);
    const capturer = at(afterBoard, splitMove(reply)[0]);
    const retaken = line.length > 2 && splitMove(line[2])[1] === spot;
    const worth = (p) => PIECE_VALUE[p.toLowerCase()] || 0;
    const evenTrade = retaken && taken && worth(capturer) >= worth(taken);
    if (taken && taken.toLowerCase() !== "k" && !evenTrade) {
      const name = pieceName(taken);
      return ["hung_piece", `이 수 뒤에 ${name}${josa(name, "을/를")} 잡힙니다.`];
    }
  }
  const target = at(board, splitMove(best)[1]);
  if (target && splitMove(best)[1] !== splitMove(played)[1] && !isPass(best)) {
    const name = pieceName(target);
    return ["missed_capture", `상대 ${name}${josa(name, "을/를")} 잡을 수 있었습니다.`];
  }
  return ["positional", ""];
}

function explainPositional(start, fen, bestPv, playedPv, side) {
  const end = (line) => {
    const game = new Game(fen, []);
    for (const move of line.slice(0, LINE_PLIES)) {
      if (game.status() !== null || !game.legal().includes(move)) break;
      game.moves.push(move);
    }
    return game.moves.length ? game.board() : null;
  };
  const a = end(bestPv), b = end(playedPv);
  if (a && b) {
    const gap = material(a, side) - material(b, side);
    if (gap >= 2) return `이어지는 수순까지 보면 엔진의 수보다 말 점수로 ${gap}점 뒤집니다.`;
  }
  return "말 손해는 크지 않지만 형세가 나빠졌습니다.";
}

async function extendLine(engine, fen, line) {
  const game = new Game(fen, []);
  const kept = [];
  for (const move of line) {
    if (game.status() !== null || !game.legal().includes(move)) return kept;
    game.moves.push(move);
    kept.push(move);
  }
  while (kept.length < LINE_PLIES && game.status() === null) {
    const { best } = await engine.evaluate(game, EXTEND_NODES);
    if (!game.legal().includes(best)) break;
    game.moves.push(best);
    kept.push(best);
  }
  return kept;
}

export async function analyze(game, engine, progress) {
  const { fen0, moves, side } = game;
  const points = [];
  const total = moves.length + 1;
  for (let ply = 0; ply <= moves.length; ply++) {
    const position = new Game(fen0, moves.slice(0, ply));
    const result = position.status();
    if (result) {
      const score = result.winner === null ? 0 : result.winner === side ? 3000 : -3000;
      points.push({ score, best: null, pv: [] });
    } else {
      const { score, best, pv } = await engine.evaluate(position, ANALYSIS_NODES);
      points.push({ score: score * (position.turn === side ? 1 : -1), best, pv });
    }
    progress?.(ply + 1, total);
  }

  const frames = [];
  for (let ply = 0; ply <= moves.length; ply++) frames.push(frame(new Game(fen0, moves.slice(0, ply))));

  const candidates = [];
  for (let ply = side === CHO ? 0 : 1; ply < moves.length; ply += 2) {
    const before = points[ply], after = points[ply + 1];
    if (!before.best) continue;
    const drop = winRate(before.score) - winRate(after.score);
    if (moves[ply] === before.best || drop < 0.08) continue;
    candidates.push({ drop, ply, loss: Math.max(0, before.score - after.score) });
  }
  candidates.sort((a, b) => b.drop - a.drop);

  const moments = [];
  for (const { drop, ply, loss } of candidates) {
    if (moments.length === MOMENTS) break;
    const after = points[ply + 1];
    const played = moves[ply];
    const position = new Game(fen0, moves.slice(0, ply));
    const fen = position.fen();
    // 고른 실수는 더 깊게 다시 읽는다. 깊게 봐도 내 수가 최선이면 실수가 아니다.
    const deep = await engine.evaluate(position, PROBE_NODES);
    const best = deep.best;
    if (best === played) continue;
    const bestPv = await extendLine(engine, fen, deep.pv);
    const playedPv = await extendLine(engine, fen, [played, ...after.pv]);
    const board = frames[ply].board;
    let [kind, text] = classify(board, played, best, playedPv, deep.score, after.score, fen, bestPv);
    if (kind === "positional") text = explainPositional(board, fen, bestPv, playedPv, side);
    const result = lesson(fen, side, played, best, kind, playedPv.slice(1), bestPv);
    result.intent = describe(await probe(engine, fen, best, side));
    moments.push({
      ply, number: Math.floor(ply / 2) + 1, label: labelOf(drop), kind, text, played, best,
      before: Math.round(winRate(deep.score) * 100), after: Math.round(winRate(after.score) * 100),
      loss, fen, legal: legalMap(position), lesson: result,
    });
  }
  moments.sort((a, b) => a.ply - b.ply);
  return {
    version: REVIEW_VERSION, side,
    graph: points.map((p) => Math.round(winRate(p.score) * 100)),
    frames, moments,
  };
}

export async function judge(engine, fen, move, side) {
  const position = new Game(fen);
  const { score, best } = await engine.evaluate(position, ANALYSIS_NODES);
  if (move === best) return { verdict: "best", best };
  const next = new Game(fen, [move]);
  const status = next.status();
  if (status) return { verdict: status.winner === side ? "best" : "bad", best };
  const reply = await engine.evaluate(next, ANALYSIS_NODES);
  const loss = score + reply.score;
  return { verdict: loss <= GOOD_ENOUGH ? "good" : "bad", best, loss: Math.max(0, loss) };
}
