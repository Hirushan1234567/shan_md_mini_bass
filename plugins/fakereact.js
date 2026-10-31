// plugins/channels.js
// Channel management: auto-react, auto-follow, link, emoji pack
// Premium-only (owner exempt) — gating handled by index.js executePlugin

const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "..", "channelAutoReact.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return { channels: {} };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// Extract channel JID from a link or raw JID
function extractChannelRef(input) {
  const raw = input.trim();
  // Direct JID
  if (raw.includes("@newsletter")) return { jid: raw, code: null };
  // Link form: https://whatsapp.com/channel/<code>
  const m = raw.match(/whatsapp\.com\/channel\/([A-Za-z0-9_-]+)/);
  if (m) return { jid: null, code: m[1] };
  return null;
}

async function resolveJid(sock, input) {
  const ref = extractChannelRef(input);
  if (!ref) return null;
  if (ref.jid) return ref.jid;
  try {
    const meta = await sock.newsletterMetadataByInvite(ref.code);
    return meta?.id || null;
  } catch (e) {
    console.error("[channels] resolveJid failed:", e.message);
    return null;
  }
}

const REACT_DELAY = 1500; // ms between backfill reactions
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const command = async (sock, msg, text) => {
  const [cmd, ...args] = text.split(" ");
  const sender = msg.key.participant || msg.key.remoteJid;
  const from = msg.key.remoteJid;

  const reply = (t) =>
    sock.sendMessage(from, { text: t }, { quoted: msg });

  // ---------- chnal.link <jid or link> ----------
  if (cmd === "chnal.link") {
    const input = args[0];
    if (!input) return reply("Usage: chnal.link <channel jid or link>");
    let jid, meta;
    const ref = extractChannelRef(input);
    if (!ref) return reply("❌ Invalid channel jid or link");
    if (ref.jid) {
      jid = ref.jid;
      meta = await sock.newsletterMetadata("jid", jid).catch(() => null);
    } else {
      meta = await sock.newsletterMetadataByInvite(ref.code).catch(() => null);
    }
    if (!meta) return reply("❌ Couldn't fetch channel metadata");
    if (meta.id) jid = meta.id;
    const link = meta.inviteCode
      ? `https://whatsapp.com/channel/${meta.inviteCode}`
      : "⚠️ No invite code available for this channel";
    return reply(
      `📢 *Channel Info*\n` +
      `Name: ${meta.name || meta.subject || "Unknown"}\n` +
      `JID: ${jid}\n` +
      `Link: ${link}\n` +
      `Followers: ${meta.subscribers || meta.subscribersCount || "?"}`
    );
  }

  // ---------- chnal.react <channel link/jid> [emoji] ----------
  if (cmd === "chnal.react") {
    const input = args[0];
    const emoji = args[1] || "❤️";
    if (!input) return reply("Usage: chnal.react <channel jid or link> [emoji]\nEmoji defaults to ❤️. Use 'off' instead of channel to disable.");

    if (input.toLowerCase() === "off") {
      const cfg = loadConfig();
      if (cfg.channels[from]) {
        delete cfg.channels[from];
        saveConfig(cfg);
        return reply("✅ Auto-react disabled for this chat");
      }
      return reply("ℹ️ Auto-react wasn't enabled here");
    }

    const jid = await resolveJid(sock, input);
    if (!jid) return reply("❌ Couldn't resolve that channel");

    const cfg = loadConfig();
    cfg.channels[from] = { targetJid: jid, emoji, enabled: true };
    saveConfig(cfg);
    return reply(`✅ Auto-react enabled on channel\nEmoji: ${emoji}`);
  }

  // ---------- chfallow <channel link/jid> <count> ----------
  if (cmd === "chfallow") {
    const input = args[0];
    const countArg = args[1] || "50";
    if (!input) return reply("Usage: chfallow <channel jid or link> <count>\nCount: 1k, 2k, 500, etc.");

    const jid = await resolveJid(sock, input);
    if (!jid) return reply("❌ Couldn't resolve that channel");

    let count = parseInt(countArg.toLowerCase().replace("k", "000"));
    if (isNaN(count) || count < 1) count = 50;
    if (count > 5000) count = 5000; // sanity cap

    await reply(`⏳ Following channel & backfilling reactions to ~${count} posts...`);

    try {
      // Follow the channel
      await sock.newsletterFollow(jid);
    } catch (e) {
      console.error("[channels] follow failed:", e.message);
    }

    // Fetch recent messages for backfill
    let reacted = 0;
    try {
      const result = await sock.fetchMessagesFromNewsletter(jid, count, "newsletters");
      const msgs = result?.messages || [];
      const emoji = loadConfig().channels[from]?.emoji || "❤️";
      for (const m of msgs) {
        const id = m?.key?.id;
        if (!id) continue;
        try {
          await sock.newsletterReaction(jid, id, emoji);
          reacted++;
          await sleep(REACT_DELAY);
        } catch (e) {
          // Skip failures (already reacted, deleted post, etc.)
        }
      }
    } catch (e) {
      console.error("[channels] backfill failed:", e.message);
      return reply(
        `✅ Followed channel!\n⚠️ Backfill reaction failed: ${e.message}\n` +
        `Note: fetchMessagesFromNewsletter may not return history on all Baileys versions. Auto-react will still work on NEW posts if enabled with chnal.react.`
      );
    }

    return reply(`✅ Done!\n📡 Followed channel\n💬 Reacted to ${reacted} posts`);
  }

  // ---------- chnal.emoji <channel link/jid> 😀,😂,❤️ ----------
  if (cmd === "chnal.emoji") {
    const input = args[0];
    if (!input) return reply("Usage: chnal.emoji <channel jid or link> 😀,😂,❤️\nRequires bot to be channel admin. 1-8 emojis, comma separated.");

    // Emojis = everything after the channel ref
    const rest = text.slice(text.indexOf(cmd) + cmd.length).trim();
    const emojiPart = rest.replace(input, "").trim();
    const emojis = emojiPart.split(",").map((e) => e.trim()).filter(Boolean);

    if (emojis.length < 1 || emojis.length > 8) {
      return reply("❌ Provide 1-8 emojis, comma separated\nExample: chnal.emoji <link> 😀,😂,❤️");
    }

    const jid = await resolveJid(sock, input);
    if (!jid) return reply("❌ Couldn't resolve that channel");

    try {
      await sock.newsletterUpdateEmojiReactions(jid, emojis);
      return reply("✅ Channel emoji pack updated: " + emojis.join(" "));
    } catch (e) {
      return reply(`❌ Failed to update emoji pack: ${e.message}\nMake sure the bot is admin on that channel.`);
    }
  }

  return false; // Not our command
};

// Called for every incoming message (via handleBackgroundPlugins in index.js)
const handleMessage = async (sock, msg) => {
  const cfg = loadConfig();
  const from = msg.key.remoteJid;
  const rules = cfg.channels[from];
  if (!rules?.enabled) return;

  // Only react to posts from the target channel
  if (msg.key.remoteJid !== rules.targetJid) return;
  const id = msg?.key?.id;
  if (!id) return;

  try {
    await sock.newsletterReaction(rules.targetJid, id, rules.emoji);
  } catch (e) {
    console.error("[channels] auto-react failed:", e.message);
  }
};

module.exports = { command, handleMessage, commands: ["chnal.link", "chnal.react", "chfallow", "chnal.emoji"] };