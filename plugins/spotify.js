// ============================================================
// SHAN MINI BOT V1 — SPOTIFY DOWNLOADER
// English • Number Replies Only • No Buttons
// ============================================================

const SPOTIFY_BASE = "https://api.chamindu.site/api/v1/spotify";
const YT_BASE = "https://api.chamindu.site/api/v1/youtube";

const API_KEY = process.env.CHAMA_API_KEY || "";
const PREFIX = process.env.PREFIX || ".";

const BRAND = "💙 SHAN MINI BOT V1";
const FOOTER = "POWERED BY SHAN MINI BOT";

const MARKER_SEARCH = "SHAN SPOTIFY SEARCH";
const MARKER_DETAILS = "SHAN SPOTIFY DETAILS";

const QUALITIES = ["128kbps", "320kbps"];
const MAX_RESULTS = Number(process.env.SPOTIFY_MAX_RESULTS) || 10;
const TTL = 20 * 60 * 1000;
const API_TIMEOUT = Number(process.env.SONG_API_TIMEOUT) || 25000;

const searches = new Map();
const tracks = new Map();
const lastBy = new Map();

const newId = () => Math.random().toString(36).slice(2, 8);

function sweep() {
    const now = Date.now();

    for (const map of [searches, tracks]) {
        for (const [id, value] of map) {
            if (now - value.time > TTL) map.delete(id);
        }
    }

    for (const [key, value] of lastBy) {
        if (
            (!value.search || !searches.has(value.search)) &&
            (!value.track || !tracks.has(value.track))
        ) {
            lastBy.delete(key);
        }
    }
}

const str = value =>
    typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "";

const isHttp = value =>
    typeof value === "string" && /^https?:\/\//i.test(value);

const isTrackUrl = value =>
    /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/[A-Za-z0-9]+/i.test(
        String(value || "")
    );

const cut = (value, max) => {
    const text = String(value || "");
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
};

const cleanTitle = value =>
    String(value || "")
        .replace(
            /\s*[\(\[](official|lyrics?|audio|video|music video|lyric video|8d audio|visualizer)[^\)\]]*[\)\]]/gi,
            ""
        )
        .replace(/\s+/g, " ")
        .trim();

function getChat(msg) {
    return msg?.key?.remoteJid || "";
}

function getSender(msg, sock) {
    if (msg?.key?.participant) return msg.key.participant;
    if (msg?.key?.fromMe) return sock?.user?.id || getChat(msg);
    return getChat(msg);
}

function getChatKey(msg, sock) {
    return `${getChat(msg)}:${getSender(msg, sock)}`;
}

async function react(sock, msg, emoji) {
    try {
        await sock.sendMessage(getChat(msg), {
            react: { text: emoji, key: msg.key }
        });
    } catch {}
}

async function reply(sock, msg, text) {
    return sock.sendMessage(
        getChat(msg),
        { text: String(text) },
        { quoted: msg }
    );
}

function unwrapMessage(message) {
    let current = message;

    for (let i = 0; i < 5 && current; i++) {
        const wrapped =
            current.ephemeralMessage?.message ||
            current.viewOnceMessage?.message ||
            current.viewOnceMessageV2?.message ||
            current.documentWithCaptionMessage?.message;

        if (!wrapped) break;
        current = wrapped;
    }

    return current || {};
}

function quotedTextOf(msg) {
    try {
        const message = unwrapMessage(msg?.message);

        const context =
            message.extendedTextMessage?.contextInfo ||
            message.imageMessage?.contextInfo ||
            message.videoMessage?.contextInfo ||
            message.documentMessage?.contextInfo;

        const quoted = unwrapMessage(context?.quotedMessage);

        return (
            quoted.conversation ||
            quoted.extendedTextMessage?.text ||
            quoted.imageMessage?.caption ||
            quoted.videoMessage?.caption ||
            quoted.documentMessage?.caption ||
            ""
        );
    } catch {
        return "";
    }
}

// ============================================================
// API
// ============================================================

async function callApi(base, endpoint, params = {}, label = "") {
    const url = new URL(`${base}/${endpoint}`);

    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, String(value));
        }
    }

    if (API_KEY) url.searchParams.set("api_key", API_KEY);

    const response = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json"
        },
        signal: AbortSignal.timeout(API_TIMEOUT)
    });

    const json = await response.json().catch(() => null);

    console.log(
        `[SHAN SPOTIFY] ${label || endpoint}: HTTP ${response.status}`
    );

    if (!response.ok) {
        throw new Error(`API returned HTTP ${response.status}`);
    }

    return json;
}

function okJson(json) {
    return Boolean(
        json &&
        json.success !== false &&
        json.status !== false
    );
}

function pickUrl(json) {
    for (const object of [json?.data, json?.result, json]) {
        if (!object || typeof object !== "object") continue;

        for (const key of [
            "download_url",
            "download_link",
            "url",
            "link",
            "audio",
            "mp3",
            "direct_url",
            "audio_url"
        ]) {
            const value = object[key];

            if (isHttp(value)) {
                try {
                    const host = new URL(value).hostname;

                    if (
                        host === "localhost" ||
                        host === "127.0.0.1" ||
                        host === "0.0.0.0" ||
                        host === "::1" ||
                        /^10\./.test(host) ||
                        /^192\.168\./.test(host) ||
                        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
                    ) {
                        continue;
                    }

                    return value;
                } catch {}
            }
        }
    }

    return "";
}

function ytIdOf(item) {
    return (
        (String(item.video_id || "").match(/^[\w-]{11}$/) || [])[0] ||
        (String(item.youtube_url || "").match(
            /(?:v=|youtu\.be\/)([\w-]{11})/
        ) || [])[1] ||
        (String(item.thumbnail || "").match(
            /ytimg\.com\/vi(?:_webp)?\/([\w-]{11})/
        ) || [])[1] ||
        ""
    );
}

// ============================================================
// SEARCH
// ============================================================

async function doSearch(ctx, query) {
    const { sock, from, msg, sender } = ctx;

    const json = await callApi(
        SPOTIFY_BASE,
        "search",
        { q: query },
        "Spotify search"
    );

    const list = (
        Array.isArray(json?.result)
            ? json.result
            : Array.isArray(json?.data)
                ? json.data
                : []
    )
        .filter(item => item && item.title)
        .slice(0, MAX_RESULTS);

    if (!okJson(json) || !list.length) {
        await ctx.react("❌");
        await ctx.reply(`❌ No songs found for "${query}".`);
        return false;
    }

    const results = list.map(item => ({
        title: str(item.title),
        artist:
            str(item.artist) && !/^unknown/i.test(item.artist)
                ? str(item.artist)
                : "",
        duration: str(item.duration),
        thumb: isHttp(item.thumbnail) ? item.thumbnail : "",
        spotify_url: isTrackUrl(item.spotify_url)
            ? item.spotify_url
            : "",
        yt_id: ytIdOf(item)
    }));

    const id = newId();

    searches.set(id, {
        from,
        results,
        time: Date.now()
    });

    const key = `${from}:${sender}`;

    lastBy.set(key, {
        ...(lastBy.get(key) || {}),
        search: id
    });

    const lines = results.map((item, index) =>
        `*${index + 1}.* ${cut(item.title, 65)}\n` +
        `   Artist: ${item.artist || "Unknown"}\n` +
        `   Duration: ${item.duration || "Unknown"}`
    );

    const text =
        `💙 *${BRAND}*\n` +
        `🎵 *${MARKER_SEARCH}*\n\n` +
        `Search: _${cut(query, 80)}_\n\n` +
        `${lines.join("\n\n")}\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `*Reply to this message with a number to select a song.*\n` +
        `Example: 1\n\n` +
        `Results expire in 20 minutes.\n` +
        `_${FOOTER}_`;

    await ctx.reply(text);
    return true;
}

// ============================================================
// SONG DETAILS — NUMBER REPLY ONLY
// ============================================================

async function showDetails(ctx, item) {
    const { from, sender } = ctx;

    let track = {
        title: item.title || "Unknown Track",
        artist: item.artist || "",
        album: "",
        duration: item.duration || "",
        release: "",
        thumb: item.thumb || "",
        spotify_url: item.spotify_url || "",
        preview: "",
        yt_id: item.yt_id || "",
        query: [cleanTitle(item.title), item.artist]
            .filter(Boolean)
            .join(" ")
    };

    if (track.spotify_url) {
        try {
            const json = await callApi(
                SPOTIFY_BASE,
                "track",
                { url: track.spotify_url },
                "Spotify track"
            );

            const data = json?.result || json?.data;

            if (okJson(json) && data) {
                track = {
                    ...track,
                    title: str(data.title) || track.title,
                    artist: str(data.artist) || track.artist,
                    album: str(data.album),
                    duration: str(data.duration) || track.duration,
                    release: str(data.release_date),
                    thumb: isHttp(data.thumbnail)
                        ? data.thumbnail
                        : track.thumb,
                    preview: isHttp(data.preview_url)
                        ? data.preview_url
                        : ""
                };

                track.query = [cleanTitle(track.title), track.artist]
                    .filter(Boolean)
                    .join(" ");
            }
        } catch (error) {
            console.log(
                "[SHAN SPOTIFY] Track details error:",
                error.message
            );
        }
    }

    const id = newId();

    tracks.set(id, {
        from,
        track,
        time: Date.now()
    });

    const key = `${from}:${sender}`;

    lastBy.set(key, {
        ...(lastBy.get(key) || {}),
        track: id
    });

    const text = [
        `💙 *${BRAND}*`,
        `🎧 *${MARKER_DETAILS}*`,
        "",
        `Song: *${track.title}*`,
        track.artist ? `Artist: ${track.artist}` : "",
        track.album ? `Album: ${track.album}` : "",
        track.duration ? `Duration: ${track.duration}` : "",
        track.release ? `Release: ${track.release}` : "",
        "",
        "━━━━━━━━━━━━━━━━━━",
        "*SELECT AUDIO QUALITY*",
        "",
        "*1.* 128kbps",
        "*2.* 320kbps",
        "",
        "*Reply to this message with 1 or 2.*",
        "",
        `_${FOOTER}_`
    ].filter(Boolean).join("\n");

    await ctx.reply(text);
    return true;
}

// ============================================================
// YOUTUBE MP3 FALLBACK
// ============================================================

async function ytMp3(track, quality) {
    let videoId = track.yt_id;

    if (!videoId) {
        const json = await callApi(
            YT_BASE,
            "search",
            { q: track.query || track.title },
            "YouTube search"
        );

        const list = Array.isArray(json?.data)
            ? json.data
            : Array.isArray(json?.result)
                ? json.result
                : Array.isArray(json?.results)
                    ? json.results
                    : [];

        const first = list.find(item =>
            item && (item.id || item.video_id || ytIdOf(item))
        );

        if (first) {
            videoId = first.id || first.video_id || ytIdOf(first);
        }
    }

    if (!videoId) return null;

    const qualities = [...new Set([quality, "128kbps", "320kbps"])];

    for (const requestedQuality of qualities) {
        try {
            const json = await callApi(
                YT_BASE,
                "mp3",
                {
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    quality: requestedQuality
                },
                `YouTube MP3 ${requestedQuality}`
            );

            const url = okJson(json) ? pickUrl(json) : "";

            if (url) {
                return {
                    url,
                    quality: requestedQuality
                };
            }
        } catch (error) {
            console.log(
                "[SHAN SPOTIFY] MP3 error:",
                error.message
            );
        }
    }

    return null;
}

// ============================================================
// DOWNLOAD
// ============================================================

async function sendAudio(ctx, track, qualityIndex) {
    const { sock, from, msg } = ctx;
    const quality = QUALITIES[qualityIndex];

    await ctx.reply(
        `💙 *${BRAND}*\n\n` +
        `Preparing audio...\n` +
        `Song: ${track.title}\n` +
        `Requested quality: ${quality}\n\n` +
        `Please wait.`
    );

    let audioURL = "";
    let usedQuality = "";

    try {
        const result = await ytMp3(track, quality);

        if (result) {
            audioURL = result.url;
            usedQuality = result.quality;
        }
    } catch (error) {
        console.log(
            "[SHAN SPOTIFY] Download error:",
            error.message
        );
    }

    if (!audioURL) {
        if (track.preview) {
            await ctx.reply(
                "The full audio link is unavailable. Sending the available preview."
            );

            await sock.sendMessage(
                from,
                {
                    audio: { url: track.preview },
                    mimetype: "audio/mpeg",
                    ptt: false
                },
                { quoted: msg }
            );

            return true;
        }

        await ctx.reply(
            "❌ Unable to obtain an audio link for this song.\n\n" +
            "Please try another song later."
        );

        return false;
    }

    const safeName = (
        `${track.title}${track.artist ? " - " + track.artist : ""}`
    )
        .replace(/[\\/:*?"<>|\n\r]/g, "")
        .slice(0, 90);

    const fileName = `${safeName || "song"}.mp3`;

    try {
        if (track.thumb) {
            await sock.sendMessage(
                from,
                {
                    image: { url: track.thumb },
                    caption:
                        `💙 *${BRAND}*\n\n` +
                        `Song: ${track.title}\n` +
                        `Artist: ${track.artist || "Unknown"}\n` +
                        `Quality: ${usedQuality}\n\n` +
                        `_${FOOTER}_`
                },
                { quoted: msg }
            ).catch(() => {});
        }

        await sock.sendMessage(
            from,
            {
                audio: { url: audioURL },
                mimetype: "audio/mpeg",
                fileName,
                ptt: false
            },
            { quoted: msg }
        );

        return true;
    } catch (error) {
        console.error(
            "[SHAN SPOTIFY] WhatsApp audio send error:",
            error.message
        );

        await ctx.reply(
            "❌ Failed to send the audio. Please try again later."
        );

        return false;
    }
}

// ============================================================
// CONTEXT
// ============================================================

function makeContext(sock, msg) {
    const from = getChat(msg);
    const sender = getSender(msg, sock);

    return {
        sock,
        msg,
        from,
        sender,
        prefix: PREFIX,
        reply: text => reply(sock, msg, text),
        react: emoji => react(sock, msg, emoji)
    };
}

async function pickSong(ctx, id, number) {
    const entry = searches.get(String(id || ""));

    if (!entry) {
        await ctx.reply(
            `Search expired. Search again using:\n${PREFIX}spotify <song name>`
        );
        return true;
    }

    const index = Number(number) - 1;
    const item = entry.results[index];

    if (!item) {
        await ctx.reply(
            `Invalid selection. Reply with a number from 1 to ${entry.results.length}.`
        );
        return true;
    }

    await ctx.react("🎧");

    try {
        await showDetails(ctx, item);
    } catch (error) {
        console.error("[SHAN SPOTIFY] Details error:", error.message);
        await ctx.reply("Failed to retrieve song details. Please try again.");
    }

    return true;
}

async function pickQuality(ctx, id, number) {
    const entry = tracks.get(String(id || ""));

    if (!entry) {
        await ctx.reply(
            `Song selection expired. Search again using:\n${PREFIX}spotify <song name>`
        );
        return true;
    }

    const index = Number(number) - 1;

    if (!QUALITIES[index]) {
        await ctx.reply("Invalid quality. Reply with 1 or 2.");
        return true;
    }

    await ctx.react("⏳");

    try {
        const success = await sendAudio(ctx, entry.track, index);
        await ctx.react(success ? "✅" : "❌");
    } catch (error) {
        console.error("[SHAN SPOTIFY] Download error:", error.message);
        await ctx.react("❌");
        await ctx.reply("Download failed. Please try again later.");
    }

    return true;
}

// ============================================================
// PLUGIN EXPORT
// ============================================================

export default {
    command: "spotify",

    alias: [
        "spotifydl",
        "spotsel",
        "spotget"
    ],

    react: "🎧",
    replyHandler: true,

    async execute(sock, msg, args, commandName) {
        const ctx = makeContext(sock, msg);

        sweep();

        // Buttons are not used, but these commands remain available
        // for direct command-based selection if needed.
        const command = String(commandName || "spotify").toLowerCase();

        if (command === "spotsel") {
            return pickSong(ctx, args[0], args[1]);
        }

        if (command === "spotget") {
            return pickQuality(ctx, args[0], args[1]);
        }

        const query = args.join(" ").trim();

        if (!query) {
            return ctx.reply(
                `💙 *${BRAND} — SPOTIFY DOWNLOADER*\n\n` +
                `Usage: ${PREFIX}spotify <song name>\n\n` +
                `Example: ${PREFIX}spotify Shape of You\n\n` +
                `You can also provide a Spotify track link.`
            );
        }

        try {
            await ctx.react("🔎");

            const spotifyLink = query
                .split(/\s+/)
                .find(isTrackUrl);

            if (spotifyLink) {
                return showDetails(ctx, {
                    title: "Spotify Track",
                    artist: "",
                    duration: "",
                    thumb: "",
                    spotify_url: spotifyLink.split("?")[0]
                });
            }

            await doSearch(ctx, query);
        } catch (error) {
            console.error("[SHAN SPOTIFY] Command error:", error.message);
            await ctx.react("❌");
            await ctx.reply(
                "❌ Search failed. Please check the API configuration and try again."
            );
        }
    },

    matchReply(text, quotedText, msg) {
        if (!/^\d{1,2}$/.test(String(text || "").trim())) {
            return false;
        }

        const quoted = quotedTextOf(msg) || quotedText || "";

        return (
            quoted.includes(MARKER_SEARCH) ||
            quoted.includes(MARKER_DETAILS)
        );
    },

    async handleReply(sock, msg, text) {
        const ctx = makeContext(sock, msg);
        const quoted = quotedTextOf(msg);

        // Only handle replies quoting this plugin's own messages.
        if (
            !quoted.includes(MARKER_SEARCH) &&
            !quoted.includes(MARKER_DETAILS)
        ) {
            return false;
        }

        const numberText = String(text || "").trim();

        if (!/^\d{1,2}$/.test(numberText)) {
            return false;
        }

        const key = `${ctx.from}:${ctx.sender}`;
        const last = lastBy.get(key) || {};
        const number = Number(numberText);

        if (quoted.includes(MARKER_DETAILS)) {
            if (!last.track) {
                await ctx.reply("Song selection expired. Please search again.");
                return true;
            }

            return pickQuality(ctx, last.track, number);
        }

        if (!last.search) {
            await ctx.reply("Search results expired. Please search again.");
            return true;
        }

        return pickSong(ctx, last.search, number);
    }
};