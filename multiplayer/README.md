# Multiplayer Relay (Cloudflare Workers Free Plan)

This tiny, zero-dependency Cloudflare Worker + SQLite Durable Object uses the **WebSocket Hibernation API**:
- **Free forever** on the Cloudflare Workers Free plan (no 7-day project pausing, zero idle charges while hibernating, ~2M incoming WS messages/day free at the 20:1 ratio, outgoing broadcasts are free).
- **Scales cleanly** to 40+ concurrent cats in the meadow.
- **Automatic inactivity cleanup:** Both client and server disconnect idle cats after 2 minutes of inactivity (and reconnect automatically as soon as the user moves or clicks again).

## Deploy in 60 seconds

1. Log in to Cloudflare (free account):
   ```bash
   cd multiplayer
   npx wrangler login
   ```
2. Deploy the Worker + Durable Object:
   ```bash
   npx wrangler deploy
   ```
   Wrangler will print your live URL, e.g. `https://matthew-cat-meadow.<your-subdomain>.workers.dev`.
3. Paste `wss://matthew-cat-meadow.<your-subdomain>.workers.dev/ws` into `DEFAULT_WS_URL` at the top of `js/multiplayer.js` (and bump `?v=` in `index.html`), then push to GitHub Pages.
