/**
 * config.ts — runtime config for the native app.
 *
 * Hermes has no `import.meta.env`, so the desktop's `VITE_SIGNALING_URL` plumbing
 * doesn't exist here — signaling targets are plain constants the UI can override.
 *
 * Relay-matching (this is what decides whether phone and desktop can find each
 * other on the same y-webrtc topic):
 *   • iOS SIMULATOR + desktop `pnpm run dev`  → both reach ws://localhost:4444
 *     (the sim shares the Mac's loopback; the dev desktop renderer is `isLocalDev`
 *     so it uses ONLY ws://localhost:4444, never prod). This is the clean rig.
 *   • PHYSICAL phone + packaged desktop        → both use the prod relay
 *     wss://oss.naridon.com/signaling. (localhost on a real phone is the phone
 *     itself — that entry just fails silently and prod carries the connection.)
 *
 * Listing both is safe: y-webrtc dials every signaling server and peers meet on
 * any shared one. The field is editable in the UI so a physical-phone test can
 * point at the Mac's LAN IP (ws://<mac-ip>:4444) if desired.
 */
export const SIGNALING_LOCAL = 'ws://localhost:4444';
export const SIGNALING_PROD = 'wss://oss.naridon.com/signaling';

/** Default shown in the connect screen. Comma-separated; trimmed + split on use. */
export const DEFAULT_SIGNALING = `${SIGNALING_LOCAL}, ${SIGNALING_PROD}`;

/** ICE servers for WebRTC peer connections (helps a physical phone behind NAT). */
export const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export function parseSignalingList(input: string): string[] {
  return String(input || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
