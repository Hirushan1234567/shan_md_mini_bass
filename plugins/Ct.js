// plugins/cartoonlk.js
// SHAN MINI BOT — CARTOONSLK
// Search cartoons, list episodes and download options
// Node.js ESM | Baileys
//
// Commands:
// .cartoonlk <name>
// .cartoonlk <cartoons.lk URL>
// Reply with a number to select a result or episode.

import axios from "axios";
import * as cheerio from "cheerio";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const SITE = "https://cartoons.lk";
const PREFIX = process.env.PREFIX || ".";
const TIMEOUT = 30000;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

// In-memory selection sessions
const sessions = new Map();

const http = axios.create({
  timeout: TIMEOUT,
  maxRedirects: 8,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/json,*/*",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#039;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(input) {
  try {
    const url = new URL(input);

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    if (!/(^|\.)cartoons\.lk$/i.test(url.hostname)) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getChatId(message) {
  return (
    message?.key?.remoteJid ||
    message?.chat ||
    message?.from ||
    ""
  );
}

function getText(message) {
  const msg = message?.message || {};

  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    message?.text ||
    ""
  ).trim();
}

async function reply(sock, message, text) {
  const jid = getChatId(message);

  if (!jid) {
    throw new Error("Could not determine the chat ID.");
  }

  return sock.sendMessage(
    jid,
    { text },
    { quoted: message }
  );
}

async function fetchPage(url) {
  const response = await http.get(url, {
    responseType: "text",
  });

  return {
    html: response.data,
    finalUrl: response.request?.res?.responseUrl || url,
  };
}

// --------------------------------------------------
// SEARCH FILTERS
// --------------------------------------------------

const EXCLUDED_TITLES = new Set([
  "about us",
  "contact us",
  "privacy policy",
  "terms and conditions",
  "cartoons",
  "movies",
  "tv series",
  "korean dramas",
  "home",
  "login",
  "register",
  "cart",
  "my account",
  "search",
  "next",
  "previous",
  "read more",
  "load more",
]);

const EXCLUDED_PATHS = [
  "/about",
  "/about-us",
  "/contact",
  "/contact-us",
  "/privacy-policy",
  "/terms-and-conditions",
  "/cart",
  "/my-account",
  "/wp-admin",
  "/wp-content",
];

function isContentPage(url) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname
      .replace(/\/+$/, "")
      .toLowerCase();

    if (!pathname) return false;

    if (
      EXCLUDED_PATHS.some(
        (item) =>
          pathname === item ||
          pathname.startsWith(item + "/")
      )
    ) {
      return false;
    }

    if (
      /^\/(category|tag|author|page)(\/|$)/i.test(pathname)
    ) {
      return false;
    }

    if (
      /\/(cartoons|movies|tv-series|korean-dramas)$/i.test(
        pathname
      )
    ) {
      return false;
    }

    const segments = pathname.split("/").filter(Boolean);

    return segments.length >= 1;
  } catch {
    return false;
  }
}

function addSearchResult(results, seen, title, rawUrl) {
  title = cleanText(title);

  const url = normalizeUrl(rawUrl);

  if (!url || !title || title.length < 4) return;

  if (EXCLUDED_TITLES.has(title.toLowerCase())) return;

  if (!isContentPage(url)) return;

  if (seen.has(url)) return;

  seen.add(url);
  results.push({ title, url });
}

// --------------------------------------------------
// SEARCH CARTOONS
// --------------------------------------------------

async function searchCartoons(query) {
  const searchUrl = new URL("/", SITE);
  searchUrl.searchParams.set("s", query);

  const { html } = await fetchPage(searchUrl.href);
  const $ = cheerio.load(html);

  const results = [];
  const seen = new Set();

  // Prefer WordPress post/search result containers.
  const selectors = [
    "article",
    ".post",
    ".search-result",
    ".search-results article",
    ".posts .item",
    ".archive-post",
    ".movie-item",
    ".entry",
    ".post-item",
  ];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const node = $(element);

      const anchors = node.find(
        "h1 a, h2 a, h3 a, .entry-title a, " +
        ".post-title a, a[href]"
      );

      anchors.each((__, anchorElement) => {
        const anchor = $(anchorElement);
        const title = cleanText(anchor.text());
        const href = anchor.attr("href") || "";

        addSearchResult(results, seen, title, href);
      });
    });
  }

  // Fallback: filter links instead of accepting every navigation item.
  if (results.length === 0) {
    $("a[href]").each((_, element) => {
      const anchor = $(element);
      const title = cleanText(anchor.text());
      const href = anchor.attr("href") || "";

      addSearchResult(results, seen, title, href);
    });
  }

  // Rank matching titles first.
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1);

  results.sort((a, b) => {
    const score = (title) =>
      words.reduce(
        (total, word) =>
          total + (title.toLowerCase().includes(word) ? 1 : 0),
        0
      );

    return score(b.title) - score(a.title);
  });

  return results.slice(0, 15);
}

// --------------------------------------------------
// EPISODE DATA
// --------------------------------------------------

function extractEpisodes(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('script[id^="episodes-data-"]').each((_, element) => {
    const scriptId = $(element).attr("id") || "";
    const postId = scriptId.match(/episodes-data-(\d+)/)?.[1];

    const data = parseJson($(element).html() || "");

    if (!data) return;

    let episodes = [];

    if (Array.isArray(data)) {
      episodes = data;
    } else if (Array.isArray(data.episodes)) {
      episodes = data.episodes;
    } else if (Array.isArray(data.data)) {
      episodes = data.data;
    }

    for (const episode of episodes) {
      results.push({
        postId,
        number: String(
          episode.number ??
          episode.episode ??
          results.length + 1
        ),
        title: cleanText(episode.title || ""),
        resolution: cleanText(episode.resolution || ""),
        fileSize: cleanText(episode.file_size || ""),
        downloadLinks: Array.isArray(episode.download_links)
          ? episode.download_links.map((link) => ({
              label: cleanText(link.label || "Download"),
              fileSize: cleanText(link.file_size || ""),
              provider: cleanText(link.provider || ""),
              linkIndex: Number(link.link_index ?? 0),
            }))
          : [],
      });
    }
  });

  return results;
}

// --------------------------------------------------
// SELECTION SESSIONS
// --------------------------------------------------

function createSession(jid, data) {
  const id = crypto.randomBytes(8).toString("hex");

  sessions.set(id, {
    ...data,
    jid,
    createdAt: Date.now(),
  });

  return id;
}

function getLatestSession(jid) {
  const now = Date.now();

  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt > 10 * 60 * 1000) {
      sessions.delete(id);
    }
  }

  return [...sessions.entries()]
    .filter(([, session]) => session.jid === jid)
    .sort((a, b) => b[1].createdAt - a[1].createdAt)[0];
}

// --------------------------------------------------
// SHOW CARTOON PAGE
// --------------------------------------------------

async function showCartoon(sock, message, rawUrl) {
  const url = normalizeUrl(rawUrl);

  if (!url) {
    return reply(
      sock,
      message,
      "❌ Please provide a valid cartoons.lk URL."
    );
  }

  const { html, finalUrl } = await fetchPage(url);
  const $ = cheerio.load(html);

  const title = cleanText(
    $("h1.entry-title").first().text() ||
    $("h1").first().text() ||
    $("title").first().text()
  );

  const episodes = extractEpisodes(html);

  if (!episodes.length) {
    return reply(
      sock,
      message,
      `🎬 *${title || "Cartoon"}*\n\n` +
      "No episode data was found on this page.\n\n" +
      `🌐 Page:\n${finalUrl}\n\n` +
      "Try another cartoon page or search by title."
    );
  }

  createSession(getChatId(message), {
    type: "episodes",
    title,
    pageUrl: finalUrl,
    html,
    episodes,
  });

  const episodeList = episodes
    .slice(0, 50)
    .map((episode, index) => {
      const extra = episode.title
        ? ` — ${episode.title}`
        : "";

      return (
        `${index + 1}. Episode ${episode.number}${extra}`
      );
    })
    .join("\n");

  return reply(
    sock,
    message,
    `🎬 *${title || "CARTOON"}*\n\n` +
    `📺 Episodes: ${episodes.length}\n\n` +
    `${episodeList}\n\n` +
    "Reply with an episode number."
  );
}

// --------------------------------------------------
// DOWNLOAD RESOLUTION
// --------------------------------------------------

function findExplicitVideoUrl(html) {
  const $ = cheerio.load(html);
  const candidates = [];

  $("a[href], video[src], source[src]").each((_, element) => {
    const node = $(element);
    const url =
      node.attr("href") ||
      node.attr("src") ||
      "";

    if (!/^https?:\/\//i.test(url)) return;

    if (
      /\.(mp4|mkv|webm)(?:[?#]|$)/i.test(url)
    ) {
      candidates.push(url);
    }
  });

  return candidates[0] || null;
}

async function resolveDownloadLink(session, option) {
  /*
   * CartoonSLK provides provider names and link indexes in the
   * episode JSON, but not the actual protected file URL.
   *
   * The website's initiateDownload() calls getSecureLink().
   * The exact AJAX action and payload must be identified before
   * making the request. Do not guess an endpoint and treat a
   * returned HTML page as a video.
   */

  const directUrl = findExplicitVideoUrl(session.html);

  if (directUrl) {
    return {
      url: directUrl,
      direct: true,
    };
  }

  return {
    url: null,
    direct: false,
    error:
      "The actual video URL is generated by getSecureLink(). " +
      "The required AJAX action and request parameters are not " +
      "available in the page data currently collected.",
  };
}

// --------------------------------------------------
// VIDEO DOWNLOAD
// --------------------------------------------------

async function downloadVideo(url) {
  const tempPath = path.join(
    os.tmpdir(),
    `cartoonlk-${crypto.randomBytes(8).toString("hex")}.mp4`
  );

  const response = await http.get(url, {
    responseType: "stream",
    maxRedirects: 8,
    headers: {
      Referer: SITE + "/",
    },
    validateStatus: (status) =>
      status >= 200 && status < 400,
  });

  const contentType = String(
    response.headers["content-type"] || ""
  ).toLowerCase();

  if (
    contentType.includes("text/html") ||
    contentType.includes("application/json")
  ) {
    response.data.destroy();

    throw new Error(
      "The server returned a webpage instead of a video file."
    );
  }

  const declaredLength = Number(
    response.headers["content-length"] || 0
  );

  if (declaredLength > MAX_DOWNLOAD_BYTES) {
    response.data.destroy();

    throw new Error(
      "The video exceeds the configured 100 MB limit."
    );
  }

  let total = 0;
  const writer = fs.createWriteStream(tempPath);

  try {
    await new Promise((resolve, reject) => {
      response.data.on("data", (chunk) => {
        total += chunk.length;

        if (total > MAX_DOWNLOAD_BYTES) {
          response.data.destroy(
            new Error("Video exceeds the 100 MB limit.")
          );
        }
      });

      response.data.on("error", reject);
      writer.on("error", reject);
      writer.on("finish", resolve);

      response.data.pipe(writer);
    });

    const fileHandle = await fs.promises.open(tempPath, "r");
    const header = Buffer.alloc(16);

    await fileHandle.read(header, 0, 16, 0);
    await fileHandle.close();

    const headerText = header.toString("ascii");

    const validVideo =
      headerText.includes("ftyp") ||
      headerText.startsWith("RIFF") ||
      header[0] === 0x1a;

    if (!validVideo) {
      throw new Error(
        "The downloaded file is not a recognised video."
      );
    }

    return tempPath;
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw error;
  }
}

// --------------------------------------------------
// NUMBER REPLY HANDLER
// --------------------------------------------------

async function handleNumberReply(sock, message, number) {
  const jid = getChatId(message);
  const found = getLatestSession(jid);

  if (!found) return false;

  const [sessionId, session] = found;

  if (session.type === "search") {
    const item = session.items[number - 1];

    if (!item) {
      await reply(sock, message, "❌ Invalid result number.");
      return true;
    }

    sessions.delete(sessionId);

    await showCartoon(sock, message, item.url);
    return true;
  }

  if (session.type === "episodes") {
    const episode = session.episodes[number - 1];

    if (!episode) {
      await reply(sock, message, "❌ Invalid episode number.");
      return true;
    }

    if (!episode.downloadLinks.length) {
      await reply(
        sock,
        message,
        "❌ No download options are available for this episode."
      );

      return true;
    }

    createSession(jid, {
      type: "qualities",
      title: session.title,
      pageUrl: session.pageUrl,
      html: session.html,
      episode,
    });

    const options = episode.downloadLinks
      .map((option, index) => {
        const size = option.fileSize
          ? ` | ${option.fileSize}`
          : "";

        return (
          `${index + 1}. ${option.label}${size}\n` +
          `   Provider: ${option.provider || "unknown"}`
        );
      })
      .join("\n\n");

    await reply(
      sock,
      message,
      `🎬 *${session.title}*\n` +
      `📺 Episode ${episode.number}\n\n` +
      `${options}\n\n` +
      "Reply with a quality number."
    );

    return true;
  }

  if (session.type === "qualities") {
    const option = session.episode.downloadLinks[number - 1];

    if (!option) {
      await reply(sock, message, "❌ Invalid quality number.");
      return true;
    }

    await reply(
      sock,
      message,
      "⏳ Checking the video download source..."
    );

    const resolved = await resolveDownloadLink(
      session,
      option
    );

    if (!resolved.url || !resolved.direct) {
      await reply(
        sock,
        message,
        "❌ *Unable to obtain the actual video URL.*\n\n" +
        "Cartoons.lk generates protected download links " +
        "through its getSecureLink() function.\n\n" +
        "The AJAX action and request parameters are still " +
        "needed to complete the video download integration.\n\n" +
        `🌐 Page:\n${session.pageUrl}`
      );

      return true;
    }

    let filePath;

    try {
      filePath = await downloadVideo(resolved.url);

      const buffer = await fs.promises.readFile(filePath);

      await sock.sendMessage(
        jid,
        {
          video: buffer,
          mimetype: "video/mp4",
          caption:
            `🎬 ${session.title}\n` +
            `Episode ${session.episode.number}`,
        },
        { quoted: message }
      );

      await reply(
        sock,
        message,
        "✅ Video sent successfully."
      );
    } catch (error) {
      console.error("[cartoonlk] Download error:", error);

      await reply(
        sock,
        message,
        `❌ Download failed: ${error.message}`
      );
    } finally {
      if (filePath) {
        await fs.promises.unlink(filePath).catch(() => {});
      }

      sessions.delete(sessionId);
    }

    return true;
  }

  return false;
}

// --------------------------------------------------
// PLUGIN EXPORT
// --------------------------------------------------

export default {
  name: "cartoonlk",
  command: "cartoonlk",
  aliases: ["cartoon", "cartoonsearch"],

  description:
    "Search cartoons.lk and browse cartoon episodes",

  async execute(sock, message, args) {
    try {
      const input = args.join(" ").trim();

      if (!input) {
        return reply(
          sock,
          message,
          `🎬 *CARTOONSLK SEARCH*\n\n` +
          `Usage:\n${PREFIX}cartoonlk <cartoon name>\n\n` +
          `Example:\n${PREFIX}cartoonlk Ben 10\n\n` +
          `Or use a cartoons.lk page URL.`
        );
      }

      const url = normalizeUrl(input);

      if (url) {
        return await showCartoon(sock, message, url);
      }

      await reply(
        sock,
        message,
        "🔎 Searching CartoonSLK..."
      );

      const results = await searchCartoons(input);

      if (!results.length) {
        return reply(
          sock,
          message,
          "❌ No cartoon/movie results found.\n\n" +
          "Try a different search term or paste a cartoons.lk URL."
        );
      }

      createSession(getChatId(message), {
        type: "search",
        items: results,
      });

      const list = results
        .map((item, index) => `${index + 1}. ${item.title}`)
        .join("\n");

      return reply(
        sock,
        message,
        `🎬 *SEARCH RESULTS*\n\n` +
        `${list}\n\n` +
        "Reply with a result number to open the page."
      );
    } catch (error) {
      console.error("[cartoonlk] Command error:", error);

      return reply(
        sock,
        message,
        `❌ Search failed: ${error.message || "Unknown error"}`
      );
    }
  },

  async handleReply(sock, message) {
    const text = getText(message);

    if (!/^\d+$/.test(text)) {
      return false;
    }

    try {
      return await handleNumberReply(
        sock,
        message,
        Number(text)
      );
    } catch (error) {
      console.error("[cartoonlk] Reply error:", error);

      await reply(
        sock,
        message,
        "❌ Unable to process the selection."
      );

      return true;
    }
  },
};