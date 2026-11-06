// 전적, 내 급수, 기보, 복기, 실수 문제집 저장. 브라우저의 IndexedDB를 쓴다.
const START_RANK = 8;  // 22급
export const PLACEMENT_GAMES = 6;
const PLACEMENT_STEP = 3;
const REVIEW_DAYS = [1, 3, 7, 14, 30];

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("janggi", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dateText(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class Store {
  static async open() {
    const store = new Store(await openDb());
    store.profile = (await store.get("profile")) || {};
    const defaults = { rank: START_RANK, ranked_games: 0, ladder: [], stats: {}, options: {}, solved: {} };
    for (const [k, v] of Object.entries(defaults)) if (store.profile[k] === undefined) store.profile[k] = v;
    for (const [kind, value] of Object.entries(store.profile.solved)) {
      if (typeof value === "number") {  // 예전에는 푼 개수만 저장했다
        store.profile.solved[kind] = Array.from({ length: value }, (_, i) => i + 1);
      }
    }
    store.current = (await store.get("current")) || null;
    store.deck = (await store.get("mistakes")) || [];
    store.index = (await store.get("game-index")) || [];
    store.mistakeLog = (await store.get("mistake-log")) || [];
    navigator.storage?.persist?.();
    return store;
  }

  constructor(db) {
    this.db = db;
  }

  tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const t = this.db.transaction("kv", mode);
      const request = fn(t.objectStore("kv"));
      t.oncomplete = () => resolve(request?.result);
      t.onerror = () => reject(t.error);
    });
  }

  get(key) { return this.tx("readonly", (s) => s.get(key)); }
  set(key, value) { return this.tx("readwrite", (s) => s.put(value, key)); }
  del(key) { return this.tx("readwrite", (s) => s.delete(key)); }

  saveProfile() { return this.set("profile", this.profile); }

  saveCurrent(data) {
    this.current = data;
    return this.set("current", data);
  }

  clearCurrent() {
    this.current = null;
    return this.del("current");
  }

  async record(game, levelCount) {
    const p = this.profile;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    let id = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    while (this.index.some((g) => g.id === id)) id += "x";
    const finished = `${dateText()}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const full = { ...game, id, finished };
    await this.set(`game:${id}`, full);
    this.index.unshift({
      id, finished, level: game.level, level_name: game.level_name, side: game.side, outcome: game.outcome,
      reason: game.reason, score: game.score, plies: game.plies, undos: game.undos,
    });
    await this.set("game-index", this.index);

    const stats = p.stats[game.level] || (p.stats[game.level] = { w: 0, l: 0, d: 0 });
    stats[{ win: "w", loss: "l", draw: "d" }[game.outcome]] += 1;

    const ranked = game.level === p.rank && game.undos === 0;
    const before = p.rank;
    if (ranked) {
      const step = p.ranked_games < PLACEMENT_GAMES ? PLACEMENT_STEP : 1;
      const delta = { win: step, loss: -step, draw: 0 }[game.outcome];
      p.rank = Math.max(0, Math.min(levelCount - 1, before + delta));
      p.ranked_games += 1;
      p.ladder.push(p.rank);
    }
    await this.saveProfile();
    await this.clearCurrent();
    return { id, ranked, before, rank: p.rank };
  }

  loadGame(id) { return this.get(`game:${id}`); }
  history(limit) { return this.index.slice(0, limit); }
  loadReview(id) { return this.get(`review:${id}`); }

  async saveReview(id, review) {
    await this.set(`review:${id}`, review);
    this.mistakeLog = this.mistakeLog.filter((m) => m.id !== id);
    this.mistakeLog.unshift({ id, kinds: review.moments.map((m) => m.kind) });
    this.mistakeLog = this.mistakeLog.slice(0, 20);
    await this.set("mistake-log", this.mistakeLog);
  }

  mistakeCounts() {
    const counts = {};
    for (const entry of this.mistakeLog) for (const kind of entry.kinds) counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }

  async addMistakes(gameId, moments, side) {
    const known = new Set(this.deck.map((i) => i.id));
    const due = dateText(REVIEW_DAYS[0]);
    for (const m of moments) {
      const id = `${gameId}:${m.ply}`;
      if (!known.has(id)) {
        this.deck.push({ id, fen: m.fen, side, best: m.best, played: m.played, text: m.text, kind: m.kind, box: 0, due });
      }
    }
    await this.set("mistakes", this.deck);
  }

  dueMistakes() {
    const today = dateText();
    return this.deck.filter((i) => i.due <= today);
  }

  async answerMistake(id, correct) {
    for (const item of this.deck) {
      if (item.id === id) {
        item.box = correct ? Math.min(item.box + 1, REVIEW_DAYS.length - 1) : 0;
        item.due = dateText(REVIEW_DAYS[item.box]);
      }
    }
    await this.set("mistakes", this.deck);
  }
}
