// Registers the extensionless ESM resolver (see ext-resolve.mjs).
// Usage: node --import ./tests/ext-loader.mjs tests/e2ee-crypto.test.mjs
import { register } from 'node:module';
register('./ext-resolve.mjs', import.meta.url);
