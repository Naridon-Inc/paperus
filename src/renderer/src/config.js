// Runtime-resolvable configuration. Resolution order for every value:
//   1. window.__NL_CONFIG[KEY]  — a deploy-time override the host can inject WITHOUT
//      rebuilding (the self-host web image writes this from env at container start),
//   2. Vite build-time env (VITE_*),
//   3. for the relay URL: the page's OWN origin (so one web image works on any
//      self-host domain — wss://<your-host>/signaling),
//   4. a sensible default (the official oss.naridon.com relay).
//
// This is what lets a self-hoster run the web app on `notes.example.com` and have
// it talk to their own relay at the same origin, with zero rebuild and no config
// files — just `docker compose up`.

function rt(key) {
  return (typeof window !== 'undefined' && window.__NL_CONFIG && window.__NL_CONFIG[key]) || undefined;
}
function viteEnv(key) {
  return (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) || undefined;
}
function lsGet(key) {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(key)) || undefined;
  } catch (_e) { return undefined; }
}

// A team can point the WHOLE app at THEIR OWN self-hosted server at runtime —
// with NO rebuild and on EVERY platform, including the Electron desktop app (the
// build-time VITE_* vars and the web-only window.__NL_CONFIG can't reach desktop
// users). The team server is a single base URL (e.g. `https://team.acme.com`);
// both the WebRTC signaling path (`/signaling`) and the optional always-on relay
// path (`/yjs`) hang off it. Stored in localStorage by server-config.js so this
// stays synchronous — providers read these getters during construction. Until a
// team sets it, everything falls back to Naridon's free oss.naridon.com relay.
function teamServerBase() {
  let v = lsGet('notionless_server_url');
  if (!v) return undefined;
  v = String(v).trim().replace(/\/+$/, '');
  if (!v) return undefined;
  // Accept http(s):// or ws(s):// and normalize to a realtime-socket scheme.
  if (/^https:\/\//i.test(v)) v = v.replace(/^https/i, 'wss');
  else if (/^http:\/\//i.test(v)) v = v.replace(/^http/i, 'ws');
  else if (!/^wss?:\/\//i.test(v)) v = `wss://${v}`; // bare host → assume TLS
  return v;
}
// True when running as a real web app (served over http/https on a non-localhost
// host). False in Electron (custom protocol) and on localhost dev.
function isDeployedWeb() {
  return typeof window !== 'undefined' && window.location
    && /^https?:$/.test(window.location.protocol)
    && window.location.hostname !== 'localhost'
    && window.location.hostname !== '127.0.0.1';
}
function sameOriginWs(pathname) {
  if (!isDeployedWeb()) return undefined;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${pathname}`;
}

export const Config = {
  // Invite deep link. `notionless://invite#team=…` opens the installed desktop
  // app; the secret rides in the URL fragment and never reaches a server.
  get APP_DEEP_LINK() {
    return rt('APP_DEEP_LINK') || viteEnv('VITE_APP_DEEP_LINK') || 'notionless://invite';
  },

  // Where teammates without the app go to install it.
  get DOWNLOAD_URL() {
    return rt('DOWNLOAD_URL') || viteEnv('VITE_DOWNLOAD_URL')
      || 'https://github.com/Naridon-Inc/paperus/releases/latest';
  },

  // WebRTC signaling relay. Brokers peer connections; stores nothing — it sees
  // only BLAKE2b-hashed room names and E2EE ciphertext. On a deployed web app it
  // defaults to the page's own origin (/signaling), so a self-hosted bundle needs
  // no relay URL configured. p2p.js still adds the local :4444 server on localhost.
  get SIGNALING_URL() {
    // Runtime team-server override wins on EVERY platform (incl. desktop), so a
    // team can broker peers through their OWN relay with no rebuild. An explicit
    // per-key override still trumps it for advanced setups.
    const explicit = lsGet('notionless_signaling_url');
    if (explicit) return explicit;
    const base = teamServerBase();
    if (base) return `${base}/signaling`;
    return rt('SIGNALING_URL') || viteEnv('VITE_SIGNALING_URL')
      || sameOriginWs('/signaling') || 'wss://oss.naridon.com/signaling';
  },

  // OPTIONAL self-hosted "always-on" cloud sync. Empty by default → pure P2P
  // (notes sync only while ≥1 teammate is online). Set it (or inject
  // __NL_CONFIG.CLOUD_SYNC_URL = "/yjs" from the self-host bundle) and the app ALSO
  // mirrors each note's ENCRYPTED transport doc to your box, so the latest state is
  // always available even when everyone's laptop is closed. The box only ever sees
  // hashed room names and ciphertext. See docs/SELF_HOSTED_SYNC.md.
  get CLOUD_SYNC_URL() {
    // A team server exposes an always-on encrypted relay at `/yjs`, so deriving
    // it from the same base means "connect to your team's server" also turns on
    // 24/7 availability in one step. (p2p.js still honors the per-client
    // `notionless_cloud_sync_disabled` opt-out, so a user can drop back to pure
    // P2P without leaving their team's signaling relay.) Explicit env wins.
    const explicit = rt('CLOUD_SYNC_URL') || viteEnv('VITE_CLOUD_SYNC_URL') || '';
    const base = teamServerBase();
    const v = explicit || (base ? `${base}/yjs` : '');
    // Allow a relative "/yjs" override to resolve against the current origin.
    if (v && v.startsWith('/')) return sameOriginWs(v) || '';
    return v;
  },

  // Local-first: default to a self-hosted relay/sync server on localhost. On a
  // deployed web app, the same origin serves the API.
  get DEFAULT_API_URL() {
    return rt('API_URL') || viteEnv('VITE_API_URL') || 'http://localhost:9008';
  },

  async getApiUrl() {
    // If the web build is served from the same origin as the relay, use it.
    if (isDeployedWeb()) return window.location.origin;
    // Check for user-configured API URL (desktop app settings)
    if (typeof window !== 'undefined' && window.api && window.api.getSettings) {
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
