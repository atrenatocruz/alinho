# WhatsApp group bot

Always-on Node process that posts padel mix rosters into a WhatsApp group and lets players reply `In`/`Out` to book/release a spot. Talks to the same Supabase project as the main app, using the service-role key (bypasses RLS — keep it secret, never commit it, never put it in a `VITE_`-prefixed var).

Uses [Baileys](https://github.com/WhiskeySockets/Baileys), an unofficial library that logs in as a real WhatsApp Web device — this is the only way to participate in a group thread (Meta's official Cloud API is 1:1-only and cannot post to or read from groups). Use a spare/secondary phone number for the linked account, not a personal one.

See the root [`README.md`](../README.md) / [`DEPLOYMENT.md`](../DEPLOYMENT.md) for how this fits into the rest of the app. This file covers the bot itself: run it locally, or deploy it (Fly.io or AWS EC2), scan the pairing QR, and configure the target group JID.

## Local development

```bash
cd whatsapp-bot
npm install
cp .env.example .env   # fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
npm start
```

On first run it prints a QR code in the terminal — scan it with the bot's WhatsApp (Linked devices). The session is saved to `./baileys-auth/` (gitignored) so you don't need to rescan on every restart.

Once connected, it logs every group the account is in, with its JID — copy the target group's JID into `settings.whatsapp_group_jid` in Supabase.

## Deploying to Fly.io

```bash
fly launch --no-deploy          # creates the app, uses fly.toml
fly volumes create wa_session --size 1
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
fly deploy
fly logs                        # scan the QR shown here (one-time)
```

The Fly volume at `/data` is required — without it, Baileys' session is wiped on every redeploy and you'd have to rescan the QR each time.

## Deploying to AWS EC2 (free tier, 12 months for new accounts)

Any small instance works — `t2.micro`/`t3.micro` (free-tier eligible), Ubuntu or Amazon Linux. The `Dockerfile` here isn't Fly-specific, it's a normal Docker image — only `fly.toml` above is Fly-only and can be ignored for this path.

1. **Launch the instance** (EC2 → Launch instance, free-tier-eligible type). No inbound ports need opening — the bot never receives traffic from the internet, it only makes outbound connections (to WhatsApp and Supabase) — so the default security group (SSH only, from your IP) is enough.

2. **SSH in and install Docker:**
   ```bash
   ssh -i your-key.pem ubuntu@<instance-ip>
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # log out and back in after this
   ```

3. **Get the code onto the instance** (clone the repo, or just this folder if it's been split into its own repo) and `cd whatsapp-bot`.

4. **Create `.env`** on the instance — never commit this file:
   ```bash
   cp .env.example .env
   nano .env   # fill in SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
   ```

5. **Build and run it, auto-restarting on crash or instance reboot:**
   ```bash
   docker build -t alinho-wa-bot .
   docker run -d --name alinho-wa-bot \
     --restart unless-stopped \
     --env-file .env \
     -v $(pwd)/baileys-auth:/app/baileys-auth \
     alinho-wa-bot
   ```
   The `-v` mount persists the WhatsApp session on the instance's own disk. Unlike Fly.io, no extra "volume" setup is needed — EC2's root EBS disk is already persistent across reboots by default.

6. **Scan the pairing QR** (one-time):
   ```bash
   docker logs -f alinho-wa-bot
   ```
   Scan it with the bot's WhatsApp (Linked devices), then Ctrl+C — the container keeps running in the background regardless.

`--restart unless-stopped` covers both crash recovery and instance reboots automatically (Docker's own service starts on boot and restarts anything with that flag) — no extra systemd setup needed.
