// Shim for `isomorphic-webcrypto/src/react-native`, which lib0 (a y-webrtc dep)
// eagerly requires from its react-native webcrypto variant. We run y-webrtc
// WITHOUT a room password (the app's real confidentiality is the E2EE
// transportDoc, not y-webrtc's optional password layer), so `subtle` is never
// invoked at runtime — this module only needs to RESOLVE and expose the shape
// lib0 reads at import time: `ensureSecure()`, `subtle`, `getRandomValues`.
// getRandomValues is backed by react-native-get-random-values (global.crypto).
const api = {
  ensureSecure() {},
  get subtle() {
    return (global.crypto && global.crypto.subtle) || undefined;
  },
  getRandomValues(arr) {
    return global.crypto.getRandomValues(arr);
  },
};

module.exports = { default: api };
