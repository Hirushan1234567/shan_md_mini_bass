import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import mongoose from "mongoose";
import * as baileys from "@whiskeysockets/baileys";
import dotenv from "dotenv";

dotenv.config();

const makeWASocket = typeof baileys.default === "function" ? baileys.default : baileys.makeWASocket;
const { useMultiFileAuthState, fetchLatestWaWebVersion, DisconnectReason } = baileys;
const PORT = Number(process.env.PAIR_PORT || 3010);
const SECRET = String(process.env.PAIR_API_SECRET || "");
const MONGO = String(process.env.MONGODB_URI || "");
const COLLECTION = process.env.PAIR_SITE_COLLECTION || "pair_sessions";
const logger = pino({ level: "silent" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = n => String(n || "").replace(/\D/g, "");
const valid = n => /^[1-9]\d{7,14}$/.test(n);

if (!SECRET || !MONGO) {
  console.error("PAIR_API_SECRET and MONGODB_URI are required.");
  process.exit(1);
}

await mongoose.connect(MONGO);
const sessions = mongoose.connection.collection(COLLECTION);
console.log("SHAN VPS Pair API connected to MongoDB.");

const active = new Set();
function send(res, value) {
  if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(value) + "\n");
}
function readFiles(dir) {
  const files = [];
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (!fs.statSync(full).isFile()) continue;
    const data = fs.readFileSync(full, "utf8");
    total += Buffer.byteLength(data);
    if (total > 12 * 1024 * 1024) throw new Error("Session too large");
    files.push({ name, data });
  }
  return files;
}

async function pair(req, res, number) {
  if (active.has(number)) {
    res.writeHead(409, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Pairing already in progress for this number." }));
  }
  const old = await sessions.findOne({ _id: number }, { projection: { status: 1, active: 1 } });
  if (old?.status === "ready" && old?.active) {
    res.writeHead(409, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "This number is already connected." }));
  }

  active.add(number);
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });

  const dir = path.join(os.tmpdir(), "shan-pair-" + number + "-" + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  let sock;
  let finished = false;
  let registered = false;
  let aborted = false;
  const finish = async (error) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    try { sock?.ev?.removeAllListeners?.(); sock?.end?.(undefined); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    active.delete(number);
    if (error && !aborted) send(res, { type: "error", reason: error === "expired" ? "expired" : "failed" });
    if (!res.writableEnded) res.end();
  };
  const timeout = setTimeout(() => { void finish("expired"); }, 180000);
  res.on("close", () => {
    if (!res.writableEnded) { aborted = true; void finish("aborted"); }
  });

  try {
    const latest = await fetchLatestWaWebVersion();
    if (finished) return;
    const version = latest?.version;
    if (!Array.isArray(version) || version.length !== 3) throw new Error("WhatsApp version unavailable");
    const { state, saveCreds } = await useMultiFileAuthState(dir);
    if (finished) return;
    sock = makeWASocket({
      version, auth: state, logger, printQRInTerminal: false,
      markOnlineOnConnect: false, syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      connectTimeoutMs: 60000, defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000, generateHighQualityLinkPreview: false,
      browser: ["Ubuntu", "Chrome", "20.0.04"]
    });
    sock.ev.on("creds.update", () => { void saveCreds().catch(() => {}); });
    sock.ev.on("connection.update", async update => {
      if (finished) return;
      if (update.connection === "open") {
        registered = true;
        send(res, { type: "status", status: "linking" });
        try {
          await sleep(6000);
          await saveCreds();
          const files = readFiles(dir);
          await sessions.updateOne(
            { _id: number },
            { $set: { status: "ready", files, active: false, claimedAt: null, updatedAt: new Date() },
              $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
          );
          send(res, { type: "status", status: "linked" });
          await finish();
        } catch (e) {
          console.error("Pair session save failed:", e?.message || e);
          await finish("failed");
        }
      }
      if (update.connection === "close" && !registered) {
        const code = update.lastDisconnect?.error?.output?.statusCode || update.lastDisconnect?.error?.statusCode;
        if (code !== DisconnectReason.restartRequired) {
          console.error("Pair socket closed before link:", code, update.lastDisconnect?.error?.message || "No error message", update.lastDisconnect?.error?.name || "Unknown error", update.lastDisconnect?.error?.output?.payload?.message || "No payload message");
          await finish("failed");
        }
      }
    });
    await sleep(2500);
    if (finished || state.creds.registered) throw new Error("Pair socket is not ready for a new link");
    const code = await sock.requestPairingCode(number);
    send(res, { type: "code", code: code.length === 8 ? code.slice(0,4) + "-" + code.slice(4) : code, expiresIn: 180 });
  } catch (e) {
    console.error("Pair API error:", e?.stack || e?.message || e);
    await finish("failed");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true, service: "SHAN VPS Pair API" }));
  }
  if (req.method !== "POST" || url.pathname !== "/api/pair") {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Not found" }));
  }
  if (req.headers["x-pair-secret"] !== SECRET) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Unauthorized" }));
  }
  let body = "";
  req.on("data", chunk => { body += chunk; if (body.length > 4096) req.destroy(); });
  req.on("end", async () => {
    try {
      const number = clean(JSON.parse(body || "{}").number);
      if (!valid(number)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Invalid WhatsApp number." }));
      }
      await pair(req, res, number);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request." }));
      }
    }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log("SHAN VPS Pair API listening on 127.0.0.1:" + PORT));
async function shutdown() {
  server.close();
  try { await mongoose.disconnect(); } catch {}
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
