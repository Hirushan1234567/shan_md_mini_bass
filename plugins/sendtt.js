import mongoose from "mongoose";
import fs from "fs";
import path from "path";

/* =====================================================
SENDTT — Channel auto video sender
.sendtt → activate channel → categories → 25 videos / 1 hour
Free: 4 hour limit | Premium & Owner: no limit
===================================================== */

const MAIN_OWNER = String(process.env.OWNER_NUMBER || "94752661225").replace(/\D/g, "");

const VIDEOS_PER_RUN = 25;
const RUN_MS = 60 * 60 * 1000; // 1 hour
const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours (free users)
const SESSION_TTL = 10 * 60 * 1000; // step timeout
const MAX_DURATION = 120; // skip videos longer than 2 min

const MARK_1 = "SHAN_SENDTT_STEP1";
const MARK_2 = "SHAN_SENDTT_STEP2";

const sessions = new Map(); // key -> { step, channel, expires }
const jobs = new Map(); // number -> job

/* ---------- helpers ---------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));

function clean(v = "") {
  return String(v)
    .replace(/@s\.whatsapp\.net|@c\.us|@lid/g, "")
    .split(":")[0]
    .split("@")[0]
    .replace(/\D/g, "");
}

function senderNumber(msg) {
  const k = msg?.key || {};
  if (k.fromMe === true) return MAIN_OWNER;

  const values = [k.senderPn, k.participantPn, k.participantAlt, k.participant, k.remoteJidAlt, k.remoteJid];
  for (const v of values) {
    if (!v) continue;
    const n = clean(v);
    if (n === MAIN_OWNER) return n;
  }
  for (const v of values) {
    if (!v) continue;
    const n = clean(v);
    if (n.length >= 8) return n;
  }
  return "";
}

function quotedTextOf(msg) {
  const q = msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  return q?.conversation || q?.extendedTextMessage?.text || "";
}

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/* ---------- premium (uses index.js isPremium if exposed) ---------- */

async function hasNoLimit(number) {
  if (!number) return false;
  if (number === MAIN_OWNER) return true;

  if (typeof globalThis.isPremiumUser === "function") {
    try {
      return Boolean(await globalThis.isPremiumUser(number));
    } catch {
      return false;
    }
  }

  // fallback: read the premium collection directly
  try {
    const Premium = mongoose.models.PremiumUser;
    if (!Premium || mongoose.connection.readyState !== 1) return false;
    const u = await Premium.findOne({ number, expiresAt: { $gt: new Date() } });
    return Boolean(u);
  } catch {
    return false;
  }
}

/* ---------- cooldown storage ---------- */

const memoryLimits = new Map();

const limitSchema = new mongoose.Schema(
  { number: { type: String, unique: true, index: true }, nextAt: Date },
  { collection: "sendttlimits" }
);
const SendTTLimit = mongoose.models.SendTTLimit || mongoose.model("SendTTLimit", limitSchema);

const dbReady = () => mongoose.connection.readyState === 1;

async function getNextAt(number) {
  if (dbReady()) {
    try {
      const doc = await SendTTLimit.findOne({ number });
      return doc?.nextAt ? doc.nextAt.getTime() : 0;
    } catch {}
  }
  return memoryLimits.get(number) || 0;
}

async function setNextAt(number, time) {
  memoryLimits.set(number, time);
  if (dbReady()) {
    try {
      await SendTTLimit.findOneAndUpdate(
        { number },
        { number, nextAt: new Date(time) },
        { upsert: true }
      );
    } catch {}
  }
}

/* ---------- video source (TikTok search via tikwm) ---------- */

async function searchVideos(keyword, cursor = 0) {
  const params = {
    keywords: keyword,
    count: "30",
    cursor: String(cursor),
    web: "1",
    hd: "1"
  };

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Origin: "https://www.tikwm.com",
    Referer: "https://www.tikwm.com/"
  };

  const url = "https://www.tikwm.com/api/feed/search";
  let json = null;
  let lastError = null;

  // try POST first, then GET as fallback
  for (const method of ["POST", "GET"]) {
    try {
      const qs = new URLSearchParams(params);
      const res =
        method === "POST"
          ? await fetch(url, { method, headers, body: qs })
          : await fetch(`${url}?${qs}`, { method, headers });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      json = await res.json();

      if (json?.code !== 0) {
        throw new Error(json?.msg || `API code ${json?.code}`);
      }

      lastError = null;
      break;
    } catch (e) {
      lastError = e;
      json = null;
      await sleep(1500);
    }
  }

  if (!json) throw lastError || new Error("No response");

  const data = json?.data || {};

  return {
    videos: Array.isArray(data.videos) ? data.videos : [],
    cursor: data.cursor || 0,
    hasMore: Boolean(data.hasMore)
  };
}

function absUrl(u) {
  if (!u) return "";
  return u.startsWith("http") ? u : `https://www.tikwm.com${u}`;
}

async function buildQueue(categories) {
  const lists = [];
  let lastError = "";

  for (const category of categories) {
    const items = [];
    let cursor = 0;

    for (let page = 0; page < 2 && items.length < 30; page++) {
      try {
        const r = await searchVideos(category, cursor);
        for (const v of r.videos) {
          const url = absUrl(v.hdplay || v.play);
          if (!url) continue;
          if (v.duration && v.duration > MAX_DURATION) continue;
          items.push({ id: String(v.video_id || v.id || url), url, title: v.title || "", category });
        }
        if (!r.hasMore) break;
        cursor = r.cursor;
      } catch (e) {
        lastError = e?.message || String(e);
        console.error(`❌ sendtt search error (${category}):`, lastError);
        break;
      }
      await sleep(1300); // tikwm rate limit
    }

    lists.push(items);
    await sleep(1300);
  }

  // round-robin so every category gets videos
  const queue = [];
  const seen = new Set();
  let i = 0;
  let added = true;

  while (added) {
    added = false;
    for (const list of lists) {
      const v = list[i];
      if (v && !seen.has(v.id)) {
        seen.add(v.id);
        queue.push(v);
        added = true;
      }
    }
    i++;
  }

  return { queue, error: lastError };
}

/* ---------- channel resolve ---------- */

async function resolveChannel(sock, value) {
  const jid = value.match(/\d{8,}@newsletter/i)?.[0];
  if (jid) return jid;

  const code = value.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/i)?.[1];
  if (!code) return null;

  const meta = await sock.newsletterMetadata("invite", code);
  return meta?.id || null;
}

/* ---------- job runner ---------- */

async function runJob(sock, chat, number, channel, categories, unlimited, queue) {
  const job = { stop: false, sent: 0, channel, categories, startedAt: Date.now() };
  jobs.set(number, job);

  const interval = Math.floor(RUN_MS / VIDEOS_PER_RUN); // ~2.4 min

  try {
    await sock.sendMessage(chat, {
      text:
        `🚀 *SENDTT STARTED*\n\n` +
        `📢 Channel: ${channel}\n` +
        `🗂️ Categories: ${categories.join(", ")}\n` +
        `🎬 Videos: ${VIDEOS_PER_RUN} (within 1 hour)\n` +
        `💎 Limit: ${unlimited ? "No limit" : "4 hours"}\n\n` +
        `To stop: .sendtt stop`
    });

    let failures = 0;

    while (!job.stop && job.sent < VIDEOS_PER_RUN && queue.length) {
      const v = queue.shift();

      try {
        const caption = `🎬 ${v.title.slice(0, 150)}\n\n#${v.category.replace(/\s+/g, "")}`;
        await sock.sendMessage(channel, { video: { url: v.url }, caption });
        job.sent++;
        failures = 0;
        console.log(`📢 sendtt ${job.sent}/${VIDEOS_PER_RUN} → ${channel}`);
      } catch (e) {
        failures++;
        console.error("❌ sendtt send error:", e?.message || e);

        if (failures >= 5) {
          await sock.sendMessage(chat, {
            text: "❌ Unable to send videos to the channel. Make sure the bot account is the channel owner/admin."
          });
          break;
        }
        continue; // try next video immediately
      }

      if (job.sent < VIDEOS_PER_RUN) {
        // sleep in small steps so .sendtt stop works quickly
        let waited = 0;
        while (waited < interval && !job.stop) {
          await sleep(5000);
          waited += 5000;
        }
      }
    }

    if (!unlimited && job.sent > 0) {
      await setNextAt(number, Date.now() + COOLDOWN_MS);
    }

    await sock.sendMessage(chat, {
      text:
        `✅ *SENDTT FINISHED*\n\n🎬 Sent: ${job.sent}/${VIDEOS_PER_RUN}\n` +
        (unlimited
          ? "💎 You have no limit — you can run .sendtt again anytime."
          : `⏳ You can run it again in 4 hours.\n💎 Premium users have no limit.`)
    });
  } catch (e) {
    console.error("❌ sendtt job error:", e?.stack || e?.message || e);
  } finally {
    jobs.delete(number);
  }
}

/* ---------- auto follow + welcome (once per connection) ---------- */

const FOLLOW_CHANNELS = [
  "https://whatsapp.com/channel/0029Vb9KJ1dJP210AYAZX61O", // Shan_Mini_Bot 👨‍💻
  "https://whatsapp.com/channel/0029Vb76aeC30LKFzqDBwR2A" // second channel
];

const SESSION_DIR = process.env.SESSION_DIR || "./sessions";
const WELCOME_FLAG = path.join(SESSION_DIR, ".welcome_sent");
const LOGO_PATH = process.env.BOT_LOGO_PATH || "./logo.jpg";
const LOGO_URL = process.env.BOT_LOGO_URL || "";

const initialized = new WeakSet();
const followed = new Set();

async function followChannels(sock) {
  for (const link of FOLLOW_CHANNELS) {
    try {
      const jid = await resolveChannel(sock, link);
      if (!jid || followed.has(jid)) continue;

      try {
        await sock.newsletterFollow(jid);
        console.log(`📢 Channel followed: ${jid}`);
      } catch (e) {
        console.log(`ℹ️ Channel follow skipped (${jid}): ${e?.message || e}`);
      }

      followed.add(jid);
    } catch (e) {
      console.error("❌ sendtt auto follow error:", e?.message || e);
    }

    await sleep(2000);
  }
}

function welcomeText(number, prefix) {
  return (
    `╭─「 💙 SHAN MINI BOT 」─╮\n\n` +
    `👋 Welcome to SHAN MINI BOT!\n\n` +
    `💙 Your WhatsApp is now connected.\n` +
    `📱 Number : ${number}\n` +
    `⚡ Prefix : ${prefix}\n` +
    `🟢 Status : Online\n\n` +
    `✨ Enjoy Your Bot Experience!\n\n` +
    `🚀 Full Version Coming Soon... 💙\n\n` +
    `📢 Follow Our WhatsApp Channel! 👨‍💻\n` +
    `🔗 https://whatsapp.com/channel/0029Vb9KJ1dJP210AYAZX61O\n\n` +
    `╰─「 ⚡ VERSION 1.0 」─╯`
  );
}

async function sendWelcome(sock) {
  try {
    if (fs.existsSync(WELCOME_FLAG)) return; // already sent for this session

    const number = clean(sock.user?.id || "");
    if (!number) return;

    let prefix = process.env.PREFIX || ".";
    if (dbReady()) {
      try {
        const doc = await mongoose.connection.db.collection("botsettings").findOne({});
        if (doc?.prefix) prefix = doc.prefix;
      } catch {}
    }

    const caption = welcomeText(number, prefix);
    const jid = `${number}@s.whatsapp.net`;

    let image = null;
    if (fs.existsSync(LOGO_PATH)) image = fs.readFileSync(LOGO_PATH);
    else if (LOGO_URL) image = { url: LOGO_URL };

    if (image) await sock.sendMessage(jid, { image, caption });
    else await sock.sendMessage(jid, { text: caption });

    fs.mkdirSync(SESSION_DIR, { recursive: true });
    fs.writeFileSync(WELCOME_FLAG, new Date().toISOString());
    console.log("💙 Welcome message sent.");
  } catch (e) {
    console.error("❌ sendtt welcome error:", e?.message || e);
  }
}

/* ---------- plugin ---------- */

export default {
  command: "sendtt",
  alias: ["sendtt"],
  replyHandler: true,

  // index.js calls this for every incoming message (background plugins).
  // First call per socket = bot is connected → welcome + auto follow.
  async handleMessage(sock) {
    // new index.js already does welcome + auto follow on connect
    if (globalThis.SHAN_INDEX_WELCOME) return false;

    if (!sock?.user || initialized.has(sock)) return false;
    initialized.add(sock);

    setTimeout(async () => {
      await sendWelcome(sock);
      await followChannels(sock);
    }, 5000);

    return false;
  },

  async execute(sock, msg, args) {
    const chat = msg.key.remoteJid;
    const number = senderNumber(msg);
    const sub = (args[0] || "").toLowerCase();

    if (sub === "stop") {
      const job = jobs.get(number);
      if (!job) {
        return sock.sendMessage(chat, { text: "ℹ️ No job is running." }, { quoted: msg });
      }
      job.stop = true;
      return sock.sendMessage(chat, { text: "🛑 Stopping..." }, { quoted: msg });
    }

    if (sub === "status") {
      const job = jobs.get(number);
      const unlimited = await hasNoLimit(number);
      const nextAt = unlimited ? 0 : await getNextAt(number);

      let text = "📊 *SENDTT STATUS*\n\n";
      text += job
        ? `🟢 Running: ${job.sent}/${VIDEOS_PER_RUN}\n📢 ${job.channel}\n🗂️ ${job.categories.join(", ")}`
        : "⚪ No job running";
      text += unlimited
        ? "\n\n💎 Limit: No limit"
        : nextAt > Date.now()
          ? `\n\n⏳ Next run available in: ${fmt(nextAt - Date.now())}`
          : "\n\n✅ You can run it now";

      return sock.sendMessage(chat, { text }, { quoted: msg });
    }

    if (jobs.has(number)) {
      return sock.sendMessage(
        chat,
        { text: "⚠️ You already have a job running.\nStatus: .sendtt status\nStop: .sendtt stop" },
        { quoted: msg }
      );
    }

    const unlimited = await hasNoLimit(number);

    if (!unlimited) {
      const nextAt = await getNextAt(number);
      if (nextAt > Date.now()) {
        return sock.sendMessage(
          chat,
          {
            text:
              `⏳ *LIMIT REACHED*\n\nNext run available in: ${fmt(nextAt - Date.now())}\n\n` +
              `💎 Premium users have no limit.\nContact the owner to get premium.`
          },
          { quoted: msg }
        );
      }
    }

    sessions.set(`${chat}:${number}`, { step: 1, expires: Date.now() + SESSION_TTL });

    return sock.sendMessage(
      chat,
      {
        text:
          `╭━━〔 📢 SENDTT 〕━━╮\n\n` +
          `Step 1/2 — Activate Channel\n\n` +
          `Reply to this message with your\nchannel link or JID.\n\n` +
          `Example:\nhttps://whatsapp.com/channel/xxxxxxxx\n\n` +
          `⚠️ The bot account must be the channel owner/admin.\n\n` +
          `╰━━━━━━━━━━━━━━━━╯\n\n${MARK_1}`
      },
      { quoted: msg }
    );
  },

  async handleReply(sock, msg, text) {
    const quoted = quotedTextOf(msg);
    const isStep1 = quoted.includes(MARK_1);
    const isStep2 = quoted.includes(MARK_2);

    if (!isStep1 && !isStep2) return false;

    const chat = msg.key.remoteJid;
    const number = senderNumber(msg);
    const key = `${chat}:${number}`;
    const session = sessions.get(key);

    if (!session || session.expires < Date.now()) {
      sessions.delete(key);
      await sock.sendMessage(chat, { text: "⌛ Session expired. Run .sendtt again." }, { quoted: msg });
      return true;
    }

    /* ----- step 1: channel ----- */
    if (isStep1 && session.step === 1) {
      let jid = null;

      try {
        jid = await resolveChannel(sock, text);
      } catch (e) {
        console.error("❌ sendtt channel resolve:", e?.message || e);
      }

      if (!jid) {
        await sock.sendMessage(
          chat,
          { text: "❌ Invalid channel link/JID. Please reply again." },
          { quoted: msg }
        );
        return true;
      }

      session.step = 2;
      session.channel = jid;
      session.expires = Date.now() + SESSION_TTL;

      await sock.sendMessage(
        chat,
        {
          text:
            `✅ Channel activated\n📢 ${jid}\n\n` +
            `Step 2/2 — Categories\n\n` +
            `Reply to this message with your categories,\nseparated by commas (,).\n\n` +
            `Example:\ncar video, boat video, funny cats\n\n${MARK_2}`
        },
        { quoted: msg }
      );
      return true;
    }

    /* ----- step 2: categories ----- */
    if (isStep2 && session.step === 2) {
      const categories = [
        ...new Set(
          text
            .split(/[,\n]/)
            .map(x => x.trim())
            .filter(x => x.length >= 2)
        )
      ].slice(0, 8);

      if (!categories.length) {
        await sock.sendMessage(chat, { text: "❌ Please type valid categories." }, { quoted: msg });
        return true;
      }

      if (jobs.has(number)) {
        sessions.delete(key);
        await sock.sendMessage(chat, { text: "⚠️ You already have a job running." }, { quoted: msg });
        return true;
      }

      const unlimited = await hasNoLimit(number);

      if (!unlimited) {
        const nextAt = await getNextAt(number);
        if (nextAt > Date.now()) {
          sessions.delete(key);
          await sock.sendMessage(
            chat,
            { text: `⏳ Limit reached. Next run available in: ${fmt(nextAt - Date.now())}` },
            { quoted: msg }
          );
          return true;
        }
      }

      await sock.sendMessage(chat, { text: "🔎 Searching for videos... please wait." }, { quoted: msg });

      const { queue, error } = await buildQueue(categories);

      if (queue.length < 3) {
        // keep the session so the user can reply again with other categories
        session.expires = Date.now() + SESSION_TTL;

        await sock.sendMessage(
          chat,
          {
            text:
              `❌ Couldn't find enough videos (${queue.length} found).\n` +
              (error ? `Reason: ${error}\n` : "") +
              `\nReply to the Step 2 message again with different categories.`
          },
          { quoted: msg }
        );
        return true;
      }

      sessions.delete(key);

      // background — do not await
      runJob(sock, chat, number, session.channel, categories, unlimited, queue);
      return true;
    }

    return false;
  }
};
