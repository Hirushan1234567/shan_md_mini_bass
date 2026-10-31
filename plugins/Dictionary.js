import axios from "axios";

export default {
  command: "dictionary",
  aliases: ["define", "meaning"],
  category: "utility",
  description: "Find English word definitions",

  async execute(sock, msg, args) {
    const jid = msg.key.remoteJid;

    try {
      const word = args.join(" ").trim();

      if (!word || !/^[a-zA-Z -]+$/.test(word)) {
        return sock.sendMessage(jid, {
          text: "Usage: .dictionary <English word>\nExample: .dictionary beautiful"
        }, { quoted: msg });
      }

      const response = await axios.get(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        { timeout: 15000 }
      );

      const entry = response.data[0];

      let output = `📚 *DICTIONARY*\n\n🔤 Word: ${entry.word}\n`;

      const phonetic = entry.phonetic ||
        entry.phonetics?.find(p => p.text)?.text;

      if (phonetic) {
        output += `🔊 Pronunciation: ${phonetic}\n`;
      }

      output += "\n";

      let count = 0;

      for (const meaning of entry.meanings || []) {
        for (const definition of meaning.definitions || []) {
          output +=
            `📖 *${meaning.partOfSpeech}*\n` +
            `${definition.definition}\n`;

          if (definition.example) {
            output += `💬 Example: ${definition.example}\n`;
          }

          output += "\n";

          count++;

          if (count >= 4) break;
        }

        if (count >= 4) break;
      }

      await sock.sendMessage(jid, {
        text: output.trim()
      }, { quoted: msg });

    } catch (error) {
      console.error("[dictionary]", error.message);

      await sock.sendMessage(jid, {
        text: "❌ Word not found or the dictionary service is unavailable."
      }, { quoted: msg });
    }
  }
};