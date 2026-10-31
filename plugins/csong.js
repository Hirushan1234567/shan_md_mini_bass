// chsong2.js - post a song (styled card + voice-note audio) to a WhatsApp channel
// Usage:  .ch <channel link> <song name>      (search & post the song)
//         .ch <channel link> <youtube link>   (post that YouTube song)
//         .ch <channel link>                  (reply to a song/audio message)

import yts from 'yt-search';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const BOT_NAME = 'SHAN MINI BOT';
const JOIN_LINK = 'https://whatsapp.com/channel/0029Vb76aeC30LKFzqDBwR2A';

/* ------------------------------------------------------------------ *
 * 1) DOWNLOADER - put your working downloader here.
 *    Must return a Buffer of the audio (mp3/m4a/webm, anything ffmpeg reads).
 * ------------------------------------------------------------------ */
// ---- yt-dlp (auto-downloaded standalone binary, most reliable option) ----
// Optional: put a cookies.txt (exported from a browser, Netscape format) next to
// index.js - this is what gets past "Sign in to confirm you're not a bot".
const YTDLP = path.join(process.cwd(), 'yt-dlp');
const COOKIES = path.join(process.cwd(), 'cookies.txt');

async function ensureYtdlp() {
  if (fs.existsSync(YTDLP)) return;
  const r = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux');
  if (!r.ok) throw new Error('yt-dlp download failed: ' + r.status);
  fs.writeFileSync(YTDLP, Buffer.from(await r.arrayBuffer()), { mode: 0o755 });
}

async function ytdlpAudio(videoUrl) {
  await ensureYtdlp();
  const args = ['-f', 'bestaudio/best', '--no-playlist', '--js-runtimes', 'node', '-q', '-o', '-', videoUrl];
  if (fs.existsSync(COOKIES)) args.unshift('--cookies', COOKIES);
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, args);
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      const buf = Buffer.concat(out);
      code === 0 && buf.length > 50_000
        ? resolve(buf)
        : reject(new Error(err.trim().split('\n').pop() || 'yt-dlp exit ' + code));
    });
  });
}

// Public APIs tried in order (they come and go - edit/replace freely).
// Each is called as API + encodeURIComponent(videoUrl); the first
// mp3/audio URL found in the JSON reply is used.
const AUDIO_APIS = [
  'https://api.siputzx.my.id/api/d/ytmp3?url=',
  'https://api.ryzendesu.vip/api/downloader/ytmp3?url=',
  'https://api.agatz.xyz/api/ytmp3?url=',
];

function findAudioUrl(obj) {
  let found = null;
  const walk = (o) => {
    if (found || o == null) return;
    if (typeof o === 'string') {
      if (/^https?:\/\//.test(o) && /(mp3|m4a|audio|download|dl)/i.test(o)) found = o;
    } else if (typeof o === 'object') Object.values(o).forEach(walk);
  };
  walk(obj);
  return found;
}

async function downloadAudio(videoUrl) {
  const errors = [];

  // 1) yt-dlp
  try {
    return await ytdlpAudio(videoUrl);
  } catch (e) {
    errors.push('yt-dlp: ' + e.message);
  }

  // 2) third-party APIs
  for (const api of AUDIO_APIS) {
    try {
      const r = await fetch(api + encodeURIComponent(videoUrl), { signal: AbortSignal.timeout(45000) });
      const j = await r.json();
      const link = findAudioUrl(j);
      if (!link) throw new Error('no audio url in reply');
      const f = await fetch(link, { signal: AbortSignal.timeout(180000) });
      const buf = Buffer.from(await f.arrayBuffer());
      if (buf.length < 50_000) throw new Error('file too small');
      return buf;
    } catch (e) {
      errors.push(`${new URL(api).host}: ${e.message}`);
    }
  }

  throw new Error('All downloaders failed -> ' + errors.join(' | '));
}

/* ------------------------------------------------------------------ *
 * 2) Convert to OGG/Opus - the only audio format channels play properly
 * ------------------------------------------------------------------ */
function toOpus(input) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', 'pipe:0', '-vn',
      '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '1',
      '-f', 'ogg', 'pipe:1',
    ]);
    const out = [];
    ff.stdout.on('data', (d) => out.push(d));
    ff.on('error', reject);
    ff.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg failed: ' + code))
    );
    ff.stdin.on('error', () => {});
    ff.stdin.end(input);
  });
}

// fake waveform (64 bytes, 0-100) - needed for the voice-note look
const waveform = () =>
  new Uint8Array(Array.from({ length: 64 }, (_, i) => Math.round(30 + 60 * Math.abs(Math.sin(i / 4)))));

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function resolveChannel(sock, input) {
  input = (input || '').trim();
  let meta;
  if (input.endsWith('@newsletter')) {
    meta = await sock.newsletterMetadata('jid', input);
  } else {
    const m = input.match(/channel\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    meta = await sock.newsletterMetadata('invite', m[1]);
  }
  // role of the connected number in this channel
  let role = meta?.viewer_metadata?.role || meta?.viewer?.role;
  if (!role && meta?.id) {
    const again = await sock.newsletterMetadata('jid', meta.id).catch(() => null);
    role = again?.viewer_metadata?.role || again?.viewer?.role;
  }
  role = String(role || 'UNKNOWN').toUpperCase();
  return {
    jid: meta.id,
    name: meta.name || 'Channel',
    role,
    isAdmin: role === 'OWNER' || role === 'ADMIN',
  };
}

export default {
  name: 'ch',
  command: ['ch'],
  category: 'channel',
  desc: 'Post a song to a WhatsApp channel (owner/admin only)',

  async run({ sock, m, args, reply }) {
    const chat = m.key.remoteJid;
    const say = reply || ((t) => sock.sendMessage(chat, { text: t }, { quoted: m }));

    // first arg that looks like a channel link / JID, the rest is the song name
    const idx = args.findIndex((a) => /whatsapp\.com\/channel\//.test(a) || a.endsWith('@newsletter'));
    if (idx === -1)
      return say('Usage:\n.ch <channel link> <song name>\n.ch <channel link> <youtube link>\n.ch <channel link>  (reply to a song)');
    const chInput = args[idx];
    const ytArg = args.find((a, i) => i !== idx && /(youtu\.be\/|youtube\.com\/)/.test(a));
    const ytId = ytArg?.match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/)?.[1];
    const query = args.filter((a, i) => i !== idx && a !== ytArg).join(' ').trim();

    // quoted audio (if the user replied to a song)
    const ctx = m.message?.extendedTextMessage?.contextInfo;
    const quoted = ctx?.quotedMessage;
    const quotedAudio = quoted?.audioMessage;

    if (!query && !ytId && !quotedAudio)
      return say('Give a song name / YouTube link, or reply to an audio message.');

    try {
      const ch = await resolveChannel(sock, chInput);
      if (!ch) return say('Invalid channel link.');
      if (!ch.isAdmin)
        return say(`🚫 You are not an admin of *${ch.name}*.\nThe connected number must be the channel owner/admin to post there.`);

      let opus, secs = 0;

      if (query || ytId) {
        // ---- search by name: card + voice note ----
        await say('🔎 Searching...');
        const v = ytId ? await yts({ videoId: ytId }) : (await yts(query)).videos?.[0];
        if (!v) return say('Song not found.');
        v.thumbnail = v.thumbnail || v.image;

        await say(`⬇️ Downloading: ${v.title}`);
        opus = await toOpus(await downloadAudio(v.url));
        secs = v.seconds || 0;

        const caption =
          `┌──『 🎧 *MUSIC LOUNGE* 🎧 』──┐\n\n` +
          `🎵 *${v.title}*\n` +
          `🎤 ${v.author?.name || 'Unknown'}\n` +
          `⏱️ ${fmt(secs)}\n` +
          `📻 ${ch.name}\n\n` +
          `🎧 *FEEL THE BEAT* 🎹 *LIVE YOUR MUSIC* 💖\n` +
          `└──────────────────────────┘\n\n` +
          `📲 Join 👉 ${JOIN_LINK}\n\n` +
          `> ✨ Powered by ${BOT_NAME}`;
        await sock.sendMessage(ch.jid, { image: { url: v.thumbnail }, caption });
      } else {
        // ---- replied audio: just forward it as a voice note ----
        await say('⬇️ Processing audio...');
        const buf = await downloadMediaMessage(
          { key: { remoteJid: chat, id: ctx.stanzaId, participant: ctx.participant }, message: quoted },
          'buffer',
          {}
        );
        opus = await toOpus(buf);
        secs = quotedAudio.seconds || 0;
      }

      await sock.sendMessage(ch.jid, {
        audio: opus,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        seconds: secs,
        waveform: waveform(),
      });

      await say(`✅ Posted to *${ch.name}*`);
    } catch (e) {
      console.error('[ch]', e);
      await say('❌ Failed: ' + (e?.message || e));
    }
  },
};
