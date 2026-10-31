// plugins/apk.js
// SHAN MINI BOT - All-in-One APK Plugin
//
// Commands:
// .apk whatsapp
// .apk com.whatsapp
// .apk https://play.google.com/store/apps/details?id=com.whatsapp
// .apksearch spotify
// .apkmod minecraft

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const API = "https://ws75.aptoide.com/api/7/apps/search";
const MAX_SEND_MB = Number(process.env.APK_MAX_MB || 1900);

const NEOXR_KEY = process.env.NEOXR_API_KEY || "";
const LOL_KEY = process.env.LOLHUMAN_API_KEY || "";

const TMP_DIR = path.join(process.cwd(), "tmp");

try {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  process.env.TMPDIR = TMP_DIR;
} catch {}

const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36";

const str = value =>
  value === undefined || value === null ? "" : String(value);

const fmtBytes = value => {
  const n = Number(value) || 0;

  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB";

  return n ? n + " B" : "N/A";
};

function cleanTmp(maxAgeMs = 10 * 60 * 1000) {
  try {
    const now = Date.now();

    for (const file of fs.readdirSync(TMP_DIR)) {
      const filePath = path.join(TMP_DIR, file);

      try {
        if (now - fs.statSync(filePath).mtimeMs > maxAgeMs) {
          fs.rmSync(filePath, {
            force: true,
            recursive: true
          });
        }
      } catch {}
    }
  } catch {}
}

const removeFile = file => {
  try {
    fs.rmSync(file, { force: true });
  } catch {}
};

async function getJson(url, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function packageFromPlayLink(text) {
  if (!/play\.google\.com|market:\/\//i.test(text)) {
    return null;
  }

  const match = String(text).match(/[?&]id=([a-zA-Z0-9_.]+)/);

  return match ? match[1] : null;
}

/* ============================================================
   DOWNLOAD HELPERS
============================================================ */

async function downloadToFile(link, destination) {
  const parsed = new URL(link);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsupported download URL.");
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    20 * 60 * 1000
  );

  try {
    const response = await fetch(link, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Referer: `${parsed.origin}/`,
        Accept: "*/*"
      }
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = String(
      response.headers.get("content-type") || ""
    ).toLowerCase();

    if (
      contentType.includes("text/html") ||
      contentType.includes("application/json") ||
      contentType.startsWith("text/")
    ) {
      await response.body.cancel().catch(() => {});
      throw new Error("The URL does not point directly to a file.");
    }

    await pipeline(
      Readable.fromWeb(response.body),
      fs.createWriteStream(destination)
    );

    const size = fs.statSync(destination).size;

    if (size < 10 * 1024) {
      throw new Error("Downloaded file is too small.");
    }

    const fd = fs.openSync(destination, "r");
    const magic = Buffer.alloc(4);

    try {
      fs.readSync(fd, magic, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }

    if (magic[0] !== 0x50 || magic[1] !== 0x4b) {
      throw new Error("Downloaded file is not an APK/ZIP file.");
    }

    return size;
  } finally {
    clearTimeout(timer);
  }
}

/* ============================================================
   APTOIDE SEARCH
============================================================ */

function mapApp(app) {
  return {
    name: app.name,
    pkg: app.package,
    version: app.file?.vername || "N/A",
    size: Number(app.file?.filesize || app.size || 0),
    url: app.file?.path || app.file?.path_alt || "",
    altUrl:
      app.file?.path && app.file?.path_alt
        ? app.file.path_alt
        : "",
    trusted:
      String(app.file?.malware?.rank || "").toUpperCase() ===
      "TRUSTED",
    icon: app.icon || "",
    downloads: app.stats?.downloads,
    rating: app.stats?.rating?.avg,
    store: app.store?.name || "Aptoide"
  };
}

async function searchApps(query, limit = 8) {
  const json = await getJson(
    `${API}?query=${encodeURIComponent(query)}&limit=${limit}`
  );

  return (json?.datalist?.list || []).map(mapApp);
}

async function getByPackage(pkg) {
  const json = await getJson(
    `https://ws75.aptoide.com/api/7/app/get/package_name=${encodeURIComponent(pkg)}`
  );

  const data = json?.nodes?.meta?.data;

  return data?.package ? mapApp(data) : null;
}

async function playStoreName(pkg) {
  try {
    const response = await fetch(
      `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en`,
      {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en"
        }
      }
    );

    if (!response.ok) return "";

    const html = await response.text();

    const match = html.match(
      /<title>([^<]+?)\s*-\s*Apps on Google Play/i
    );

    return match ? match[1].split(/[:\-–]/)[0].trim() : "";
  } catch {
    return "";
  }
}

async function findByPackage(pkg) {
  const found = [];

  const add = list => {
    found.push(
      ...list.filter(
        app => app.pkg?.toLowerCase() === pkg.toLowerCase()
      )
    );
  };

  try {
    const direct = await getByPackage(pkg);

    if (direct) add([direct]);
  } catch {}

  try {
    add(await searchApps(pkg, 20));
  } catch {}

  const name = await playStoreName(pkg);

  if (name) {
    try {
      add(await searchApps(name, 20));
    } catch {}
  }

  const unique = [
    ...new Map(
      found.filter(app => app.url).map(app => [app.url, app])
    ).values()
  ];

  if (!unique.length) return null;

  const plausible = unique.filter(
    app => !app.size || app.size >= 5 * 1048576
  );

  const candidates = plausible.length ? plausible : unique;

  candidates.sort(
    (a, b) =>
      Number(b.trusted) - Number(a.trusted) ||
      b.size - a.size
  );

  return candidates[0];
}

function bestMatch(list, query) {
  const q = query.toLowerCase();

  return (
    list.find(app => app.pkg?.toLowerCase() === q) ||
    list.find(app => app.name?.toLowerCase() === q) ||
    list.find(app => app.name?.toLowerCase().includes(q)) ||
    list[0] ||
    null
  );
}

/* ============================================================
   MOD APK SEARCH
============================================================ */

function extractItems(data) {
  const seen = new Set();

  const walk = (object, depth = 0) => {
    if (
      !object ||
      typeof object !== "object" ||
      depth > 4 ||
      seen.has(object)
    ) {
      return null;
    }

    seen.add(object);

    if (
      Array.isArray(object) &&
      object.length &&
      typeof object[0] === "object"
    ) {
      return object;
    }

    for (const key of [
      "data",
      "result",
      "results",
      "items",
      "list"
    ]) {
      const result = walk(object[key], depth + 1);

      if (result) return result;
    }

    for (const value of Object.values(object)) {
      const result = walk(value, depth + 1);

      if (result) return result;
    }

    return null;
  };

  return walk(data) || [];
}

function pick(object, keys) {
  if (!object || typeof object !== "object") return "";

  for (const key of keys) {
    if (
      object[key] !== undefined &&
      object[key] !== null &&
      object[key] !== ""
    ) {
      return object[key];
    }
  }

  return "";
}

async function searchMods(query) {
  const q = encodeURIComponent(query);
  const urls = [];

  if (NEOXR_KEY) {
    for (const endpoint of ["apkmod", "happymod", "apkmody"]) {
      urls.push(
        `https://api.neoxr.eu/api/${endpoint}?q=${q}&apikey=${NEOXR_KEY}`
      );
    }
  }

  if (LOL_KEY) {
    for (const endpoint of ["apkmody", "happymod"]) {
      urls.push(
        `https://api.lolhuman.xyz/api/${endpoint}?apikey=${LOL_KEY}&query=${q}`
      );
    }
  }

  if (!urls.length) {
    throw new Error("NO_API_KEY");
  }

  let lastError = "No results found.";

  for (const url of urls) {
    try {
      const items = extractItems(await getJson(url));

      if (items.length) return items;
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }

  throw new Error(lastError);
}

/* ============================================================
   MAIN PLUGIN
============================================================ */

export default {
  command: "apk",
  commands: [
    "apk",
    "apkget",
    "getapk",
    "aptoide",
    "apkdl",
    "apksearch",
    "cariapk",
    "searchapk",
    "apkmod",
    "modapk"
  ],
  alias: [
    "apkget",
    "getapk",
    "aptoide",
    "apkdl",
    "cariapk",
    "searchapk",
    "modapk"
  ],
  description: "Search and download APK files",
  category: "download",
  react: "📦",

  async execute(sock, msg, args, commandName) {
    const from = msg?.key?.remoteJid;

    if (!from) return;

    const settings = globalThis.SHAN_GET_SETTINGS?.() || {};
    const prefix = settings.prefix || process.env.PREFIX || ".";
    const reply = text =>
      sock.sendMessage(from, { text: String(text) }, { quoted: msg });

    cleanTmp();

    const command = String(commandName || "apk").toLowerCase();
    const query = (Array.isArray(args) ? args : []).join(" ").trim();

    if (command === "apksearch" || command === "cariapk" || command === "searchapk") {
      if (!query) {
        return reply(`🔎 Usage: ${prefix}apksearch spotify`);
      }

      try {
        const list = await searchApps(query);

        if (!list.length) {
          return reply(`No results found for "${query}".`);
        }

        const lines = list.map(
          (app, index) =>
            `*${index + 1}.* ${app.name} v${app.version} (${fmtBytes(app.size)})\n${app.pkg}`
        );

        return reply(
          `🔎 *APK SEARCH: ${query}*\n\n${lines.join("\n\n")}\n\n` +
          `Download: ${prefix}apk <package>`
        );
      } catch (error) {
        return reply(`APK search failed: ${error.message}`);
      }
    }

    if (command === "apkmod" || command === "modapk") {
      if (!query) {
        return reply(`Usage: ${prefix}apkmod minecraft`);
      }

      try {
        const items = (await searchMods(query)).slice(0, 6);

        const lines = items.map((item, index) => {
          const name = str(pick(item, ["title", "name"])) || "Unknown";
          const version = str(pick(item, ["version", "ver"]));
          const size = str(pick(item, ["size", "filesize"]));
          const description = str(
            pick(item, ["mod", "mod_info", "modinfo", "description", "desc"])
          ).slice(0, 100);
          const link = str(
            pick(item, ["download", "download_url", "url", "link", "href"])
          );

          return [
            `*${index + 1}.* ${name}${version ? ` v${version}` : ""}`,
            size ? `Size: ${size}` : "",
            description,
            link
          ].filter(Boolean).join("\n");
        });

        return reply(
          `🧪 *APK MOD: ${query}*\n\n${lines.join("\n\n")}\n\n` +
          "Warning: Third-party mod APKs may contain malware."
        );
      } catch (error) {
        if (error.message === "NO_API_KEY") {
          return reply(
            "API key required. Set NEOXR_API_KEY or LOLHUMAN_API_KEY in your environment."
          );
        }

        return reply(`Mod APK search failed: ${error.message}`);
      }
    }

    if (!query) {
      return reply(
        `📦 *APK DOWNLOADER*\n\n` +
        `${prefix}apk whatsapp\n` +
        `${prefix}apk com.whatsapp\n` +
        `${prefix}apksearch spotify\n` +
        `${prefix}apkmod minecraft`
      );
    }

    if (
      /^https?:\/\//i.test(query) &&
      !/play\.google\.com/i.test(query)
    ) {
      const link = query.split(/\s+/)[0];

      const tempFile = path.join(
        TMP_DIR,
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.apk`
      );

      try {
        await reply("Downloading APK...");

        const size = await downloadToFile(link, tempFile);

        const parsed = new URL(link);

        let fileName = decodeURIComponent(
          parsed.pathname.split("/").pop() || "app.apk"
        );

        if (!/\.(apk|xapk|apks|zip)$/i.test(fileName)) {
          fileName += ".apk";
        }

        await sock.sendMessage(
          from,
          {
            document: { url: tempFile },
            mimetype: "application/vnd.android.package-archive",
            fileName,
            caption: `${fileName}\nSize: ${fmtBytes(size)}`
          },
          { quoted: msg }
        );
      } catch (error) {
        await reply(`Download failed: ${error.message}`);
      } finally {
        removeFile(tempFile);
      }

      return;
    }

    const playPackage = packageFromPlayLink(query);
    const isPlayLink = /play\.google\.com|market:\/\//i.test(query);

    if (isPlayLink && !playPackage) {
      return reply("Unable to find the package ID in the Play Store URL.");
    }

    const searchQuery = playPackage || query;
    const packagePattern = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i;

    let app;

    try {
      app = playPackage || packagePattern.test(searchQuery)
        ? await findByPackage(searchQuery)
        : bestMatch(await searchApps(searchQuery, 8), searchQuery);
    } catch (error) {
      return reply(`APK lookup failed: ${error.message}`);
    }

    if (!app) {
      return reply(`No APK found for "${searchQuery}". Try ${prefix}apksearch ${searchQuery}`);
    }

    const info =
      `📦 *${app.name}*\n\n` +
      `Package: ${app.pkg}\n` +
      `Version: ${app.version}\n` +
      `Size: ${fmtBytes(app.size)}\n` +
      `Downloads: ${app.downloads ?? "-"}\n` +
      `Rating: ${app.rating ?? "-"}\n` +
      `Store: ${app.store}` +
      (app.trusted ? "\nTrusted scan status: TRUSTED" : "");

    if (!app.url) {
      return reply(`${info}\n\nDownload URL unavailable.`);
    }

    if (app.size > 0 && app.size < 20 * 1048576 &&
        !app.obbs?.length && Number(app.downloads) >= 10000000) {
      return reply(
        `${info}\n\nThe returned file may be an incomplete installer. ` +
        `Verify it through the official app store before installing.\n${app.url}`
      );
    }

    if (app.size / 1048576 > MAX_SEND_MB) {
      return reply(`${info}\n\nFile exceeds the configured send limit:\n${app.url}`);
    }

    await reply(`${info}\n\nDownloading APK...`);

    const tempFile = path.join(
      TMP_DIR,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.apk`
    );

    try {
      let size;
      let lastError;

      for (const url of [app.url, app.altUrl].filter(Boolean)) {
        try {
          size = await downloadToFile(url, tempFile);

          if (app.size > 0 && size < app.size * 0.9) {
            throw new Error("Downloaded file is smaller than expected.");
          }

          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          removeFile(tempFile);
        }
      }

      if (lastError) throw lastError;

      await sock.sendMessage(
        from,
        {
          document: { url: tempFile },
          mimetype: "application/vnd.android.package-archive",
          fileName:
            `${String(app.name).replace(/[\\/:*?"<>|]/g, "")} ${app.version}.apk`,
          caption: `${app.name} ${app.version}\nSize: ${fmtBytes(size)}`
        },
        { quoted: msg }
      );
    } catch (error) {
      await reply(`Unable to send APK: ${error.message}\n\n${app.url}`);
    } finally {
      removeFile(tempFile);
    }
  }
};