const plugin = {
    command: "contactcard",
    commands: ["contactcard", "vcard"],

    async execute(sock, msg, args) {
        const chat = msg?.key?.remoteJid;
        if (!chat) return;

        const input = Array.isArray(args)
            ? args.join(" ").trim()
            : String(args || "").trim();

        const [rawNumber, ...nameParts] = input.split(/\s+/);
        const name = nameParts.join(" ");

        const number = (rawNumber || "").replace(/\D/g, "");

        if (!number || number.length < 7 || number.length > 15 || !name) {
            return sock.sendMessage(chat, {
                text:
                    "👤 *CONTACT CARD*\n\n" +
                    "Usage:\n" +
                    ".contactcard 94771234567 Name\n\n" +
                    "Include the country code."
            }, { quoted: msg });
        }

        const safeName = name.replace(/[\r\n]/g, " ").slice(0, 100);

        const escapeVCard = value =>
            value.replace(/\\/g, "\\\\")
                .replace(/;/g, "\\;")
                .replace(/,/g, "\\,")
                .replace(/\n/g, "\\n");

        const vcard = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            `FN:${escapeVCard(safeName)}`,
            `TEL;TYPE=CELL;TYPE=VOICE:+${number}`,
            "END:VCARD"
        ].join("\r\n");

        await sock.sendMessage(chat, {
            contacts: {
                displayName: safeName,
                contacts: [{ vcard }]
            }
        }, { quoted: msg });
    }
};

export default plugin;