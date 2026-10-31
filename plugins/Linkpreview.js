import axios from "axios";
import dns from "node:dns/promises";
import net from "node:net";

const MAX_SIZE = 1024 * 1024;

function privateIP(ip) {
    if (net.isIPv4(ip)) {
        const [a, b, c] = ip.split(".").map(Number);

        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            a >= 224 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            (a === 100 && b >= 64 && b <= 127)
        );
    }

    if (net.isIPv6(ip)) {
        const s = ip.toLowerCase();

        return (
            s === "::" ||
            s === "::1" ||
            s.startsWith("fc") ||
            s.startsWith("fd") ||
            s.startsWith("fe80:") ||
            s.startsWith("ff")
        );
    }

    return true;
}

async function validateURL(raw) {
    const url = new URL(raw);

    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Only HTTP and HTTPS URLs are supported.");
    }

    if (url.username || url.password) {
        throw new Error("URLs with credentials are not allowed.");
    }

    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

    if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".internal")
    ) {
        throw new Error("Private hosts are not allowed.");
    }

    if (net.isIP(host)) {
        if (privateIP(host)) throw new Error("Private IP blocked.");
    } else {
        const records = await dns.lookup(host, { all: true });

        if (!records.length || records.some(r => privateIP(r.address))) {
            throw new Error("Private or restricted host blocked.");
        }
    }

    return url;
}

function getMeta(html, key, attribute = "property") {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const patterns = [
        new RegExp(
            `<meta\\b(?=[^>]*\\b${attribute}\\s*=\\s*["']${escaped}["'])[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'][^>]*>`,
            "i"
        ),
        new RegExp(
            `<meta\\b(?=[^>]*\\bcontent\\s*=\\s*["']([^"']*)["'])[^>]*\\b${attribute}\\s*=\\s*["']${escaped}["'][^>]*>`,
            "i"
        )
    ];

    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) return match[1] || "";
    }

    return "";
}

function decodeHTML(value) {
    return value
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

async function execute(sock, msg, args) {
    const chat = msg?.key?.remoteJid;
    if (!chat) return;

    const input = Array.isArray(args)
        ? args.join(" ").trim()
        : String(args || "").trim();

    if (!input) {
        return sock.sendMessage(chat, {
            text: "Usage:\n.linkpreview https://example.com"
        }, { quoted: msg });
    }

    let url;

    try {
        url = await validateURL(input);
    } catch (error) {
        return sock.sendMessage(chat, {
            text: `❌ ${error.message || "Invalid URL."}`
        }, { quoted: msg });
    }

    try {
        const response = await axios.get(url.href, {
            timeout: 12000,
            maxRedirects: 0,
            maxContentLength: MAX_SIZE,
            responseType: "text",
            headers: {
                "User-Agent": "SHAN-MINI-BOT/1.0",
                Accept: "text/html"
            },
            validateStatus: status => status === 200
        });

        const html = String(response.data || "");
        const title = decodeHTML(
            html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""
        );

        const description = decodeHTML(
            getMeta(html, "og:description") ||
            getMeta(html, "description", "name") ||
            getMeta(html, "twitter:description")
        );

        const image = getMeta(html, "og:image") ||
            getMeta(html, "twitter:image");

        let imageURL = "";

        if (image) {
            try {
                const parsed = new URL(image, url);
                if (["http:", "https:"].includes(parsed.protocol)) {
                    imageURL = parsed.href;
                }
            } catch {}
        }

        const result = [
            "🔗 *WEBSITE PREVIEW*",
            "",
            `📌 Title: ${title || "Not available"}`,
            "",
            `📝 Description: ${description || "Not available"}`,
            "",
            `🌐 Website: ${url.hostname}`,
            `🖼️ Image: ${imageURL || "Not available"}`,
            "",
            `🔗 URL: ${url.href}`
        ].join("\n");

        await sock.sendMessage(chat, {
            text: result
        }, { quoted: msg });

    } catch (error) {
        await sock.sendMessage(chat, {
            text: `❌ Could not read website metadata.\n${error.message || ""}`
        }, { quoted: msg });
    }
}

export default {
    command: "linkpreview",
    commands: ["linkpreview", "preview"],
    execute
};