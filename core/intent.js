// 엔진이 고른 수의 의도를 가정 실험으로 알아낸다. 맥 버전 janggi/intent.py를 옮긴 것이다.
// 엔진에게 심리는 없지만, 상황을 바꿔 다시 읽게 하면 그 수가 무엇을 하는지 드러난다.
import { applyMove, arrow, at, boardFen, direction, josa, label, owner, screenDirection, value } from "./commentary.js";
import { mateIn } from "./engine.js";
import { CHO, Game, isPass, legalMovesOf, opponent, splitMove } from "./rules.js";

export const PROBE_NODES = 20000;  // 휴대폰에 맞춰 맥 버전보다 얕게 읽는다
const PV_KEEP = 6;
const THREAT_GAIN = 0.08, DANGER_DROP = 0.1, ONLY_MOVE_GAP = 0.1, EQUAL_GAP = 0.02, PATH_GAIN = 3;

const winRate = (score) => 1 / (1 + 10 ** (-Math.max(-3000, Math.min(3000, score)) / 400));
const percent = (score) => Math.floor(winRate(score) * 100 + 0.5);

export async function probe(engine, fen, best, side) {
  const position = new Game(fen, []);
  const { score } = await engine.evaluate(position, PROBE_NODES);
  const raw = { fen, side, best, before: score, alts: await engine.topMoves(position, PROBE_NODES, 3) };
  const after = new Game(fen, [best]);
  const status = after.status();
  raw.finished = status !== null;
  if (!status) {
    raw.after = -(await engine.evaluate(after, PROBE_NODES)).score;
    raw.gives_check = after.inCheck();
    const wait = after.passMove();
    if (wait && !raw.gives_check) {
      const free = new Game(fen, [best, wait]);
      if (!free.status()) {
        const r = await engine.evaluate(free, PROBE_NODES);
        raw.threat = { wait, move: r.best, score: r.score, pv: r.pv.slice(0, PV_KEEP) };
      }
    }
  }
  raw.in_check = position.inCheck();
  const wait = raw.in_check ? null : position.passMove();
  if (wait) {
    const idle = new Game(fen, [wait]);
    if (!idle.status()) {
      const r = await engine.evaluate(idle, PROBE_NODES);
      const danger = { wait, move: r.best, score: -r.score, pv: r.pv.slice(0, PV_KEEP), still: null,
        possible: !status && after.legal().includes(r.best) };
      if (danger.possible) {
        const tried = new Game(fen, [best, r.best]);
        const result = tried.status();
        danger.still = result ? (result.winner === side ? 3000 : -3000) : (await engine.evaluate(tried, PROBE_NODES)).score;
      }
      raw.danger = danger;
    }
  }
  return raw;
}

function legalOf(board, side) {
  try {
    return legalMovesOf(boardFen(board, side));
  } catch {
    return [];
  }
}

function movesByPiece(board, side) {
  const counts = {};
  for (const move of legalOf(board, side)) {
    if (!isPass(move)) {
      const a = splitMove(move)[0];
      counts[a] = (counts[a] || 0) + 1;
    }
  }
  return counts;
}

function palacePressure(board, side) {
  const rows = side !== CHO ? ["1", "2", "3"] : ["8", "9", "10"];
  const palace = new Set(["d", "e", "f"].flatMap((f) => rows.map((r) => f + r)));
  const found = new Set();
  for (const move of legalOf(board, side)) {
    if (isPass(move)) continue;
    const [a, b] = splitMove(move);
    if (palace.has(b) && !palace.has(a)) found.add(a);
  }
  return found.size;
}

function goalOf(board, pv, actor, viewer) {
  let current = board;
  for (let index = 0; index < pv.length; index++) {
    const [a, b] = splitMove(pv[index]);
    if (a !== b && at(current, b) && at(current, a) && owner(at(current, a)) === actor && at(current, b).toLowerCase() !== "k") {
      return { index, move: pv[index], piece: label(current, a, viewer), target: label(current, b, viewer) };
    }
    current = applyMove(current, pv[index]);
  }
  return null;
}

function threatPoint(raw, boardAfter) {
  const { threat, side } = raw;
  if (!threat || raw.after === undefined || isPass(threat.move)) return null;
  const mate = mateIn(threat.score);
  const gain = winRate(threat.score) - winRate(raw.after);
  if (!(mate && mate > 0) && gain < THREAT_GAIN) return null;
  const arrows = [arrow(threat.move, "mine")];
  const name = label(boardAfter, splitMove(threat.move)[0], side);
  if (mate && mate > 0) {
    return { aim: "외통을 노리는", text: `상대가 가만히 있으면 ${mate}수 안에 외통으로 끝납니다. 첫 수는 ${name}${josa(name, "으로/로")} 둡니다.`, arrows, board: boardAfter };
  }
  const goal = goalOf(boardAfter, threat.pv, side, side);
  if (!goal || goal.index > 4) return null;
  const when = goal.index === 0 ? "다음 수에" : `${Math.floor(goal.index / 2) + 1}수 뒤에`;
  return {
    aim: `상대 ${goal.target}${josa(goal.target, "을/를")} 노리는`,
    text: `상대가 가만히 있으면 ${when} ${goal.piece}${josa(goal.piece, "으로/로")} 상대 ${goal.target}${josa(goal.target, "을/를")} 잡습니다.`,
    arrows: goal.index === 0 ? [arrow(goal.move, "mine")] : arrows, board: boardAfter,
  };
}

function dangerPoint(raw, board) {
  const { danger, side } = raw;
  if (!danger || isPass(danger.move)) return null;
  const base = raw.after ?? raw.before;
  if (winRate(base) - winRate(danger.score) < DANGER_DROP) return null;
  const name = label(board, splitMove(danger.move)[0], side);
  const mate = mateIn(danger.score);
  const goal = goalOf(board, danger.pv, opponent(side), side);
  let what, short;
  if (mate && mate < 0) {
    what = `${-mate}수 안에 외통을 당합니다`;
    short = "상대의 외통";
  } else if (goal) {
    const when = goal.index === 0 ? "바로" : `${Math.floor(goal.index / 2) + 1}수 뒤에`;
    what = `${when} 상대 ${goal.piece}${josa(goal.piece, "이/가")} 내 ${goal.target}${josa(goal.target, "을/를")} 잡습니다`;
    short = `내 ${goal.target}${josa(goal.target, "을/를")} 노리는 공격`;
  } else {
    what = `상대 ${name}${josa(name, "이/가")} ${screenDirection(danger.move, side)} 움직여 승률이 ${percent(danger.score)}%까지 떨어집니다`;
    short = "상대의 공격";
  }
  const prevented = !danger.possible || (danger.still !== null && winRate(danger.still) - winRate(danger.score) >= DANGER_DROP);
  const tail = prevented ? "이 수가 그 공격을 막습니다." : "이 수를 두어도 위험이 다 사라지지는 않습니다.";
  return { prevented, short, text: `내가 가만히 있으면 ${what}. ${tail}`, arrows: [arrow(danger.move, "theirs")], board };
}

function structurePoints(raw, board, boardAfter) {
  const { side, best } = raw;
  const [a, b] = splitMove(best);
  const points = [];
  if (a === b) return points;
  const enemy = opponent(side);
  const mineBefore = movesByPiece(board, side), mineAfter = movesByPiece(boardAfter, side);
  const movedBefore = mineBefore[a] || 0, movedAfter = mineAfter[b] || 0;
  const moved = label(boardAfter, b, side);
  if (movedAfter - movedBefore >= PATH_GAIN + 1) {
    points.push({ kind: "active", text: `${moved}${josa(moved, "이/가")} 둘 수 있는 수가 ${movedBefore}개에서 ${movedAfter}개로 늘어 활동 범위가 넓어집니다.`, arrows: [arrow(best, "mine")] });
  }
  const byGain = (x, y) => y.gain - x.gain || (x.square < y.square ? -1 : 1);
  const opened = [];
  for (const [square, n] of Object.entries(mineBefore)) {
    if (square !== a && mineAfter[square] !== undefined && mineAfter[square] - n >= PATH_GAIN && value(at(board, square)) >= 5) {
      opened.push({ gain: mineAfter[square] - n, square, count: n });
    }
  }
  for (const square of Object.keys(mineAfter)) {
    if (mineBefore[square] === undefined && square !== b && value(at(board, square)) >= 5 && mineAfter[square] >= PATH_GAIN) {
      opened.push({ gain: mineAfter[square], square, count: 0 });
    }
  }
  if (opened.length) {
    const { gain, square, count } = opened.sort(byGain)[0];
    const name = label(board, square, side);
    points.push({ kind: "open", name, text: `${name}의 길이 열립니다. 둘 수 있는 수가 ${count}개에서 ${count + gain}개로 늘어납니다.`, arrows: [arrow(best, "mine")] });
  }
  const theirsBefore = movesByPiece(board, enemy), theirsAfter = movesByPiece(boardAfter, enemy);
  const blocked = [];
  for (const [square, n] of Object.entries(theirsBefore)) {
    const loss = n - (theirsAfter[square] || 0);
    if (at(boardAfter, square) === at(board, square) && loss >= PATH_GAIN && value(at(board, square)) >= 5) {
      blocked.push({ gain: loss, square, count: n });
    }
  }
  if (blocked.length) {
    const { gain, square, count } = blocked.sort(byGain)[0];
    const name = label(board, square, side);
    points.push({ kind: "block", name, text: `상대 ${name}의 길을 막습니다. 둘 수 있는 수가 ${count}개에서 ${count - gain}개로 줄어듭니다.`, arrows: [arrow(best, "mine")] });
  }
  const pressureBefore = palacePressure(board, side), pressureAfter = palacePressure(boardAfter, side);
  if (pressureAfter > pressureBefore) {
    points.push({ kind: "palace", text: `상대 궁성으로 들어갈 수 있는 내 말이 ${pressureBefore}개에서 ${pressureAfter}개로 늘어납니다.`, arrows: [arrow(best, "mine")] });
  }
  return points;
}

function comparePoint(raw, board) {
  const { side, best } = raw;
  const alts = raw.alts.filter((x) => x.move !== best);
  const top = raw.alts.find((x) => x.move === best);
  if (!alts.length) return { text: "이 국면에서 둘 만한 수는 사실상 이 수 하나입니다.", arrows: [] };
  if (!top) return null;
  const other = alts[0];
  const gap = winRate(top.score) - winRate(other.score);
  const [a, b] = splitMove(other.move);
  let what = "한수쉼";
  if (a !== b) {
    const name = label(board, a, side);
    what = `${name}${josa(name, "을/를")} ${direction(other.move, side)} 두는 수`;
  }
  const rates = `승률 ${percent(top.score)}% 대 ${percent(other.score)}%`;
  let text = `다음 후보는 ${what}입니다(${rates}).`;
  if (gap >= ONLY_MOVE_GAP) text = `다음 후보인 ${what}와 차이가 큽니다(${rates}). 사실상 이 수를 둬야 하는 국면입니다.`;
  else if (gap <= EQUAL_GAP) text = `${what}도 비슷하게 평가됩니다. 꼭 이 수여야 하는 건 아닙니다.`;
  return { text, arrows: a === b ? [] : [arrow(other.move, "option")] };
}

export function describe(raw) {
  const { fen, side, best } = raw;
  const board = new Game(fen, []).board();
  const after = applyMove(board, best);
  const [a, b] = splitMove(best);
  const points = [];
  const victim = a !== b ? at(board, b) : "";
  const name = a !== b ? label(board, a, side) : "";
  const threat = raw.finished ? null : threatPoint(raw, after);
  const danger = dangerPoint(raw, board);
  const structure = structurePoints(raw, board, after);
  let headline;
  if (raw.finished) headline = "이 수로 대국을 끝냅니다";
  else if (a === b) headline = "말을 움직이지 않고 기다리는 수";
  else if (raw.in_check) headline = "장군을 풀어내는 수";
  else if (danger && danger.prevented && threat) headline = `${danger.short}을 막으면서 ${threat.aim} 수`;
  else if (danger && danger.prevented) headline = `${danger.short}을 막는 수`;
  else if (victim) {
    const target = label(board, b, side);
    headline = `상대 ${target}${josa(target, "을/를")} 잡는 수`;
  } else if (raw.gives_check) headline = "장군으로 상대를 몰아붙이는 수";
  else if (threat) headline = `${threat.aim} 수`;
  else {
    const opened = structure.find((p) => p.kind === "open");
    const blocked = structure.find((p) => p.kind === "block");
    if (opened) headline = `${opened.name}의 길을 여는 준비 수`;
    else if (blocked) headline = `상대 ${blocked.name}의 길을 막는 수`;
    else if (structure.some((p) => p.kind === "palace")) headline = "상대 궁성을 압박하는 수";
    else if (structure.length) headline = `${name}${josa(name, "을/를")} 좋은 자리로 옮기는 수`;
    else headline = "뚜렷한 노림수 없이 형세를 다지는 수";
  }
  if (raw.gives_check) points.push({ text: `${name}${josa(name, "으로/로")} 장군을 불러 상대가 먼저 궁을 지키게 합니다.`, arrows: [arrow(best, "mine")], board: after });
  if (threat) points.push({ text: threat.text, arrows: threat.arrows, board: threat.board });
  if (danger) points.push({ text: danger.text, arrows: danger.arrows, board: danger.board });
  for (const point of structure) points.push({ text: point.text, arrows: point.arrows, board: after });
  const compare = comparePoint(raw, board);
  if (compare) points.push({ text: compare.text, arrows: compare.arrows, board });
  return { headline, points };
}
