// SHAN MINI BOT — TikTok format selector
// The configured TikTok API currently returns a provider handoff URL, not a media file.
const API_BASE = String(process.env.SHAN_MINI_API_URL || "http://127.0.0.1:3036").replace(/\/+$/, "");
const API_KEY = String(process.env.SHAN_MINI_API_KEY || "").trim();
const API_ENDPOINT = API_BASE.endsWith("/api/v1/tt/convert") ? API_BASE : `${API_BASE}/api/v1/tt/convert`;
const TIKTOK_URL = /https?:\/\/(?:www\.|vm\.|vt\.)?tiktok\.com\/\S+/i;
const pending = new Map();
function firstUrl(value = "") { return String(value).match(/https?:\/\/[^\s<>"']+/i)?.[0] || ""; }
function safeHttpUrl(value) { try { const url = new URL(String(value || "")); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : ""; } catch { return ""; } }
function cleanText(value, fallback = "") { return typeof value === "string" && value.trim() ? value.trim() : fallback; }
async function deliver(sock, msg, url, format) {
  const chat = msg?.key?.remoteJid, endpoint = new URL(API_ENDPOINT);
  endpoint.searchParams.set("format", format); endpoint.searchParams.set("url", url); endpoint.searchParams.set("api_key", API_KEY);
  const response = await fetch(endpoint, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.status !== true) throw new Error(cleanText(data?.detail || data?.message || data?.error, `API request failed (HTTP ${response.status})`));
  const providerUrl = safeHttpUrl(data.provider_url);
  if (!providerUrl) throw new Error("TikTok API did not return a valid provider link.");
  const text = ["╭━━〔 💠 SHAN TIKTOK 〕━━╮", "", `📦 Format: ${cleanText(data.format, format.toUpperCase())}`, `🔗 Provider: ${cleanText(data.provider, "TikTok provider")}`, `📤 Delivery: ${cleanText(data.delivery, format)}`, "", "🔗 Continue:", providerUrl, "", cleanText(data.instruction, "Open the provider link to continue."), "", "ℹ️ Current API supplies a provider link; it does not send the media file directly.", "╰━━━━━━━━━━━━━━━━━━━━╯"].join("\n");
  await sock.sendMessage(chat, { text }, { quoted: msg });
}
function makeId() { return Math.random().toString(36).slice(2, 8); }
export default {
  command: "tt", commands: ["tt", "tiktok", "ttdl", "tiktokdl"], alias: ["tiktok", "ttdl", "tiktokdl"],
  category: "download", description: "TikTok video / audio / document format selector", replyHandler: true,
  async execute(sock, msg, args = []) {
    const chat = msg?.key?.remoteJid; if (!chat) return;
    const url = firstUrl(Array.isArray(args) ? args.join(" ") : String(args || ""));
    if (!url || !TIKTOK_URL.test(url)) return sock.sendMessage(chat, { text: "🎵 *SHAN TIKTOK DOWNLOADER*\n\nUse: .tt <TikTok URL>" }, { quoted: msg });
    if (!API_KEY) return sock.sendMessage(chat, { text: "❌ TikTok API key is not configured." }, { quoted: msg });
    const id = makeId(); pending.set(id, { url, time: Date.now() });
    for (const [key, value] of pending) if (Date.now() - value.time > 600000) pending.delete(key);
    if (typeof globalThis.SHAN_SEND_NATIVE_BUTTONS !== "function") return sock.sendMessage(chat, { text: "TikTok format buttons are unavailable in this WhatsApp client." }, { quoted: msg });
    await globalThis.SHAN_SEND_NATIVE_BUTTONS(sock, chat, "💠 Choose your TikTok download format", [
      { id: `shan_tt_${id}_video`, text: "🎬 Video" }, { id: `shan_tt_${id}_audio`, text: "🎧 Audio" }, { id: `shan_tt_${id}_document`, text: "📁 Document" }
    ], { quoted: msg });
  },
  async handleReply(sock, msg, text) {
    const match = String(text || "").trim().match(/^shan_tt_([a-z0-9]{4,8})_(video|audio|document)$/i);
    if (!match) return false;
    const [, id, format] = match, entry = pending.get(id);
    if (!entry || Date.now() - entry.time > 600000) {
      pending.delete(id); await sock.sendMessage(msg.key.remoteJid, { text: "⌛ This TikTok selection expired. Please send the link again." }, { quoted: msg }); return true;
    }
    try {
      await sock.sendMessage(msg.key.remoteJid, { react: { text: "⏳", key: msg.key } });
      await deliver(sock, msg, entry.url, format.toLowerCase());
      await sock.sendMessage(msg.key.remoteJid, { react: { text: "✅", key: msg.key } });
    } catch (error) {
      console.error("[SHAN:TIKTOK] API error:", error?.stack || error?.message || error);
      await sock.sendMessage(msg.key.remoteJid, { text: "❌ TikTok request failed\n\n" + cleanText(error?.message, "Please try again later.") }, { quoted: msg });
      await sock.sendMessage(msg.key.remoteJid, { react: { text: "❌", key: msg.key } }).catch(() => {});
    }
    return true;
  }
};
