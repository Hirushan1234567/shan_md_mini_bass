// plugins/tiktok.js
// SHAN MINI BOT V1 — TikTok downloader (quality + Video / Document)
//
//   .tt <TikTok link>  → card → reply a number (1 = HD, 2 = SD, 3 = MP3 ...)
//                              → then 1 = Video, 2 = Document   (or reply "2d" to skip the 2nd step)
//
// Needs: dlcore.js in the main bot folder (next to index.js and lang.js).
// Source: tikwm.com (no watermark), fallback yt-dlp.
// To make it Premium-only: .premiumco tiktok

// dlcore.js root folder එකේ (index.js ළඟ) හෝ plugins/ ඇතුළේ — දෙකෙන් එකක තිබුණත් වැඩ කරනවා
const {
  createDownloader,
  downloadToFile,
  firstUrl,
  ytdlpInfo,
  ytdlpOptions,
  UA
} = await import("../dlcore.js").catch(() => import("./dlcore.js"));

const TT_URL = /https?:\/\/(?:[a-z0-9-]+\.)?tiktok\.com\/\S+/i;
const ORIGIN = "https://www.tikwm.com";

const abs = u => (!u ? "" : /^https?:\/\//i.test(u) ? u : `${ORIGIN}${u.startsWith("/") ? "" : "/"}${u}`);

async function tikwm(url) {
  const res = await fetch(`${ORIGIN}/api/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({ url, hd: "1" }),
    signal: AbortSignal.timeout(30000)
  });

  const json = await res.json().catch(() => null);

  if (!json || json.code !== 0 || !json.data) {
    throw new Error(json?.msg || "TikTok service unavailable");
  }

  const d = json.data;
  const options = [];

  if (Array.isArray(d.images) && d.images.length) {
    options.push({
      kind: "images",
      label: "",
      size: 0,
      get: async () => ({ images: d.images.map(abs) })
    });
  } else {
    const hd = abs(d.hdplay);
    const sd = abs(d.play);

    if (hd && hd !== sd) {
      options.push({ kind: "video", label: "HD", size: Number(d.hd_size) || 0, get: () => downloadToFile(hd) });
    }

    if (sd) {
      options.push({
        kind: "video",
        label: hd && hd !== sd ? "SD" : "Video",
        size: Number(d.size) || 0,
        get: () => downloadToFile(sd)
      });
    }
  }

  if (d.music) {
    options.push({ kind: "audio", label: "MP3", size: 0, get: () => downloadToFile(abs(d.music)) });
  }

  if (!options.length) throw new Error("Nothing to download");

  return {
    title: d.title || "TikTok",
    author: d.author?.nickname || d.author?.unique_id || "",
    duration: Number(d.duration) || 0,
    thumbnail: abs(d.cover || d.origin_cover),
    options
  };
}

export default createDownloader({
  title: "TIKTOK",
  icon: "🎵",
  example: "https://vt.tiktok.com/ZSxxxxxx/",
  commands: ["tiktok", "tt", "ttdl", "tiktokdl"],

  match: text => {
    const url = firstUrl(text);
    return url && TT_URL.test(url) ? url : null;
  },

  async resolve(url) {
    try {
      return await tikwm(url);
    } catch (error) {
      console.error("[DL:TIKTOK] tikwm failed, trying yt-dlp:", error?.message || error);

      try {
        const info = await ytdlpInfo(url);
        return { ...info, options: ytdlpOptions(url, info) };
      } catch (fallback) {
        // yt-dlp ස්ථාපනය කරන්න බැරි නම් මුල් error එකම පෙන්වනවා
        throw fallback?.code === "NO_YTDLP" ? error : fallback;
      }
    }
  }
});
