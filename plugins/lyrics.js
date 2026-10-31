// plugins/lyrics.js
// SHAN MINI BOT V1 — Lyrics Plugin
// ESM compatible — No extra npm package required

const API_TIMEOUT = 15000;
const MAX_CHUNK_LENGTH = 3500;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "User-Agent": "SHAN-MINI-BOT/1.0",
                Accept: "application/json"
            },
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`API returned HTTP ${response.status}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function cleanLyrics(value) {
    if (typeof value !== "string") return "";

    return value
        .replace(/\r/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function splitText(text, maxLength = MAX_CHUNK_LENGTH) {
    const chunks = [];
    let remaining = text;

    while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf("\n", maxLength);

        if (splitAt < maxLength * 0.5) {
            splitAt = remaining.lastIndexOf(" ", maxLength);
        }

        if (splitAt < maxLength * 0.5) {
            splitAt = maxLength;
        }

        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
    }

    if (remaining) chunks.push(remaining);

    return chunks;
}

async function getLyricsFromNekolabs(query) {
    try {
        const url =
            `https://api.nekolabs.web.id/music/lyrics?query=${encodeURIComponent(query)}`;

        const data = await fetchJSON(url);

        const possibleLyrics = [
            data?.result?.lyrics,
            data?.lyrics,
            typeof data?.result === "string" ? data.result : "",
            data?.data?.lyrics
        ];

        for (const item of possibleLyrics) {
            const lyrics = cleanLyrics(item);

            if (lyrics.length > 20) {
                return lyrics;
            }
        }
    } catch (error) {
        console.log("[LYRICS] Nekolabs API:", error.message);
    }

    return "";
}

async function getLyricsFromLyricsOvh(query) {
    try {
        // lyrics.ovh suggest endpoint searches for matching songs
        const searchURL =
            `https://api.lyrics.ovh/suggest/${encodeURIComponent(query)}`;

        const searchData = await fetchJSON(searchURL);
        const songs = searchData?.data || [];

        if (!songs.length) return "";

        // Try a few matching results
        for (const song of songs.slice(0, 3)) {
            const artist = song?.artist?.name;
            const title = song?.title;

            if (!artist || !title) continue;

            try {
                const lyricsURL =
                    `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;

                const lyricsData = await fetchJSON(lyricsURL);
                const lyrics = cleanLyrics(lyricsData?.lyrics);

                if (lyrics.length > 20) return lyrics;
            } catch (error) {
                console.log("[LYRICS] Lyrics.ovh result:", error.message);
            }
        }
    } catch (error) {
        console.log("[LYRICS] Lyrics.ovh search:", error.message);
    }

    return "";
}

function getChatJid(msg) {
    return msg?.key?.remoteJid || msg?.chat || null;
}

function getMessageText(msg) {
    const message = msg?.message || {};

    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        ""
    );
}

async function react(sock, msg, emoji) {
    try {
        const jid = getChatJid(msg);
        if (!jid || !msg?.key) return;

        await sock.sendMessage(jid, {
            react: {
                text: emoji,
                key: msg.key
            }
        });
    } catch {
        // Reactions are optional
    }
}

const plugin = {
    name: "lyrics",
    command: "lyrics",
    commands: ["lyrics", "lyric", "ly"],
    alias: ["lyric", "ly"],
    description: "Search for song lyrics",
    category: "music",

    async execute(sock, msg, args = []) {
        const jid = getChatJid(msg);

        if (!jid) return;

        const query = args.join(" ").trim();

        await react(sock, msg, "🔍");

        if (!query) {
            return sock.sendMessage(
                jid,
                {
                    text:
                        "🎵 *LYRICS SEARCH*\n\n" +
                        "Please enter a song title or artist.\n\n" +
                        "Example: .lyrics Shape of You\n" +
                        "Example: .ly Believer"
                },
                { quoted: msg }
            );
        }

        await sock.sendMessage(
            jid,
            { text: "🎵 Searching for lyrics... Please wait." },
            { quoted: msg }
        );

        try {
            let lyrics = await getLyricsFromNekolabs(query);

            if (!lyrics) {
                lyrics = await getLyricsFromLyricsOvh(query);
            }

            if (!lyrics) {
                await react(sock, msg, "❌");

                return sock.sendMessage(
                    jid,
                    {
                        text:
                            "❌ *Lyrics Not Found*\n\n" +
                            "No lyrics were found for that song.\n" +
                            "Please check the spelling or try the artist's name."
                    },
                    { quoted: msg }
                );
            }

            const chunks = splitText(
                `🎵 *${query}*\n\n${lyrics}`
            );

            for (let i = 0; i < chunks.length; i++) {
                const header =
                    chunks.length > 1
                        ? `🎵 *LYRICS — Part ${i + 1}/${chunks.length}*\n\n`
                        : "";

                await sock.sendMessage(
                    jid,
                    { text: header + chunks[i] },
                    { quoted: msg }
                );

                if (i < chunks.length - 1) {
                    await delay(500);
                }
            }

            await react(sock, msg, "✅");
        } catch (error) {
            console.error("[LYRICS] Error:", error);

            await react(sock, msg, "❌");

            await sock.sendMessage(
                jid,
                {
                    text:
                        "❌ *Lyrics Search Failed*\n\n" +
                        "The lyrics service is temporarily unavailable. " +
                        "Please try again later."
                },
                { quoted: msg }
            );
        }
    }
};

export default plugin;