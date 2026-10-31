// plugins/webdlm.js

import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import dns from "dns/promises";
import net from "net";
import { randomUUID } from "crypto";

const MAX_HTML_SIZE = 5 * 1024 * 1024;
const REQUEST_TIMEOUT = 20000;
const TEMP_DIR = path.join(os.tmpdir(), "shan-webdl");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function getMessageText(msg) {
  const message = msg?.message || msg?.msg?.message || {};

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ""
  );
}

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }

  const [a, b, c] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase().split("%")[0];

  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff")
  ) {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);

    if (net.isIP(mapped) === 4) {
      return isPrivateIPv4(mapped);
    }
  }

  return false;
}

function isPrivateAddress(ip) {
  const version = net.isIP(ip);

  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);

  return true;
}

async function validateUrl(value) {
  let url;

  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid URL. Example: https://example.com");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }

  if (url.username || url.password) {
    throw new Error("URLs containing usernames or passwords are not allowed.");
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    throw new Error("Private and local addresses are not allowed.");
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error("Private IP addresses are not allowed.");
    }
  } else {
    let records;

    try {
      records = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error("Could not resolve the website hostname.");
    }

    if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
      throw new Error("The website resolves to a private or restricted IP address.");
    }
  }

  return url;
}

async function fetchHtml(initialUrl) {
  let currentUrl = initialUrl;

  for (let redirects = 0; redirects <= 3; redirects++) {
    await validateUrl(currentUrl.toString());

    const response = await axios.get(currentUrl.toString(), {
      responseType: "arraybuffer",
      timeout: REQUEST_TIMEOUT,
      maxRedirects: 0,
      maxContentLength: MAX_HTML_SIZE,
      maxBodyLength: MAX_HTML_SIZE,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        "User-Agent": "SHAN-MINI-BOT-WebDownloader/1.0",
        Accept: "text/html,application/xhtml+xml;q=0.9",
      },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;

      if (!location) {
        throw new Error("The website returned an invalid redirect.");
      }

      if (redirects === 3) {
        throw new Error("Too many redirects.");
      }

      currentUrl = new URL(location, currentUrl);
      continue;
    }

    const contentType = String(response.headers["content-type"] || "").toLowerCase();

    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error("The URL did not return an HTML document.");
    }

    const buffer = Buffer.from(response.data);

    if (!buffer.length) {
      throw new Error("The website returned an empty response.");
    }

    if (buffer.length > MAX_HTML_SIZE) {
      throw new Error("HTML file exceeds the 5 MB limit.");
    }

    return {
      html: buffer.toString("utf8"),
      finalUrl: currentUrl.toString(),
      size: buffer.length,
    };
  }

  throw new Error("Unable to download the website.");
}

function safeFilename(url) {
  let hostname = new URL(url).hostname
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .slice(0, 80);

  if (!hostname) hostname = "website";

  return `${hostname}.html`;
}

async function handleDownload(sock, msg, input) {
  const chat = msg?.key?.remoteJid;

  if (!chat) return;

  if (!input) {
    await sock.sendMessage(
      chat,
      {
        text:
          "🌐 *SHAN MINI BOT — WEBSITE HTML DOWNLOADER*\n\n" +
          "Usage:\n" +
          ".webdl https://example.com\n\n" +
          "Downloads the website's HTML source as an HTML document.",
      },
      { quoted: msg }
    );
    return;
  }

  let parsedUrl;

  try {
    parsedUrl = await validateUrl(input);
  } catch (error) {
    await sock.sendMessage(
      chat,
      { text: `❌ ${error.message}` },
      { quoted: msg }
    );
    return;
  }

  const status = await sock.sendMessage(
    chat,
    { text: "⏳ Downloading website HTML...\nPlease wait." },
    { quoted: msg }
  );

  let filePath;

  try {
    const result = await fetchHtml(parsedUrl);
    const filename = safeFilename(result.finalUrl);

    filePath = path.join(TEMP_DIR, `${randomUUID()}-${filename}`);

    await fs.promises.writeFile(filePath, result.html, {
      flag: "wx",
      mode: 0o600,
    });

    await sock.sendMessage(chat, {
      document: await fs.promises.readFile(filePath),
      mimetype: "text/html",
      fileName: filename,
      caption:
        "✅ *WEBSITE HTML DOWNLOADED*\n\n" +
        `🌐 Website: ${new URL(result.finalUrl).hostname}\n` +
        `📄 File: ${filename}\n` +
        `📦 Size: ${(result.size / 1024).toFixed(2)} KB\n\n` +
        "ℹ️ This contains the returned HTML source only. " +
        "External CSS, JavaScript, images, and server-side code are not included.",
    });
  } catch (error) {
    const message =
      error.code === "ERR_BAD_RESPONSE"
        ? "The website returned an invalid response."
        : error.code === "ECONNABORTED"
          ? "The website request timed out."
          : error.response?.status
            ? `Website returned HTTP ${error.response.status}.`
            : error.message || "An unknown error occurred.";

    await sock.sendMessage(
      chat,
      { text: `❌ *Download failed*\n\n${message}` },
      { quoted: msg }
    );
  } finally {
    if (filePath) {
      await fs.promises.unlink(filePath).catch(() => {});
    }

    if (status?.key?.id) {
      await sock.sendMessage(chat, {
        delete: status.key,
      }).catch(() => {});
    }
  }
}

const webdlPlugin = {
  command: "webdl",
  commands: ["webdl", "webdownload", "sitehtml"],

  async execute(sock, msg, args, commandName) {
    const input =
      Array.isArray(args) ? args.join(" ").trim() : String(args || "").trim();

    await handleDownload(sock, msg, input);
  },
};

export default webdlPlugin;