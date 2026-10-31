import http from "http";
import crypto from "crypto";
import mongoose from "mongoose";

const PORT = process.env.PORT || 3000;
const WEB_ORIGIN = process.env.WEB_ORIGIN || "*";
// Owner API — .env එකේ OWNER_API_KEY දාන්න (SHAN_MINI_ වලින් පටන් ගන්න ඕනේ)
const OWNER_KEY = process.env.OWNER_API_KEY || "SHAN_MINI_shanika";
const OWNER_NUMBER = process.env.OWNER_NUMBER || "94752661225";

const keys = () => mongoose.connection.collection("apikeys");
const sessions = new Map(); // admin token -> expiry

const send = (res, code, data) => {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": WEB_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type,x-api-key,x-admin-token",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS"
  });
  res.end(JSON.stringify(data));
};

const body = req =>
  new Promise(r => {
    let d = "";
    req.on("data", c => (d += c));
    req.on("end", () => {
      try { r(JSON.parse(d || "{}")); } catch { r({}); }
    });
  });

const isAdmin = req => {
  const exp = sessions.get(req.headers["x-admin-token"]);
  return Boolean(exp && exp > Date.now());
};

const newKey = () => "SHAN_MINI_" + crypto.randomBytes(16).toString("hex");

/* Number එකකට key එකක් දෙනවා (කලින් තියෙනවා නම් ඒකම).
   Owner number එකට හැමදාම OWNER_API_KEY එකම. */
export async function getOrCreateKey(number, name = "") {
  if (mongoose.connection.readyState !== 1 || !number) return null;

  const col = keys();
  const isOwner = number === OWNER_NUMBER;
  let doc = await col.findOne({ number });

  if (!doc) {
    doc = {
      number,
      name: name || number,
      key: isOwner ? OWNER_KEY : newKey(),
      role: isOwner ? "owner" : "user",
      active: true,
      sent: false,
      createdAt: new Date()
    };
    await col.insertOne(doc);
  } else if (isOwner && doc.key !== OWNER_KEY) {
    await col.updateOne({ number }, { $set: { key: OWNER_KEY, role: "owner" } });
    doc.key = OWNER_KEY;
  }

  return doc.key;
}

export async function isKeySent(number) {
  if (mongoose.connection.readyState !== 1) return false;
  const doc = await keys().findOne({ number });
  return Boolean(doc?.sent);
}

export async function markKeySent(number) {
  if (mongoose.connection.readyState !== 1) return;
  await keys().updateOne({ number }, { $set: { sent: true, sentAt: new Date() } });
}

async function verifyKey(key) {
  if (!key || !key.startsWith("SHAN_MINI_")) return null;
  if (key === OWNER_KEY) return { role: "owner" };
  const doc = await keys().findOne({ key, active: { $ne: false } });
  return doc ? { role: "user", number: doc.number, name: doc.name } : null;
}

export function startApiServer() {
  http
    .createServer(async (req, res) => {
      if (req.method === "OPTIONS") return send(res, 204, {});
      const url = new URL(req.url, "http://x");

      try {
        // Admin login — Owner API එකෙන් විතරයි
        if (url.pathname === "/api/admin/login" && req.method === "POST") {
          const { key } = await body(req);
          if (key !== OWNER_KEY) return send(res, 401, { error: "Owner API only" });
          const token = crypto.randomBytes(32).toString("hex");
          sessions.set(token, Date.now() + 12 * 3600 * 1000);
          return send(res, 200, { token });
        }

        // Key verify
        if (url.pathname === "/api/verify") {
          const r = await verifyKey(req.headers["x-api-key"]);
          return r
            ? send(res, 200, { valid: true, ...r })
            : send(res, 401, { valid: false });
        }

        // ---- Admin only ----
        if (url.pathname.startsWith("/api/keys")) {
          if (!isAdmin(req)) return send(res, 401, { error: "Admin login required" });

          if (req.method === "GET")
            return send(res, 200, await keys().find({}).toArray());

          if (req.method === "POST") {
            const { name, number } = await body(req);
            const clean = String(number || "").replace(/\D/g, "");

            if (clean) {
              const key = await getOrCreateKey(clean, name);
              return send(res, 200, { key });
            }

            const k = newKey();
            await keys().insertOne({
              name: String(name || "user"),
              key: k,
              role: "user",
              active: true,
              createdAt: new Date()
            });
            return send(res, 200, { key: k });
          }

          if (req.method === "DELETE") {
            const number = url.searchParams.get("number");
            const r = await keys().deleteOne({ number });
            return send(res, 200, { deleted: r.deletedCount });
          }
        }

        send(res, 404, { error: "Not found" });
      } catch (e) {
        send(res, 500, { error: e.message });
      }
    })
    .listen(PORT, () => console.log(`🌐 API server on :${PORT}`));
}
