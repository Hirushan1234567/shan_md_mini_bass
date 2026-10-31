// SHAN MINI BOT V1 — PROFILE PICTURE
// ESM | Dynamic Prefix | Auto Reaction

export default {
    name: "dp",
    commands: ["dp", "pp", "profile", "pic"],

    async execute(sock, msg, args) {
        const chat = msg.key.remoteJid;
        const sender =
            msg.key.participant ||
            msg.key.remoteJid;

        try {
            await sock.sendMessage(chat, {
                react: { text: "🖼️", key: msg.key }
            });
        } catch {}

        try {
            const contextInfo =
                msg.message?.extendedTextMessage?.contextInfo ||
                msg.message?.imageMessage?.contextInfo ||
                msg.message?.videoMessage?.contextInfo ||
                {};

            let target;

            // Reply to a user's message to get their DP
            if (contextInfo.participant) {
                target = contextInfo.participant;
            } else if (args[0]) {
                const number = args[0].replace(/\D/g, "");

                if (!number || number.length < 7) {
                    return await sock.sendMessage(
                        chat,
                        {
                            text: "❌ Please provide a valid phone number.\n\nExample: .dp 94771234567"
                        },
                        { quoted: msg }
                    );
                }

                target = `${number}@s.whatsapp.net`;
            } else {
                target = sender;
            }

            let pictureUrl;

            try {
                pictureUrl = await sock.profilePictureUrl(target, "image");
            } catch {
                return await sock.sendMessage(
                    chat,
                    {
                        text:
                            "❌ Unable to retrieve this profile picture.\n\n" +
                            "The user may not have a profile picture, " +
                            "or their privacy settings may prevent access."
                    },
                    { quoted: msg }
                );
            }

            await sock.sendMessage(
                chat,
                {
                    image: { url: pictureUrl },
                    caption:
                        "╭━━━〔 🖼️ PROFILE PICTURE 〕━━━╮\n\n" +
                        `👤 User: @${target.split("@")[0]}\n\n` +
                        "╰━━━━━━━━━━━━━━━━━━━━━━╯\n" +
                        "⚡ POWERED BY SHAN MINI BOT",
                    mentions: [target]
                },
                { quoted: msg }
            );
        } catch (error) {
            console.error("[DP ERROR]", error);

            await sock.sendMessage(
                chat,
                { text: "❌ Failed to retrieve the profile picture." },
                { quoted: msg }
            );
        }
    }
};