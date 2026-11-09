// SHAN MINI BOT — TikTok API handoff plugin
// Commands: .tt <TikTok URL> | .tt document <URL> | .tt audio <URL>
// API returns a provider handoff URL (not a media file), so this plugin
// sends the verified handoff link and the API's instructions to the chat.

const API_BASE = String(
  process.env.SHAN_MINI_API_URL || "http://127.0.0.1:3036"
).replace(/\/+$/, "");

const API_KEY = String(process.env.SHAN_MINI_API_KEY || "").trim();

const API_ENDPOINT = API_BASE.endsWith("/api/v1/tt/convert")
  ? API_BASE
  : `${API_BASE}/api/v1/tt/convert`;

const TIKTOK_URL = /https?:\/\/(?:www\.|vm\.|vt\.)?tiktok\.com\/\S+/i;

function firstUrl(value = "") {
  return String(value).match(/https?:\/\/[^\s<>"']+/i)?.[0] || "";
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function cleanText(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

export default {
  command: "tt",
  commands: ["tt", "tiktok", "ttdl", "tiktokdl"],
  alias: ["tiktok", "ttdl", "tiktokdl"],
  category: "download",
  description: "TikTok video / audio link",

  async execute(sock, msg, args = [], commandName = "tt") {
    const chat = msg?.key?.remoteJid;
    if (!chat) return;

    const reply = text =>
      sock.sendMessage(chat, { text }, { quoted: msg });

    const values = Array.isArray(args) ? [...args] : String(args || "").split(/\s+/);
    let format = "video";

    if (["video", "document", "doc", "audio", "mp3"].includes(
      String(values[0] || "").toLowerCase()
    )) {
      const selected = String(values.shift()).toLowerCase();
      format = selected === "doc" ? "document" : selected === "mp3" ? "audio" : selected;
    }

    const input = values.join(" ").trim();
    const url = firstUrl(input);

    if (!url || !TIKTOK_URL.test(url)) {
      return reply(
        "🎵 *SHAN TIKTOK DOWNLOADER*\n\n" +
        "Usage:\n" +
        ".tt <TikTok URL>\n" +
        ".tt document <TikTok URL>\n" +
        ".tt audio <TikTok URL>"
      );
    }

    if (!API_KEY) {
      return reply(
        "❌ TikTok API key is not configured.\n" +
        "Add SHAN_MINI_API_KEY to the bot's private .env file."
      );
    }

    try {
      await sock.sendMessage(chat, { react: { text: "⏳", key: msg.key } });

      const endpoint = new URL(API_ENDPOINT);
      endpoint.searchParams.set("format", format);
      endpoint.searchParams.set("url", url);
      endpoint.searchParams.set("api_key", API_KEY);

      const response = await fetch(endpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30000)
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data || data.status !== true) {
        const reason = cleanText(
          data?.detail || data?.message || data?.error,
          `API request failed (HTTP ${response.status})`
        );
        throw new Error(reason);
      }

      const providerUrl = safeHttpUrl(data.provider_url);

      if (!providerUrl) {
        throw new Error("The API did not return a valid provider link.");
      }

      const provider = cleanText(data.provider, "TikTok provider");
      const instruction = cleanText(
        data.instruction,
        "Open the provider link and follow its instructions."
      );
      const delivery = cleanText(data.delivery, format);

      const text =
        "╭━━〔 🎵 SHAN TIKTOK 〕━━╮\n\n" +
        `📦 Format: ${cleanText(data.format, format.toUpperCase())}\n` +
        `🔗 Provider: ${provider}\n` +
        `📤 Delivery: ${delivery}\n\n` +
        "🔗 *Continue here:*\n" +
        providerUrl +
        "\n\n" +
        instruction +
        "\n\n" +
        "ℹ️ The current API returns a provider link, not the video file itself.\n" +
        "╰━━━━━━━━━━━━━━━━━━━━╯";

      await reply(text);

      try {
        await sock.sendMessage(chat, { react: { text: "✅", key: msg.key } });
      } catch {}
    } catch (error) {
      console.error("[SHAN:TIKTOK] API error:", error?.stack || error?.message || error);

      try {
        await sock.sendMessage(chat, { react: { text: "❌", key: msg.key } });
      } catch {}

      return reply(
        "❌ *TikTok request failed*\n\n" +
        cleanText(error?.message, "Please try again later.")
      );
    }
  }
};
