// 브라우저 안에서 도는 엔진 연결과 급수별 수 선택. 맥 버전 janggi/engine.py와 같은 방식이다.
const NETWORK = "janggi-9991472750de.nnue";
const MATE_BASE = 30000;
const TERM = /^\|\s*(Mobility|King safety|Threats)\s*\|.*\|\s*(-?\d+\.\d+)\s+-?\d+\.\d+\s*\|$/;

export class EngineError extends Error {}

export function mateIn(score) {
  if (Math.abs(score) < MATE_BASE - 10000) return null;
  const n = Math.floor((MATE_BASE - Math.abs(score)) / 100);
  return score > 0 ? n : -n;
}

// 엔진의 eval 출력에서 말별 가치와 평가 항목을 뽑는다. 장군 상태면 비어 있다.
export function parseEval(lines) {
  const terms = {}, pieces = {}, rows = [];
  let inTable = false;
  for (const text of lines) {
    const line = text.trim();
    const term = TERM.exec(line);
    if (term) terms[term[1]] = Number(term[2]);
    if (line.includes("piece values")) inTable = true;
    else if (inTable && line.startsWith("|")) rows.push(line);
    else if (inTable && !line.startsWith("+")) inTable = false;
  }
  for (let index = 0; index + 1 < rows.length; index += 2) {
    const names = rows[index].split("|").slice(1, 10);
    const values = rows[index + 1].split("|").slice(1, 10);
    names.forEach((name, column) => {
      if (name.trim() && values[column]?.trim()) {
        pieces["abcdefghi"[column] + (10 - index / 2)] = Number(values[column]);
      }
    });
  }
  return { terms, pieces };
}

export class Engine {
  static async create(onProgress = () => {}) {
    if (!window.crossOriginIsolated) {
      throw new EngineError("이 브라우저에서는 AI를 실행할 수 없습니다. 앱을 새로고침해 보세요.");
    }
    onProgress("AI를 불러오는 중");
    let sf;
    try {
      sf = await window.Stockfish({
        locateFile: (file) => new URL(`vendor/${file}`, document.baseURI).href,
        mainScriptUrlOrBlob: new URL("vendor/stockfish.js", document.baseURI).href,
      });
    } catch (error) {
      throw new EngineError(`AI를 시작하지 못했습니다: ${error}`);
    }
    onProgress("신경망을 불러오는 중");
    const response = await fetch(`engine/${NETWORK}`);
    if (!response.ok) throw new EngineError("신경망 파일을 받지 못했습니다.");
    sf.FS.writeFile(`/${NETWORK}`, new Uint8Array(await response.arrayBuffer()));
    const engine = new Engine(sf);
    await engine.boot();
    return engine;
  }

  constructor(sf) {
    this.sf = sf;
    this.options = {};
    this.lines = [];
    this.waiter = null;
    this.trace = [];  // 마지막 탐색에서 깊이별로 1순위가 어떻게 바뀌었는지
    sf.addMessageListener((line) => {
      if (this.waiter) this.waiter(line);
      else this.lines.push(line);
    });
  }

  send(text) {
    this.sf.postMessage(text);
  }

  next(timeoutMs = 120000) {
    if (this.lines.length) return Promise.resolve(this.lines.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new EngineError("AI 응답 시간이 초과됐습니다."));
      }, timeoutMs);
      this.waiter = (line) => {
        clearTimeout(timer);
        this.waiter = null;
        resolve(line);
      };
    });
  }

  async until(prefix) {
    for (;;) {
      const line = await this.next();
      if (line.startsWith(prefix)) return line;
    }
  }

  ready() {
    this.send("isready");
    return this.until("readyok");
  }

  set(name, value) {
    const text = String(value);
    if (this.options[name] !== text) {
      this.send(`setoption name ${name} value ${text}`);
      this.options[name] = text;
    }
  }

  async boot() {
    this.send("uci");
    await this.until("uciok");
    this.set("UCI_Variant", "janggi");
    this.set("EvalFile", NETWORK);
    this.set("Threads", 1);
    this.set("Hash", 16);
    await this.ready();
  }

  async newGame() {
    this.send("ucinewgame");
    await this.ready();
  }

  async choose(game, level) {
    let temperature = 0, mpv = 1, skill = 20, go;
    if (level.kind === "skill") {
      skill = level.skill;
      go = `go depth ${level.depth ?? 1 + Math.max(skill, 0)}`;
    } else if (level.kind === "soft") {
      temperature = level.T;
      mpv = level.mpv;
      const whole = Math.floor(level.depth);  // 2.4처럼 소수면 수마다 2와 3을 40% 비율로 섞는다
      go = `go depth ${whole + (Math.random() < level.depth - whole ? 1 : 0)}`;
    } else if (level.kind === "nodes") {
      go = `go nodes ${level.nodes}`;
      if (game.moves.length < 12) {
        temperature = 12;
        mpv = 3;
      }
    } else {
      throw new Error(`알 수 없는 급수 설정: ${level.kind}`);
    }
    this.set("Skill Level", skill);
    this.set("MultiPV", mpv);
    await this.ready();
    const { best, lines } = await this.search(game, go);
    if (temperature > 0 && lines.size) return sample(lines, temperature);
    return best;
  }

  async evaluate(game, nodes = 10000) {
    this.set("Skill Level", 20);
    this.set("MultiPV", 1);
    await this.ready();
    const { best, lines } = await this.search(game, `go nodes ${nodes}`);
    const line = lines.get(1) || { score: 0, pv: [best] };
    return { score: line.score, best, pv: line.pv };
  }

  // 수를 읽지 않고 현재 판을 평가한다. 값은 초 기준이다.
  async staticEval(game) {
    this.send(`position fen ${game.fen()}`);
    this.send("eval");
    const lines = [];
    for (;;) {
      const line = await this.next(30000);
      lines.push(line);
      if (line.startsWith("Final evaluation")) return parseEval(lines);
    }
  }

  async topMoves(game, nodes, count) {
    this.set("Skill Level", 20);
    this.set("MultiPV", count);
    await this.ready();
    const { lines } = await this.search(game, `go nodes ${nodes}`);
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => ({ move: l.pv[0], score: l.score }));
  }

  async search(game, go) {
    const moves = game.moves.length ? ` moves ${game.moves.join(" ")}` : "";
    this.send(`position fen ${game.fen0}${moves}`);
    this.send(go);
    const lines = new Map();
    this.trace = [];
    for (;;) {
      const line = await this.next();
      if (line.startsWith("bestmove")) return { best: line.split(" ")[1], lines };
      if (!line.startsWith("info") || !line.includes(" pv ") || line.includes("bound")) continue;
      const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
      const pv = / pv (.+)$/.exec(line);
      if (!score || !pv) continue;
      const k = /\bmultipv (\d+)/.exec(line);
      const number = k ? Number(k[1]) : 1;
      const entry = { score: centipawns(score[1], Number(score[2])), pv: pv[1].trim().split(" ") };
      lines.set(number, entry);
      const depth = /\bdepth (\d+)/.exec(line);
      if (number === 1 && depth) this.trace.push({ depth: Number(depth[1]), move: entry.pv[0], score: entry.score });
    }
  }
}

function centipawns(unit, value) {
  if (unit === "cp") return value;
  return (MATE_BASE - 100 * Math.abs(value)) * (value > 0 ? 1 : -1);
}

function sample(lines, temperature) {
  const options = [...lines.values()];
  const top = Math.max(...options.map((o) => o.score));
  const weights = options.map((o) => Math.exp(Math.max((o.score - top) / temperature, -50)));
  let pick = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return options[i].pv[0];
  }
  return options[options.length - 1].pv[0];
}
