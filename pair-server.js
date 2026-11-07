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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || "").replace(/\D/g, "");
const valid = number => /^[1-9]\d{7,14}$/.test(number);
const active = new Map();

if (!SECRET || !MONGO) {
  console.error("PAIR_API_SECRET and MONGODB_URI are required.");
  process.exit(1);
}

await mongoose.connect(MONGO);
const sessions = mongoose.connection.collection(COLLECTION);
console.log("SHAN VPS Pair API connected to MongoDB.");

function json(res, status, value) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
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

async function startPair(number) {
  if (active.has(number)) {
    const current = active.get(number);
    return { status: current.status, pairCode: current.pairCode || null, expiresIn: 180 };
  }

  const old = await sessions.findOne({ _id: number }, { projection: { status: 1, active: 1 } });
  if (old?.status === "ready" && old?.active) {
    const error = new Error("This number is already connected.");
    error.statusCode = 409;
    throw error;
  }

  const dir = path.join(os.tmpdir(), "shan-pair-" + number + "-" + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  const stateInfo = { status: "starting", pairCode: null, sock: null, dir, timer: null, registered: false, finished: false };
  active.set(number, stateInfo);

  const cleanup = async (status, errorMessage = null) => {
    if (stateInfo.finished) return;
    stateInfo.finished = true;
    clearTimeout(stateInfo.timer);
    try { stateInfo.sock?.ev?.removeAllListeners?.(); stateInfo.sock?.end?.(undefined); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    active.delete(number);
    if (status === "failed" || status === "expired") {
      await sessions.updateOne(
        { _id: number },
        { $set: { status, active: false, pairCode: null, error: errorMessage || status, updatedAt: new Date() } },
        { upsert: true }
      ).catch(() => {});
    }
  };

  stateInfo.timer = setTimeout(() => { void cleanup("expired", "Pairing code expired"); }, 180000);

  try {
    await sessions.updateOne(
      { _id: number },
      { $set: { status: "pairing", active: false, pairCode: null, error: null, updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );

    const latest = await fetchLatestWaWebVersion();
    const version = latest?.version;
    if (!Array.isArray(version) || version.length !== 3) throw new Error("WhatsApp version unavailable");

    const { state, saveCreds } = await useMultiFileAuthState(dir);
    if (state.creds.registered) throw new Error("This temporary pairing session is already registered");

    let reconnectAttempts = 0;
    let reconnectTimer = null;

    const connectSocket = () => {
      if (stateInfo.finished) return;
      const sock = makeWASocket({
        version, auth: state, logger, printQRInTerminal: false,
        markOnlineOnConnect: false, syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        connectTimeoutMs: 60000, defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000, generateHighQualityLinkPreview: false,
        browser: ["Ubuntu", "Chrome", "20.0.04"]
      });
      stateInfo.sock = sock;

      sock.ev.on("creds.update", () => {
        void saveCreds().catch(error => console.error("Pair creds save failed:", error?.message || error));
      });

      sock.ev.on("connection.update", async update => {
        if (stateInfo.finished || stateInfo.sock !== sock) return;

        if (update.connection === "open" && !stateInfo.registered) {
          stateInfo.registered = true;
          stateInfo.status = "linking";
          try {
            await sleep(5000);
            await saveCreds();
            const files = readFiles(dir);
            if (!files.some(file => file.name === "creds.json")) throw new Error("WhatsApp credentials were not saved");
            await sessions.updateOne(
              { _id: number },
              { $set: { status: "ready", files, active: false, pairCode: null, error: null, claimedAt: null, updatedAt: new Date() },
                $setOnInsert: { createdAt: new Date() } },
              { upsert: true }
            );
            console.log("WhatsApp pair saved for number:", number);
            await cleanup("ready");
          } catch (error) {
            console.error("Pair session save failed:", error?.stack || error?.message || error);
            await cleanup("failed", error?.message || "Could not save linked session");
          }
        }

        if (update.connection === "close" && !stateInfo.registered) {
          const code = update.lastDisconnect?.error?.output?.statusCode || update.lastDisconnect?.error?.statusCode;
          if (code === DisconnectReason.restartRequired) {
            reconnectAttempts += 1;
            if (reconnectAttempts > 5) {
              await cleanup("failed", "WhatsApp requested too many reconnects");
              return;
            }
            console.log("Pair socket restarting after WhatsApp link handshake:", number, reconnectAttempts);
            try { sock.ev.removeAllListeners(); } catch {}
            reconnectTimer = setTimeout(() => {
              reconnectTimer = null;
              connectSocket();
            }, 1200);
            return;
          }
          const message = update.lastDisconnect?.error?.message || "WhatsApp connection closed before linking";
          console.error("Pair socket closed before link:", code, message, update.lastDisconnect?.error?.name || "Unknown error");
          await cleanup("failed", message);
        }
      });
    };

    connectSocket();
    await sleep(2500);
    if (stateInfo.finished || state.creds.registered) throw new Error("Pair socket is not ready for a new link");
    const rawCode = await sock.requestPairingCode(number);
    const pairCode = rawCode.length === 8 ? rawCode.slice(0, 4) + "-" + rawCode.slice(4) : rawCode;
    stateInfo.status = "pairing";
    stateInfo.pairCode = pairCode;
    await sessions.updateOne(
      { _id: number },
      { $set: { status: "pairing", pairCode, codeExpiresAt: new Date(Date.now() + 180000), updatedAt: new Date() } },
      { upsert: true }
    );
    return { status: "pairing", pairCode, expiresIn: 180 };
  } catch (error) {
    console.error("Pair API error:", error?.stack || error?.message || error);
    await cleanup("failed", error?.message || "Pair request failed");
    throw error;
  }
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error("Request body too large");
  }
  return JSON.parse(raw || "{}");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "SHAN VPS Pair API" });
  }

  if (req.headers["x-pair-secret"] !== SECRET) {
    return json(res, 401, { error: "Unauthorized" });
  }

  try {
    if (req.method === "POST" && url.pathname === "/api/pair") {
      const number = clean((await readBody(req)).number);
      if (!valid(number)) return json(res, 400, { error: "Invalid WhatsApp number." });
      const result = await startPair(number);
      return json(res, 200, { success: true, number, ...result });
    }

    const match = url.pathname.match(/^\/api\/pair\/([1-9]\d{7,14})$/);
    if (req.method === "GET" && match) {
      const number = match[1];
      const live = active.get(number);
      if (live) {
        return json(res, 200, {
          success: true, number, status: live.status,
          pairCode: live.pairCode && live.status === "pairing" ? live.pairCode : null
        });
      }
      const saved = await sessions.findOne({ _id: number }, { projection: { status: 1, active: 1, pairCode: 1, codeExpiresAt: 1, error: 1, updatedAt: 1 } });
      if (!saved) return json(res, 404, { error: "Pairing session not found" });
      const codeValid = saved.codeExpiresAt && new Date(saved.codeExpiresAt).getTime() > Date.now();
      return json(res, 200, {
        success: true, number, status: saved.status || "pending",
        pairCode: codeValid ? saved.pairCode || null : null,
        active: saved.active === true, error: saved.error || null
      });
    }

    return json(res, 404, { error: "Not found" });
  } catch (error) {
    return json(res, error.statusCode || 500, { error: error.message || "Pair API error" });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log("SHAN VPS Pair API listening on 127.0.0.1:" + PORT));
async function shutdown() {
  server.close();
  for (const [number, state] of active) {
    clearTimeout(state.timer);
    try { state.sock?.end?.(undefined); } catch {}
    try { fs.rmSync(state.dir, { recursive: true, force: true }); } catch {}
  }
  try { await mongoose.disconnect(); } catch {}
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
