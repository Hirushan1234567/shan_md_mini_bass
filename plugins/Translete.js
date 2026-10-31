// translate.js - For whatsapp-mini-bot-v1
// No npm install needed

module.exports = {
    name: 'translate',
    alias: ['tr', 'trans'],
    description: 'Translate Text',
    category: 'fun',

    async execute(sock, m, args) {
        try {
            let text = args.join(' ');
            if (!text) {
                return await sock.sendMessage(m.chat, {
                    text: 'Text ekak danna machan! Example: .tr en Hello machan'
                }, { quoted: m });
            }

            // .tr si Hello -> si = sinhala, en = english
            let lang = 'en';
            let q = text;

            const parts = text.split(' ');
            if (parts.length > 1 && parts[0].length === 2) {
                lang = parts[0];
                q = parts.slice(1).join(' ');
            }

            const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' + lang + '&dt=t&q=' + encodeURIComponent(q);
            const res = await fetch(url);
            const data = await res.json();
            const translated = data[0][0][0];

            let msg = 'Translated to ' + lang + ': ' + translated;
            await sock.sendMessage(m.chat, { text: msg }, { quoted: m });

        } catch (e) {
            console.log('Translate Error:', e);
            await sock.sendMessage(m.chat, {
                text: 'Error ekak awa machan! ' + e.message
            }, { quoted: m });
        }
    }
};