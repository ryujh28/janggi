// 대국 준비와 대국 진행
const panel = document.getElementById("panel");
const board = new Board(document.getElementById("board"), (move) => handlers.move(move));
const handlers = { move: () => {} };
const sounds = new Sounds();
board.onPlace = (taken) => sounds.place(taken);
document.addEventListener("pointerdown", () => sounds.unlock());

const SETUP_NAMES = {
  "masang-sangma": "마상상마", "sangma-masang": "상마마상",
  "masang-masang": "마상마상", "sangma-sangma": "상마상마",
};
const SIDE_NAMES = { cho: "초", han: "한" };
const REASONS = {
  checkmate: "외통", stalemate: "둘 수 있는 수가 없음", bikjang: "빅장 점수 판정",
  double_pass: "양쪽 한수쉼 점수 판정", repetition: "같은 형세 반복", no_progress: "50수 규칙 점수 판정",
  resign: "기권",
};
let setup = { level: null, side: "cho", setup: "masang-sangma", aiSetup: "random", picking: false };
let home = null;
let current = null;
let thinking = false;
let confirming = null;

function call(method, ...args) {
  return window.janggiApi[method](...args);
}

function html(strings, ...values) {
  return strings.reduce((out, s, i) => {
    const v = values[i - 1];
    return out + (Array.isArray(v) ? v.join("") : v ?? "") + s;
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };

// 대국 준비 ------------------------------------------------------------
async function showHome() {
  current = null;
  confirming = null;
  handlers.move = () => {};
  home = await call("home");
  applySettings(home.options);
  renderHome();
  previewBoard();
}

async function previewBoard() {
  const preview = await call("preview", setup.side, setup.setup, setup.aiSetup);
  board.render({ board: preview, side: setup.side === "han" ? "han" : "cho", interactive: false });
}

function chip(group, value, label, active) {
  return `<button class="chip" data-${group}="${value}" aria-pressed="${active}">${label}</button>`;
}

function rung(l) {
  const stat = home.stats[l.index];
  const record = stat ? `, ${stat.w}승 ${stat.l}패` : "";
  const chosen = l.index === (setup.level ?? home.rank);
  const classes = ["rung", l.index === home.rank ? "mine" : "", chosen ? "chosen" : ""].join(" ");
  return `<button class="${classes}" data-level="${l.index}" title="${l.group}${record}">${l.name}</button>`;
}

function rankNote() {
  if (home.placement_left > 0) {
    return `내 실력을 찾는 중입니다. 앞으로 ${home.placement_left}판은 승패에 따라 세 단계씩 움직입니다.`;
  }
  return "이기면 한 단계 오르고, 지면 한 단계 내려갑니다.";
}

function renderHome() {
  const manual = setup.level !== null && setup.level !== home.rank;
  const opponent = manual ? home.levels[setup.level].name : home.rank_name;
  const rows = home.levels.slice().reverse();
  panel.innerHTML = html`
    <div class="top-line"><h1>장기</h1><span class="links">
      <button class="link" id="to-records">전적</button><button class="link" id="to-settings">설정</button></span></div>
    ${home.resume ? `<div class="notice"><p>두던 대국이 있습니다. ${home.resume.level_name} 상대, ${home.resume.plies}수째.</p>
      <button class="link" id="resume">이어서 두기</button></div>` : ""}
    <div class="my-rank"><strong>${home.rank_name}</strong><span class="quiet">내 급수</span></div>
    <p class="quiet">${rankNote()}</p>
    <button class="primary" id="start">${opponent} 상대와 대국 시작</button>
    ${manual ? `<p class="quiet">직접 고른 상대와의 대국은 내 급수에 반영되지 않습니다.</p>` : ""}
    <div class="field"><h2>내 진영</h2>
      <div class="chips">
        ${chip("side", "cho", "초, 먼저 둠", setup.side === "cho")}
        ${chip("side", "han", "한, 덤 1.5", setup.side === "han")}
        ${chip("side", "random", "무작위", setup.side === "random")}
      </div>
    </div>
    <div class="field"><h2>내 상차림</h2>
      <div class="chips two">
        ${Object.entries(SETUP_NAMES).map(([k, v]) => chip("setup", k, v, setup.setup === k)).join("")}
      </div>
    </div>
    <div class="field"><h2>상대 상차림</h2>
      <div class="chips three">
        ${chip("ai", "random", "무작위", setup.aiSetup === "random")}
        ${Object.entries(SETUP_NAMES).map(([k, v]) => chip("ai", k, v, setup.aiSetup === k)).join("")}
      </div>
    </div>
    <div class="field"><h2>공부</h2>
      <div class="study">
        <button id="to-shots">필승수 공부</button>
        <button id="to-mate">외통 문제</button>
        <button id="to-mistakes">내 실수 문제 ${home.mistakes_due}</button>
      </div>
    </div>
    <button class="link" id="pick">${setup.picking ? "상대 고르기 닫기" : "상대 직접 고르기"}</button>
    ${setup.picking ? `<div class="ladder">${rows.map(rung).join("")}</div>` : ""}`;
  panel.querySelectorAll("[data-level]").forEach((b) => b.onclick = () => {
    const level = Number(b.dataset.level);
    setup.level = level === home.rank ? null : level;
    renderHome();
  });
  panel.querySelectorAll("[data-side]").forEach((b) => b.onclick = () => {
    setup.side = b.dataset.side;
    renderHome();
    previewBoard();
  });
  panel.querySelectorAll("[data-setup]").forEach((b) => b.onclick = () => {
    setup.setup = b.dataset.setup;
    renderHome();
    previewBoard();
  });
  panel.querySelectorAll("[data-ai]").forEach((b) => b.onclick = () => {
    setup.aiSetup = b.dataset.ai;
    renderHome();
    previewBoard();
  });
  on("pick", () => { setup.picking = !setup.picking; renderHome(); });
  on("start", startGame);
  on("to-records", showRecords);
  on("to-settings", showSettings);
  on("resume", resumeGame);
  on("to-shots", () => showPuzzle("shot-wonang"));
  on("to-mate", () => showPuzzle("mate1"));
  on("to-mistakes", () => showPuzzle("mistake"));
}

// 대국 ------------------------------------------------------------------
async function startGame() {
  const button = document.getElementById("start");
  if (button) {
    button.disabled = true;
    button.textContent = "대국을 준비하는 중";
  }
  handlers.move = playMove;
  apply(await call("start", setup.level, setup.side, setup.setup, setup.aiSetup));
  advance();
}

async function resumeGame() {
  handlers.move = playMove;
  apply(await call("resume"));
  advance();
}

function apply(state) {
  if (state.error && !state.board) {
    panel.innerHTML = `<p class="notice error">${state.error}</p>`;
    return;
  }
  const before = current;
  current = state;
  confirming = null;
  if (state.check && !before?.check) setTimeout(() => sounds.check(), 170);
  if (state.over && !before?.over) setTimeout(() => sounds.finish(), 240);
  board.render({
    board: state.board, side: state.side, legal: state.legal, last: state.last, threats: state.threats,
    check: state.check, turn: state.turn, interactive: state.my_turn && !thinking,
  });
  renderGame();
}

async function advance() {
  if (!current || current.over || current.my_turn || current.engine_error) return;
  thinking = true;
  renderGame();
  const [next] = await Promise.all([call("ai_move"), sleep(450)]);
  thinking = false;
  apply(next);
}

async function playMove(move) {
  apply(await call("play", move));
  await sleep(120);
  advance();
}

function statusLine(s) {
  if (s.engine_error) return { title: "AI를 실행할 수 없습니다", text: s.engine_error, alert: true };
  if (thinking) return { title: "상대가 수를 고르는 중", text: s.last?.pass ? "내 한수쉼을 받았습니다." : "" };
  const passed = s.last?.pass ? "상대가 한수쉼을 했습니다." : "";
  if (s.check) return { title: "장군입니다", text: "궁을 피하거나 막아야 합니다.", alert: true };
  if (s.bikjang) return { title: "빅장입니다", text: "지금 한수쉼을 하면 대국이 끝나고 점수로 판정합니다.", alert: true };
  return { title: "내 차례", text: passed || "말을 눌러 옮기거나 끌어다 놓으세요." };
}

function rankResult(o) {
  if (!o.ranked) return `<p class="quiet">이 대국은 내 급수에 반영되지 않습니다.</p>`;
  if (o.moved > 0) return `<p class="notice">${o.rank_name}로 올랐습니다.</p>`;
  if (o.moved < 0) return `<p class="notice">${o.rank_name}로 내려갔습니다.</p>`;
  return `<p class="quiet">내 급수는 ${o.rank_name} 그대로입니다.</p>`;
}

function resultBlock(s) {
  const o = s.over;
  const title = { win: "이겼습니다", loss: "졌습니다", draw: "비겼습니다" }[o.outcome];
  const detail = `${REASONS[o.reason] || o.reason}. 초 ${o.score.cho}점, 한 ${o.score.han}점.`;
  return `<div class="status"><strong>${title}</strong><p>${detail}</p></div>${rankResult(o)}
    <button class="primary" id="review">복기하기</button>
    <div class="two-buttons"><button id="again">다음 대국</button><button id="leave">대국 준비로</button></div>`;
}

function playerBlock(s, side, label) {
  const lost = s.captured[side === "cho" ? "han" : "cho"];
  const minis = lost.map((p) => {
    const info = pieceLabel(p);
    return `<span class="mini ${info.side}">${info.char}</span>`;
  });
  return `<div class="player"><div class="player-head">
      <h2>${label}, ${SIDE_NAMES[side]}</h2><span class="player-score">${s.score[side]}</span></div>
    <div class="captured" aria-label="잡은 말">${minis.join("")}</div></div>`;
}

function renderGame() {
  const s = current;
  if (!s) return;
  const me = s.side, ai = me === "cho" ? "han" : "cho";
  const line = s.over ? null : statusLine(s);
  const busy = thinking || !s.my_turn;
  const passLabel = confirming === "pass" ? "그래도 한수쉼" : "한수쉼";
  const resignLabel = confirming === "resign" ? "기권 확정" : "기권";
  const showing = Boolean(home?.options?.threats);
  panel.innerHTML = html`
    ${playerBlock(s, ai, `${s.level_name} AI`)}
    ${s.over ? resultBlock(s) : `<div class="status ${line.alert ? "alert" : ""}">
        <strong>${line.title}</strong><p>${line.text}</p></div>
      ${confirming === "pass" ? `<p class="notice">한수쉼을 두면 대국이 끝나고 점수로 판정합니다.</p>` : ""}
      <div class="actions">
        <button id="pass" ${busy || !s.pass_move ? "disabled" : ""}>${passLabel}</button>
        <button id="undo" ${busy || !s.can_undo ? "disabled" : ""}>무르기</button>
        <button id="resign" ${busy ? "disabled" : ""}>${resignLabel}</button>
      </div>
      <button class="toggle" id="threats" aria-pressed="${showing}">잡힐 말 표시</button>
      ${s.engine_error ? `<button id="retry">다시 시도</button>` : ""}`}
    ${playerBlock(s, me, "나")}
    ${s.over ? "" : `<p class="quiet">대국은 자동으로 저장됩니다.
      ${s.undos ? "무르기를 쓴 대국은 내 급수에 반영되지 않습니다." : ""}</p>
      <button class="link" id="leave">대국 준비로</button>`}`;
  on("pass", passTurn);
  on("undo", async () => apply(await call("undo")));
  on("resign", resign);
  on("retry", advance);
  on("again", async () => { home = await call("home"); setup.level = null; startGame(); });
  on("leave", showHome);
  on("review", () => showReview(s.over.game_id, () => renderFinished()));
  on("threats", toggleThreats);
}

function renderFinished() {
  handlers.move = () => {};
  apply(current);
}

async function toggleThreats() {
  const options = await call("set_option", "threats", !home.options.threats);
  home.options = options;
  apply(await call("state"));
}

async function passTurn() {
  if (current.pass_ends_game && confirming !== "pass") {
    confirming = "pass";
    renderGame();
    return;
  }
  await playMove(current.pass_move);
}

async function resign() {
  if (confirming !== "resign") {
    confirming = "resign";
    renderGame();
    return;
  }
  apply(await call("resign"));
}

// 설정 ------------------------------------------------------------------
const PIECE_SKINS = { ivory: "상아", boxwood: "회양목", jade: "옥", slate: "먹돌" };
const BOARD_SKINS = { ginkgo: "행자목", walnut: "호두나무", paper: "한지" };

function applySettings(options) {
  const svg = document.getElementById("board");
  svg.classList.remove(...[...svg.classList].filter((c) => c.startsWith("piece-") || c.startsWith("board-")));
  if (options.piece_skin && options.piece_skin !== "ivory") svg.classList.add(`piece-${options.piece_skin}`);
  if (options.board_skin && options.board_skin !== "ginkgo") svg.classList.add(`board-${options.board_skin}`);
  sounds.enabled = options.sound !== false;
  sounds.volume = options.volume ?? 0.8;
}

async function saveOption(name, value) {
  home.options = await call("set_option", name, value);
  applySettings(home.options);
  renderSettings();
}

function showSettings() {
  renderSettings();
}

function renderSettings() {
  const o = home.options;
  const piece = o.piece_skin || "ivory", plate = o.board_skin || "ginkgo";
  const volume = Math.round((o.volume ?? 0.8) * 100);
  panel.innerHTML = html`
    <div class="top-line"><h1>설정</h1><button class="link" id="back">대국 준비</button></div>
    <div class="field"><h2>말</h2><div class="chips two">
      ${Object.entries(PIECE_SKINS).map(([k, v]) => chip("piece", k, v, piece === k)).join("")}</div></div>
    <div class="field"><h2>장기판</h2><div class="chips three">
      ${Object.entries(BOARD_SKINS).map(([k, v]) => chip("plate", k, v, plate === k)).join("")}</div></div>
    <div class="field"><h2>소리</h2><div class="chips two">
      ${chip("sound", "on", "켜기", o.sound !== false)}${chip("sound", "off", "끄기", o.sound === false)}</div>
      <label class="slider">크기 <input id="volume" type="range" min="10" max="100" step="10" value="${volume}"></label>
      <button id="test-sound">소리 들어 보기</button></div>`;
  on("back", showHome);
  panel.querySelectorAll("[data-piece]").forEach((b) => b.onclick = () => saveOption("piece_skin", b.dataset.piece));
  panel.querySelectorAll("[data-plate]").forEach((b) => b.onclick = () => saveOption("board_skin", b.dataset.plate));
  panel.querySelectorAll("[data-sound]").forEach((b) => b.onclick = () => saveOption("sound", b.dataset.sound === "on"));
  document.getElementById("volume").onchange = (e) => saveOption("volume", Number(e.target.value) / 100);
  on("test-sound", () => sounds.place(false));
}

// 전적 ------------------------------------------------------------------
const MISTAKE_NAMES = {
  hung_piece: "공짜 말 내줌", missed_capture: "잡을 말 놓침", missed_mate: "외통 놓침",
  allowed_mate: "외통 허용", positional: "형세 악화", missed_win: "점수승 놓침", allowed_loss: "점수패 허용",
};

function sparkline(values) {
  if (values.length < 2) return `<p class="quiet">대국을 두 판 이상 두면 급수 변화가 그려집니다.</p>`;
  const low = Math.min(...values), high = Math.max(...values, low + 1);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 300},${58 - ((v - low) / (high - low)) * 52}`);
  return `<svg class="spark" viewBox="0 0 300 64" preserveAspectRatio="none" role="img" aria-label="내 급수 변화"><polyline points="${pts.join(" ")}" /></svg>`;
}

function mistakeBars(counts) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<p class="quiet">복기를 하면 자주 나오는 실수가 여기에 쌓입니다.</p>`;
  const top = entries[0][1];
  return `<div class="bars">${entries.map(([k, v]) => `<div class="bar-row"><span>${MISTAKE_NAMES[k] || k}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${(v / top) * 100}%"></span></span><span>${v}</span></div>`).join("")}</div>`;
}

async function showRecords() {
  const data = await call("history", 40);
  const rows = data.games.map((g) => `<div class="history-row">
    <span class="outcome-${g.outcome}">${{ win: "승", loss: "패", draw: "무" }[g.outcome]}</span>
    <span>${g.level_name} 상대, ${SIDE_NAMES[g.side]}<br>
      <small class="quiet">${REASONS[g.reason] || g.reason}, ${g.plies}수, ${g.finished.slice(5, 10).replace("-", ".")}</small></span>
    <button class="link" data-review="${g.id}">복기</button></div>`);
  panel.innerHTML = html`
    <div class="top-line"><h1>전적</h1><button class="link" id="back">대국 준비</button></div>
    <div class="field"><h2>내 급수 변화</h2>${sparkline(data.ladder_index)}</div>
    <div class="field"><h2>자주 나오는 실수</h2>${mistakeBars(data.mistakes)}</div>
    <div class="field"><h2>최근 대국</h2>
    ${rows.length ? `<div class="history">${rows.join("")}</div>`
      : `<p class="quiet">아직 끝낸 대국이 없습니다. 첫 대국을 두면 여기에 기록됩니다.</p>`}</div>`;
  on("back", showHome);
  panel.querySelectorAll("[data-review]").forEach((b) => b.onclick = () => showReview(b.dataset.review, showRecords));
}

function boot() {
  if (document.fonts?.load) {
    Promise.all([document.fonts.load('32px "Janggi Cho"', "楚車包馬象士卒"),
      document.fonts.load('32px "Janggi Han"', "漢車包馬象士兵")]).finally(showHome);
  } else {
    showHome();
  }
}

if (window.janggiApi) boot();
else window.addEventListener("janggi-ready", boot, { once: true });
