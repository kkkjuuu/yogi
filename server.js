const express = require("express"), http = require("http"), { Server } = require("socket.io");
const app = express(), srv = http.createServer(app), io = new Server(srv);
app.use(express.static("public"));
const K = ["skip", "rev", "draw", "shield", "swap"], card = () => K[Math.floor(Math.random() * K.length)];
const rooms = {};
const newCode = () => { let c; do c = Array.from({ length: 4 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ"[Math.random() * 23 | 0]).join(""); while (rooms[c]); return c; };
const NAME = { skip: "ข้ามตา", rev: "ย้อนทิศ", draw: "จั่ว 2 ใบ", shield: "โล่กัน", swap: "สลับมือ" };

function push(r) {
  r.players.forEach(p => p.sock && io.to(p.sock).emit("state", {
    code: r.code, started: r.started, over: r.over, turn: r.turn, round: Math.floor(r.moves / Math.max(1, r.players.length)) + 1,
    msg: r.msg, pile: r.pile, host: r.players[0].id, hand: p.hand,
    players: r.players.map(q => ({ id: q.id, name: q.name, count: q.hand.length, on: !!q.sock }))
  }));
}
function advance(r, step = 1) {
  const n = r.players.length; r.moves++;
  for (let i = 0, s = step; i < n * 2 && s > 0; i++) {           // ข้ามคนที่หลุดออนไลน์
    r.turn = ((r.turn + r.dir) % n + n) % n;
    if (r.players[r.turn].sock) s--;
  }
}
const nextP = r => r.players[((r.turn + r.dir) % r.players.length + r.players.length) % r.players.length];

io.on("connection", s => {
  const my = () => { const r = rooms[s.data.room]; return r && { r, p: r.players.find(x => x.id === s.data.uid) }; };
  s.on("join", ({ create, code, uid, name }, ack) => {
    if (typeof ack !== "function" || !uid || !String(name || "").trim()) return;
    let r = create ? (rooms[code = newCode()] = { code, players: [], started: false, over: false, turn: 0, dir: 1, moves: 0, pile: null, msg: "รอผู้เล่น" }) : rooms[String(code || "").toUpperCase()];
    if (!r) return ack({ error: "ไม่พบห้องนี้" });
    let p = r.players.find(x => x.id === uid);
    if (!p) {
      if (r.started && !r.over) return ack({ error: "เกมเริ่มไปแล้ว" });
      if (r.players.length >= 6) return ack({ error: "ห้องเต็ม (สูงสุด 6 คน)" });
      p = { id: uid, hand: [] }; r.players.push(p);
    }
    p.name = String(name).trim().slice(0, 14); p.sock = s.id; p.shield = p.shield || false;
    s.data = { room: r.code, uid }; s.join(r.code); ack({ code: r.code }); push(r);
  });
  s.on("start", () => {
    const m = my(); if (!m) return; const { r, p } = m;
    if (p !== r.players[0] || r.players.length < 2 || (r.started && !r.over)) return;
    r.players.forEach(q => { q.hand = Array.from({ length: 5 }, card); q.shield = false; });
    Object.assign(r, { started: true, over: false, turn: 0, dir: 1, moves: 0, pile: null, msg: "เริ่มเกมแล้ว" }); push(r);
  });
  s.on("play", idx => {
    const m = my(); if (!m) return; const { r, p } = m;
    if (!r.started || r.over || r.players[r.turn] !== p || !(idx in p.hand)) return;
    const k = p.hand.splice(idx, 1)[0]; r.pile = k; let step = 1, note = "";
    const nx = nextP(r);
    if (k === "skip") step = 2;
    else if (k === "rev") { r.dir *= -1; note = " ทิศการเล่นกลับด้าน"; }
    else if (k === "shield") { p.shield = true; note = " (รับโล่ 1 ครั้ง)"; }
    else if (k === "draw" || k === "swap") {
      if (nx === p) { }
      else if (nx.shield) { nx.shield = false; note = ` แต่ ${nx.name} ใช้โล่กันไว้`; }
      else if (k === "draw") { nx.hand.push(card(), card()); note = ` ${nx.name} จั่ว 2 ใบ`; }
      else { [p.hand, nx.hand] = [nx.hand, p.hand]; note = ` สลับมือกับ ${nx.name}`; }
    }
    r.msg = `${p.name} ใช้ ${NAME[k]}${note}`;
    if (!p.hand.length) { r.over = true; r.msg = `${p.name} ชนะ! ไพ่หมดมือ`; } else advance(r, step);
    push(r);
  });
  s.on("draw", () => {
    const m = my(); if (!m) return; const { r, p } = m;
    if (!r.started || r.over || r.players[r.turn] !== p) return;
    p.hand.push(card()); r.msg = `${p.name} จั่วการ์ด 1 ใบ`; advance(r); push(r);
  });
  const out = () => {
    const m = my(); if (!m) return; const { r, p } = m;
    p.sock = null; s.leave(r.code);
    if (!r.started) r.players = r.players.filter(x => x !== p);
    else if (r.players[r.turn] === p && !r.over) advance(r, 0 + 1);
    s.data = {}; r.players.length ? push(r) : delete rooms[r.code];
  };
  s.on("leave", out); s.on("disconnect", out);
});
setInterval(() => { for (const c in rooms) if (!rooms[c].players.some(p => p.sock)) delete rooms[c]; }, 3600e3);
srv.listen(process.env.PORT || 3000, () => console.log("yogi on", process.env.PORT || 3000));
