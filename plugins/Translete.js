// SHAN MINI BOT — Translate plugin (ES Module compatible)
export default {
  name: "translate",
  command: "translate",
  commands: ["translate", "tr", "trans"],
  alias: ["tr", "trans"],
  description: "Translate text",
  category: "fun",
  async execute(sock, msg, args) {
    const jid = msg?.key?.remoteJid;
    if (!jid) return false;
    const reply = text => sock.sendMessage(jid, { text }, { quoted: msg });
    try {
      const input = (Array.isArray(args) ? args : []).join(" ").trim();
      if (!input) return reply("Text ekak danna! Example: .tr si Hello");
      let lang = "en";
      let query = input;
      const parts = input.split(/\s+/);
      if (parts.length > 1 && /^[a-z]{2,3}$/i.test(parts[0])) {
        lang = parts[0].toLowerCase();
        query = parts.slice(1).join(" ");
      }
      const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" +
        encodeURIComponent(lang) + "&dt=t&q=" + encodeURIComponent(query);
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("Translation service HTTP " + response.status);
      const data = await response.json();
      const translated = Array.isArray(data?.[0]) ? data[0].map(x => x?.[0] || "").join("") : "";
      if (!translated) throw new Error("Translation response was empty");
      return reply("🌐 Translated (" + lang + "):\n" + translated);
    } catch (error) {
      console.error("Translate Error:", error);
      return reply("❌ Translate error: " + (error?.message || error));
    }
  }
};
