import axios from "axios";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const API_URL = process.env.PINTEREST_API_URL || "";
const TMP_DIR = path.join(process.cwd(), "tmp");

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

const plugin = {
  name: "pinterest",
  command: ["pinterest", "pin"],
  category: "downloader",
  description: "Download Pinterest videos",
  usage: ".pinterest <Pinterest URL>",
  react: "📥",

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;
    const url = args.join(" ").trim();

    if (!url) {
      return sock.sendMessage(
        jid,
        {
          text: "❌ Please provide a Pinterest video URL.\n\nExample: .pinterest https://pin.it/example"
        },
        { quoted: msg }
      );
    }

    if (!/^https?:\/\/(www\.)?(pinterest\.[a-z.]+|pin\.it)\//i.test(url)) {
      return sock.sendMessage(
        jid,
        { text: "❌ Invalid Pinterest URL." },
        { quoted: msg }
      );
    }

    if (!API_URL) {
      return sock.sendMessage(
        jid,
        { text: "❌ Pinterest API is not configured. Set PINTEREST_API_URL in your .env file." },
        { quoted: msg }
      );
    }

    let filePath;

    try {
      await sock.sendMessage(
        jid,
        { text: "⏳ Downloading Pinterest video..." },
        { quoted: msg }
      );

      const response = await axios.get(API_URL, {
        params: { url },
        timeout: 30000,
        headers: {
          Accept: "application/json"
        }
      });

      const data = response.data;

      const videoUrl =
        data?.video_url ||
        data?.video ||
        data?.download_url ||
        data?.data?.video_url ||
        data?.data?.url;

      if (!videoUrl) {
        throw new Error("No downloadable video found in API response.");
      }

      const videoResponse = await axios.get(videoUrl, {
        responseType: "arraybuffer",
        timeout: 120000,
        maxContentLength: 100 * 1024 * 1024,
        maxBodyLength: 100 * 1024 * 1024
      });

      const buffer = Buffer.from(videoResponse.data);

      if (!buffer.length) {
        throw new Error("Downloaded file is empty.");
      }

      filePath = path.join(TMP_DIR, `${randomUUID()}.mp4`);

      fs.writeFileSync(filePath, buffer);

      await sock.sendMessage(
        jid,
        {
          video: fs.readFileSync(filePath),
          mimetype: "video/mp4",
          caption: "💠 *SHAN MINI BOT V1*\n\n✅ Pinterest video downloaded."
        },
        { quoted: msg }
      );

    } catch (error) {
      console.error("[PINTEREST]", error.message);

      await sock.sendMessage(
        jid,
        {
          text: "❌ Pinterest download failed.\n\nThe video may be private, unavailable, or unsupported by the API."
        },
        { quoted: msg }
      );

    } finally {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }
};

export default plugin;