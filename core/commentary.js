// 엔진 수순과 판 상태에서 복기 해설 문장을 만든다. 맥 버전 janggi/commentary.py를 옮긴 것이다.
// 문장은 모두 규칙으로 확인한 사실에서만 만들고, 확인되는 이유가 없으면 모른다고 말한다.
import { CHO, HAN, Game, PIECE_VALUE, isPass, legalMovesOf, givesCheck, opponent, splitMove } from "./rules.js";

const HABITS = {
  hung_piece: "말을 옮기기 전에 도착할 칸을 상대가 잡을 수 있는지, 내 말이 지키고 있는지 확인하세요.",
  ignored_threat: "수를 두기 전에 상대가 방금 둔 수가 무엇을 노리는지 먼저 보세요.",
  missed_capture: "내 수를 찾기 전에 공짜로 잡을 수 있는 상대 말이 있는지 먼저 훑어보세요.",
  missed_mate: "장군을 부를 수 있을 때는 상대 궁이 피할 칸을 먼저 세어 보세요.",
  allowed_mate: "수를 두기 전에 내 궁이 피할 칸이 남아 있는지, 상대가 장군을 부를 수 있는지 확인하세요.",
  positional: "당장 잡히는 말이 없어도 내 말이 움직일 길이 막히지 않는지 살펴보세요.",
  missed_win: "점수가 앞설 때는 한수쉼이나 빅장으로 대국을 끝낼 수 있는지 확인하세요.",
  allowed_loss: "점수가 뒤질 때는 상대가 한수쉼이나 빅장으로 대국을 끝낼 수 있는지 확인하세요.",
};

export function josa(word, pair) {
  const final = (word.charCodeAt(word.length - 1) - 0xac00) % 28;
  if (pair === "으로/로") return final === 0 || final === 8 ? "로" : "으로";
  const [withFinal, without] = pair.split("/");
  return final ? withFinal : without;
}

export const cell = (sq) => [10 - Number(sq.slice(1)), sq.charCodeAt(0) - 97];
const squareOf = (r, c) => "abcdefghi"[c] + (10 - r);
export const at = (board, sq) => { const [r, c] = cell(sq); return board[r][c]; };
const isUpper = (p) => p === p.toUpperCase();
export const owner = (p) => (isUpper(p) ? CHO : HAN);
export const value = (p) => PIECE_VALUE[p.toLowerCase()] || 0;

export function applyMove(board, move) {
  const [a, b] = splitMove(move);
  const out = board.map((row) => row.slice());
  if (a !== b) {
    const [ra, ca] = cell(a), [rb, cb] = cell(b);
    out[rb][cb] = out[ra][ca];
    out[ra][ca] = "";
  }
  return out;
}

export function boardFen(board, side) {
  const rows = board.map((row) => {
    let text = "", empty = 0;
    for (const p of row) {
      if (p) {
        text += (empty || "") + p;
        empty = 0;
      } else {
        empty += 1;
      }
    }
    return text + (empty || "");
  });
  return `${rows.join("/")} ${side === CHO ? "w" : "b"} - - 0 1`;
}

function legalOf(board, side) {
  try {
    return legalMovesOf(boardFen(board, side));
  } catch {
    return [];
  }
}

export function captures(board, side) {
  const found = [];
  for (const move of legalOf(board, side)) {
    const [a, b] = splitMove(move);
    const victim = at(board, b);
    if (a !== b && victim && owner(victim) !== side && victim.toLowerCase() !== "k") {
      found.push({ src: a, dst: b, piece: at(board, a), victim });
    }
  }
  return found;
}

const mobility = (board, side) => legalOf(board, side).filter((m) => !isPass(m)).length;

export function defenders(board, square) {
  const mine = owner(at(board, square));
  const test = board.map((row) => row.slice());
  const [r, c] = cell(square);
  test[r][c] = mine === CHO ? "p" : "P";
  return captures(test, mine).filter((x) => x.dst === square);
}

export function pieceName(p) {
  return { r: "차", c: "포", n: "마", b: "상", a: "사", k: "궁", p: isUpper(p) ? "졸" : "병" }[p.toLowerCase()];
}

export function label(board, square, viewer) {
  const piece = at(board, square);
  const name = pieceName(piece);
  const same = [];
  board.forEach((row, r) => row.forEach((p, c) => { if (p === piece) same.push(squareOf(r, c)); }));
  if (same.length === 1) return name;
  const column = (s) => (viewer === CHO ? cell(s)[1] : 8 - cell(s)[1]);
  const col = column(square);
  if (piece.toLowerCase() === "p" && same.length > 2) {
    if (col === 4) return `가운데 ${name}`;
    return `${col < 4 ? "왼쪽" : "오른쪽"}${col === 0 || col === 8 ? " 끝" : ""} ${name}`;
  }
  const others = same.filter((s) => s !== square).map(column);
  if (others.every((o) => o > col)) return `왼쪽 ${name}`;
  if (others.every((o) => o < col)) return `오른쪽 ${name}`;
  return `가운데 ${name}`;
}

export function direction(move, viewer) {
  const [a, b] = splitMove(move);
  const [ra, ca] = cell(a), [rb, cb] = cell(b);
  const forward = viewer === CHO ? ra - rb : rb - ra;
  const right = viewer === CHO ? cb - ca : ca - cb;
  const sideWord = right > 0 ? "오른쪽" : "왼쪽";
  if (right === 0) return forward > 0 ? "앞으로" : "뒤로";
  if (forward === 0) return `${sideWord}으로`;
  return `${sideWord} ${forward > 0 ? "앞으로" : "뒤로"}`;
}

export function screenDirection(move, viewer) {
  return direction(move, viewer).replace("앞으로", "위로").replace("뒤로", "아래로");
}

export function arrow(move, kind) {
  const [a, b] = splitMove(move);
  return { from: a, to: b, kind };
}

export function material(board, side) {
  let total = 0;
  for (const row of board) {
    for (const p of row) {
      if (p) total += owner(p) === side ? value(p) : -value(p);
    }
  }
  return total;
}

function isBetweenScreen(board, cannon, screen, target) {
  const [rc, cc] = cell(cannon), [rt, ct] = cell(target);
  if (rc !== rt && cc !== ct) return false;
  const cells = [];
  if (rc === rt) {
    for (let c = Math.min(cc, ct) + 1; c < Math.max(cc, ct); c++) cells.push([rc, c]);
  } else {
    for (let r = Math.min(rc, rt) + 1; r < Math.max(rc, rt); r++) cells.push([r, cc]);
  }
  const filled = cells.filter(([r, c]) => board[r][c]);
  const [sr, sc] = cell(screen);
  return filled.length === 1 && filled[0][0] === sr && filled[0][1] === sc;
}

function narrate(board, move, viewer, first = false) {
  const [a, b] = splitMove(move);
  const piece = at(board, a);
  const who = owner(piece) === viewer ? "내" : "상대";
  if (a === b) return `${who === "내" ? "내가" : "상대가"} 한수쉼을 합니다.`;
  const name = label(board, a, viewer);
  if (at(board, b)) {
    const whose = who === "내" ? "상대" : "내";
    const target = label(board, b, viewer);
    return `${who} ${name}${josa(name, "이/가")} ${whose} ${target}${josa(target, "을/를")} 잡습니다.`;
  }
  if (first && who === "내") return `내가 ${name}${josa(name, "을/를")} ${direction(move, viewer)} 옮겼습니다.`;
  if (who === "내") return `내 ${name}${josa(name, "을/를")} ${direction(move, viewer)} 옮깁니다.`;
  return `상대 ${name}${josa(name, "이/가")} ${screenDirection(move, viewer)} 움직입니다.`;
}

function walk(fen, line, viewer) {
  const game = new Game(fen, []);
  const steps = [];
  line.forEach((move, index) => {
    if (steps.length !== index) return;
    if (game.status() !== null || !game.legal().includes(move)) return;
    const board = game.board();
    let text = narrate(board, move, viewer, index === 0);
    game.moves.push(move);
    const status = game.status();
    const [a, b] = splitMove(move);
    if (status && status.reason === "checkmate") text += " 외통입니다.";
    else if (game.inCheck()) text += " 장군입니다.";
    const piece = at(board, a);
    steps.push({
      board: game.board(),
      turn: game.turn,
      last: { from: a, to: b, pass: a === b },
      arrows: a === b ? [] : [arrow(move, piece && owner(piece) === viewer ? "mine" : "theirs")],
      text,
    });
  });
  return steps;
}

function lineSummary(start, steps, side) {
  if (!steps.length) return null;
  const delta = material(steps[steps.length - 1].board, side) - material(start, side);
  if (delta < 0) return `이 수순이 끝나면 말 점수로 ${-delta}점 손해입니다.`;
  if (delta > 0) return `이 수순이 끝나면 말 점수로 ${delta}점 이득입니다.`;
  return "이 수순에서는 말 점수 변화가 없습니다.";
}

function escapeReport(board, side) {
  const king = side === CHO ? "K" : "k";
  let spot = null;
  board.forEach((row, r) => row.forEach((p, c) => { if (p === king && !spot) spot = [r, c]; }));
  if (!spot) return null;
  const [r, c] = spot;
  const top = side === CHO ? 7 : 0;
  const [cx, cy] = [top + 1, 4];
  const diagonalOk = (r === cx && c === cy) || (Math.abs(r - cx) === 1 && Math.abs(c - cy) === 1);
  const palace = [];
  for (const dr of [-1, 0, 1]) {
    for (const dc of [-1, 0, 1]) {
      if (!dr && !dc) continue;
      const [x, y] = [r + dr, c + dc];
      if (x < top || x > top + 2 || y < 3 || y > 5) continue;
      if (x === r || y === c || (diagonalOk && x === cx && y === cy) || (r === cx && c === cy)) palace.push([x, y]);
    }
  }
  if (!palace.length) return null;
  const blocked = palace.filter(([x, y]) => board[x][y] && owner(board[x][y]) === side).length;
  const open = palace.length - blocked;
  if (!open) return `궁이 갈 수 있는 칸 ${palace.length}곳이 모두 내 말로 막혀 있습니다.`;
  const parts = [];
  if (blocked) parts.push(`${blocked}곳은 내 말이 막고 있고`);
  parts.push(`${open}곳은 상대 말이 지키고 있습니다`);
  return `궁이 갈 수 있는 칸 ${palace.length}곳 중 ${parts.join(" ")}.`;
}

function reasonsAgainst(board, played, side) {
  const enemy = opponent(side);
  const after = applyMove(board, played);
  const [a, b] = splitMove(played);
  const found = [];
  const beforeThreats = captures(board, enemy);
  const afterThreats = captures(after, enemy);
  const attackersOf = afterThreats.filter((x) => x.dst === b);
  const movedName = a !== b ? label(after, b, side) : null;

  if (a !== b && attackersOf.length) {
    const attacker = attackersOf.reduce((m, x) => (value(x.piece) < value(m.piece) ? x : m));
    const guards = defenders(after, b);
    const piece = at(after, b);
    const name = label(after, attacker.src, side);
    if (!guards.length) {
      found.push({
        text: `옮긴 ${movedName}${josa(movedName, "이/가")} 도착한 칸은 상대 ${name}${josa(name, "이/가")} 바로 잡을 수 있고, 지켜 주는 내 말이 없습니다.`,
        arrows: [arrow(attacker.src + attacker.dst, "theirs")],
      });
    } else if (value(attacker.piece) < value(piece)) {
      const guard = label(after, guards[0].src, side);
      found.push({
        text: `${guard}${josa(guard, "이/가")} 지키고 있어도 상대 ${name}(${value(attacker.piece)}점)와 내 ${movedName}(${value(piece)}점)를 바꾸면 손해입니다.`,
        arrows: [arrow(attacker.src + attacker.dst, "theirs"), arrow(guards[0].src + guards[0].dst, "mine")],
      });
    }
  }

  const old = new Set(beforeThreats.map((x) => x.dst));
  for (const x of afterThreats) {
    if (x.dst === b || !old.has(x.dst)) continue;
    if (defenders(after, x.dst).length && value(x.piece) >= value(x.victim)) continue;
    const name = label(after, x.dst, side);
    const attacker = label(after, x.src, side);
    found.push({
      text: `상대 ${attacker}${josa(attacker, "이/가")} 노리던 내 ${name}${josa(name, "을/를")} 그대로 뒀습니다.`,
      arrows: [arrow(x.src + x.dst, "theirs")], kind: "ignored_threat",
    });
    break;
  }

  for (const x of afterThreats) {
    if (x.dst === b || old.has(x.dst) || a === b) continue;
    if (defenders(after, x.dst).length && value(x.piece) >= value(x.victim)) continue;
    const name = label(after, x.dst, side);
    const attacker = label(after, x.src, side);
    let text;
    if (x.piece.toLowerCase() === "c" && isBetweenScreen(after, x.src, b, x.dst)) {
      text = `내 ${movedName}${josa(movedName, "이/가")} 상대 ${attacker}의 받침이 되어 내 ${name}${josa(name, "이/가")} 잡히게 됐습니다.`;
    } else if (defenders(board, x.dst).length && !defenders(after, x.dst).length) {
      text = `${movedName}${josa(movedName, "이/가")} 자리를 옮기면서 지켜 주던 내 ${name}${josa(name, "이/가")} 상대 ${attacker}에게 잡히게 됐습니다.`;
    } else {
      text = `이 수로 길이 열려 상대 ${attacker}${josa(attacker, "이/가")} 내 ${name}${josa(name, "을/를")} 노리게 됐습니다.`;
    }
    found.push({ text, arrows: [arrow(x.src + x.dst, "theirs")] });
    break;
  }

  if (!found.length) {
    const mineBefore = mobility(board, side), mineAfter = mobility(after, side);
    const theirsBefore = mobility(board, enemy), theirsAfter = mobility(after, enemy);
    if (mineAfter <= mineBefore - 4) {
      found.push({ text: `내가 둘 수 있는 수가 ${mineBefore}개에서 ${mineAfter}개로 줄어 말이 답답해졌습니다.`, arrows: [] });
    }
    if (theirsAfter >= theirsBefore + 4) {
      found.push({ text: `상대가 둘 수 있는 수가 ${theirsBefore}개에서 ${theirsAfter}개로 늘어 상대 말이 더 자유로워졌습니다.`, arrows: [] });
    }
  }
  return found;
}

function reasonsFor(board, best, side) {
  const enemy = opponent(side);
  const [a, b] = splitMove(best);
  if (a === b) return [{ text: "지금은 말을 움직이지 않고 한수쉼을 하는 편이 낫습니다.", arrows: [] }];
  const after = applyMove(board, best);
  const name = label(board, a, side);
  const found = [];
  if (at(board, b)) {
    const target = label(board, b, side);
    const tail = defenders(board, b).length ? "지키는 말이 있어도 교환이 이득입니다." : "지키는 말이 없어 공짜로 잡을 수 있습니다.";
    found.push({ text: `${name}${josa(name, "으로/로")} 상대 ${target}${josa(target, "을/를")} 잡습니다. ${tail}`, arrows: [arrow(best, "mine")] });
  }
  if (new Game(boardFen(after, enemy)).inCheck()) {
    found.push({ text: `${name}${josa(name, "으로/로")} 장군을 불러 상대가 먼저 궁을 지키게 만듭니다.`, arrows: [arrow(best, "mine")] });
  }
  const beforeThreats = new Map();
  for (const x of captures(board, enemy)) beforeThreats.set(x.dst, x);
  const afterThreats = new Set(captures(after, enemy).map((x) => x.dst));
  for (const [square, x] of beforeThreats) {
    const safe = !afterThreats.has(square) && square !== a;
    if (safe || (square === a && !afterThreats.has(b))) {
      const target = square !== a ? square : b;
      const piece = label(after, target, side);
      const attacker = label(board, x.src, side);
      const verb = `${piece}${josa(piece, "을/를")} ${square === a ? "피합니다" : "지킵니다"}`;
      found.push({ text: `상대 ${attacker}${josa(attacker, "이/가")} 노리던 내 ${verb}.`, arrows: [arrow(best, "mine"), arrow(x.src + x.dst, "theirs")] });
      break;
    }
  }
  const myBefore = new Set(captures(board, side).map((x) => x.dst));
  for (const x of captures(after, side)) {
    if (!myBefore.has(x.dst) && x.dst !== b && value(x.victim) >= 3 && !defenders(after, x.dst).length) {
      const target = label(after, x.dst, side);
      found.push({ text: `다음 수에 상대 ${target}${josa(target, "을/를")} 잡을 수 있게 됩니다.`, arrows: [arrow(best, "mine"), arrow(x.src + x.dst, "mine")] });
      break;
    }
  }
  if (!found.length) {
    const mineBefore = mobility(board, side), mineAfter = mobility(after, side);
    if (mineAfter >= mineBefore + 4) {
      found.push({ text: `내가 둘 수 있는 수가 ${mineBefore}개에서 ${mineAfter}개로 늘어 말이 살아납니다.`, arrows: [arrow(best, "mine")] });
    }
  }
  return found;
}

function summaryGap(playedSteps, bestSteps, side) {
  if (!playedSteps.length || !bestSteps.length) return 0;
  return material(bestSteps[bestSteps.length - 1].board, side) - material(playedSteps[playedSteps.length - 1].board, side);
}

function firstLoss(start, steps, side) {
  for (let index = 0; index < steps.length; index++) {
    const before = index ? steps[index - 1].board : start;
    const last = steps[index].last;
    const victim = last.pass ? "" : at(before, last.to);
    if (!victim || owner(victim) !== side) continue;
    const mover = at(before, last.from);
    if (index + 1 < steps.length && steps[index + 1].last.to === last.to && value(mover) >= value(victim)) continue;
    const later = Math.floor((index + 1) / 2);
    const name = label(before, last.from, side);
    const target = label(before, last.to, side);
    const when = later <= 1 ? "바로" : `${later}수 뒤에`;
    return {
      text: `이어지는 수순에서 ${when} 상대 ${name}${josa(name, "이/가")} 내 ${target}${josa(target, "을/를")} 잡습니다.`,
      arrows: [arrow(last.from + last.to, "theirs")], step: index,
    };
  }
  return null;
}

function checkChances(board, side) {
  const fen = boardFen(board, side);
  try {
    // 차례를 바꾼 국면이라 궁을 잡는 수가 나올 수 있다. 궁이 없는 판은 규칙 코드가 처리하지 못한다.
    const moves = legalMovesOf(fen).filter((m) => at(board, splitMove(m)[1]).toLowerCase() !== "k");
    return moves.filter((m) => givesCheck(fen, [m])).length;
  } catch {
    return 0;
  }
}

const sameArrow = (x, y) => x.from === y.from && x.to === y.to && x.kind === y.kind;

export function lesson(fen, side, played, best, kind, playedPv, bestPv) {
  const board = new Game(fen).board();
  const playedSteps = walk(fen, [played, ...playedPv], side);
  const bestSteps = walk(fen, bestPv.length ? bestPv : [best], side);
  let why = reasonsAgainst(board, played, side);
  const better = reasonsFor(board, best, side);
  const loss = firstLoss(board, playedSteps, side);
  if (loss && !why.some((r) => r.arrows.some((a) => sameArrow(a, loss.arrows[0])))) why.push(loss);
  const enemy = opponent(side);
  const before = checkChances(board, enemy), after = checkChances(applyMove(board, played), enemy);
  if (after >= before + 2) {
    why.push({ text: `상대가 장군을 부를 수 있는 수가 ${before}개에서 ${after}개로 늘어 궁이 위험해졌습니다.`, arrows: [] });
  }
  const gap = summaryGap(playedSteps, bestSteps, side);
  if (gap >= 2) why.push({ text: `엔진 수순과 끝 형세를 비교하면 말 점수로 ${gap}점 뒤집니다.`, arrows: [] });
  let habit = kind;
  if (why.some((r) => r.kind === "ignored_threat") && (kind === "hung_piece" || kind === "positional")) habit = "ignored_threat";
  let playedSummary = lineSummary(board, playedSteps, side);
  const bestSummary = lineSummary(board, bestSteps, side);
  if (playedSteps.length && kind === "allowed_mate") {
    const report = escapeReport(playedSteps[playedSteps.length - 1].board, side);
    if (report) playedSummary = report;
  }
  const certain = why.length > 0 || kind !== "positional";
  if (!certain) {
    why = [{ text: "엔진은 이 수를 나쁘게 보지만, 말 손해나 위협처럼 짚어 말할 이유는 찾지 못했습니다. 수순을 보며 비교해 보세요.", arrows: [] }];
  }
  return {
    why, better,
    played_steps: playedSteps, best_steps: bestSteps,
    played_summary: playedSummary, best_summary: bestSummary,
    habit: HABITS[habit] || HABITS.positional,
    certain, after_played: applyMove(board, played),
  };
}
