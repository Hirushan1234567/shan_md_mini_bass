// plugins/facebook.js
// SHAN MINI BOT V1 — Facebook video downloader (quality + Video / Document)
//
//   .fb <Facebook link>  → card → reply a number → 1 = Video, 2 = Document   (or "2d")
//
// Needs: dlcore.js (next to index.js). Uses yt-dlp (auto-installs to ./bin/yt-dlp).
// Private / friends-only videos: set YTDLP_COOKIES=./cookies.txt in .env
//
// ⚠️ If you still have the old fb.js plugin, remove it from plugins/ — otherwise the "fb" command is registered twice.
// To make it Premium-only: .premiumco fb

// dlcore.js can be in the root folder (next to index.js) or inside plugins/
const { createDownloader, firstUrl, ytdlpInfo, ytdlpOptions } = await import("../dlcore.js").catch(() => import("./dlcore.js"));

const FB_URL = /https?:\/\/(?:[a-z0-9-]+\.)?(?:facebook\.com|fb\.watch|fb\.com)\/\S+/i;

export default createDownloader({
  title: "FACEBOOK",
  icon: "📘",
  example: "https://www.facebook.com/watch?v=1234567890",
  commands: ["fb", "facebook", "fbdl", "fbvideo"],

  match: text => {
    const url = firstUrl(text);
    return url && FB_URL.test(url) ? url : null;
  },

  async resolve(url) {
    const info = await ytdlpInfo(url);

    if (!info.heights.length && !info.isImage) throw new Error("No downloadable video found");

    return { ...info, title: info.title || "Facebook video", options: ytdlpOptions(url, info) };
  }
});
