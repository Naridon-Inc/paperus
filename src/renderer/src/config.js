export const Config = {
  // Notionless is a desktop (Mac) app only — there is no hosted web app. Invite
  // links are `notionless://invite#team=…` deep links that open the installed
  // desktop app directly; the secret rides in the URL fragment, so it never
  // reaches any server. p2p.js builds team/note links from this scheme.
  APP_DEEP_LINK:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_APP_DEEP_LINK) ||
    'notionless://invite',

  // Where teammates who don't have the app yet go to install it.
  // Open source under the Naridon-Inc org.
  DOWNLOAD_URL:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DOWNLOAD_URL) ||
    'https://github.com/Naridon-Inc/notionless/releases/latest',

  // WebRTC signaling relay (the only server, and the only thing hosted at
  // oss.naridon.com). Brokers peer connections; stores nothing — it sees only
  // BLAKE2b-hashed room names and E2EE ciphertext. p2p.js ignores this on
  // localhost dev (uses the local :4444 server instead). Override with
  // VITE_SIGNALING_URL for a self-hosted relay.
  SIGNALING_URL:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SIGNALING_URL) ||
    'wss://oss.naridon.com/signaling',

  // OPTIONAL self-hosted "always-on" cloud sync. Empty by default → pure P2P
  // (notes sync only while ≥1 teammate is online). Point this at your own relay's
  // persisting Yjs endpoint (e.g. wss://notes.example.com/yjs) and the app ALSO
  // mirrors each note's ENCRYPTED transport doc there, so the latest state is
  // always available even when everyone's laptop is closed. The box only ever
  // sees BLAKE2b-hashed room names and E2EE ciphertext — no accounts, no keys,
  // no plaintext. See docs/SELF_HOSTED_SYNC.md. Override with VITE_CLOUD_SYNC_URL.
  CLOUD_SYNC_URL:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_CLOUD_SYNC_URL) ||
    '',

  // Local-first: default to a self-hosted relay/sync server on localhost.
  // Override via desktop settings (apiUrl) or VITE_API_URL for the web build.
  DEFAULT_API_URL:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_URL) ||
    'http://localhost:9008',

  async getApiUrl() {
    // If the web build is served from the same origin as the relay, use it.
    if (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http')
        && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        return window.location.origin;
    }
    // Check for user-configured API URL (desktop app settings)
    if (window.api && window.api.getSettings) {
        try {
            const custom = await window.api.getSettings('apiUrl');
            if (custom) return custom;
        } catch (e) {}
    }
    return this.DEFAULT_API_URL;
  },

  async setApiUrl(url) {
    if (!url) return;
    const normalized = url.replace(/\/$/, '');
    await window.api.setSettings('apiUrl', normalized);
  },

  async getWsUrl() {
    const apiUrl = await this.getApiUrl();
    return apiUrl.replace(/^http/, 'ws');
  }
}
