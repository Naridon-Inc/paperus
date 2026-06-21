# Debugging Log: OOM Crash on Startup

**Issue:** Application crashes immediately after "Manifest initialized" with `FATAL ERROR: JavaScript heap out of memory`.

**Root Cause:**
- Initial suspicion: Recursive scanning of large directories (`~/Downloads`) loaded as "Implicit Roots".
- Confirmed: `Manifest initialized for root: /Users/muhammed/Downloads` appears in logs before crash.

**Attempted Fixes:**

1.  **Limit Recursion Depth:**
    -   *Action:* Modified `getDirectoryTree` in `src/main/index.js` to limit recursion depth to 2.
    -   *Result:* Failed. Crash persisted.
    -   *Reason:* Even with depth 2, `fs.readdirSync` on a folder with 10k+ files creates massive arrays of strings/objects synchronously, spiking memory.

2.  **Limit Item Count (Pagination):**
    -   *Action:* Added `MAX_ITEMS = 500` limit to `getDirectoryTree`. Sliced `dirData` array.
    -   *Result:* Failed. Crash persisted.
    -   *Reason:* `fs.readdirSync` reads *all* filenames into memory before slicing. If folder has millions of files, OOM happens *inside* `readdirSync` or immediately after string allocation.

3.  **Non-Recursive Scan (Safe Mode):**
    -   *Action:* Refactored `getDirectoryTree` to be strictly non-recursive (depth 0 only for subfolders).
    -   *Result:* Failed. Crash persisted.
    -   *Reason:* The renderer still requests the root. If the root is `~/Downloads`, and it's huge, the initial scan still kills it.

4.  **Async Iterator (`opendir`):**
    -   *Action:* Refactored `getDirectoryTree` to use `fs.opendir` (async iterator) instead of `readdirSync`. This reads entries one by one, allowing true memory-safe limits (stop after 500).
    -   *Result:* Failed. Crash persisted.
    -   *Reason:* This *should* have worked for file scanning. The persistence suggests the issue might not be *just* the scanning, but **state persistence**.

5.  **Global Workspace Safety:**
    -   *Action:* Modified `ensureManifest` to redirect "Unsafe Roots" (`Downloads`, `Home`) to a `GlobalWorkspace` manifest in AppData to prevent creating `.opus` folders in Downloads.
    -   *Result:* Crash persisted.
    -   *Reason:* While this prevents writing to Downloads, the app *still tries to scan it* because it was previously saved in `knownProjects` in `electron-settings`.

6.  **Emergency Settings Cleanup:**
    -   *Action:* Added logic in `src/main/index.js` (before app ready) to check `settings.json` size and delete it if > 1MB.
    -   *Result:* Crash persisted.
    -   *Reason:* Maybe the settings file isn't > 1MB, but contains just the *path* to Downloads, which triggers the scan logic loop or some other initialization OOM.

**Current Status:**
-   The application logic for handling large folders is now robust (`opendir` + limits).
-   However, the **startup crash persists**, likely due to:
    1.  **Corrupted/Poisoned State:** Something in `electron-settings` (besides size) or `Application Support` is triggering a heavy operation on launch.
    2.  **V8/Electron Issue:** The stack trace `v8::CpuProfile` suggests profiling/debugging overhead might be contributing, or a native module issue.
    3.  **Zombie Processes:** Old electron processes might be hanging?

**Remaining Tasks / Next Steps:**
-   **Nuke Persistence:** Manually clear `~/Library/Application Support/Opus` to reset all state.
-   **Disable DevTools/Profiler:** Ensure no heavy devtools overhead.
-   **Verify Fixes:** Once the app starts (after state reset), verify the `opendir` logic actually prevents future crashes when opening Downloads.
