# SHAN MINI BOT — VPS Pair API setup

The pairing page now proxies pair-code requests to this persistent VPS service. Keep the existing `shan-mini-bass` process running; this is a separate PM2 process.

## 1. VPS environment

In `/opt/shan_md_mini_bass/.env`, add these as separate lines (do not join them to another variable):

```env
PAIR_PORT=3010
PAIR_API_SECRET=PASTE_THE_SAME_LONG_RANDOM_SECRET_HERE
PAIR_SITE_COLLECTION=pair_sessions
```

Use a long random secret. Set the exact same value in the Vercel project as `PAIR_API_SECRET`. Do not put the secret in frontend code or commit it.

## 2. Start the pairing service

```bash
cd /opt/shan_md_mini_bass
git pull origin main
npm install
pm2 start pair-server.js --name shan-pair-api
pm2 save
pm2 status
```

The service listens only on `127.0.0.1:3010`; expose it through the existing HTTPS Nginx virtual host, not by opening port 3010 publicly.

## 3. Nginx reverse proxy

Add this location inside the existing HTTPS `server { ... }` block for the VPS domain:

```nginx
location ^~ /pair-api/ {
    rewrite ^/pair-api/(.*)$ /$1 break;
    proxy_pass http://127.0.0.1:3010;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 240s;
    proxy_send_timeout 240s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

Then validate and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Check that `https://YOUR-VPS-DOMAIN/pair-api/health` returns JSON with `"ok":true`.

## 4. Vercel environment

In the Pair Website Vercel project, add these environment variables for Production (and Preview if you test preview deployments):

```env
PAIR_API_URL=https://YOUR-VPS-DOMAIN/pair-api
PAIR_API_SECRET=THE_EXACT_SAME_SECRET_AS_THE_VPS
```

Redeploy the Pair Website after saving the variables.

## Notes

- Keep `MONGODB_URI` and `PAIR_SITE_COLLECTION=pair_sessions` consistent with the existing bot.
- The VPS bot's existing session directory and PM2 process are not deleted or overwritten by this pairing service.
- This service saves the paired auth files into the existing `pair_sessions` MongoDB collection. The existing bot watcher then picks up the configured main pairing number.
- The current bot backend has one main-session watcher; this setup does not automatically create independent running bot instances for every arbitrary visitor number.
