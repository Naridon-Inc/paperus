# Web offline browser regressions

Prerequisites: Node 22, pnpm, Python 3, and Playwright browsers. These tests create
isolated temporary browser profiles and synthetic teams/notes. No production
account, domain, NAS, or credentials are needed.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:web
npm install --prefix backend --omit=dev --ignore-scripts --no-package-lock
python3 -m venv .browser-env
.browser-env/bin/pip install playwright
.browser-env/bin/playwright install webkit chromium
```

Run a local relay in one terminal (use a temporary persistence directory):

```sh
PORT=19008 NODE_ENV=production NL_MODE=online YJS_PERSIST_DIR=/tmp/paperus-browser-relay ANALYTICS_DISABLE=true node backend/src/index.js
```

In another terminal, run the fixture and then execute tests in a third terminal:

```sh
node tests/browser/server.mjs
```

```sh
.browser-env/bin/python tests/browser/offline.py
PAPERUS_TEST_BROWSER=chromium .browser-env/bin/python tests/browser/background_sync.py
```

The first test verifies an offline cold start, restored team and content, an
offline edit surviving another full browser restart, and subsequent sync to a
second client. The second verifies an older note among 16 notes is uploaded after
an online app restart WITHOUT opening the note, and a fresh client obtains the
edit after the sender is fully closed.

To verify a scoped installation:

```sh
PAPERUS_TEST_PORT=18084 PAPERUS_TEST_PREFIX=/notes node tests/browser/server.mjs
```

```sh
PAPERUS_TEST_URL=http://localhost:18084/notes/ PAPERUS_TEST_BROWSER=chromium .browser-env/bin/python tests/browser/background_sync.py
```

Optional variables: `PAPERUS_TEST_URL`, `PAPERUS_TEST_BROWSER` (`webkit` or
`chromium`), `PAPERUS_TEST_HOST_MAPPING` (Chromium only), and
`PAPERUS_ARTIFACT_DIR` for screenshots. The fixture also accepts
`PAPERUS_RELAY_URL`, `PAPERUS_TEST_PORT`, and `PAPERUS_TEST_PREFIX`.

WebKit with an iPhone viewport is automation, not a physical iPhone validation.
Do not commit generated browser profiles, relay data, or screenshots.

For a static-host-only check without a running relay or Docker runtime settings:

```sh
python3 -m http.server 18085 --bind 127.0.0.1 --directory dist-web
```

```sh
.browser-env/bin/python tests/browser/static_host.py
```
