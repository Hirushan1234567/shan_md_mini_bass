// sticker.js - For whatsapp-mini-bot-v1
// Compatible with your index.js

const { Sticker, StickerTypes } = require('wa-sticker-formatter');

module.exports = {
    name: 'sticker',
    alias: ['s', 'stiker'],
    description: 'Photo to Sticker',
    category: 'fun',
    
    async execute(sock, m, args) {
        try {
            const quoted = m.quoted || m;
            const mime = (quoted.msg || quoted).mimetype || '';
            
            if (!/image|video/.test(mime)) {
                return await sock.sendMessage(m.chat, { 
                    text: '❌ *Image එකක් Reply කරලා .sticker ගහන්න මචන්!*\n\n_Example: .sticker_' 
                }, { quoted: m });
            }

            // React
            await sock.sendMessage(m.chat, { react: { text: '⏳', key: m.key } });

            let media = await quoted.download();
            
            const sticker = new Sticker(media, {
                pack: 'Cyber Kaviya',
                author: 'Mini Bot v1',
                type: StickerTypes.FULL,
                quality: 70,
            });

            const buffer = await sticker.toBuffer();
            
            await sock.sendMessage(m.chat, { sticker: buffer }, { quoted: m });
            await sock.sendMessage(m.chat, { react: { text: '✅', key: m.key } });

        } catch (e) {
            console.log('Sticker Error:', e);
            await sock.sendMessage(m.chat, { 
                text: '❌ *Error එකක් ආවා මචන්!*\n' + e.message 
            }, { quoted: m });
        }
    }
};