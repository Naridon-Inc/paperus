/**
 * Feature flags for the open-source, local-first build of Notionless.
 *
 * The app works 100% locally with no account. Anything that depends on a
 * hosted SaaS backend is optional and can be toggled here. Self-hosters /
 * forks can flip these without touching call sites.
 *
 * Overridable at build time via Vite env vars (VITE_FEATURE_*).
 */
function envFlag(name, fallback) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      const v = import.meta.env[name];
      if (v === 'true' || v === '1') return true;
      if (v === 'false' || v === '0') return false;
    }
  } catch (e) { /* import.meta unavailable */ }
  return fallback;
}

export const Features = {
  // Zero-account, pure-P2P teams: install → create team → share one link →
  // teammates join instantly with a local username+password (no server account).
  // This is the only collaboration model in the open-source build.
  p2pTeams: envFlag('VITE_FEATURE_P2P_TEAMS', true),

  // Sandboxed plugin system (iframe-isolated, capability-gated). Lets third-party
  // plugins extend the editor/sidebar/AI/auth surfaces without touching the host.
  // Defaults on; everything behind it is defensive and try/catch-wrapped so a
  // broken or missing plugin can never prevent the app from starting.
  plugins: envFlag('VITE_FEATURE_PLUGINS', true),

  // Plugin Studio: the agentic, multi-harness, UI-based plugin BUILDER that
  // graduates the single-shot "Generate with Claude" box. Author-time only,
  // consent-gated, and OFF by default. When off, registerStudioIpc is never
  // invoked (no studio:* channels) and the Studio view/button stay hidden.
  // See docs/PLUGIN_STUDIO_CONTRACT.md.
  pluginStudio: envFlag('VITE_FEATURE_PLUGINS_STUDIO', false),

  // ── Removed in the open-source, local-first build ───────────────────────────
  // Everything below is a hosted-SaaS skin (accounts, billing, cloud DB). It is
  // hard-disabled here and recoverable from git history. Call sites should be
  // migrating off these flags onto `p2pTeams`.

  // SaaS subscription billing (Stripe).
  billing: false,

  // WebAuthn / passkey login (required a server account).
  passkeys: false,

  // Account-based cloud teamspaces — superseded by P2P teams.
  teams: false,

  // Server-mediated, DB-persisted cloud sync — superseded by pure P2P.
  cloudSync: false,

  // Hosted-account identity providers (server account + OAuth).
  googleAuth: false,
  githubAuth: false,
};
