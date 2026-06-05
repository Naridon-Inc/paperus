/**
 * sandbox-runtime.js — code that runs INSIDE the sandbox (FROZEN CONTRACT §1.1, §4, §5).
 *
 * This module's job in the HOST realm is only to *carry the source string* of the
 * runtime that executes inside the `<iframe sandbox="allow-scripts">`. The iframe
 * has a unique opaque origin (no `allow-same-origin`), so it CANNOT reach
 * `window.parent`, `window.api`, cookies, or host storage. The runtime below runs
 * there and is the ONLY code in the sandbox besides the third-party plugin entry.
 *
 * The runtime:
 *   - hardens the realm: removes/over-shadows `fetch`, `XMLHttpRequest`,
 *     `WebSocket`, `eval`, `Function`, `importScripts`, `WebAssembly` so a plugin
 *     has NO ambient I/O. There is no `window.api`, no `require`, no Node here.
 *   - mirrors the §4 RPC envelope + the monotonic-integer id scheme (its own
 *     counter, independent from the host's), correlating request/response by id.
 *   - builds the `ctx` proxy from the `ctxDescriptor` the host sends in
 *     `plugin.activate`. Each `ctx.<ns>.<method>(...)` just packages a
 *     `host.<ns>.<method>` request — the "JSON-only boundary + ergonomic ctx" rule.
 *   - marshals callbacks (onToken/render/onChange/run/authenticate/...) into
 *     integer `token`s stored in a local Map; the host invokes them later via a
 *     `plugin.callback {token, args}` event which the runtime dispatches back.
 *   - imports NOTHING from the host realm.
 *
 * The plugin entry is appended after this runtime as an ES module (`type=module`)
 * inside the same iframe document; it does `export default definePlugin({...})`
 * and posts its module namespace back to the runtime via a tiny global handoff
 * (`__notionlessPluginReady`). The runtime then drives activate/deactivate.
 */

/**
 * The runtime source, as a string. `plugin-sandbox.js` injects it into the
 * iframe's `srcdoc` inside a classic <script> (it defines the bridge globals the
 * plugin module then calls). Keep this self-contained: no host imports, no
 * template interpolation from host scope.
 *
 * @type {string}
 */
export const SANDBOX_RUNTIME_SOURCE = String.raw`
(function () {
  'use strict';

  // ── Realm hardening: deny ambient I/O and code-gen ────────────────────────
  // No allow-same-origin means this is already an opaque origin with no access
  // to the host window. We additionally neutralize network + dynamic eval so a
  // plugin must route EVERYTHING through host-mediated RPC (ctx.net.fetch etc.).
  function deny(name) {
    try {
      Object.defineProperty(self, name, {
        value: function denied() {
          throw new Error('[notionless] "' + name + '" is not available in the plugin sandbox');
        },
        writable: false,
        configurable: false,
      });
    } catch (e) { /* property may be non-configurable already */ }
  }
  ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts',
   'navigator', 'localStorage', 'sessionStorage', 'indexedDB', 'caches',
   'Worker', 'SharedWorker', 'WebAssembly'].forEach(function (n) {
    try { deny(n); } catch (e) {}
  });
  // Block dynamic code generation. (Static plugin code already loaded as a module.)
  try { self.eval = function () { throw new Error('[notionless] eval is disabled in the plugin sandbox'); }; } catch (e) {}
  try {
    // Replace the Function constructor with one that refuses to build from strings.
    var OrigFunction = Function;
    self.Function = function () { throw new Error('[notionless] Function() is disabled in the plugin sandbox'); };
    self.Function.prototype = OrigFunction.prototype;
  } catch (e) {}

  // ── Envelope constants (mirror plugin-rpc.js §4.1) ────────────────────────
  var T_REQUEST = 'request', T_RESPONSE = 'response', T_ERROR = 'error', T_EVENT = 'event';
  var CODES = {
    CAPABILITY_DENIED: 'CAPABILITY_DENIED', BAD_PARAMS: 'BAD_PARAMS', NOT_FOUND: 'NOT_FOUND',
    TIMEOUT: 'TIMEOUT', INTERNAL: 'INTERNAL', UNSUPPORTED_METHOD: 'UNSUPPORTED_METHOD',
    QUARANTINED: 'QUARANTINED', HOST_DISPOSED: 'HOST_DISPOSED',
  };
  var RPC_TIMEOUT_MS = 8000;

  // ── Monotonic integer id counter (NORMATIVE §4.3) — independent per side ───
  var _id = 0;
  function nextId() { _id += 1; return _id; }

  // ── Callback token registry (§5 boundary rule) ────────────────────────────
  // Functions never cross the wire. We store them under integer tokens and hand
  // the host the token; the host calls back via a plugin.callback {token,args} event.
  var _token = 0;
  function nextToken() { _token += 1; return _token; }
  var callbacks = new Map(); // token -> fn

  function registerCallback(fn) {
    if (typeof fn !== 'function') return undefined;
    var tok = nextToken();
    callbacks.set(tok, fn);
    return tok;
  }
  function invokeCallback(token, args) {
    var fn = callbacks.get(token);
    if (!fn) return undefined;
    try {
      return fn.apply(null, Array.isArray(args) ? args : []);
    } catch (e) {
      try { console.warn('[notionless] plugin callback ' + token + ' threw:', e); } catch (_) {}
      return undefined;
    }
  }

  // ── Wire transport ────────────────────────────────────────────────────────
  // The host transfers one MessagePort via the iframe's window 'message' event.
  // Until the port arrives we buffer nothing — the host always sends the port
  // before any request.
  var port = null;
  var outbox = [];
  function post(msg) {
    if (port) { try { port.postMessage(msg); } catch (e) {} }
    else outbox.push(msg);
  }
  function flushOutbox() {
    if (!port) return;
    var pending = outbox; outbox = [];
    for (var i = 0; i < pending.length; i++) {
      try { port.postMessage(pending[i]); } catch (e) {}
    }
  }

  // pending host-bound requests: id -> { resolve, reject, timer }
  var pending = new Map();

  function request(method, params, timeout) {
    var id = nextId();
    var ms = (typeof timeout === 'number' && isFinite(timeout)) ? timeout : RPC_TIMEOUT_MS;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (pending.has(id)) {
          pending.delete(id);
          var err = new Error("RPC '" + method + "' timed out");
          err.code = CODES.TIMEOUT;
          reject(err);
        }
      }, ms);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      post({ type: T_REQUEST, id: id, method: method, params: params === undefined ? null : params });
    });
  }
  function notify(method, params) {
    var id = nextId();
    post({ type: T_EVENT, id: id, method: method, params: params === undefined ? null : params });
    return id;
  }

  // ── Argument marshaling: replace functions with callback-token markers ─────
  // We deep-walk plain JSON values and swap any function for { __cb__: token }.
  // The host stores nothing special — it just sees a token and arranges to call
  // back via plugin.callback. Mirrored decode happens host-side per the contract.
  function marshal(value, depth) {
    if (depth > 8) return null;
    if (typeof value === 'function') {
      return { __cb__: registerCallback(value) };
    }
    if (value === null || typeof value !== 'object') {
      return value;
    }
    if (Array.isArray(value)) {
      var arr = [];
      for (var i = 0; i < value.length; i++) arr.push(marshal(value[i], depth + 1));
      return arr;
    }
    var out = {};
    for (var k in value) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        out[k] = marshal(value[k], depth + 1);
      }
    }
    return out;
  }

  // ── ctx proxy builder (from ctxDescriptor) ────────────────────────────────
  // ctxDescriptor is a plain JSON manifest: { namespaces: { editor: ['insert',...], ... } }.
  // For each ns.method we synthesize a function that issues host.<ns>.<method>.
  function buildCtx(descriptor) {
    var ctx = {};
    var nss = (descriptor && descriptor.namespaces) || {};
    Object.keys(nss).forEach(function (ns) {
      var methods = nss[ns] || [];
      var bag = {};
      methods.forEach(function (method) {
        bag[method] = function () {
          var args = Array.prototype.slice.call(arguments);
          // Most ctx methods take a single options object; pass the marshaled
          // arg list and let the host adapter destructure. We marshal callbacks.
          var marshaledArgs = args.map(function (a) { return marshal(a, 0); });
          var p = request('host.' + ns + '.' + method, { args: marshaledArgs });
          // Methods that register a contribution return a Disposable synchronously
          // in spirit; we return a Promise that resolves to the host result, plus
          // attach a best-effort dispose() that works once the id is known.
          return wrapResult(p, ns, method, marshaledArgs);
        };
      });
      ctx[ns] = bag;
    });

    // ctx.brain (ADDITIVE v1, Phase 4): tool registration for the Company Brain.
    // Like the command 'run' / provider 'generate' proxies, the user's tool
    // handler never crosses the wire — we store it under a callback token and the
    // host invokes it via plugin.callback. The host passes [args, callId]; we run
    // the handler and post its return value back as host.notify.brainToolResult so
    // the host's bridge.run promise resolves with the tool's result.
    if (nss.brain) {
      ctx.brain = {
        registerTool: function (descriptor) {
          var spec = descriptor || {};
          var userHandler = (typeof spec.handler === 'function')
            ? spec.handler
            : ((typeof spec.run === 'function') ? spec.run : null);
          // Wrap the handler so invoking its token runs it and returns the result
          // to the host over the correlated brainToolResult channel.
          var wrapped = function (args, callId) {
            Promise.resolve()
              .then(function () { return userHandler ? userHandler(args) : { error: 'no handler' }; })
              .then(function (result) {
                notify('host.notify.brainToolResult', { callId: callId, result: result === undefined ? null : result });
              }, function (err) {
                notify('host.notify.brainToolResult', { callId: callId, error: (err && err.message) || String(err) });
              });
          };
          // Marshal a descriptor whose handler is the wrapped callback token; the
          // host reads { id, description, parameters, handler:{__cb__} } from params.
          var payload = {
            id: spec.id,
            description: spec.description,
            parameters: marshal(spec.parameters, 0),
            handler: { __cb__: registerCallback(wrapped) },
          };
          var p = request('host.brain.registerTool', payload);
          return wrapResult(p, 'brain', 'registerTool', [payload]);
        },
        listTools: function () {
          return request('host.brain.listTools', { args: [] });
        },
      };
    }

    // ctx.events.on is always available (no capability) if listed.
    return ctx;
  }

  // Registration-style calls should feel like they return a Disposable. We return
  // a thenable that ALSO exposes dispose()/update() which lazily resolve.
  function wrapResult(promise, ns, method, marshaledArgs) {
    // Identify the registration token (the first arg's id, if any) so dispose can
    // target it. The host returns { disposeToken } for registrations.
    var disposeTokenPromise = promise.then(function (r) {
      return r && typeof r === 'object' ? r.disposeToken : undefined;
    }, function () { return undefined; });

    promise.dispose = function () {
      return disposeTokenPromise.then(function (tok) {
        if (tok === undefined || tok === null) return { ok: false };
        return request('host.host.dispose', { disposeToken: tok });
      });
    };
    promise.update = function (vdom) {
      return disposeTokenPromise.then(function (tok) {
        if (tok === undefined || tok === null) return { ok: false };
        return request('host.host.update', { disposeToken: tok, vdom: marshal(vdom, 0) });
      });
    };
    // For statusItem-style results that expose set(...).
    promise.set = function (v) {
      return disposeTokenPromise.then(function (tok) {
        if (tok === undefined || tok === null) return { ok: false };
        return request('host.host.statusSet', { disposeToken: tok, value: marshal(v, 0) });
      });
    };
    // For view results that expose show().
    promise.show = function () {
      return disposeTokenPromise.then(function (tok) {
        if (tok === undefined || tok === null) return { ok: false };
        return request('host.host.show', { disposeToken: tok });
      });
    };
    return promise;
  }

  // ── Plugin lifecycle ──────────────────────────────────────────────────────
  var pluginImpl = null; // { activate, deactivate }
  var activated = false;

  // The plugin module calls this when its default export is ready.
  self.__notionlessRegisterPlugin = function (impl) {
    pluginImpl = impl || null;
  };
  // Some plugins may set a global instead; support both.
  function resolvePluginImpl() {
    if (pluginImpl) return pluginImpl;
    if (self.__notionlessPluginDefault) return self.__notionlessPluginDefault;
    return null;
  }

  // ── Inbound dispatch (host → plugin) ──────────────────────────────────────
  function reply(id, result) { post({ type: T_RESPONSE, id: id, result: result === undefined ? null : result }); }
  function replyError(id, code, message, data) {
    var e = { code: code || CODES.INTERNAL, message: message || 'error' };
    if (data !== undefined) { try { JSON.stringify(data); e.data = data; } catch (x) {} }
    post({ type: T_ERROR, id: id, error: e });
  }

  function handleInboundRequest(msg) {
    var id = msg.id, method = msg.method, params = msg.params || {};
    if (method === 'plugin.activate') {
      var impl = resolvePluginImpl();
      if (!impl || typeof impl.activate !== 'function') {
        replyError(id, CODES.INTERNAL, 'plugin did not export an activate() function');
        return;
      }
      var ctx = buildCtx(params.ctxDescriptor || {});
      Promise.resolve().then(function () {
        return impl.activate(ctx);
      }).then(function () {
        activated = true;
        reply(id, { ok: true });
      }, function (err) {
        replyError(id, CODES.INTERNAL, (err && err.message) || 'activate failed');
      });
      return;
    }
    if (method === 'plugin.deactivate') {
      var impl2 = resolvePluginImpl();
      Promise.resolve().then(function () {
        if (impl2 && typeof impl2.deactivate === 'function' && activated) {
          return impl2.deactivate();
        }
        return undefined;
      }).then(function () {
        activated = false;
        callbacks.clear();
        reply(id, { ok: true });
      }, function (err) {
        // Even on a failing deactivate we ack so the host can dispose us.
        activated = false;
        callbacks.clear();
        reply(id, { ok: true, warning: (err && err.message) || 'deactivate threw' });
      });
      return;
    }
    replyError(id, CODES.UNSUPPORTED_METHOD, "no handler for method '" + method + "'");
  }

  function handleInboundEvent(msg) {
    var method = msg.method, params = msg.params || {};
    if (method === 'plugin.callback') {
      // The host invokes a previously-registered callback token.
      invokeCallback(params.token, params.args);
      return;
    }
    // host.event.<name> events are surfaced via ctx.events.on, which under the
    // hood registered a callback token; the host dispatches those as
    // plugin.callback already. Any other event is ignored.
  }

  function onMessage(ev) {
    var msg = ev && ev.data;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case T_RESPONSE: {
        var e = pending.get(msg.id);
        if (e) { pending.delete(msg.id); clearTimeout(e.timer); e.resolve(msg.result); }
        break;
      }
      case T_ERROR: {
        var er = pending.get(msg.id);
        if (er) {
          pending.delete(msg.id); clearTimeout(er.timer);
          var err = new Error((msg.error && msg.error.message) || 'plugin host error');
          err.code = (msg.error && msg.error.code) || CODES.INTERNAL;
          if (msg.error && msg.error.data !== undefined) err.data = msg.error.data;
          er.reject(err);
        }
        break;
      }
      case T_REQUEST:
        handleInboundRequest(msg);
        break;
      case T_EVENT:
        handleInboundEvent(msg);
        break;
      default:
        break;
    }
  }

  // ── Port handshake ────────────────────────────────────────────────────────
  // The host sends the MessagePort once as the FIRST window message (with no
  // useful data, only the transferred port). After that, all traffic rides the port.
  self.addEventListener('message', function bootstrap(ev) {
    if (ev.ports && ev.ports.length && !port) {
      port = ev.ports[0];
      port.onmessage = onMessage;
      if (typeof port.start === 'function') port.start();
      flushOutbox();
      // Tell the host we are alive and ready to receive plugin.activate.
      notify('host.notify.ready', { ts: 0 });
    }
  });

  // Expose a tiny bridge the plugin module's loader uses (definePlugin handoff).
  self.__notionless = {
    register: self.__notionlessRegisterPlugin,
  };
})();
`

/**
 * Build the full iframe `srcdoc` HTML: the hardened runtime above, followed by
 * the plugin's ESM entry source loaded as a module that hands its default export
 * back to the runtime. `definePlugin` (from the SDK) just returns the impl object;
 * the loader calls `__notionlessRegisterPlugin(impl)`.
 *
 * @param {string} entrySource  the plugin's ESM entry module text (from plugin:read)
 * @param {Record<string,string>} [moduleShims]  bare-specifier → source map, e.g.
 *        '@notionless/plugin-sdk' → the tiny definePlugin module. Injected as a
 *        classic <script type="importmap"> of blob: URLs so the plugin's bare
 *        imports resolve WITHOUT network access.
 * @returns {string} srcdoc HTML
 */
export function buildSandboxSrcdoc(entrySource, moduleShims = {}) {
  const safeEntry = String(entrySource == null ? '' : entrySource)

  // Build blob: URLs for each shimmed bare specifier so `import ... from '@x'`
  // resolves entirely in-realm (no same-origin, no network). The import map is a
  // JSON literal embedded in the document.
  const importMap = { imports: {} }
  const shimScripts = []
  let shimIdx = 0
  for (const [specifier, source] of Object.entries(moduleShims || {})) {
    if (typeof specifier !== 'string' || typeof source !== 'string') continue
    shimIdx += 1
    const varName = `__shim${shimIdx}`
    // Create a blob URL at runtime inside the doc, then register it in the map.
    // We emit a script that builds the URL and a placeholder; but import maps must
    // be present before module evaluation, so we instead inline the shim as a
    // data: module URL computed at document-author time.
    const dataUrl = `data:text/javascript;base64,${b64Utf8(source)}`
    importMap.imports[specifier] = dataUrl
    shimScripts.push(`/* shim ${varName}: ${escapeForComment(specifier)} */`)
  }

  // The plugin entry is also turned into a data: module URL and imported, so that
  // its top-level `export default definePlugin({...})` is captured and registered.
  const entryDataUrl = `data:text/javascript;base64,${b64Utf8(safeEntry)}`

  const loaderModule = [
    `import impl from ${JSON.stringify(entryDataUrl)};`,
    'try {',
    '  if (self.__notionlessRegisterPlugin) self.__notionlessRegisterPlugin(impl && impl.default ? impl.default : impl);',
    '  else self.__notionlessPluginDefault = impl && impl.default ? impl.default : impl;',
    '} catch (e) {',
    "  try { console.error('[notionless] plugin entry failed to load:', e); } catch (_) {}",
    '}',
  ].join('\n')
  const loaderDataUrl = `data:text/javascript;base64,${b64Utf8(loaderModule)}`

  const importMapJson = JSON.stringify(importMap)

  // Minimal, locked-down document. CSP forbids inline-less network and disallows
  // navigation. Only data: scripts (our own) execute; no external origins.
  return [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="',
    "default-src 'none';",
    "script-src 'unsafe-inline' data: blob:;",
    "connect-src 'none';",
    "img-src data:;",
    "style-src 'unsafe-inline';",
    "base-uri 'none';",
    "form-action 'none';",
    '">',
    `<script type="importmap">${importMapJson}</script>`,
    '</head><body>',
    `<script>${SANDBOX_RUNTIME_SOURCE}</script>`,
    `<script type="module" src="${loaderDataUrl}"></script>`,
    '</body></html>',
  ].join('\n')
}

/** base64-encode a UTF-8 string for data: URLs (works in browser + Node). */
function b64Utf8(str) {
  try {
    if (typeof TextEncoder !== 'undefined' && typeof btoa === 'function') {
      const bytes = new TextEncoder().encode(str)
      let bin = ''
      for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
      return btoa(bin)
    }
  } catch (_e) { /* fall through */ }
  // Node fallback (used by tooling/tests; not in the browser runtime path).
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf-8').toString('base64')
  // Last resort: btoa of raw (may mangle non-ASCII, but path is unreachable in prod).
  return typeof btoa === 'function' ? btoa(str) : str
}

function escapeForComment(s) {
  return String(s).replace(/\*\//g, '* /')
}

export default { SANDBOX_RUNTIME_SOURCE, buildSandboxSrcdoc }
