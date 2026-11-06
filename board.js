// 장기판 SVG 그리기와 입력 처리
const U = { x: 84, y: 76, left: 54, top: 58 };
const NAMES = {
  k: { cho: "楚", han: "漢" }, r: "車", c: "包", n: "馬", b: "象", a: "士",
  p: { cho: "卒", han: "兵" },
};
const SIZE = { k: 37, r: 31, c: 31, n: 31, b: 31, a: 24, p: 24 };
const SVG = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function octagon(r) {
  const a = r * 0.42;
  return [[-a, -r], [a, -r], [r, -a], [r, a], [a, r], [-a, r], [-r, a], [-r, -a]]
    .map((p) => p.join(",")).join(" ");
}

function pieceLabel(p) {
  const side = p === p.toUpperCase() ? "cho" : "han";
  const name = NAMES[p.toLowerCase()];
  return { side, char: typeof name === "string" ? name : name[side] };
}

class Board {
  constructor(svg, onMove) {
    this.svg = svg;
    this.onMove = onMove;
    this.flipped = false;
    this.pieces = [];
    this.legal = {};
    this.selected = null;
    this.drag = null;
    this.drawBase();
    this.layer = el("g", {}, svg);
    this.marks = el("g", {}, svg);
    svg.addEventListener("pointerdown", (e) => this.pointerDown(e));
    svg.addEventListener("pointermove", (e) => this.pointerMove(e));
    svg.addEventListener("pointerup", (e) => this.pointerUp(e));
  }

  drawBase() {
    const defs = el("defs", {}, this.svg);
    const grain = el("filter", { id: "grain", x: "0", y: "0", width: "100%", height: "100%" }, defs);
    el("feTurbulence", { type: "fractalNoise", baseFrequency: "0.012 0.32", numOctaves: "4", seed: "8" }, grain);
    el("feColorMatrix", { values: "0 0 0 0 .36  0 0 0 0 .22  0 0 0 0 .08  0 0 0 .55 -.1" }, grain);
    const faces = [
      ["face-ivory", "#f6edd8", "#dccba6"], ["face-boxwood", "#e9c98a", "#c2954f"],
      ["face-jade", "#d9ece0", "#9fc7b0"], ["face-slate", "#3d4148", "#23262b"],
    ];
    for (const [id, a, b] of faces) {
      const g = el("linearGradient", { id, x1: "0", y1: "0", x2: "1", y2: "1" }, defs);
      el("stop", { offset: "0", "stop-color": a }, g);
      el("stop", { offset: "1", "stop-color": b }, g);
    }
    const w = U.x * 8 + U.left * 2, h = U.y * 9 + U.top * 2;
    el("rect", { x: 3, y: 7, width: w - 6, height: h - 8, rx: 5, fill: "#0f1a2a", opacity: .55 }, this.svg);
    el("rect", { class: "board-face", x: 0, y: 0, width: w - 2, height: h - 6, rx: 5 }, this.svg);
    el("rect", { class: "board-grain", x: 0, y: 0, width: w - 2, height: h - 6, rx: 5, filter: "url(#grain)" }, this.svg);
    const lines = el("g", { class: "board-lines", "stroke-width": 1.5, "stroke-linecap": "round", fill: "none" }, this.svg);
    const X = (c) => U.left + c * U.x, Y = (r) => U.top + r * U.y;
    for (let c = 0; c < 9; c++) el("line", { x1: X(c), y1: Y(0), x2: X(c), y2: Y(9) }, lines);
    for (let r = 0; r < 10; r++) el("line", { x1: X(0), y1: Y(r), x2: X(8), y2: Y(r) }, lines);
    for (const [a, b] of [[0, 2], [7, 9]]) {
      el("line", { x1: X(3), y1: Y(a), x2: X(5), y2: Y(b) }, lines);
      el("line", { x1: X(5), y1: Y(a), x2: X(3), y2: Y(b) }, lines);
    }
    el("rect", { x: X(0) - 5, y: Y(0) - 5, width: U.x * 8 + 10, height: U.y * 9 + 10, "stroke-width": 2.5 }, lines);
    const spots = [[1, 2], [7, 2], [1, 7], [7, 7]];
    for (const c of [0, 2, 4, 6, 8]) spots.push([c, 3], [c, 6]);
    for (const [c, r] of spots) {
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (c + dx < 0 || c + dx > 8) continue;
        const x = X(c) + dx * 7, y = Y(r) + dy * 7;
        el("path", { d: `M${x + dx * 9} ${y}H${x}V${y + dy * 9}`, "stroke-width": 1.2 }, lines);
      }
    }
  }

  // 말 위치 계산
  point(c, r) {
    const dc = this.flipped ? 8 - c : c, dr = this.flipped ? 9 - r : r;
    return { x: U.left + dc * U.x, y: U.top + dr * U.y };
  }

  square(c, r) { return "abcdefghi"[c] + (10 - r); }

  cell(sq) { return { c: sq.charCodeAt(0) - 97, r: 10 - Number(sq.slice(1)) }; }

  fromEvent(e) {
    const m = this.svg.getScreenCTM().inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    const dc = Math.round((p.x - U.left) / U.x), dr = Math.round((p.y - U.top) / U.y);
    if (dc < 0 || dc > 8 || dr < 0 || dr > 9) return null;
    const c = this.flipped ? 8 - dc : dc, r = this.flipped ? 9 - dr : dr;
    return { sq: this.square(c, r), x: p.x, y: p.y };
  }

  // 판 그리기
  render(view) {
    this.board = view.board;
    this.flipped = view.side === "han";
    this.legal = view.legal || {};
    this.mine = view.interactive ? view.side : null;
    this.lastMove = view.last || null;
    this.checkSide = view.check ? view.turn : null;
    this.threats = view.threats || [];
    this.arrows = view.arrows || [];
    this.selected = null;
    this.drawPieces();
    this.drawMarks();
    this.animate();
  }

  drawPieces() {
    this.layer.replaceChildren();
    this.nodes = {};
    this.board.forEach((row, r) => row.forEach((p, c) => {
      if (!p) return;
      const { side, char } = pieceLabel(p);
      const kind = p.toLowerCase();
      const s = SIZE[kind];
      const sq = this.square(c, r);
      const pos = this.point(c, r);
      const g = el("g", { class: `piece ${side}`, "data-sq": sq }, this.layer);
      g.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      if (side === this.mine) g.classList.add("mine");
      if (this.lastMove && this.lastMove.to === sq && !this.lastMove.pass) g.classList.add("last");
      if (kind === "k" && side === this.checkSide) g.classList.add("in-check");
      el("polygon", { class: "edge", points: octagon(s), transform: "translate(0 4)" }, g);
      el("polygon", { class: "face", points: octagon(s) }, g);
      el("polygon", { class: "rim", points: octagon(s - 4) }, g);
      const t = el("text", { y: 1, "font-size": s * 1.28 }, g);
      t.textContent = char;
      this.nodes[sq] = g;
    }));
  }

  drawMarks() {
    this.marks.replaceChildren();
    if (this.lastMove && !this.lastMove.pass) {
      const a = this.cell(this.lastMove.from), p = this.point(a.c, a.r);
      el("circle", { class: "mark-from", cx: p.x, cy: p.y, r: 15 }, this.marks);
    }
    for (const sq of this.threats) {
      const { c, r } = this.cell(sq), p = this.point(c, r);
      const s = SIZE[this.board[r][c].toLowerCase()] + 4;
      el("polygon", { class: "mark-threat", points: octagon(s), transform: `translate(${p.x} ${p.y})` }, this.marks);
    }
    for (const a of this.arrows) this.drawArrow(a);
    for (const n of Object.values(this.nodes)) n.classList.remove("selected");
    if (!this.selected) return;
    this.nodes[this.selected]?.classList.add("selected");
    for (const sq of this.legal[this.selected] || []) {
      const { c, r } = this.cell(sq), p = this.point(c, r);
      if (this.board[r][c]) {
        const s = SIZE[this.board[r][c].toLowerCase()] + 5;
        el("polygon", { class: "mark-take", points: octagon(s), transform: `translate(${p.x} ${p.y})` }, this.marks);
      } else {
        el("circle", { class: "mark-move", cx: p.x, cy: p.y, r: 11 }, this.marks);
      }
    }
  }

  drawArrow(a) {
    const from = this.cell(a.from), to = this.cell(a.to);
    const p = this.point(from.c, from.r), q = this.point(to.c, to.r);
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const ux = (q.x - p.x) / length, uy = (q.y - p.y) / length;
    const end = { x: q.x - ux * 16, y: q.y - uy * 16 };
    const g = el("g", { class: `arrow ${a.kind}` }, this.marks);
    el("line", { x1: p.x + ux * 12, y1: p.y + uy * 12, x2: end.x, y2: end.y }, g);
    const nx = -uy, ny = ux, size = 15;
    el("polygon", {
      points: `${q.x - ux * 2},${q.y - uy * 2} ${end.x + nx * size},${end.y + ny * size} ${end.x - nx * size},${end.y - ny * size}`,
    }, g);
  }

  animate() {
    const m = this.lastMove;
    const pieces = this.board.flat().filter(Boolean).length;
    const taken = this.pieceCount !== undefined && pieces < this.pieceCount;
    this.pieceCount = pieces;
    const key = m && m.from + m.to + this.board.flat().join("");
    if (!m || m.pass || !this.nodes[m.to] || this.lastShown === key) return;
    this.lastShown = key;
    this.onPlace?.(taken);
    if (this.dropped === m.from + m.to) {  // 끌어다 놓은 수는 이미 제자리에 있다
      this.dropped = null;
      return;
    }
    const node = this.nodes[m.to];
    const target = node.style.transform;
    const a = this.cell(m.from), p = this.point(a.c, a.r);
    node.style.transform = `translate(${p.x}px, ${p.y}px)`;
    node.getBoundingClientRect();
    node.classList.add("moving");
    node.style.transform = target;
  }

  // 입력
  pointerDown(e) {
    if (!this.mine) return;
    const hit = this.fromEvent(e);
    if (!hit) return;
    const { c, r } = this.cell(hit.sq);
    const p = this.board[r][c];
    const own = p && (p === p.toUpperCase() ? "cho" : "han") === this.mine;
    if (this.selected && (this.legal[this.selected] || []).includes(hit.sq)) {
      this.commit(this.selected, hit.sq);
      return;
    }
    if (own && this.legal[hit.sq]) {
      this.selected = hit.sq;
      this.drawMarks();
      this.drag = { from: hit.sq, moved: false };
      this.svg.setPointerCapture(e.pointerId);
    } else {
      this.selected = null;
      this.drawMarks();
    }
  }

  pointerMove(e) {
    if (!this.drag) return;
    const hit = this.fromEvent(e);
    const node = this.nodes[this.drag.from];
    if (!hit || !node) return;
    const a = this.cell(this.drag.from), p = this.point(a.c, a.r);
    if (!this.drag.moved && Math.hypot(hit.x - p.x, hit.y - p.y) < 8) return;
    this.drag.moved = true;
    this.layer.appendChild(node);
    node.style.transform = `translate(${hit.x}px, ${hit.y - 3}px)`;
  }

  pointerUp(e) {
    if (!this.drag) return;
    const { from, moved } = this.drag;
    this.drag = null;
    if (!moved) return;
    const hit = this.fromEvent(e);
    if (hit && (this.legal[from] || []).includes(hit.sq)) {
      this.commit(from, hit.sq, true);
      return;
    }
    const a = this.cell(from), p = this.point(a.c, a.r);
    this.nodes[from].style.transform = `translate(${p.x}px, ${p.y}px)`;
  }

  commit(from, to, dragged = false) {
    this.selected = null;
    if (dragged) this.dropped = from + to;
    this.mine = null;
    this.onMove(from + to);
  }
}
