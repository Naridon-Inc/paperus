/**
 * brain-service-logos.js — small inline-SVG marks for the AI backends the Company
 * Brain can use, so the chip/setup show the *actual service* (Claude, Gemini,
 * OpenAI, Ollama, …) instead of a generic coloured dot.
 *
 * Each logo is a self-contained 24×24 SVG string (brand-coloured). Returned as a
 * string so callers can drop it straight into innerHTML; size via CSS on the
 * `.brain-svc-logo` class.
 */

const wrap = (inner) => `<svg class="brain-svc-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">${inner}</svg>`

const LOGOS = {
  // Anthropic / Claude — the clay-orange radiating sunburst.
  claude: wrap('<g stroke="#D97757" stroke-width="2" stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="5.5" y1="5.5" x2="18.5" y2="18.5"/><line x1="18.5" y1="5.5" x2="5.5" y2="18.5"/><line x1="12" y1="4.2" x2="12" y2="4.2"/></g>'),

  // Google Gemini — the four-point sparkle.
  gemini: wrap('<path fill="#4285F4" d="M12 2c.4 5.3 4.3 9.2 10 10-5.7.8-9.6 4.7-10 10-.4-5.3-4.3-9.2-10-10 5.7-.8 9.6-4.7 10-10z"/>'),

  // OpenAI — the six-lobed knot (rosette approximation), brand teal.
  openai: wrap('<g fill="none" stroke="#10A37F" stroke-width="1.7"><ellipse cx="12" cy="12" rx="3.1" ry="8"/><ellipse cx="12" cy="12" rx="3.1" ry="8" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="3.1" ry="8" transform="rotate(120 12 12)"/></g>'),

  // Ollama / on-your-computer — a CPU/chip mark (local compute).
  ollama: wrap('<g fill="none" stroke="#111" stroke-width="1.7" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="2"/><rect x="10" y="10" width="4" height="4" rx="1" fill="#111" stroke="none"/><g stroke-linecap="round"><line x1="9.5" y1="4" x2="9.5" y2="6.5"/><line x1="14.5" y1="4" x2="14.5" y2="6.5"/><line x1="9.5" y1="17.5" x2="9.5" y2="20"/><line x1="14.5" y1="17.5" x2="14.5" y2="20"/><line x1="4" y1="9.5" x2="6.5" y2="9.5"/><line x1="4" y1="14.5" x2="6.5" y2="14.5"/><line x1="17.5" y1="9.5" x2="20" y2="9.5"/><line x1="17.5" y1="14.5" x2="20" y2="14.5"/></g></g>'),

  // OpenRouter — a routing node (indigo).
  openrouter: wrap('<g fill="none" stroke="#6467F2" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6.5" r="2.2"/><circle cx="18" cy="17.5" r="2.2"/><line x1="8" y1="11" x2="16" y2="7.5"/><line x1="8" y1="13" x2="16" y2="16.5"/></g>'),

  // Generic coding agent (CLI) — a terminal prompt.
  agent: wrap('<g fill="none" stroke="#333" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 10l3 2.5L7 15"/><line x1="12.5" y1="15" x2="16" y2="15"/></g>'),

  // Fallback for an unknown/custom service.
  service: wrap('<g fill="none" stroke="#6b7280" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 4v2.5M12 17.5V20M4 12h2.5M17.5 12H20M6.3 6.3l1.8 1.8M15.9 15.9l1.8 1.8M17.7 6.3l-1.8 1.8M8.1 15.9l-1.8 1.8"/></g>'),
}

/**
 * @param {string} kind one of: claude, gemini, openai, ollama, openrouter, agent, service
 * @returns {string} inline SVG markup
 */
export function serviceLogo(kind) {
  return LOGOS[kind] || LOGOS.service
}

export default serviceLogo
