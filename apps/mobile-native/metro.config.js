// Metro config — wires Node-core polyfills so y-webrtc/simple-peer resolve on
// React Native (Hermes). simple-peer pulls in readable-stream/buffer/events and
// uses the `browser` field of randombytes + get-browser-rtc to pick RN-friendly
// implementations.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// lib0's react-native webcrypto variant eagerly requires isomorphic-webcrypto
// (a native-crypto backend we don't ship). We run y-webrtc password-less, so
// alias it to a local shim that only needs to resolve. See src/shims/webcrypto.js.
const WEBCRYPTO_SHIM = path.resolve(__dirname, 'src/shims/webcrypto.js');
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === 'isomorphic-webcrypto' ||
    moduleName.startsWith('isomorphic-webcrypto/')
  ) {
    return { type: 'sourceFile', filePath: WEBCRYPTO_SHIM };
  }
  return (defaultResolveRequest || context.resolveRequest)(context, moduleName, platform);
};

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  stream: require.resolve('readable-stream'),
  buffer: require.resolve('buffer'),
  events: require.resolve('events'),
  process: require.resolve('process'),
};

// Honor the `browser` field for classic (non-exports) packages like
// randombytes/get-browser-rtc, so they pick their browser implementations.
config.resolver.resolverMainFields = ['react-native', 'browser', 'main'];

// For packages that ship an `exports` map (package exports stays enabled by
// default on SDK 54+), resolve the `browser` condition too.
config.resolver.unstable_conditionNames = ['require', 'react-native', 'browser'];

module.exports = config;
