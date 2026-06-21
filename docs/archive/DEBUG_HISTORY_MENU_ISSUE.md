# Debug History: Shopify App Navigation Menu Issue

**Problem:** The Shopify App Bridge navigation menu does not appear in the Shopify Admin sidebar.
**Core Symptom:** `window.shopify` is `undefined`. Script is "Preloaded but not used".

---

## ❌ FAILED ATTEMPTS

### 1. UI Component Fixes
*   **Result:** Failed. DOM element exists but disconnected.

### 2. Manual URL Updates
*   **Result:** Fixed Env. URL now correct, but menu still missing.

### 3. Auth Route & Proxy Fixes
*   **Result:** Fixed Auth. 200 OK on auth routes, but script still blocked.

### 4. Clean Slate (AppProvider Only)
*   **Result:** Failed. `window.shopify` undefined.

### 5. Brute Force (Manual Script + Forced CSP)
*   **Result:** Failed. Script "Preloaded but not used".
*   **Why Failed:** Even with permissive CSP and manual HEAD script, browser refuses to execute CDN script.

### 6. Cache Clear + Restart
*   **Result:** Failed. Same issue persists.

### 7. Local Script (Patched)
*   **Attempt:**
    *   Downloaded `app-bridge.js` to `public/`.
    *   Patched validation to allow local hosting.
    *   Updated `root.tsx` to `src="/app-bridge.js"`.
*   **Result:** Failed. `window.shopify` still undefined.
*   **Error:** Logs still show CDN URL being preloaded (cache? Remix auto-injection?).

### 8. Meta Tag Approach
*   **Attempt:** Used `<meta name="shopify-api-key" content={apiKey} />` (official method).
*   **Result:** Failed. Same CDN preload issue.

### 9. **FULL TEMP APP REPLICATION (IN PROGRESS)**
*   **Approach:**
    *   Copied EXACT `root.tsx` from Temp App (minimal, no loader, no auth, no manual script).
    *   Copied EXACT `app.tsx` structure (NavMenu with Link components, not `<a>` tags).
    *   Reverted all CSP modifications in `entry.server.tsx`.
    *   Deleted local patched `app-bridge.js`.
    *   Cleared all caches (`.shopify`, `node_modules/.vite`, `build`).
*   **Hypothesis:** The Main App had too many custom modifications (loaders in root, manual scripts, CSP overrides) that conflicted with `@shopify/shopify-app-remix` defaults. Temp App works because it's pristine.
*   **Testing:** User to restart server and test.

### 10. Build Fix (Ghost Export)
*   **Issue:** `plugin:vite:esbuild` reported "Multiple exports with the same name 'ErrorBoundary'" at a line number beyond the file end, indicating a stale build cache.
*   **Fix:** Overwrote `app.tsx` and commented out `ErrorBoundary` to force cache invalidation and remove the conflict source.
*   **Next:** User to restart server.

### 11. Vite Config Cleanup
*   **Issue:** "Menu in DOM" indicates App Bridge not starting. Suspect `define` block in `vite.config.ts` hardcoding stale API key or interfering with client env.
*   **Fix:** Removed `define` block and `loadEnv` from `vite.config.ts` to match Temp App. Cleaned up `app.tsx`.
*   **Next:** User to restart server.

### 12. Current Status (Menu in DOM)
*   **Result:** App now renders (menu visible in DOM), but App Bridge connection failed (menu not in sidebar).
*   **Error:** Browser warning: "The resource ...app-bridge.js was preloaded ... but not used".
*   **Diagnosis:** App Bridge script is either missing from DOM or blocked from executing. Auto-injection via `AppProvider` seems to be failing or conflicting.
*   **Plan:** Force manual script injection in `root.tsx` to bypass `AppProvider` logic.

### 13. Isolation Test (Remove AppProvider)
*   **Hypothesis:** `@shopify/shopify-app-remix/react`'s `AppProvider` might be conflicting with the manual script injection or causing the "preloaded but not used" issue.
*   **Plan:** Temporarily remove `AppProvider` and `NavMenu` from `app.tsx`. Render raw HTML and check `window.shopify` availability.
*   **Goal:** Determine if the issue is with the Script Loading (Network/CSP) or the React Wrapper (Initialization).

### 14. Isolation Test 2 (Polaris AppProvider)
*   **Result:** Previous test crashed because child routes need Polaris context.
*   **Plan:** Use `@shopify/polaris`'s `AppProvider` (UI only) instead of `@shopify/shopify-app-remix/react`'s `AppProvider` (Bridge + UI).
*   **Goal:** Restore rendering to check `window.shopify` logs without triggering Remix's App Bridge auto-injection.

### 15. Result of Isolation
*   **Result:** `window.shopify` is `UNDEFINED`.
*   **Implication:** `AppProvider` was NOT the cause. The script `app-bridge.js` is failing to execute entirely.
*   **Observations:**
    *   "Preloaded but not used" warning persists.
    *   Console shows errors from `post-purchase-email-app` extension.
*   **Hypothesis:** Browser Extension blocking script OR CSP violation.
*   **Next:** Verify CSP headers and test in Incognito.

### 16. Force Permissive CSP (Retry)
*   **Context:** `window.shopify` is undefined. "Preloaded but not used" persists. `vite.config.ts` is now clean.
*   **Hypothesis:** The manual script injection lacks a `nonce`, and the default CSP (set by `shopify.server.ts`) blocks it.
*   **Plan:** Explicitly overwrite the CSP header in `entry.server.tsx` to allow `https://cdn.shopify.com` without a nonce (unsafe-inline/eval).
*   **Goal:** Allow the manual script to execute.

### 17. Force Permissive CSP (Result)
*   **Result:** `window.shopify` is still `UNDEFINED`.
*   **Observations:**
    *   **Network Test PASSED**: `fetch` returns 200 OK. This rules out network blocking.
    *   **Execution FAILED**: Script fetched but not executed. "Preloaded but not used" persists.
*   **Diagnosis:** Script tag is present but blocked from execution (likely subtle CSP mismatch) or ignored due to hydration/preload mismatch.
*   **Plan:** Switch to **Programmatic Script Injection** via `useEffect`. This bypasses static HTML/hydration issues and allows explicit `onload`/`onerror` handling.

### 18. Programmatic Injection Success
*   **Result:** `window.shopify` is **DEFINED**. Script loaded successfully via `useEffect`.
*   **Implication:** The issue was definitely related to how the browser/Remix handled the static `<script>` tag (likely conflicting with preload headers or hydration). Programmatic injection works.
*   **Plan:** Re-integrate React UI components (`AppProvider`, `NavMenu`).
*   **Strategy:** Use `AppProvider` with `isEmbeddedApp={false}` to prevent it from trying to inject the script (since we are doing it manually), while still providing context to `NavMenu`.

### 19. FINAL RESOLUTION
*   **Result:** **SUCCESS.** The menu now appears in the Shopify sidebar.
*   **Solution Summary:**
    1.  **Programmatic Injection:** Manually injecting `app-bridge.js` via `useEffect` in `app.tsx` bypassed the environment/hydration issues that blocked the static script tag.
    2.  **Config Cleanup:** Removed conflicting `define` blocks in `vite.config.ts`.
    3.  **AppProvider Mode:** Used `isEmbeddedApp={false}` on `AppProvider` to disable its internal script injection while keeping its context for UI components.
    4.  **CSP Override:** Forced permissive CSP in `entry.server.tsx` (likely helped, though programmatic injection might have bypassed the specific blocking mechanism).
*   **Status:** Closed.

---

## ✅ SUCCESSFUL BASELINE

### Temp App
*   Fresh template. **Menu works.**

---

## 🔍 OBSERVATIONS

1.  **Persistent CDN Reference:** Even after changing script src to local, browser logs show CDN URL preloaded.
2.  **No Script Execution:** `window.shopify` never defined, no errors from script itself (suggests it never runs).
3.  **"Preloaded but not used":** Classic CSP or CORS block symptom, but permissive CSP didn't fix it.
4.  **Works in Temp App:** Standard setup with identical dependencies works, implying environmental or config difference.

---

## 🤔 REMAINING SUSPECTS

1.  **Remix `Links` Component:** Auto-generating CDN preload link that conflicts or overrides manual script?
2.  **AppProvider Interference:** Even with `isEmbeddedApp={false}`, might be doing something in background?
3.  **Vite Dev Server Config:** Proxy, middleware, or HMR interfering with script execution?
4.  **Browser Extension:** Adblocker or privacy extension blocking Shopify domain scripts?
5.  **Network Proxy/Firewall:** Corporate network blocking `cdn.shopify.com`?

---

## 📋 NEXT STEPS

1.  **Web Research:** Search for similar "window.shopify undefined Remix" issues.
2.  **Network Tab Inspection:** Check if `/app-bridge.js` returns 200 OK.
3.  **Disable Browser Extensions:** Test in incognito mode.
4.  **Compare `package.json` Versions:** Temp App vs Main App dependency versions.
5.  **Contact Shopify Support:** With reproduction case (Temp works, Main doesn't).
