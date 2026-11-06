// 복기와 문제 풀이
let review = null;

async function showReview(gameId, back) {
  handlers.move = () => {};
  review = { back, moment: null, frame: null, line: null, step: 0, feedback: null, tries: 0 };
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
  selectMoment(review.data.moments.length ? 0 : null);
}

function reviewFrame(index) {
  const f = review.data.frames[index];
  return { board: f.board, last: f.last, side: review.data.side, turn: f.turn, interactive: false };
}

function selectMoment(index) {
  review.moment = index;
  review.line = null;
  review.feedback = null;
  review.tries = 0;
  handlers.move = tryMove;
  if (index === null) {
    review.frame = review.data.frames.length - 1;
    board.render(reviewFrame(review.frame));
  } else {
    const m = review.data.moments[index];
    review.frame = m.ply;
    board.render({ ...reviewFrame(m.ply), legal: m.legal, interactive: true });
  }
  renderReview();
}

function jumpTo(ply) {
  review.moment = null;
  review.line = null;
  review.feedback = null;
  review.frame = ply;
  handlers.move = () => {};
  board.render(reviewFrame(ply));
  renderReview();
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

function playLine(name) {
  const m = review.data.moments[review.moment];
  const lesson = m.lesson;
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

// 엔진 수의 의도. 노림수를 밝힌 항목과 겹치는 일반 설명은 뺀다.
function bestReasons(m) {
  const { intent, better } = m.lesson;
  const aimed = intent.points.some((p) => p.text.startsWith("상대가 가만히"));
  return [...intent.points, ...better.filter((r) => !(aimed && r.text.startsWith("다음 수에")))];
}

function focusReason(index) {
  const m = review.data.moments[review.moment];
  const isBest = review.line.name === "best";
  const reason = (isBest ? bestReasons(m) : m.lesson.why)[index];
  review.focus = index;
  const base = reason.board || (isBest ? review.data.frames[m.ply].board : m.lesson.after_played);
  board.render({ board: base, side: review.data.side, arrows: reason.arrows, interactive: false });
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
    aria-pressed="${review.focus === i}">${r.text}</button>`).join("")}</div>`;
}

function coachBlock() {
  if (review.moment === null) {
    const none = review.data.moments.length === 0;
    return `<div class="coach"><strong>${none ? "승부를 가른 큰 실수가 없었습니다" : `${review.frame}수째 형세`}</strong>
      <p class="quiet">그래프를 누르면 그 시점의 판을 볼 수 있습니다.</p></div>`;
  }
  const m = review.data.moments[review.moment];
  const lesson = m.lesson;
  const fb = review.feedback;
  const feedback = fb ? `<p class="${fb.ok ? "good" : "bad"}">${fb.text}</p>` : "";
  const head = `<strong>${m.number}수째, ${m.label}</strong>
    <p class="quiet">승률 ${m.before}%에서 ${m.after}%로 떨어졌습니다.</p>${feedback}`;
  if (!review.line) {
    return `<div class="coach">${head}<p class="quiet">판에서 더 좋은 수를 직접 찾아 두어 보세요.</p>
      <div class="two-buttons"><button id="show-best">엔진의 수 보기</button><button id="show-played">내 수가 왜 나빴나</button></div></div>`;
  }
  const isBest = review.line.name === "best";
  const total = review.line.steps.length;
  const step = review.line.steps[review.step];
  const summary = isBest ? lesson.best_summary : lesson.played_summary;
  const atEnd = review.step >= total - 1;
  return `<div class="coach">${head}
    ${isBest ? `<p class="aim">${lesson.intent.headline}</p>
      <p class="quiet">엔진에게 심리는 없어서, 상황을 바꿔 다시 읽게 한 결과로 의도를 짚었습니다.</p>` : `<p>${m.text}</p>`}
    ${reasonList(isBest ? bestReasons(m) : lesson.why)}
    <div class="stepper">
      <button id="prev" ${review.step <= 0 ? "disabled" : ""}>이전</button>
      <span>${review.step + 1} / ${total}</span>
      <button id="next" ${atEnd ? "disabled" : ""}>다음</button></div>
    <p class="narration">${review.focus === null && step ? step.text : "수순을 보려면 이전이나 다음을 누르세요."}</p>
    ${atEnd && summary ? `<p class="quiet">${summary}</p>` : ""}
    ${isBest ? "" : `<p class="notice">${lesson.habit}</p>`}
    <div class="two-buttons"><button id="switch-line">${isBest ? "내 수가 왜 나빴나" : "엔진의 수 보기"}</button>
      <button id="again-try">다시 풀기</button></div></div>`;
}

function renderReview() {
  const { moments } = review.data;
  const items = moments.map((m, i) => `<button class="moment" data-moment="${i}" aria-pressed="${review.moment === i}">
    <span>${m.number}수째</span><span>${m.label}</span></button>`);
  panel.innerHTML = html`
    <div class="top-line"><h1>복기</h1><button class="link" id="back">돌아가기</button></div>
    ${graphSvg()}
    ${items.length ? `<div class="moments">${items.join("")}</div>` : ""}
    ${coachBlock()}`;
  on("back", review.back);
  panel.querySelectorAll("[data-moment]").forEach((b) => b.onclick = () => selectMoment(Number(b.dataset.moment)));
  on("show-best", () => playLine("best"));
  on("show-played", () => playLine("played"));
  on("switch-line", () => playLine(review.line.name === "best" ? "played" : "best"));
  on("again-try", () => selectMoment(review.moment));
  on("prev", () => { review.step -= 1; review.focus = null; showLineStep(); });
  on("next", () => { review.step += 1; review.focus = null; showLineStep(); });
  panel.querySelectorAll("[data-reason]").forEach((b) => b.onclick = () => focusReason(Number(b.dataset.reason)));
  document.getElementById("graph").onclick = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const n = review.data.graph.length - 1;
    jumpTo(Math.max(0, Math.min(n, Math.round(((e.clientX - box.left) / box.width) * n))));
  };
}

// 문제 ------------------------------------------------------------------
let puzzle = null;
const MATE_KINDS = [["mate1", "1수"], ["mate2", "2수"], ["mate3", "3수"]];

async function showPuzzle(kind) {
  home = await call("home");
  puzzle = { kind, state: null, message: null, finished: false, answer: null, step: 0 };
  handlers.move = puzzleMove;
  loadPuzzle();
}

async function loadPuzzle() {
  const state = await call("puzzle_next", puzzle.kind);
  puzzle.state = state;
  puzzle.message = null;
  puzzle.finished = false;
  puzzle.answer = null;
  drawPuzzle();
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
  return `${SIDE_NAMES[s.side]} 차례입니다. ${s.n}수 안에 외통을 만드세요.`;
}

function renderPuzzle() {
  const s = puzzle.state;
  const isMate = puzzle.kind !== "mistake";
  const tabs = isMate ? `<div class="chips">${MATE_KINDS.map(([k, label]) => {
    const info = home.puzzles[k];
    const count = info ? ` ${info.solved}/${info.total}` : "";
    return `<button class="chip" data-kind="${k}" aria-pressed="${puzzle.kind === k}">${label}${count}</button>`;
  }).join("")}</div>` : "";
  let body;
  if (s.empty) {
    body = isMate
      ? `<div class="coach"><strong>이 단계의 문제를 모두 풀었습니다</strong><p class="quiet">다른 단계를 골라 보세요.</p></div>`
      : `<div class="coach"><strong>오늘 풀 문제가 없습니다</strong>
          <p class="quiet">대국을 복기하면 실수한 국면이 다음 날부터 문제로 나옵니다.</p></div>`;
  } else {
    const count = isMate ? `<p class="quiet">${s.number} / ${s.total}번 문제</p>` : `<p class="quiet">남은 문제 ${s.left}개</p>`;
    const message = puzzle.message ? `<p class="${puzzle.message.ok ? "good" : "bad"}">${puzzle.message.text}</p>` : "";
    const stepper = puzzle.answer ? `<div class="stepper">
        <button id="a-prev" ${puzzle.step <= 0 ? "disabled" : ""}>이전</button>
        <span>${puzzle.step + 1} / ${puzzle.answer.length}</span>
        <button id="a-next" ${puzzle.step >= puzzle.answer.length - 1 ? "disabled" : ""}>다음</button></div>` : "";
    const solved = puzzle.message?.ok && puzzle.finished;
    const buttons = solved
      ? `<button class="primary" id="p-next">다음 문제</button>`
      : `<div class="two-buttons"><button id="p-retry">다시 풀기</button><button id="p-answer">답 보기</button></div>
         ${isMate ? "" : `<button id="p-next">다음 문제</button>`}`;
    body = `<div class="coach"><strong>${puzzlePrompt(s)}</strong>${count}${message}${stepper}</div>${buttons}`;
  }
  panel.innerHTML = html`
    <div class="top-line"><h1>${isMate ? "외통 문제" : "내 실수 문제"}</h1><button class="link" id="back">돌아가기</button></div>
    ${tabs}${body}`;
  on("back", showHome);
  on("p-next", loadPuzzle);
  on("p-retry", retryPuzzle);
  on("p-answer", showAnswer);
  on("a-prev", () => { puzzle.step -= 1; showAnswerStep(); });
  on("a-next", () => { puzzle.step += 1; showAnswerStep(); });
  panel.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => showPuzzle(b.dataset.kind));
}
