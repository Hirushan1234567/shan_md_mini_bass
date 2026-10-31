import axios from "axios";
import dns from "node:dns/promises";
import net from "node:net";

const TIMEOUT = 15000;

function isPrivateIP(ip) {
    if (net.isIPv4(ip)) {
        const p = ip.split(".").map(Number);
        const [a, b, c] = p;

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

    if (net.isIPv6(ip)) {
        const s = ip.toLowerCase().split("%")[0];

        if (
            s === "::" ||
            s === "::1" ||
            s.startsWith("fc") ||
            s.startsWith("fd") ||
            /^fe[89ab]/.test(s) ||
            s.startsWith("ff")
        ) return true;

        if (s.startsWith("::ffff:")) {
            const mapped = s.slice(7);
            if (net.isIPv4(mapped)) return isPrivateIP(mapped);
        }

        return false;
    }

    return true;
}

async function validateURL(input) {
    let url;

    try {
        url = new URL(input);
    } catch {
        throw new Error("Invalid URL. Example: .webinfo https://example.com");
    }

    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Only HTTP and HTTPS URLs are supported.");
    }

    if (url.username || url.password) {
        throw new Error("URLs containing credentials are not allowed.");
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

    if (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        hostname.endsWith(".internal")
    ) {
        throw new Error("Private and local websites are not allowed.");
    }

    if (net.isIP(hostname)) {
        if (isPrivateIP(hostname)) {
            throw new Error("Private IP addresses are not allowed.");
        }
    } else {
        let records;

        try {
            records = await dns.lookup(hostname, { all: true });
        } catch {
            throw new Error("Could not resolve the website.");
        }

        if (
            !records.length ||
            records.some(record => isPrivateIP(record.address))
        ) {
            throw new Error("Website resolves to a private or restricted IP.");
        }
    }

    return url;
}

function getTitle(html) {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

    if (!match) return "Not provided";

    return match[1]
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);
}

async function execute(sock, msg, args) {
    const chat = msg?.key?.remoteJid;
    if (!chat) return;

    const input = Array.isArray(args)
        ? args.join(" ").trim()
        : String(args || "").trim();

    if (!input) {
        return sock.sendMessage(chat, {
            text: "🌐 *WEBSITE INFO*\n\nUsage:\n.webinfo https://example.com"
        }, { quoted: msg });
    }

    let url;

    try {
        url = await validateURL(input);
    } catch (error) {
        return sock.sendMessage(chat, {
            text: `❌ ${error.message}`
        }, { quoted: msg });
    }

    const started = Date.now();

    try {
        const response = await axios.get(url.href, {
            timeout: TIMEOUT,
            maxRedirects: 0,
            maxContentLength: 1024 * 1024,
            responseType: "text",
            validateStatus: () => true,
            headers: {
                "User-Agent": "SHAN-MINI-BOT/1.0",
                Accept: "text/html"
            }
        });

        const elapsed = Date.now() - started;
        const contentType = response.headers["content-type"] || "Unknown";
        const html = typeof response.data === "string"
            ? response.data
            : "";

        const report = [
            "🌐 *SHAN MINI BOT — WEBSITE INFO*",
            "",
            `🔗 URL: ${url.href}`,
            `📌 Status: HTTP ${response.status}`,
            `⏱️ Response time: ${elapsed} ms`,
            `📄 Title: ${getTitle(html)}`,
            `📦 Content-Type: ${contentType}`,
            `🖥️ Server: ${response.headers.server || "Not provided"}`,
            `🔒 HTTPS: ${url.protocol === "https:" ? "Yes" : "No"}`,
            "",
            "ℹ️ Response time may vary depending on network conditions."
        ].join("\n");

        await sock.sendMessage(chat, {
            text: report
        }, { quoted: msg });

    } catch (error) {
        await sock.sendMessage(chat, {
            text: `❌ Website check failed.\n\n${error.code === "ECONNABORTED" ? "Request timed out." : error.message}`
        }, { quoted: msg });
    }
}

export default {
    command: "webinfo",
    commands: ["webinfo"],
    execute
};