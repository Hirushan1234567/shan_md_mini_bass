// plugins/qr.js
// SHAN MINI BOT V1 — QR Generator
// ESM compatible

const API_TIMEOUT = 20000;

function getChat(msg) {
    return msg?.key?.remoteJid || msg?.chat;
}

async function generateQR(text) {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, API_TIMEOUT);

    try {
        const url =
            `https://api.qrserver.com/v1/create-qr-code/?size=700x700&format=png&margin=2&data=${encodeURIComponent(text)}`;

        const response = await fetch(url, {
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`QR API returned HTTP ${response.status}`);
        }

        const contentType = response.headers.get("content-type") || "";

        if (!contentType.includes("image/")) {
            throw new Error("QR API did not return an image.");
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        if (!buffer.length) {
            throw new Error("Empty QR image received.");
        }

        return buffer;
    } finally {
        clearTimeout(timeout);
    }
}

const plugin = {
    name: "qr",
    command: "qr",
    commands: ["qr", "qrcode", "makeqr"],
    alias: ["qrcode", "makeqr"],
    description: "Generate a QR code image",
    category: "tools",

    async execute(sock, msg, args = []) {
        const chat = getChat(msg);

        if (!chat) return;

        const text = args.join(" ").trim();

        try {
            await sock.sendMessage(chat, {
                react: {
                    text: "🔳",
                    key: msg.key
                }
            });
        } catch {}

        if (!text) {
            return sock.sendMessage(
                chat,
                {
                    text:
                        "🔳 *QR CODE GENERATOR*\n\n" +
                        "Please enter text or a link.\n\n" +
                        "Examples:\n" +
                        ".qr Hello World\n" +
                        ".qrcode https://google.com\n" +
                        ".makeqr SHAN MINI BOT"
                },
                { quoted: msg }
            );
        }

        try {
            const qrBuffer = await generateQR(text);

            await sock.sendMessage(
                chat,
                {
                    image: qrBuffer,
                    mimetype: "image/png",
                    caption:
                        "✅ *QR Code Generated Successfully!*\n\n" +
                        "⚡ POWERED BY SHAN MINI BOT"
                },
                { quoted: msg }
            );

            try {
                await sock.sendMessage(chat, {
                    react: {
                        text: "✅",
                        key: msg.key
                    }
                });
            } catch {}
        } catch (error) {
            console.error("[QR Plugin Error]", error);

            await sock.sendMessage(
                chat,
                {
                    text:
                        "❌ *QR Generation Failed*\n\n" +
                        "The QR service is unavailable or the request failed.\n" +
                        "Please try again later."
                },
                { quoted: msg }
            );
        }
    }
};

export default plugin;