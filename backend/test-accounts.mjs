// Standalone smoke test for the optional accounts layer (no framework).
//   ACCOUNTS_ENABLED=1 ACCOUNTS_DIR=/tmp/nl-acct-test node backend/test-accounts.mjs
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.ACCOUNTS_ENABLED = '1';
process.env.ACCOUNTS_SECRET = 'test-secret-fixed';
const accounts = require('./src/accounts.js');

let pass = 0;
const ok = (name) => { pass += 1; console.log(`  ok  ${name}`); };

// First user becomes admin.
const a = accounts.signup({ email: 'Admin@Example.com ', password: 'hunter2hunter2' });
assert(a.ok, `signup admin: ${a.error}`);
assert.equal(a.user.role, 'admin');
assert.equal(a.user.email, 'admin@example.com'); // normalized
ok('first signup → admin, email normalized');

// Token round-trips and carries the uid.
const payload = accounts.verifyToken(a.token);
assert(payload && payload.uid === a.user.id, 'token verifies');
ok('session token verifies + carries uid');

// Tampered token rejected.
assert.equal(accounts.verifyToken(`${a.token}x`), null);
assert.equal(accounts.verifyToken('garbage.sig'), null);
ok('tampered/garbage tokens rejected');

// Duplicate email rejected.
const dup = accounts.signup({ email: 'admin@example.com', password: 'anotherpass1' });
assert(!dup.ok && dup.error === 'email_taken', 'dup rejected');
ok('duplicate email rejected');

// Weak password + bad email rejected.
assert.equal(accounts.signup({ email: 'x@y.com', password: 'short' }).error, 'weak_password');
assert.equal(accounts.signup({ email: 'nope', password: 'longenough1' }).error, 'invalid_email');
ok('weak password + invalid email rejected');

// Login: correct vs wrong password.
const good = accounts.login({ email: 'admin@example.com', password: 'hunter2hunter2' });
assert(good.ok && good.user.id === a.user.id, 'login ok');
const bad = accounts.login({ email: 'admin@example.com', password: 'wrongpass1234' });
assert(!bad.ok && bad.error === 'invalid_credentials', 'wrong pw rejected');
const ghost = accounts.login({ email: 'noone@example.com', password: 'whatever12345' });
assert(!ghost.ok && ghost.error === 'invalid_credentials', 'unknown user rejected (same error → no enumeration)');
ok('login: correct ok, wrong/unknown rejected with identical error');

// tokenFromReq: cookie + bearer + query.
const t = good.token;
assert.equal(accounts.tokenFromReq({ headers: { cookie: `nl_session=${encodeURIComponent(t)}` }, url: '/' }).length, t.length);
assert.equal(accounts.tokenFromReq({ headers: { authorization: `Bearer ${t}` }, url: '/' }), t);
assert.equal(accounts.tokenFromReq({ headers: {}, url: `/signaling?token=${encodeURIComponent(t)}` }), t);
ok('tokenFromReq reads cookie / bearer / query');

console.log(`\n${pass} checks passed.`);
