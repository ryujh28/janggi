// 수의 의도를 가정 실험과 엔진 내부 값으로 알아낸다. 맥 버전 janggi/intent.py를 옮긴 것이다.
// 엔진에게 심리는 없지만 상황을 바꿔 다시 읽게 하면 그 수가 무엇을 하는지 드러난다.
// probe는 엔진을 불러 값을 모으고, describe는 그 값으로 문장만 만든다.
// actor는 수를 두는 쪽, viewer는 해설을 읽는 쪽이다.
import {
  applyMove, arrow, at, boardFen, captures, cell, defenders, direction, isBetweenScreen, josa, label,
  lineSummary, material, owner, screenDirection, value, walk,
} from "./commentary.js";
import { mateIn } from "./engine.js";
import { CHO, Game, flipTurn, isPass, legalMovesOf, opponent, splitMove } from "./rules.js";

export const PROBE_NODES = 20000;  // 휴대폰에 맞춰 맥 버전보다 얕게 읽는다
const BRANCH_NODES = 4000;
const PV_KEEP = 6;
const BRANCHES = 3;
const BRANCH_PLIES = 8;
const THREAT_GAIN = 0.08, DANGER_DROP = 0.1, ONLY_MOVE_GAP = 0.1, EQUAL_GAP = 0.02, PATH_GAIN = 3;
const EASY_DEPTH = 3;
const VALUE_MIN = 0.6;  // 차례를 맞춰 비교해도 이보다 작은 변화는 대부분 측정 잡음이다
const VALUE_SHOWN = 3;
const TERM_MIN = 0.2;
const MIXED_GAP = 0.05;
const TERM_NAMES = [["King safety", "궁 안전"], ["Mobility", "기동력"], ["Threats", "위협"]];

const winRate = (score) => 1 / (1 + 10 ** (-Math.max(-3000, Math.min(3000, score)) / 400));
const percent = (score) => Math.floor(winRate(score) * 100 + 0.5);

// 소수 첫째 자리까지 부호를 붙여 쓴다. 맥과 휴대폰이 같은 값을 내도록 직접 반올림한다.
function signed(number) {
  const tenths = Math.floor(Math.abs(number) * 10 + 0.5);
  return `${number > 0 ? "+" : "-"}${(tenths / 10).toFixed(1)}`;
}

// 수순이 짧으면 이어서 읽어 결과가 드러나게 한다.
export async function extend(engine, fen, line, plies, nodes) {
  const game = new Game(fen, []);
  const kept = [];
  for (const move of line) {
    if (game.status() !== null || !game.legal().includes(move)) return kept;
    game.moves.push(move);
    kept.push(move);
  }
  while (kept.length < plies && game.status() === null) {
    const { best } = await engine.evaluate(game, nodes);
    if (!game.legal().includes(best)) break;
    game.moves.push(best);
    kept.push(best);
  }
  return kept;
}

// 가정 실험을 돌려 값만 모은다. 점수는 모두 actor 기준이다.
// chosen은 move가 엔진이 이미 고른 수라는 뜻이다. 같은 국면도 다시 읽으면 1순위가 바뀔 수 있어
// 앞서 고른 수를 최선이 아니라고 말하지 않게 한다.
export async function probe(engine, fen, move, actor, chosen = false) {
  const position = new Game(fen, []);
  const first = await engine.evaluate(position, PROBE_NODES);
  const raw = {
    fen, actor, move, before: first.score, engine_best: chosen ? move : first.best, trace: engine.trace.slice(),
    in_check: position.inCheck(), alts: await engine.topMoves(position, PROBE_NODES, 3),
  };
  const after = new Game(fen, [move]);
  const status = after.status();
  raw.finished = status !== null;
  if (!status) {
    const reply = await engine.evaluate(after, PROBE_NODES);
    raw.after = -reply.score;
    raw.gives_check = after.inCheck();
    raw.line = await extend(engine, fen, [move, ...reply.pv], BRANCH_PLIES, BRANCH_NODES);
    const wait = after.passMove();
    if (wait && !raw.gives_check) {
      const free = new Game(fen, [move, wait]);
      if (!free.status()) {
        const r = await engine.evaluate(free, PROBE_NODES);
        raw.threat = { wait, move: r.best, score: r.score, pv: r.pv.slice(0, PV_KEEP) };
      }
    }
    const afterFen = after.fen();
    raw.branches = [];
    for (const option of await engine.topMoves(after, BRANCH_NODES, BRANCHES)) {
      const line = await extend(engine, afterFen, [option.move], BRANCH_PLIES, BRANCH_NODES);
      raw.branches.push({ reply: option.move, score: -option.score, line });
    }
    if (!raw.in_check && !raw.gives_check && !isPass(move)) {
      // 신경망 값은 둘 차례만 바뀌어도 크게 흔들리므로 전후 모두 상대 차례로 맞춰 비교한다
      raw.values = {
        before: await engine.staticEval(new Game(flipTurn(fen), [])),
        after: await engine.staticEval(after),
      };
    }
  }
  const wait = raw.in_check ? null : position.passMove();
  if (wait) {
    const idle = new Game(fen, [wait]);
    if (!idle.status()) {
      const r = await engine.evaluate(idle, PROBE_NODES);
      const danger = {
        wait, move: r.best, score: -r.score, pv: r.pv.slice(0, PV_KEEP), still: null,
        possible: !status && after.legal().includes(r.best),
      };
      if (danger.possible) {
        const tried = new Game(fen, [move, r.best]);
        const result = tried.status();
        danger.still = result ? (result.winner === actor ? 3000 : -3000) : (await engine.evaluate(tried, PROBE_NODES)).score;
      }
      raw.danger = danger;
    }
  }
  return raw;
}

// actor와 viewer의 관계에 맞는 말을 고른다.
class Words {
  constructor(actor, viewer) {
    this.mine = actor === viewer;
    this.who = this.mine ? "내" : "상대";
    this.foe = this.mine ? "상대" : "내";
    this.actorIs = this.mine ? "내가" : "상대가";
    this.foeIs = this.mine ? "상대가" : "내가";
  }

  own(name) {
    return this.mine ? name : `상대 ${name}`;
  }
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

// 상대 궁성 안으로 들어갈 수 있는 내 말의 수
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

const squareOf = (r, c) => "abcdefghi"[c] + (10 - r);

function kingSquare(board, side) {
  const king = side === CHO ? "K" : "k";
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      if (board[r][c] === king) return squareOf(r, c);
    }
  }
  return null;
}

// side의 말 중 상대 궁을 바로 잡을 수 있는 말
function checkers(board, side) {
  const king = kingSquare(board, opponent(side));
  const found = new Set();
  for (const move of legalOf(board, side)) {
    if (!isPass(move) && splitMove(move)[1] === king) found.add(splitMove(move)[0]);
  }
  return [...found].sort();
}

// 수순에서 actor가 처음 말을 잡는 수를 찾는다. 궁은 제외한다.
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

// 상대가 가만히 있을 때 말을 잡거나 외통을 만드는 경우만 노림수로 본다.
function threatPoint(raw, boardAfter, viewer, w) {
  const { threat, actor } = raw;
  if (!threat || raw.after === undefined || isPass(threat.move)) return null;  // 한수쉼끼리 이어지면 대국이 끝나므로 노림수가 아니다
  const mate = mateIn(threat.score);
  const gain = winRate(threat.score) - winRate(raw.after);
  if (!(mate && mate > 0) && gain < THREAT_GAIN) return null;
  const arrows = [arrow(threat.move, w.mine ? "mine" : "theirs")];
  if (mate && mate > 0) {
    const name = w.own(label(boardAfter, splitMove(threat.move)[0], viewer));
    const tail = w.mine ? `첫 수는 ${name}${josa(name, "으로/로")} 둡니다.` : `첫 수는 ${name}입니다.`;
    const ending = w.mine ? "외통으로 끝납니다" : "외통을 당합니다";
    return { aim: "외통을 노리는", text: `${w.foeIs} 가만히 있으면 ${mate}수 안에 ${ending}. ${tail}`, arrows, board: boardAfter };
  }
  const goal = goalOf(boardAfter, threat.pv, actor, viewer);
  if (!goal || goal.index > 4) return null;
  const when = goal.index === 0 ? "다음 수에" : `${Math.floor(goal.index / 2) + 1}수 뒤에`;
  const piece = w.own(goal.piece), target = goal.target;
  return {
    aim: `${w.foe} ${target}${josa(target, "을/를")} 노리는`,
    text: `${w.foeIs} 가만히 있으면 ${when} ${piece}${josa(piece, "으로/로")} ${w.foe} ${target}${josa(target, "을/를")} 잡습니다.`,
    arrows: goal.index === 0 ? [arrow(goal.move, w.mine ? "mine" : "theirs")] : arrows, board: boardAfter,
  };
}

// 수를 두지 않고 가만히 있으면 상대가 얻는 것을 찾는다.
function dangerPoint(raw, board, viewer, w) {
  const { danger, actor } = raw;
  if (!danger || isPass(danger.move)) return null;
  const base = raw.after ?? raw.before;
  if (winRate(base) - winRate(danger.score) < DANGER_DROP) return null;
  const name = label(board, splitMove(danger.move)[0], viewer);
  const mate = mateIn(danger.score);
  const goal = goalOf(board, danger.pv, opponent(actor), viewer);
  const rate = `${w.mine ? "" : "상대 "}승률`;
  let what, short;
  if (mate && mate < 0) {
    what = w.mine ? `${-mate}수 안에 외통을 당합니다` : `${-mate}수 안에 내가 외통으로 이깁니다`;
    short = w.mine ? "상대의 외통" : "내 외통";
  } else if (goal) {
    const when = goal.index === 0 ? "바로" : `${Math.floor(goal.index / 2) + 1}수 뒤에`;
    const attacker = `${w.foe} ${goal.piece}`;
    what = `${when} ${attacker}${josa(attacker, "이/가")} ${w.who} ${goal.target}${josa(goal.target, "을/를")} 잡습니다`;
    short = `${w.who} ${goal.target}${josa(goal.target, "을/를")} 노리는 공격`;
  } else {
    const step = w.mine ? screenDirection(danger.move, viewer) : direction(danger.move, viewer);
    what = `${w.foe} ${name}${josa(name, "이/가")} ${step} 움직여 ${rate}이 ${percent(danger.score)}%까지 떨어집니다`;
    short = w.mine ? "상대의 공격" : "내 공격";
  }
  const prevented = !danger.possible || (danger.still !== null && winRate(danger.still) - winRate(danger.score) >= DANGER_DROP);
  const tail = prevented
    ? (w.mine ? "이 수가 그 공격을 막습니다." : "상대는 이 수로 그걸 막은 것입니다.")
    : "이 수를 두어도 위험이 다 사라지지는 않습니다.";
  return { prevented, short, text: `${w.actorIs} 가만히 있으면 ${what}. ${tail}`,
    arrows: [arrow(danger.move, w.mine ? "theirs" : "mine")], board };
}

const byGain = (x, y) => y[0] - x[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);

function structurePoints(raw, board, after, viewer, w) {
  const { actor, move } = raw;
  const [a, b] = splitMove(move);
  const points = [];
  if (a === b) return points;
  const enemy = opponent(actor);
  const kind = w.mine ? "mine" : "theirs";
  const mineBefore = movesByPiece(board, actor), mineAfter = movesByPiece(after, actor);
  const movedBefore = mineBefore[a] || 0, movedAfter = mineAfter[b] || 0;
  const moved = w.own(label(after, b, viewer));
  if (movedAfter - movedBefore >= PATH_GAIN + 1) {
    points.push({ kind: "active", text: `${moved}${josa(moved, "이/가")} 둘 수 있는 수가 ${movedBefore}개에서 ${movedAfter}개로 늘어 활동 범위가 넓어집니다.`, arrows: [arrow(move, kind)] });
  }
  const opened = [];
  for (const [s, n] of Object.entries(mineBefore)) {
    if (s !== a && s in mineAfter && mineAfter[s] - n >= PATH_GAIN && value(at(board, s)) >= 5) opened.push([mineAfter[s] - n, s, n]);
  }
  for (const [s, n] of Object.entries(mineAfter)) {
    if (!(s in mineBefore) && s !== b && value(at(board, s)) >= 5 && n >= PATH_GAIN) opened.push([n, s, 0]);
  }
  if (opened.length) {
    const [gain, square, count] = opened.sort(byGain)[0];
    const name = w.own(label(board, square, viewer));
    points.push({ kind: "open", name, text: `${name}의 길이 열립니다. 둘 수 있는 수가 ${count}개에서 ${count + gain}개로 늘어납니다.`, arrows: [arrow(move, kind)] });
  }
  const theirsBefore = movesByPiece(board, enemy), theirsAfter = movesByPiece(after, enemy);
  const blocked = [];
  for (const [s, n] of Object.entries(theirsBefore)) {
    const left = theirsAfter[s] || 0;
    if (at(after, s) === at(board, s) && n - left >= PATH_GAIN && value(at(board, s)) >= 5) blocked.push([n - left, s, n]);
  }
  if (blocked.length) {
    const [loss, square, count] = blocked.sort(byGain)[0];
    const name = `${w.foe} ${label(board, square, viewer)}`;
    points.push({ kind: "block", name, text: `${name}의 길을 막습니다. 둘 수 있는 수가 ${count}개에서 ${count - loss}개로 줄어듭니다.`, arrows: [arrow(move, kind)] });
  }
  const beforeP = palacePressure(board, actor), afterP = palacePressure(after, actor);
  if (afterP > beforeP) {
    points.push({ kind: "palace", text: `${w.foe} 궁성으로 들어갈 수 있는 ${w.who} 말이 ${beforeP}개에서 ${afterP}개로 늘어납니다.`, arrows: [arrow(move, kind)] });
  }
  return points;
}

function comparePoint(raw, board, viewer, w) {
  const { move } = raw;
  const alts = raw.alts.filter((x) => x.move !== move);
  const top = raw.alts.find((x) => x.move === move) || null;
  if (!alts.length) return { text: "이 국면에서 둘 만한 수는 사실상 이 수 하나입니다.", arrows: [] };
  const other = alts[0];
  const [a, b] = splitMove(other.move);
  let what = "한수쉼";
  if (a !== b) {
    const name = w.own(label(board, a, viewer));
    what = `${name}${josa(name, "을/를")} ${direction(other.move, viewer)} 두는 수`;
  }
  const arrows = a === b ? [] : [arrow(other.move, "option")];
  const prefix = w.mine ? "" : "상대 ";
  if (move !== raw.engine_best) {
    const lost = winRate(other.score) - (top ? winRate(top.score) : winRate(raw.after ?? 0));
    if (lost > EQUAL_GAP) {
      let text = `엔진은 ${what}를 더 좋게 봅니다(${prefix}승률 ${percent(other.score)}%). 이 수가 최선은 아니었습니다.`;
      if (!w.mine && lost >= MIXED_GAP) text += " 상대는 급수에 맞춰 최선이 아닌 수도 섞어 두므로 깊은 뜻이 없는 수일 수 있습니다.";
      return { text, arrows };
    }
  }
  if (!top) return { text: `다음 후보는 ${what}입니다(${prefix}승률 ${percent(other.score)}%).`, arrows };
  const gap = winRate(top.score) - winRate(other.score);
  const rates = `${prefix}승률 ${percent(top.score)}% 대 ${percent(other.score)}%`;
  let text;
  if (gap >= ONLY_MOVE_GAP) text = `다음 후보인 ${what}와 차이가 큽니다(${rates}). 사실상 이 수를 둬야 하는 국면입니다.`;
  else if (gap <= EQUAL_GAP) text = `${what}도 비슷하게 평가됩니다. 꼭 이 수여야 하는 건 아닙니다.`;
  else text = `다음 후보는 ${what}입니다(${rates}).`;
  return { text, arrows };
}

// 몇 수 앞까지 읽어야 이 수가 보이는지 알려 준다.
function depthPoint(raw, board, viewer, w) {
  const { trace, move } = raw;
  if (!trace.length || trace[trace.length - 1].move !== move) return null;
  let settled = trace.length - 1;
  while (settled > 0 && trace[settled - 1].move === move) settled -= 1;
  const { depth } = trace[settled];
  if (depth <= EASY_DEPTH || settled === 0) return "얕게 읽어도 바로 보이는 수입니다.";
  const previous = trace[settled - 1].move;
  const [a, b] = splitMove(previous);
  let what = "한수쉼";
  if (a !== b) {
    const name = label(board, a, viewer);
    what = `${w.own(name)}${josa(name, "을/를")} ${direction(previous, viewer)} 두는 수`;
  }
  return `엔진도 처음에는 ${what}를 골랐고, ${depth}수 앞까지 읽고서야 이 수로 바꿨습니다.`;
}

// 내가 둔 수가 얕은 수읽기에서는 1순위였는지 알려 준다.
export function trapPoint(trace, played, board) {
  const seen = trace.filter((t) => t.move === played).map((t) => t.depth);
  if (!seen.length || (trace.length && trace[trace.length - 1].move === played)) return null;
  return {
    text: `내가 둔 수는 엔진도 ${Math.max(...seen)}수 앞까지는 1순위로 본 수입니다. 얕게 보면 좋아 보이지만, 더 읽으면 문제가 드러납니다.`,
    arrows: [arrow(played, "mine")], board,
  };
}

const pattern = (name, text, arrows) => ({ name, text, arrows });

// src에서 dst로 갈 때 비어 있어야 하거나 받침이 놓이는 칸
function pathCells(piece, src, dst) {
  const [ra, ca] = cell(src), [rb, cb] = cell(dst);
  const dr = rb - ra, dc = cb - ca;
  const sr = Math.sign(dr), sc = Math.sign(dc);
  const kind = piece.toLowerCase();
  if ((kind === "r" || kind === "c") && (dr === 0 || dc === 0)) {
    const found = [];
    for (let i = 1; i < Math.max(Math.abs(dr), Math.abs(dc)); i++) found.push(squareOf(ra + sr * i, ca + sc * i));
    return found;
  }
  const first = Math.abs(dr) > Math.abs(dc) ? [ra + sr, ca] : [ra, ca + sc];
  if (kind === "n") return [squareOf(...first)];
  if (kind === "b") return [squareOf(...first), squareOf(first[0] + sr, first[1] + sc)];
  return [];
}

// 수의 모양을 규칙으로 판별한다. 이름이 있는 전술만 알린다.
function patternsOf(raw, board, after, viewer, w) {
  const { actor, move } = raw;
  const [a, b] = splitMove(move);
  if (a === b) return [];
  const enemy = opponent(actor);
  const kind = w.mine ? "mine" : "theirs";
  const found = [];
  const givesCheck = Boolean(raw.gives_check);

  // 두 말이 동시에 장군을 부른다
  const sources = checkers(after, actor);
  if (givesCheck && sources.length >= 2) {
    const king = kingSquare(after, enemy);
    found.push(pattern("양수겸장", "두 말이 동시에 장군을 부릅니다. 한 번에 둘 다 막기 어렵습니다.",
      sources.slice(0, 2).map((s) => arrow(s + king, kind))));
  }

  // 장군을 막으면서 되받아 장군을 부른다
  if (raw.in_check && givesCheck) {
    found.push(pattern("막으면서 장군", "장군을 막으면서 동시에 장군을 되받아 부릅니다.", [arrow(move, kind)]));
  }

  const old = new Set(captures(board, actor).map((x) => x.src + x.dst));
  const fresh = captures(after, actor).filter((x) => !old.has(x.src + x.dst) && x.dst !== b);
  const worthTaking = (x) => value(x.victim) >= 3 && (!defenders(after, x.dst).length || value(x.piece) < value(x.victim));

  // 한 말이 두 말을 동시에 노린다. 그 말이 바로 잡히면 공격이 성립하지 않는다
  const safe = !captures(after, enemy).some((x) => x.dst === b);
  const byMoved = fresh.filter((x) => x.src === b && worthTaking(x));
  if (byMoved.length >= 2 && safe) {
    const [first, second] = byMoved.slice(0, 2).map((x) => label(after, x.dst, viewer));
    found.push(pattern("두 말 동시 공격", `${w.foe} ${first}${josa(first, "과/와")} ${second}${josa(second, "을/를")} 한꺼번에 노립니다. 하나만 지킬 수 있습니다.`,
      byMoved.slice(0, 2).map((x) => arrow(x.src + x.dst, kind))));
  } else if (givesCheck && byMoved.length) {
    const name = `${w.foe} ${label(after, byMoved[0].dst, viewer)}`;
    found.push(pattern("장군과 말 공격", `장군을 부르면서 ${name}도 노립니다.`,
      [arrow(move, kind), arrow(byMoved[0].src + byMoved[0].dst, kind)]));
  }

  // 포 받침을 만든다
  const screened = fresh.find((x) => x.piece.toLowerCase() === "c" && isBetweenScreen(after, x.src, b, x.dst) && worthTaking(x));
  if (screened) {
    const cannon = w.own(label(after, screened.src, viewer));
    const target = `${w.foe} ${label(after, screened.dst, viewer)}`;
    const moved = w.own(label(after, b, viewer));
    found.push(pattern("포 받침 만들기", `${moved}${josa(moved, "이/가")} 받침이 되어 ${cannon}${josa(cannon, "이/가")} ${target}${josa(target, "을/를")} 노립니다.`,
      [arrow(screened.src + screened.dst, kind)]));
  }

  // 비켜서 뒤의 말이 공격하게 한다
  const opened = fresh.find((x) => x.src !== b && worthTaking(x) && pathCells(x.piece, x.src, x.dst).includes(a));
  if (opened && !screened) {
    const attacker = w.own(label(after, opened.src, viewer));
    const target = `${w.foe} ${label(after, opened.dst, viewer)}`;
    found.push(pattern("길 터서 공격", `말이 비키면서 ${attacker}${josa(attacker, "이/가")} ${target}${josa(target, "을/를")} 노리게 됩니다.`,
      [arrow(opened.src + opened.dst, kind)]));
  }

  // 상대 포의 받침을 치운다
  const stillThere = captures(after, enemy);
  for (const x of captures(board, enemy)) {
    const real = value(x.victim) >= 3 && (!defenders(board, x.dst).length || value(x.victim) > value(x.piece));
    if (real && x.piece.toLowerCase() === "c" && isBetweenScreen(board, x.src, a, x.dst)
        && !stillThere.some((y) => y.src === x.src && y.dst === x.dst) && x.dst !== a) {
      const target = `${w.who} ${label(board, x.dst, viewer)}`;
      found.push(pattern("포 받침 치우기", `${w.foe} 포의 받침이 되어 있던 말을 치워 ${target}${josa(target, "을/를")} 지킵니다.`,
        [arrow(x.src + x.dst, "option")]));
      break;
    }
  }

  // 지키는 말을 잡아 다른 말을 무방비로 만든다
  const victim = at(board, b);
  if (victim) {
    for (const x of captures(after, actor)) {
      const was = x.dst !== b ? defenders(board, x.dst).map((d) => d.src) : [];
      if (was.includes(b) && !defenders(after, x.dst).length && value(x.victim) >= 3) {
        const target = `${w.foe} ${label(after, x.dst, viewer)}`;
        found.push(pattern("지키는 말 잡기", `${target}${josa(target, "을/를")} 지키던 말을 잡아 무방비로 만듭니다.`,
          [arrow(move, kind), arrow(x.src + x.dst, kind)]));
        break;
      }
    }
  }

  // 상대 궁이 피할 칸을 줄인다
  const king = kingSquare(board, enemy);
  if (king) {
    const beforeMoves = movesByPiece(board, enemy)[king] || 0;
    const afterMoves = movesByPiece(after, enemy)[king] || 0;
    if (beforeMoves >= 2 && afterMoves <= 1 && !givesCheck) {
      found.push(pattern("궁 가두기", `${w.foe} 궁이 움직일 수 있는 수가 ${beforeMoves}개에서 ${afterMoves}개로 줄어듭니다.`, [arrow(move, kind)]));
    }
  }

  // 말을 내주고 더 큰 것을 얻는다. 엔진 수순에서 상대가 실제로 잡아야 희생이다
  const line = raw.line || [];
  if (line.length >= 2 && !victim && value(at(board, a)) >= 3 && splitMove(line[1])[1] === b) {
    let end = board;
    for (const step of line) end = applyMove(end, step);
    if (material(end, actor) > material(board, actor)) {
      const moved = w.own(label(after, b, viewer));
      found.push(pattern("말 버리기", `${moved}${josa(moved, "을/를")} 일부러 내주고, 이어지는 수순에서 그보다 큰 이득을 봅니다.`, [arrow(move, kind)]));
    }
  }
  return found;
}

// 신경망이 보는 말별 가치가 이 수로 어떻게 바뀌는지 고른다.
function valueChanges(raw, board, after, viewer) {
  const beforeV = raw.values?.before?.pieces, afterV = raw.values?.after?.pieces;
  if (!beforeV || !afterV || !Object.keys(beforeV).length || !Object.keys(afterV).length) return null;
  const [a, b] = splitMove(raw.move);
  const changes = [];
  for (const [square, now] of Object.entries(afterV)) {
    const origin = square === b && a !== b ? a : square;
    if (!(origin in beforeV)) continue;
    const delta = Math.abs(now) - Math.abs(beforeV[origin]);
    if (Math.abs(delta) >= VALUE_MIN) {
      const mine = owner(at(after, square)) === viewer;
      changes.push({ square, delta, mine, good: (delta > 0) === mine, name: label(after, square, viewer) });
    }
  }
  if (!changes.length) return null;
  changes.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta) || (x.square < y.square ? -1 : 1));
  const top = changes.slice(0, VALUE_SHOWN);
  const parts = top.map((c) => `${c.mine ? "내" : "상대"} ${c.name} ${signed(c.delta)}`);
  return {
    text: `신경망이 보는 말 가치 변화(1.0은 졸 하나 정도): ${parts.join(", ")}.`,
    badges: top.map((c) => ({ square: c.square, text: signed(c.delta), good: c.good })),
    board: after,
  };
}

// 옛 수작업 평가식의 항목 변화. 신경망 판단과 다를 수 있어 참고용이다.
function termChanges(raw, viewer) {
  const beforeT = raw.values?.before?.terms, afterT = raw.values?.after?.terms;
  if (!beforeT || !afterT || !Object.keys(beforeT).length || !Object.keys(afterT).length) return null;
  const sign = viewer === CHO ? 1 : -1;
  const parts = [];
  for (const [key, name] of TERM_NAMES) {
    if (key in beforeT && key in afterT) {
      const delta = (afterT[key] - beforeT[key]) * sign;
      if (Math.abs(delta) >= TERM_MIN) parts.push(`${name} ${signed(delta)}`);
    }
  }
  if (!parts.length) return null;
  return `수작업 평가식으로는 내 쪽 ${parts.join(", ")}입니다. 신경망과 판단이 다를 수 있어 참고만 하세요.`;
}

// 이 수에 대한 응수를 '~면' 꼴로 짧게 쓴다. 응수하는 쪽은 actor의 상대다.
function replyTitle(board, move, viewer, w) {
  const [a, b] = splitMove(move);
  if (a === b) return "한수쉼으로 넘기면";
  const name = `${w.foe} ${label(board, a, viewer)}`;
  if (at(board, b)) {
    const target = `${w.who} ${label(board, b, viewer)}`;
    return `${name}${josa(name, "이/가")} ${target}${josa(target, "을/를")} 잡으면`;
  }
  const step = w.foe === "내" ? direction(move, viewer) : screenDirection(move, viewer);
  return `${name}${josa(name, "을/를")} ${step} 두면`;
}

function branchViews(raw, after, viewer, w) {
  const fen = boardFen(after, opponent(raw.actor));
  const views = [];
  for (const branch of raw.branches || []) {
    const steps = walk(fen, branch.line, viewer);
    if (!steps.length) continue;
    const rate = w.mine ? percent(branch.score) : 100 - percent(branch.score);
    views.push({ title: replyTitle(after, branch.reply, viewer, w), rate, steps, summary: lineSummary(after, steps, viewer) });
  }
  return views;
}

// 실험값을 해설로 바꾼다. 판과 규칙만 쓰고 엔진은 부르지 않는다.
export function describe(raw, viewer = null) {
  const { fen, actor, move } = raw;
  viewer = viewer || actor;
  const w = new Words(actor, viewer);
  const board = new Game(fen, []).board();
  const after = applyMove(board, move);
  const [a, b] = splitMove(move);
  const kind = w.mine ? "mine" : "theirs";
  const victim = a !== b ? at(board, b) : "";
  const name = a !== b ? w.own(label(board, a, viewer)) : "";
  const threat = raw.finished ? null : threatPoint(raw, after, viewer, w);
  const danger = dangerPoint(raw, board, viewer, w);
  const structure = structurePoints(raw, board, after, viewer, w);
  const tactics = patternsOf(raw, board, after, viewer, w);

  let headline;
  if (raw.finished) headline = "이 수로 대국을 끝냅니다";
  else if (a === b) headline = "말을 움직이지 않고 기다리는 수";
  else if (raw.in_check) headline = "장군을 풀어내는 수";
  else if (victim && value(victim) >= 3) {
    const target = `${w.foe} ${label(board, b, viewer)}`;
    headline = `${target}${josa(target, "을/를")} 잡는 수`;
  } else if (danger?.prevented && threat) headline = `${danger.short}을 막으면서 ${threat.aim} 수`;
  else if (danger?.prevented) headline = `${danger.short}을 막는 수`;
  else if (victim) {
    const target = `${w.foe} ${label(board, b, viewer)}`;
    headline = `${target}${josa(target, "을/를")} 잡는 수`;
  } else if (raw.gives_check) headline = "장군으로 몰아붙이는 수";
  else if (threat) headline = `${threat.aim} 수`;
  else {
    const opened = structure.find((p) => p.kind === "open");
    const blocked = structure.find((p) => p.kind === "block");
    if (opened) headline = `${opened.name}의 길을 여는 준비 수`;
    else if (blocked) headline = `${blocked.name}의 길을 막는 수`;
    else if (structure.some((p) => p.kind === "palace")) headline = `${w.foe} 궁성을 압박하는 수`;
    else if (structure.length) headline = `${name}${josa(name, "을/를")} 좋은 자리로 옮기는 수`;
    else headline = "뚜렷한 노림수가 보이지 않는 수";
  }

  const points = [];
  if (raw.gives_check) {
    points.push({ text: `${name}${josa(name, "으로/로")} 장군을 불러 ${w.foeIs} 먼저 궁을 지켜야 합니다.`, arrows: [arrow(move, kind)], board: after });
  }
  if (threat) points.push({ text: threat.text, arrows: threat.arrows, board: threat.board });
  if (danger) points.push({ text: danger.text, arrows: danger.arrows, board: danger.board });
  for (const point of structure) points.push({ text: point.text, arrows: point.arrows, board: after });
  const compare = comparePoint(raw, board, viewer, w);
  if (compare) points.push({ text: compare.text, arrows: compare.arrows, board });
  return {
    headline, points,
    patterns: tactics.map((p) => ({ ...p, board: after })),
    depth: depthPoint(raw, board, viewer, w),
    branches: branchViews(raw, after, viewer, w),
    values: valueChanges(raw, board, after, viewer),
    terms: termChanges(raw, viewer),
  };
}
