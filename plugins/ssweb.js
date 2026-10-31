import axios from "axios";
import dns from "node:dns/promises";
import net from "node:net";

const TIMEOUT = 60000;
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

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
            (a === 100 && b >= 64 && b <= 127)
        );
    }

    if (net.isIPv6(ip)) {
        const s = ip.toLowerCase().split("%")[0];

        return (
            s === "::" ||
            s === "::1" ||
            s.startsWith("fc") ||
            s.startsWith("fd") ||
            /^fe[89ab]/.test(s) ||
            s.startsWith("ff")
        );
    }

    return true;
}

async function validateURL(input) {
    let url;

    try {
        url = new URL(input);
    } catch {
        throw new Error("Invalid URL. Example: .ssweb https://example.com");
    }

    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Only HTTP and HTTPS URLs are supported.");
    }

    if (url.username || url.password) {
        throw new Error("URLs containing credentials are not allowed.");
    }

    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

    if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".internal")
    ) {
        throw new Error("Local websites are not allowed.");
    }

    if (net.isIP(host)) {
        if (isPrivateIP(host)) {
            throw new Error("Private IP addresses are not allowed.");
        }
    } else {
        let records;

        try {
            records = await dns.lookup(host, { all: true });
        } catch {
            throw new Error("Could not resolve the website.");
        }

        if (!records.length || records.some(r => isPrivateIP(r.address))) {
            throw new Error("Website resolves to a private or restricted IP.");
        }
    }

    return url;
}

async function execute(sock, msg, args) {
    const chat = msg?.key?.remoteJid;
    if (!chat) return;

    const input = Array.isArray(args)
        ? args.join(" ").trim()
        : String(args || "").trim();

    if (!input) {
        return sock.sendMessage(chat, {
            text: "📸 *WEBSITE SCREENSHOT*\n\nUsage:\n.ssweb https://example.com"
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

    const status = await sock.sendMessage(chat, {
        text: "📸 Generating website screenshot...\nPlease wait."
    }, { quoted: msg });

    try {
        const screenshotURL =
            "https://image.thum.io/get/width/1280/crop/900/noanimate/" +
            encodeURI(url.href);

        const response = await axios.get(screenshotURL, {
            responseType: "arraybuffer",
            timeout: TIMEOUT,
            maxRedirects: 0,
            maxContentLength: MAX_IMAGE_SIZE,
            validateStatus: status => status === 200
        });

        const image = Buffer.from(response.data);
        const contentType = String(
            response.headers["content-type"] || ""
        ).toLowerCase();

        if (
            !image.length ||
            image.length > MAX_IMAGE_SIZE ||
            !contentType.startsWith("image/")
        ) {
            throw new Error("Screenshot service returned an invalid image.");
        }

        await sock.sendMessage(chat, {
            image,
            caption:
                "📸 *WEBSITE SCREENSHOT*\n\n" +
                `🌐 Website: ${url.hostname}\n` +
                "💙 SHAN MINI BOT"
        }, { quoted: msg });

    } catch (error) {
        await sock.sendMessage(chat, {
            text:
                "❌ Screenshot failed.\n\n" +
                (error.code === "ECONNABORTED"
                    ? "The screenshot request timed out."
                    : "The screenshot service may be unavailable or may have rejected the request.")
        }, { quoted: msg });
    } finally {
        if (status?.key?.id) {
            await sock.sendMessage(chat, {
                delete: status.key
            }).catch(() => {});
        }
    }
}

export default {
    command: "ssweb",
    commands: ["ssweb"],
    execute
};