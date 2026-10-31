// ═══════════════════════════════════════════════════════════
// SHAN MINI BOT V1 — UNIVERSAL JID PLUGIN
// ESM | Dynamic Prefix | Auto Reaction
//
// Commands:
// .jid
// .jid inbox
// .jid group
// .jid channel <link>
// .jid all
// ═══════════════════════════════════════════════════════════

export default {
    name: "jid",
    commands: ["jid"],

    async execute(sock, msg, args) {
        const chat = msg.key.remoteJid;
        const sender = msg.key.participant || chat;

        try {
            await sock.sendMessage(chat, {
                react: {
                    text: "🆔",
                    key: msg.key
                }
            });
        } catch {}

        try {
            const type = (args[0] || "").toLowerCase();

            // ─────────────────────────────────────────────
            // CURRENT CHAT JID
            // ─────────────────────────────────────────────
            if (!type) {
                return await sock.sendMessage(
                    chat,
                    {
                        text:
                            "╭━━━〔 🆔 JID INFORMATION 〕━━━╮\n\n" +
                            `💬 Chat JID: ${chat}\n` +
                            `👤 Sender JID: ${sender}\n\n` +
                            "╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n" +
                            "📌 Commands:\n" +
                            ".jid inbox\n" +
                            ".jid group\n" +
                            ".jid channel <link>\n" +
                            ".jid all"
                    },
                    { quoted: msg }
                );
            }

            // ─────────────────────────────────────────────
            // INBOX / PRIVATE CHAT
            // ─────────────────────────────────────────────
            if (["inbox", "private", "dm"].includes(type)) {
                const target =
                    chat.endsWith("@g.us")
                        ? sender
                        : chat;

                return await sock.sendMessage(
                    chat,
                    {
                        text:
                            "╭━━━〔 📩 INBOX JID 〕━━━╮\n\n" +
                            `🆔 JID: ${target}\n\n` +
                            "╰━━━━━━━━━━━━━━━━━━━━━━╯"
                    },
                    { quoted: msg }
                );
            }

            // ─────────────────────────────────────────────
            // GROUP JID
            // ─────────────────────────────────────────────
            if (["group", "grp", "groups"].includes(type)) {
                if (!chat.endsWith("@g.us")) {
                    return await sock.sendMessage(
                        chat,
                        {
                            text:
                                "❌ This command must be used inside a group.\n\n" +
                                "Use .jid in a group to get its JID."
                        },
                        { quoted: msg }
                    );
                }

                let groupName = "Unknown";

                try {
                    const metadata = await sock.groupMetadata(chat);
                    groupName = metadata.subject || groupName;
                } catch {}

                return await sock.sendMessage(
                    chat,
                    {
                        text:
                            "╭━━━〔 👥 GROUP JID 〕━━━╮\n\n" +
                            `📛 Group: ${groupName}\n` +
                            `🆔 JID: ${chat}\n\n` +
                            "╰━━━━━━━━━━━━━━━━━━━━━━╯"
                    },
                    { quoted: msg }
                );
            }

            // ─────────────────────────────────────────────
            // CHANNEL JID FROM LINK
            // ─────────────────────────────────────────────
            if (["channel", "chnl"].includes(type)) {
                const link = args[1];

                if (!link) {
                    return await sock.sendMessage(
                        chat,
                        {
                            text:
                                "❌ Please provide a WhatsApp Channel link.\n\n" +
                                "Example:\n" +
                                ".jid channel https://whatsapp.com/channel/CHANNEL_CODE"
                        },
                        { quoted: msg }
                    );
                }

                const match = link.match(
                    /whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i
                );

                if (!match) {
                    return await sock.sendMessage(
                        chat,
                        { text: "❌ Invalid WhatsApp Channel link." },
                        { quoted: msg }
                    );
                }

                const metadata = await sock.newsletterMetadata(
                    "invite",
                    match[1]
                );

                return await sock.sendMessage(
                    chat,
                    {
                        text:
                            "╭━━━〔 📢 CHANNEL JID 〕━━━╮\n\n" +
                            `📛 Name: ${metadata.name || "Unknown"}\n` +
                            `🆔 JID: ${metadata.id || "Unavailable"}\n\n` +
                            "╰━━━━━━━━━━━━━━━━━━━━━━╯"
                    },
                    { quoted: msg }
                );
            }

            // ─────────────────────────────────────────────
            // ALL AVAILABLE CHATS
            // ─────────────────────────────────────────────
            if (["all", "list"].includes(type)) {
                const store = sock.store || sock.ev?.store;

                if (!store?.chats) {
                    return await sock.sendMessage(
                        chat,
                        {
                            text:
                                "❌ Chat store is unavailable.\n\n" +
                                "This bot must maintain a chat store to list all known chats.\n" +
                                "Use .jid without arguments to get the current chat JID."
                        },
                        { quoted: msg }
                    );
                }

                const chats =
                    typeof store.chats.all === "function"
                        ? store.chats.all()
                        : Array.isArray(store.chats)
                            ? store.chats
                            : Object.values(store.chats);

                if (!chats.length) {
                    return await sock.sendMessage(
                        chat,
                        { text: "❌ No chats found in the chat store." },
                        { quoted: msg }
                    );
                }

                const lines = chats
                    .filter(item => item?.id)
                    .slice(0, 100)
                    .map((item, index) => {
                        return (
                            `${index + 1}. ${item.name || item.id}\n` +
                            `🆔 ${item.id}`
                        );
                    });

                const output =
                    "╭━━━〔 🌐 CHAT JID LIST 〕━━━╮\n\n" +
                    lines.join("\n\n") +
                    "\n\n╰━━━━━━━━━━━━━━━━━━━━━━╯\n" +
                    `📊 Showing ${lines.length} chats` +
                    "\n⚡ SHAN MINI BOT";

                return await sock.sendMessage(
                    chat,
                    { text: output },
                    { quoted: msg }
                );
            }

            // ─────────────────────────────────────────────
            // HELP
            // ─────────────────────────────────────────────
            return await sock.sendMessage(
                chat,
                {
                    text:
                        "╭━━━〔 🆔 JID HELP 〕━━━╮\n\n" +
                        "📩 .jid inbox\n" +
                        "👥 .jid group\n" +
                        "📢 .jid channel <link>\n" +
                        "🌐 .jid all\n" +
                        "💬 .jid\n\n" +
                        "╰━━━━━━━━━━━━━━━━━━━━━━╯"
                },
                { quoted: msg }
            );

        } catch (error) {
            console.error("[JID PLUGIN ERROR]", error);

            await sock.sendMessage(
                chat,
                {
                    text:
                        "❌ Failed to retrieve JID information.\n" +
                        "Please try again."
                },
                { quoted: msg }
            );
        }
    }
};