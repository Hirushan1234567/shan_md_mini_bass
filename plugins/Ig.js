// plugins/instagram.js
// SHAN MINI BOT V1 — Instagram reels / posts downloader (quality + Video / Document)
//
//   .ig <Instagram link>  → card → reply a number → 1 = Video, 2 = Document   (or "2d")
//
// Needs: dlcore.js (next to index.js). Uses yt-dlp (auto-installs to ./bin/yt-dlp).
// ⚠️ Instagram බොහෝ වෙලාවට login ඉල්ලනවා — .env එකේ YTDLP_COOKIES=./cookies.txt දාන්න
//    (browser එකෙන් "Get cookies.txt" extension එකෙන් export කරපු Netscape file එකක්).
// To make it Premium-only: .premiumco ig

// dlcore.js root folder එකේ (index.js ළඟ) හෝ plugins/ ඇතුළේ — දෙකෙන් එකක තිබුණත් වැඩ කරනවා
const { createDownloader, firstUrl, ytdlpInfo, ytdlpOptions } = await import("../dlcore.js").catch(() => import("./dlcore.js"));

const IG_URL = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:p|reel|reels|tv|stories|share)\/\S+/i;

export default createDownloader({
  title: "INSTAGRAM",
  icon: "📸",
  example: "https://www.instagram.com/reel/Cxxxxxxxxxx/",
  commands: ["ig", "instagram", "igdl", "reel"],

  match: text => {
    const url = firstUrl(text);
    return url && IG_URL.test(url) ? url : null;
  },

  async resolve(url) {
    const info = await ytdlpInfo(url);

    if (!info.heights.length && !info.isImage) throw new Error("No downloadable media found");

    return { ...info, title: info.title || "Instagram", options: ytdlpOptions(url, info) };
  }
});
