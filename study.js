// 복기와 문제 풀이
let review = null;
const VERDICTS = { best: "최선수", good: "좋은 수", bad: "아쉬운 수" };

async function showReview(gameId, back) {
  handlers.move = () => {};
  review = {
    back, moment: null, frame: null, line: null, step: 0, feedback: null, tries: 0,
    asked: null, explained: null, busy: null, focus: null, token: 0,
  };
  panel.innerHTML = `<div class="status"><strong>대국을 분석하는 중</strong><p id="progress"></p></div>`;
  let status = await call("review_start", gameId);
  while (!status.result && !status.error) {
    const text = document.getElementById("progress");
    if (text) text.textContent = `${status.done} / ${status.total}`;
    await sleep(200);
    status = await call("review_status");
  }
  if (status.error) {
    panel.innerHTML = `<p class="notice error">${status.error}</p><button class="link" id="back">돌아가기</button>`;
    on("back", back);
    return;
  }
  review.data = status.result;
  if (review.data.moments.length) selectMoment(0);
  else jumpTo(review.data.frames.length - 1);
}

// 수 번호는 양쪽이 한 번씩 두면 하나 올라간다. 실수 목록의 번호와 같다.
const moveNumber = (ply) => Math.floor(ply / 2) + 1;

function reviewFrame(index) {
  const f = review.data.frames[index];
  return { board: f.board, last: f.last, side: review.data.side, turn: f.turn, interactive: false };
}

// 지금 보고 있는 실수, 또는 직접 둬 본 수
function currentMoment() {
  return review.asked || (review.moment === null ? null : review.data.moments[review.moment]);
}

// 늦게 도착한 분석 결과는 token이 달라져 버려진다
function clearDetail() {
  review.token += 1;
  review.line = null;
  review.feedback = null;
  review.asked = null;
  review.explained = null;
  review.busy = null;
  review.focus = null;
}

function selectMoment(index) {
  clearDetail();
  review.moment = index;
  review.tries = 0;
  handlers.move = tryMove;
  const m = review.data.moments[index];
  review.frame = m.ply;
  board.render({ ...reviewFrame(m.ply), legal: m.legal, interactive: true });
  renderReview();
}

async function jumpTo(ply) {
  clearDetail();
  review.moment = null;
  review.frame = ply;
  handlers.move = askMove;
  const token = review.token;
  board.render(reviewFrame(ply));
  renderReview();
  if (review.data.frames[ply].turn !== review.data.side) return;
  const { legal } = await call("review_legal", ply);
  if (token === review.token) board.render({ ...reviewFrame(ply), legal, interactive: true });
}

async function tryMove(move) {
  const index = review.moment;
  const verdict = await call("review_try", index, move);
  const m = review.data.moments[index];
  review.tries += 1;
  if (verdict.verdict === "best" || verdict.verdict === "good") {
    review.feedback = { ok: true, text: verdict.verdict === "best" ? "엔진이 고른 최선수입니다." : "좋은 수입니다." };
    playLine("best");
    return;
  }
  review.feedback = { ok: false, text: "더 좋은 수가 있습니다. 다시 찾아보세요." };
  board.render({ ...reviewFrame(m.ply), legal: m.legal, interactive: true });
  renderReview();
}

// 대국에서 두지 않은 수를 직접 둬 보면 결과를 설명한다
async function askMove(move) {
  const ply = review.frame;
  const [, from, to] = move.match(/^([a-i]\d+)([a-i]\d+)$/);
  clearDetail();
  const token = review.token;
  handlers.move = () => {};
  review.busy = "이 수를 분석하는 중";
  board.render({ ...reviewFrame(ply), arrows: [{ from, to, kind: "mine" }] });
  renderReview();
  const result = await call("review_ask", ply, move);
  if (token !== review.token) return;
  review.busy = null;
  review.asked = { ...result, ply, number: moveNumber(ply), played: move, label: VERDICTS[result.verdict] };
  renderReview();
}

// 대국에서 실제로 둔 수의 의도를 설명한다. frames[n]은 n수를 둔 뒤의 판이다.
async function explainMove() {
  const ply = review.frame - 1;
  clearDetail();
  const token = review.token;
  handlers.move = () => {};
  review.busy = "이 수의 의도를 분석하는 중";
  renderReview();
  const intent = await call("review_explain", ply);
  if (token !== review.token) return;
  review.busy = null;
  review.explained = { ply, intent };
  renderReview();
}

function playLine(name) {
  const lesson = currentMoment().lesson;
  review.line = { name, steps: name === "best" ? lesson.best_steps : lesson.played_steps };
  review.step = 0;
  review.focus = null;
  handlers.move = () => {};
  showLineStep();
}

function showLineStep() {
  const f = review.line.steps[review.step];
  if (f) {
    board.render({ board: f.board, last: f.last, side: review.data.side, turn: f.turn, arrows: f.arrows, interactive: false });
  }
  renderReview();
}

function currentIntent() {
  return review.explained ? review.explained.intent : currentMoment().lesson.intent;
}

function openBranch(index) {
  const branch = currentIntent().branches[index];
  review.line = { name: "branch", steps: branch.steps, title: branch.title, summary: branch.summary, from: review.line };
  review.step = 0;
  review.focus = null;
  showLineStep();
}

function closeBranch() {
  review.line = review.line.from;
  review.step = 0;
  review.focus = null;
  if (review.line) showLineStep();
  else {
    board.render(reviewFrame(review.frame));
    renderReview();
  }
}

function intentItems(intent) {
  const tactics = intent.patterns.map((p) => ({ ...p, title: p.name }));
  return [...tactics, ...intent.points, ...(intent.values ? [intent.values] : [])];
}

// 엔진 수의 의도. 노림수를 밝힌 항목과 겹치는 일반 설명은 뺀다.
function bestReasons(m) {
  const { intent, better } = m.lesson;
  const aimed = intent.points.some((p) => p.text.startsWith("상대가 가만히"));
  return [...intentItems(intent), ...better.filter((r) => !(aimed && r.text.startsWith("다음 수에")))];
}

function currentReasons() {
  if (review.explained) return intentItems(review.explained.intent);
  const m = currentMoment();
  return review.line.name === "best" ? bestReasons(m) : m.lesson.why;
}

function focusReason(index) {
  const reason = currentReasons()[index];
  review.focus = index;
  const m = currentMoment();
  const base = reason.board || (review.line.name === "best" ? review.data.frames[m.ply].board : m.lesson.after_played);
  board.render({ board: base, side: review.data.side, arrows: reason.arrows, badges: reason.badges, interactive: false });
  renderReview();
}

function graphSvg() {
  const { graph, moments } = review.data;
  const W = 300, H = 92;
  const x = (i) => (graph.length > 1 ? (i / (graph.length - 1)) * W : 0);
  const y = (v) => H - 4 - (v / 100) * (H - 8);
  const pts = graph.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const dots = moments.map((m) => `<circle class="point" cx="${x(m.ply + 1)}" cy="${y(graph[m.ply + 1])}" r="3.5" />`).join("");
  const now = review.frame ?? 0;
  return `<svg id="graph" class="graph" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="대국 형세 그래프">
    <line class="mid" x1="0" y1="${y(50)}" x2="${W}" y2="${y(50)}" />
    <polyline class="curve" points="${pts}" />
    <line class="now" x1="${x(now)}" y1="0" x2="${x(now)}" y2="${H}" />${dots}</svg>`;
}

function reasonList(list) {
  if (!list.length) return "";
  return `<div class="reasons">${list.map((r, i) => `<button class="reason" data-reason="${i}"
    aria-pressed="${review.focus === i}">${r.title ? `<b>${r.title}</b> ` : ""}${r.text}</button>`).join("")}</div>`;
}

function intentBlock(intent, reasons) {
  const branches = intent.branches.map((b, i) => `<button class="branch" data-branch="${i}">
    <span>${b.title}</span><span>내 승률 ${b.rate}%</span></button>`);
  return `<p class="aim">${intent.headline}</p>
    <p class="quiet">엔진에게 심리는 없어서, 상황을 바꿔 다시 읽게 한 결과로 의도를 짚었습니다.</p>
    ${reasonList(reasons)}
    ${intent.depth ? `<p class="quiet">${intent.depth}</p>` : ""}
    ${intent.terms ? `<p class="quiet">${intent.terms}</p>` : ""}
    ${branches.length ? `<p class="subhead">이렇게 받으면</p><div class="branches">${branches.join("")}</div>` : ""}`;
}

function stepperBlock() {
  const total = review.line.steps.length;
  const step = review.line.steps[review.step];
  return `<div class="stepper">
      <button id="prev" ${review.step <= 0 ? "disabled" : ""}>이전</button>
      <span>${review.step + 1} / ${total}</span>
      <button id="next" ${review.step >= total - 1 ? "disabled" : ""}>다음</button></div>
    <p class="narration">${review.focus === null && step ? step.text : "수순을 보려면 이전이나 다음을 누르세요."}</p>`;
}

function browseBlock() {
  const { frames, side, moments } = review.data;
  const ply = review.frame, last = frames.length - 1;
  const mine = ply < last && frames[ply].turn === side;
  const title = ply === 0 ? "시작 국면" : `${moveNumber(ply - 1)}수째, ${frames[ply - 1].turn === side ? "내가" : "상대가"} 둔 수`;
  return `<div class="coach"><strong>${title}</strong>
    ${moments.length ? "" : `<p class="quiet">승부를 가른 큰 실수는 없었습니다.</p>`}
    <div class="stepper">
      <button id="frame-prev" ${ply <= 0 ? "disabled" : ""}>이전 수</button>
      <span>${ply} / ${last}</span>
      <button id="frame-next" ${ply >= last ? "disabled" : ""}>다음 수</button></div>
    ${ply > 0 ? `<button id="explain">이 수의 의도 보기</button>` : ""}
    <p class="quiet">${mine ? "내 차례입니다. 궁금한 수를 판에 직접 두어 보면 결과를 알려 줍니다." : "그래프를 누르면 그 시점의 판으로 갑니다."}</p></div>`;
}

function askedBlock() {
  const a = review.asked;
  const buttons = !a.lesson ? "" : a.verdict === "bad"
    ? `<button id="show-best">엔진의 수 보기</button><button id="show-played">이 수가 왜 나쁜가</button>`
    : `<button id="show-best">${a.verdict === "best" ? "이 수의 의도 보기" : "엔진의 수 보기"}</button>`;
  return `<div class="coach"><strong>${a.number}수째에 이 수를 두면</strong>
    <p class="quiet">승률 ${a.before}%에서 ${a.after}%로 바뀝니다.</p>
    <p class="${a.verdict === "bad" ? "bad" : "good"}">${a.label}</p>
    <p>${a.text}</p>
    <div class="two-buttons">${buttons}<button id="other-move">다른 수 둬 보기</button></div></div>`;
}

function coachBlock() {
  if (review.busy) return `<div class="coach"><strong>${review.busy}</strong><p class="quiet">잠시만 기다려 주세요.</p></div>`;
  if (review.line?.name === "branch") {
    const atEnd = review.step >= review.line.steps.length - 1;
    return `<div class="coach"><strong>${review.line.title}</strong>
      ${stepperBlock()}
      ${atEnd && review.line.summary ? `<p class="quiet">${review.line.summary}</p>` : ""}
      <button id="branch-back">의도로 돌아가기</button></div>`;
  }
  if (review.explained) {
    const { ply, intent } = review.explained;
    return `<div class="coach"><strong>${moveNumber(ply)}수째의 의도</strong>
      ${intentBlock(intent, intentItems(intent))}
      <button id="close-explain">판으로 돌아가기</button></div>`;
  }
  if (review.asked && !review.line) return askedBlock();
  const m = currentMoment();
  if (!m) return browseBlock();
  const lesson = m.lesson;
  const fb = review.feedback;
  const feedback = fb ? `<p class="${fb.ok ? "good" : "bad"}">${fb.text}</p>` : "";
  const head = `<strong>${m.number}수째, ${m.label}</strong>
    <p class="quiet">승률 ${m.before}%에서 ${m.after}%로 ${review.asked ? "바뀝니다" : "떨어졌습니다"}.</p>${feedback}`;
  if (!review.line) {
    return `<div class="coach">${head}<p class="quiet">판에서 더 좋은 수를 직접 찾아 두어 보세요.</p>
      <div class="two-buttons"><button id="show-best">엔진의 수 보기</button><button id="show-played">내 수가 왜 나빴나</button></div></div>`;
  }
  const isBest = review.line.name === "best";
  const atEnd = review.step >= review.line.steps.length - 1;
  const summary = isBest ? lesson.best_summary : lesson.played_summary;
  const compared = !review.asked || review.asked.verdict === "bad";
  return `<div class="coach">${head}
    ${isBest ? intentBlock(lesson.intent, bestReasons(m)) : `<p>${m.text}</p>${reasonList(lesson.why)}`}
    ${stepperBlock()}
    ${atEnd && summary ? `<p class="quiet">${summary}</p>` : ""}
    ${isBest ? "" : `<p class="notice">${lesson.habit}</p>`}
    <div class="two-buttons">${compared ? `<button id="switch-line">${isBest ? "내 수가 왜 나빴나" : "엔진의 수 보기"}</button>` : ""}
      <button id="again-try">${review.asked ? "다른 수 둬 보기" : "다시 풀기"}</button></div></div>`;
}

function renderReview() {
  const { moments, frames } = review.data;
  const items = moments.map((m, i) => `<button class="moment" data-moment="${i}" aria-pressed="${review.moment === i}">
    <span>${m.number}수째</span><span>${m.label}</span></button>`);
  panel.innerHTML = html`
    <div class="top-line"><h1>복기</h1><button class="link" id="back">돌아가기</button></div>
    ${graphSvg()}
    ${items.length ? `<div class="moments">${items.join("")}</div>
      <button class="link" id="browse">모든 수 둘러보기</button>` : ""}
    ${coachBlock()}`;
  on("back", () => { review.token += 1; review.back(); });
  panel.querySelectorAll("[data-moment]").forEach((b) => b.onclick = () => selectMoment(Number(b.dataset.moment)));
  on("browse", () => jumpTo(review.frame ?? 0));
  on("show-best", () => playLine("best"));
  on("show-played", () => playLine("played"));
  on("switch-line", () => playLine(review.line.name === "best" ? "played" : "best"));
  on("again-try", () => (review.asked ? jumpTo(review.asked.ply) : selectMoment(review.moment)));
  on("other-move", () => jumpTo(review.asked.ply));
  on("prev", () => { review.step -= 1; review.focus = null; showLineStep(); });
  on("next", () => { review.step += 1; review.focus = null; showLineStep(); });
  on("frame-prev", () => jumpTo(review.frame - 1));
  on("frame-next", () => jumpTo(review.frame + 1));
  on("explain", explainMove);
  on("close-explain", () => jumpTo(review.frame));
  on("branch-back", closeBranch);
  panel.querySelectorAll("[data-reason]").forEach((b) => b.onclick = () => focusReason(Number(b.dataset.reason)));
  panel.querySelectorAll("[data-branch]").forEach((b) => b.onclick = () => openBranch(Number(b.dataset.branch)));
  document.getElementById("graph").onclick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const n = frames.length - 1;
    jumpTo(Math.max(0, Math.min(n, Math.round(((e.clientX - box.left) / box.width) * n))));
  };
}

// 문제 ------------------------------------------------------------------
let puzzle = null;
const MATE_KINDS = [["mate1", "1수"], ["mate2", "2수"], ["mate3", "3수"]];
const SHOT_KINDS = [
  ["shot-wonang", "원앙 대 원앙"], ["shot-yang", "양귀 대 양귀"], ["shot-wonang-yang", "원앙 대 양귀"],
  ["shot-wonang-gwi", "원앙 대 귀마"], ["shot-yang-gwi", "양귀 대 귀마"], ["shot-gwi-line", "귀마 선대칭"],
  ["shot-gwi-point", "귀마 점대칭"], ["shot-late", "중후반"],
];

async function showPuzzle(kind) {
  home = await call("home");
  puzzle = { kind, state: null, message: null, finished: false, answer: null, step: 0 };
  handlers.move = puzzleMove;
  loadPuzzle();
}

function openPuzzle(state) {
  puzzle.state = state;
  puzzle.revisit = Boolean(state.done);
  puzzle.message = null;
  puzzle.finished = false;
  puzzle.answer = null;
  drawPuzzle();
}

async function loadPuzzle() {
  home = await call("home");
  openPuzzle(await call("puzzle_next", puzzle.kind));
}

// 번호로 문제를 연다. 지나간 문제로 돌아가거나 건너뛸 때 쓴다.
async function goPuzzle(number) {
  home = await call("home");
  openPuzzle(await call("puzzle_go", puzzle.kind, number));
}

function drawPuzzle() {
  const s = puzzle.state;
  if (s.empty) {
    previewBoard();
  } else {
    board.render({
      board: s.board, side: s.side, legal: s.legal, last: s.last, turn: s.turn, check: s.check,
      interactive: !puzzle.finished && !puzzle.answer,
    });
  }
  renderPuzzle();
}

async function puzzleMove(move) {
  const state = await call("puzzle_move", move);
  puzzle.state = state;
  if (state.result === "solved") {
    puzzle.message = { ok: true, text: "정답입니다." };
    puzzle.finished = true;
    home = await call("home");  // 단계 탭의 푼 문제 수를 바로 고친다
  } else if (state.result === "wrong") {
    puzzle.message = { ok: false, text: state.text ? "더 좋은 수가 있었습니다." : "외통이 풀렸습니다." };
    puzzle.finished = true;
  } else {
    puzzle.message = state.result === "continue" ? { ok: true, text: "좋습니다. 계속 두세요." } : null;
  }
  drawPuzzle();
}

async function retryPuzzle() {
  puzzle.state = await call("puzzle_retry");
  puzzle.message = null;
  puzzle.finished = false;
  puzzle.answer = null;
  drawPuzzle();
}

async function showAnswer() {
  const data = await call("puzzle_answer");
  puzzle.answer = data.frames;
  puzzle.notes = data.notes;
  puzzle.step = Math.min(1, data.frames.length - 1);
  showAnswerStep();
}

function showAnswerStep() {
  const f = puzzle.answer[puzzle.step];
  board.render({ board: f.board, last: f.last, side: puzzle.state.side, turn: f.turn, interactive: false });
  renderPuzzle();
}

function puzzlePrompt(s) {
  if (s.kind === "mistake") return `${SIDE_NAMES[s.side]} 차례입니다. 지난 대국에서 실수한 국면입니다. 더 좋은 수를 찾으세요.`;
  if (s.kind.startsWith("shot")) return `${SIDE_NAMES[s.side]} 차례입니다. 승부를 가르는 수를 찾으세요.`;
  return `${SIDE_NAMES[s.side]} 차례입니다. ${s.n}수 안에 외통을 만드세요.`;
}

function renderPuzzle() {
  const s = puzzle.state;
  const isShot = puzzle.kind.startsWith("shot");
  const isMate = puzzle.kind !== "mistake";  // 번호로 오가는 문제집인지
  const kinds = isShot ? SHOT_KINDS : MATE_KINDS;
  const tabs = isMate ? `<div class="chips${isShot ? " two" : ""}">${kinds.map(([k, label]) => {
    const info = home.puzzles[k];
    const count = info ? ` ${info.solved}/${info.total}` : "";
    return `<button class="chip" data-kind="${k}" aria-pressed="${puzzle.kind === k}">${label}${count}</button>`;
  }).join("")}</div>` : "";
  let body;
  if (s.empty) {
    body = isMate
      ? `<div class="coach"><strong>이 단계의 문제를 모두 풀었습니다</strong><p class="quiet">다른 단계를 고르거나 처음부터 다시 볼 수 있습니다.</p></div>
         <button id="p-first">1번부터 다시 보기</button>`
      : `<div class="coach"><strong>오늘 풀 문제가 없습니다</strong>
          <p class="quiet">대국을 복기하면 실수한 국면이 다음 날부터 문제로 나옵니다.</p></div>`;
  } else {
    const count = isMate
      ? (puzzle.revisit ? `<p class="quiet">이미 푼 문제입니다.</p>` : "")
      : `<p class="quiet">남은 문제 ${s.left}개</p>`;
    const nav = isMate ? `<div class="stepper wide">
        <button id="p-prev" ${s.number <= 1 ? "disabled" : ""}>이전 문제</button>
        <span>${s.number} / ${s.total}</span>
        <button id="p-forward" ${s.number >= s.total ? "disabled" : ""}>다음 문제</button></div>` : "";
    const message = puzzle.message ? `<p class="${puzzle.message.ok ? "good" : "bad"}">${puzzle.message.text}</p>` : "";
    const stepper = puzzle.answer ? `<div class="stepper">
        <button id="a-prev" ${puzzle.step <= 0 ? "disabled" : ""}>이전</button>
        <span>${puzzle.step + 1} / ${puzzle.answer.length}</span>
        <button id="a-next" ${puzzle.step >= puzzle.answer.length - 1 ? "disabled" : ""}>다음</button></div>
        ${puzzle.notes?.[puzzle.step - 1] ? `<p class="narration">${puzzle.notes[puzzle.step - 1]}</p>` : ""}` : "";
    const solved = puzzle.message?.ok && puzzle.finished;
    const reveal = isShot && (solved || puzzle.answer) ? `<p class="aim">${s.motif}</p><p>${s.text}</p>` : "";
    const buttons = solved
      ? `<button class="primary" id="p-next">${puzzle.revisit ? "안 푼 문제로 가기" : "다음 문제"}</button>
         ${isShot && !puzzle.answer ? `<button id="p-answer">수순 보기</button>` : ""}`
      : `<div class="two-buttons"><button id="p-retry">다시 풀기</button><button id="p-answer">답 보기</button></div>
         ${isMate ? "" : `<button id="p-next">다음 문제</button>`}`;
    body = `${nav}<div class="coach"><strong>${puzzlePrompt(s)}</strong>${count}${message}${reveal}${stepper}</div>${buttons}`;
  }
  panel.innerHTML = html`
    <div class="top-line"><h1>${isShot ? "필승수 공부" : isMate ? "외통 문제" : "내 실수 문제"}</h1><button class="link" id="back">돌아가기</button></div>
    ${tabs}${body}`;
  on("back", showHome);
  on("p-next", loadPuzzle);
  on("p-first", () => goPuzzle(1));
  on("p-prev", () => goPuzzle(s.number - 1));
  on("p-forward", () => goPuzzle(s.number + 1));
  on("p-retry", retryPuzzle);
  on("p-answer", showAnswer);
  on("a-prev", () => { puzzle.step -= 1; showAnswerStep(); });
  on("a-next", () => { puzzle.step += 1; showAnswerStep(); });
  panel.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => showPuzzle(b.dataset.kind));
}

// 초반 공부 --------------------------------------------------------------
let opening = null;
const OPENING_TABS = [["line", "정석 수순"], ["traps", "함정"], ["summary", "요약"]];

async function showOpening() {
  handlers.move = () => {};
  const mine = setup.setup;
  opening = {
    side: setup.side === "han" ? "han" : "cho", mine, theirs: setup.aiSetup === "random" ? mine : setup.aiSetup,
    tab: "line", ply: 0, data: null, intent: null, focus: null, alt: null, trap: null, step: 0,
    picking: false, token: 0,
  };
  await loadOpening();
}

async function loadOpening() {
  const o = opening;
  const token = ++o.token;
  const [cho, han] = o.side === "cho" ? [o.mine, o.theirs] : [o.theirs, o.mine];
  panel.innerHTML = `<div class="status"><strong>초반 분석을 불러오는 중</strong></div>`;
  const data = await call("opening", cho, han, o.side);
  if (token !== o.token) return;
  if (data.missing) {
    panel.innerHTML = `<p class="notice error">이 상차림 조합은 아직 분석하지 않았습니다.</p><button class="link" id="back">돌아가기</button>`;
    on("back", showHome);
    return;
  }
  Object.assign(o, { data, trap: null, step: 0 });
  showOpeningPly(0);
}

// ply번째 수를 둔 뒤의 판을 보여 주고, 그 수의 의도를 가져온다
async function showOpeningPly(ply) {
  const o = opening;
  Object.assign(o, { ply, focus: null, alt: null, intent: null });
  drawOpeningFrame(o.data.frames[ply]);
  renderOpening();
  if (ply === 0) return;
  const token = o.token;
  const intent = await call("opening_intent", ply - 1);
  if (token !== o.token || o.ply !== ply) return;
  o.intent = intent;
  renderOpening();
}

function drawOpeningFrame(f, extra = {}) {
  board.render({ board: f.board, last: f.last, turn: f.turn, side: opening.side, interactive: false, ...extra });
}

function scoreWords(score) {
  if (Math.abs(score) > 20000) return score > 0 ? "외통을 노리는 형세" : "외통 위기";
  const size = Math.abs(score);
  const word = size < 30 ? "거의 같음" : `${size < 80 ? "조금 " : size < 200 ? "" : "크게 "}${score > 0 ? "유리" : "불리"}`;
  return `${score > 0 ? "+" : ""}${score} (${word})`;
}

function openingReasons() {
  return opening.intent ? intentItems(opening.intent) : [];
}

function openingReasonList(list) {
  if (!list.length) return "";
  return `<div class="reasons">${list.map((r, i) => `<button class="reason" data-o-reason="${i}"
    aria-pressed="${opening.focus === i}">${r.title ? `<b>${r.title}</b> ` : ""}${r.text}</button>`).join("")}</div>`;
}

function trapButtons(list) {
  return list.map((t) => `<button class="branch" data-o-trap="${t.key}">
    <span>${t.ply + 1}번째 수 · ${t.title}</span><span>−${t.drop}</span></button>`).join("");
}

function allTraps() {
  return opening.data.plies.flatMap((p, i) => p.traps.map((t, j) => ({ ...t, key: `${i}:${j}` })));
}

function lineView() {
  const o = opening, d = o.data, total = d.plies.length;
  const nav = `<div class="stepper">
      <button id="o-prev" ${o.ply <= 0 ? "disabled" : ""}>이전</button>
      <span>${o.ply} / ${total}</span>
      <button id="o-next" ${o.ply >= total ? "disabled" : ""}>다음</button></div>`;
  if (o.ply === 0) {
    return `${nav}<div class="coach"><strong>시작 배치</strong><p>${d.summary[0]}</p>
      <p class="quiet">다음을 누르면 실력 제한 없는 엔진끼리 둔 정석 수순을 한 수씩 봅니다.
      수마다 의도, 둘 수 있었던 다른 수, 얕게 보면 좋아 보이는 손해 수를 보여 줍니다.</p></div>`;
  }
  const p = d.plies[o.ply - 1];
  const tag = p.tag === "forced" ? `<span class="tag forced">꼭 이 수</span>`
    : p.tag === "free" ? `<span class="tag free">취향대로</span>` : "";
  const intent = o.intent
    ? `<p class="aim">${o.intent.headline}</p>${openingReasonList(openingReasons())}
       ${o.intent.depth ? `<p class="quiet">${o.intent.depth}</p>` : ""}`
    : `<p class="quiet">의도를 정리하는 중입니다.</p>`;
  const alts = p.alts.map((a, i) => `<button class="branch" data-o-alt="${i}" aria-pressed="${o.alt === i}">
    <span>${a.text}${i === 0 ? " (정석)" : ""}</span><span>${i === 0 ? "" : a.diff <= 5 ? "비슷함" : `−${a.diff}`}</span></button>`).join("");
  const traps = trapButtons(p.traps.map((t, j) => ({ ...t, key: `${o.ply - 1}:${j}` })));
  return `${nav}<div class="coach"><strong>${o.ply}번째 수, ${p.mine ? "내 차례" : "상대 차례"} ${tag}</strong>
    <p>${p.text}</p><p class="quiet">이 수 뒤 평가, 내 기준 ${scoreWords(p.score)}</p>${intent}
    <p class="subhead">${p.mine ? "내가" : "상대가"} 둘 수 있었던 다른 수 (평가 차이)</p><div class="branches">${alts}</div>
    ${traps ? `<p class="subhead">얕게 보면 좋아 보이지만 손해인 수</p><div class="branches">${traps}</div>` : ""}</div>`;
}

function trapsView() {
  const o = opening;
  if (o.trap) return trapDetail();
  const list = allTraps();
  const mine = list.filter((t) => t.mine), theirs = list.filter((t) => !t.mine);
  return `<div class="coach"><strong>얕게 보면 좋아 보이지만 손해인 수</strong>
    <p class="quiet">정석 수순의 국면마다 3수 앞까지만 읽으면 상위 세 수 안에 들지만, 깊게 읽으면 최선보다 100점 넘게
    손해인 수입니다. 숫자는 손해 크기입니다.</p>
    <p class="subhead">내가 빠지기 쉬운 함정 ${mine.length}개</p><div class="branches">${trapButtons(mine)}</div>
    <p class="subhead">상대가 빠지면 응징할 기회 ${theirs.length}개</p><div class="branches">${trapButtons(theirs)}</div></div>`;
}

function currentTrap() {
  const [i, j] = opening.trap.split(":").map(Number);
  return opening.data.plies[i].traps[j];
}

function trapDetail() {
  const o = opening, t = currentTrap(), total = t.frames.length - 1;
  const text = o.step === 0
    ? `${t.ply + 1}번째 수에서 ${t.title.endsWith("잡기") ? `${t.title.slice(0, -2)}잡으면` : `${t.title} 두면`} ${t.mine ? `내 평가가 ${t.drop}점 떨어집니다` : `내가 ${t.drop}점 이득을 볼 기회가 생깁니다`}. 더 나은 수는 ${t.better}입니다.`
    : t.steps[o.step - 1];
  return `<div class="coach"><strong>${t.mine ? "내 함정" : "상대 함정, 응징 수순"}</strong>
    <div class="stepper">
      <button id="t-prev" ${o.step <= 0 ? "disabled" : ""}>이전</button>
      <span>${o.step} / ${total}</span>
      <button id="t-next" ${o.step >= total ? "disabled" : ""}>다음</button></div>
    <p class="narration">${text}</p>
    ${o.step >= total && t.summary ? `<p class="quiet">${t.summary}</p>` : ""}
    <div class="two-buttons"><button id="t-line">정석 수순에서 보기</button><button id="t-list">목록으로</button></div></div>`;
}

function drawTrap() {
  const o = opening, t = currentTrap();
  if (o.step === 0) {
    drawOpeningFrame(o.data.frames[t.ply], { arrows: [arrowOf(t.move, t.mine ? "mine" : "theirs"), arrowOf(t.best, "option")] });
  } else {
    drawOpeningFrame(t.frames[o.step]);
  }
}

function arrowOf(move, kind) {
  const [, from, to] = move.match(/^([a-i]\d+)([a-i]\d+)$/);
  return { from, to, kind };
}

function summaryView() {
  const d = opening.data;
  return `<div class="coach"><strong>이 포진의 요약</strong>
    ${d.summary.map((t) => `<p>${t}</p>`).join("")}
    <p class="quiet">평가는 엔진 점수입니다. 차 한 대가 약 900, 포나 마가 약 470, 졸 하나가 약 220입니다.</p></div>
    ${d.shots ? `<button id="o-shots">이 케이스의 필승수 풀기 (${d.shots}문제)</button>` : ""}`;
}

function renderOpening() {
  const o = opening, d = o.data;
  const caseName = (SHOT_KINDS.find(([k]) => k === d.kind) || [])[1] || "";
  const pick = o.picking ? `
    <div class="field"><h2>내 진영</h2><div class="chips">${chip("o-side", "cho", "초", o.side === "cho")}${chip("o-side", "han", "한", o.side === "han")}</div></div>
    <div class="field"><h2>내 상차림</h2><div class="chips two">${Object.entries(SETUP_NAMES).map(([k, v]) => chip("o-mine", k, v, o.mine === k)).join("")}</div></div>
    <div class="field"><h2>상대 상차림</h2><div class="chips two">${Object.entries(SETUP_NAMES).map(([k, v]) => chip("o-theirs", k, v, o.theirs === k)).join("")}</div></div>` : "";
  const body = o.tab === "line" ? lineView() : o.tab === "traps" ? trapsView() : summaryView();
  panel.innerHTML = `
    <div class="top-line"><h1>초반 공부</h1><button class="link" id="back">돌아가기</button></div>
    <div class="top-line"><p>${SIDE_NAMES[o.side]}, ${SETUP_NAMES[o.mine]} 대 ${SETUP_NAMES[o.theirs]}
      <span class="quiet">${caseName}</span></p>
      <button class="link" id="o-pick">${o.picking ? "닫기" : "포진 바꾸기"}</button></div>
    ${pick}
    <div class="chips">${OPENING_TABS.map(([k, v]) => chip("o-tab", k, v, o.tab === k)).join("")}</div>
    ${body}`;
  on("back", () => { o.token += 1; showHome(); });
  on("o-pick", () => { o.picking = !o.picking; renderOpening(); });
  for (const [attr, key] of [["oSide", "side"], ["oMine", "mine"], ["oTheirs", "theirs"]]) {
    panel.querySelectorAll(`[data-${key === "side" ? "o-side" : key === "mine" ? "o-mine" : "o-theirs"}]`).forEach((b) => {
      b.onclick = () => { o[key] = b.dataset[attr]; o.picking = false; loadOpening(); };
    });
  }
  panel.querySelectorAll("[data-o-tab]").forEach((b) => b.onclick = () => {
    o.tab = b.dataset.oTab;
    o.trap = null;
    if (o.tab === "line") showOpeningPly(o.ply);
    else { drawOpeningFrame(d.frames[o.ply]); renderOpening(); }
  });
  on("o-prev", () => showOpeningPly(o.ply - 1));
  on("o-next", () => showOpeningPly(o.ply + 1));
  panel.querySelectorAll("[data-o-reason]").forEach((b) => b.onclick = () => {
    const reason = openingReasons()[Number(b.dataset.oReason)];
    o.focus = Number(b.dataset.oReason);
    o.alt = null;
    board.render({ board: reason.board, side: o.side, arrows: reason.arrows, badges: reason.badges, interactive: false });
    renderOpening();
  });
  panel.querySelectorAll("[data-o-alt]").forEach((b) => b.onclick = () => {
    const p = d.plies[o.ply - 1];
    o.alt = Number(b.dataset.oAlt);
    o.focus = null;
    const kind = p.mine ? "mine" : "theirs";
    const arrows = [arrowOf(p.alts[0].move, kind)];
    if (o.alt > 0) arrows.push(arrowOf(p.alts[o.alt].move, "option"));
    drawOpeningFrame(d.frames[o.ply - 1], { arrows });
    renderOpening();
  });
  panel.querySelectorAll("[data-o-trap]").forEach((b) => b.onclick = () => {
    o.tab = "traps";
    o.trap = b.dataset.oTrap;
    o.step = 0;
    drawTrap();
    renderOpening();
  });
  on("t-prev", () => { o.step -= 1; drawTrap(); renderOpening(); });
  on("t-next", () => { o.step += 1; drawTrap(); renderOpening(); });
  on("t-list", () => { o.trap = null; drawOpeningFrame(d.frames[o.ply]); renderOpening(); });
  on("t-line", () => { const t = currentTrap(); o.tab = "line"; o.trap = null; showOpeningPly(t.ply + 1); });
  on("o-shots", () => { o.token += 1; showPuzzle(d.kind); });
}
