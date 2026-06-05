import sodium from 'libsodium-wrappers-sumo';

// Wire-format version tag for AEAD blobs. 3 bytes ("â®" + version) prefix every
// XChaCha20-Poly1305 ciphertext so the format can evolve and so decrypt can tell
// a v1 blob from a legacy crypto_secretbox blob. A random legacy nonce starting
// with these exact 3 bytes is a 1-in-16M event and at worst drops one stale local
// blob (plaintext is rebuilt from the durable plaintext store), never user data.
const AEAD_MAGIC = new Uint8Array([0xe2, 0xee, 0x01]);

function _hasAeadMagic(buf) {
    return buf.length > AEAD_MAGIC.length &&
        buf[0] === AEAD_MAGIC[0] && buf[1] === AEAD_MAGIC[1] && buf[2] === AEAD_MAGIC[2];
}

export class E2EEManager {
    constructor() {
        this.isReady = false;
        this.readyPromise = sodium.ready.then(() => {
            this.isReady = true;
        });
    }

    async ensureReady() {
        await this.readyPromise;
    }

    /**
     * Generate a new user key pair
     */
    async generateUserKeyPair() {
        await this.ensureReady();
        const keyPair = sodium.crypto_box_keypair();
        return {
            publicKey: sodium.to_base64(keyPair.publicKey),
            privateKey: sodium.to_base64(keyPair.privateKey)
        };
    }

    /**
     * Derive a key from a password/pin for encrypting the private key
     */
    async deriveKeyFromPassword(password, salt = null) {
        await this.ensureReady();
        if (!salt) {
            salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
        } else if (typeof salt === 'string') {
            salt = sodium.from_base64(salt);
        }

        const key = sodium.crypto_pwhash(
            sodium.crypto_secretbox_KEYBYTES,
            password,
            salt,
            sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
            sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
            sodium.crypto_pwhash_ALG_ARGON2ID13
        );

        return { key, salt: sodium.to_base64(salt) };
    }

    /**
     * Encrypt the private key with the derived KEK
     */
    async encryptPrivateKey(privateKeyBase64, password) {
        await this.ensureReady();
        const { key, salt } = await this.deriveKeyFromPassword(password);
        const privateKey = sodium.from_base64(privateKeyBase64);
        const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        const ciphertext = sodium.crypto_secretbox_easy(privateKey, nonce, key);
        
        return {
            encryptedPrivateKey: sodium.to_base64(new Uint8Array([...nonce, ...ciphertext])),
            salt
        };
    }

    /**
     * Decrypt the private key with the password
     */
    async decryptPrivateKey(encryptedPrivateKeyBase64, password, saltBase64) {
        await this.ensureReady();
        const { key } = await this.deriveKeyFromPassword(password, saltBase64);
        const data = sodium.from_base64(encryptedPrivateKeyBase64);
        const nonce = data.slice(0, sodium.crypto_secretbox_NONCEBYTES);
        const ciphertext = data.slice(sodium.crypto_secretbox_NONCEBYTES);
        
        try {
            const privateKey = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
            return sodium.to_base64(privateKey);
        } catch (e) {
            throw new Error('Incorrect password or corrupted key');
        }
    }

    /**
     * Generate a random Document Key (Symmetric)
     */
    async generateDocumentKey() {
        await this.ensureReady();
        return sodium.to_base64(sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES));
    }

    /**
     * Wrap a Document Key for a user (Asymmetric)
     */
    async wrapDocumentKey(docKeyBase64, recipientPublicKeyBase64) {
        await this.ensureReady();
        const docKey = sodium.from_base64(docKeyBase64);
        const recipientPublicKey = sodium.from_base64(recipientPublicKeyBase64);
        
        const wrapped = sodium.crypto_box_seal(docKey, recipientPublicKey);
        return sodium.to_base64(wrapped);
    }

    /**
     * Unwrap a Document Key (Asymmetric)
     */
    async unwrapDocumentKey(wrappedKeyBase64, myPublicKeyBase64, myPrivateKeyBase64) {
        await this.ensureReady();
        const wrappedKey = sodium.from_base64(wrappedKeyBase64);
        const myPublicKey = sodium.from_base64(myPublicKeyBase64);
        const myPrivateKey = sodium.from_base64(myPrivateKeyBase64);
        
        try {
            const docKey = sodium.crypto_box_seal_open(wrappedKey, myPublicKey, myPrivateKey);
            return sodium.to_base64(docKey);
        } catch (e) {
            throw new Error('Failed to unwrap document key');
        }
    }

    /**
     * Wrap a symmetric key TO a roster identity's Ed25519 public key.
     *
     * Roster identities sign with Ed25519, but libsodium sealed boxes need an
     * X25519 (Curve25519) recipient key — so convert the Ed25519 public key to
     * its birationally-equivalent Curve25519 key first, then anonymous-seal. The
     * sender is ephemeral (sealed box), so granting access needs only the
     * recipient's PUBLIC key. Returns base64.
     */
    async wrapKeyForIdentity(keyBase64, ed25519PublicKeyBase64) {
        await this.ensureReady();
        const key = sodium.from_base64(keyBase64);
        const edPk = sodium.from_base64(ed25519PublicKeyBase64);
        const curvePk = sodium.crypto_sign_ed25519_pk_to_curve25519(edPk);
        return sodium.to_base64(sodium.crypto_box_seal(key, curvePk));
    }

    /**
     * Unwrap a key that was sealed to MY Ed25519 identity. Converts both halves
     * of the identity keypair to X25519, then opens the sealed box. Throws if the
     * wrap wasn't addressed to this identity (or is corrupt).
     */
    async unwrapKeyForIdentity(wrappedBase64, ed25519PublicKeyBase64, ed25519PrivateKeyBase64) {
        await this.ensureReady();
        const wrapped = sodium.from_base64(wrappedBase64);
        const edPk = sodium.from_base64(ed25519PublicKeyBase64);
        const edSk = sodium.from_base64(ed25519PrivateKeyBase64);
        const curvePk = sodium.crypto_sign_ed25519_pk_to_curve25519(edPk);
        const curveSk = sodium.crypto_sign_ed25519_sk_to_curve25519(edSk);
        const key = sodium.crypto_box_seal_open(wrapped, curvePk, curveSk);
        if (!key) throw new Error('unwrapKeyForIdentity: not addressed to this identity');
        return sodium.to_base64(key);
    }

    /**
     * Encrypt a UTF-8 string under a symmetric key. Returns base64 of the
     * versioned AEAD blob. Used for small metadata blobs (e.g. a restricted
     * note's title) that must round-trip through a JSON-serializable Y.Map.
     * Optional `aad` binds the ciphertext to a context (so a blob can't be
     * lifted into a different one and still decrypt).
     */
    encryptString(str, keyBase64, aad = '') {
        if (!this.isReady) throw new Error('Sodium not ready');
        const combined = this.encryptUpdate(sodium.from_string(String(str)), keyBase64, aad);
        return sodium.to_base64(combined);
    }

    /** Inverse of encryptString. Returns the string, or null if decryption fails. */
    decryptString(base64, keyBase64, aad = '') {
        if (!this.isReady) throw new Error('Sodium not ready');
        const plain = this.decryptUpdate(sodium.from_base64(base64), keyBase64, aad);
        return plain ? sodium.to_string(plain) : null;
    }

    /**
     * Encrypt data with a symmetric Document Key.
     *
     * Construction (v1): XChaCha20-Poly1305-IETF AEAD. The 3-byte magic
     * `AEAD_MAGIC` versions the wire format so it can evolve, and the optional
     * `aad` (additional authenticated data — we pass the note's docId) is bound
     * into the Poly1305 tag: a ciphertext authenticated for note A will FAIL to
     * open under note B's context even if an attacker swaps it in. The 192-bit
     * XChaCha nonce is random per call, so nonce reuse is a non-issue.
     *
     *   blob = [ magic(3) || nonce(24) || aead_ciphertext+tag ]
     *
     * @param {Uint8Array} update      plaintext bytes (a Yjs update or string)
     * @param {string}     docKeyBase64 symmetric key (32B, base64)
     * @param {string}     [aad]        context string bound into the auth tag
     */
    encryptUpdate(update, docKeyBase64, aad = '') {
        if (!this.isReady) throw new Error('Sodium not ready');
        const docKey = sodium.from_base64(docKeyBase64);
        const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
        const ad = aad ? sodium.from_string(String(aad)) : null;
        const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
            update, ad, null, nonce, docKey,
        );
        const combined = new Uint8Array(AEAD_MAGIC.length + nonce.length + ciphertext.length);
        combined.set(AEAD_MAGIC, 0);
        combined.set(nonce, AEAD_MAGIC.length);
        combined.set(ciphertext, AEAD_MAGIC.length + nonce.length);
        return combined;
    }

    /**
     * Decrypt data produced by encryptUpdate. Returns the plaintext bytes, or
     * `null` if authentication fails (wrong key, wrong `aad`, or a tampered
     * blob — Poly1305 catches a single flipped bit). Never throws.
     *
     * Falls back to the legacy `crypto_secretbox` format (no magic, no aad) so
     * ciphertext written by older builds still opens during an upgrade.
     */
    decryptUpdate(encryptedUpdate, docKeyBase64, aad = '') {
        if (!this.isReady) throw new Error('Sodium not ready');
        const docKey = sodium.from_base64(docKeyBase64);
        const buf = encryptedUpdate instanceof Uint8Array ? encryptedUpdate : new Uint8Array(encryptedUpdate);

        // v1: versioned XChaCha20-Poly1305-IETF AEAD (magic-prefixed).
        if (_hasAeadMagic(buf)) {
            const nb = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
            const nonce = buf.slice(AEAD_MAGIC.length, AEAD_MAGIC.length + nb);
            const ciphertext = buf.slice(AEAD_MAGIC.length + nb);
            const ad = aad ? sodium.from_string(String(aad)) : null;
            try {
                return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, ad, nonce, docKey);
            } catch (e) {
                return null;
            }
        }

        // Legacy: crypto_secretbox [nonce(24) || ciphertext]. No AAD existed.
        try {
            const nonce = buf.slice(0, sodium.crypto_secretbox_NONCEBYTES);
            const ciphertext = buf.slice(sodium.crypto_secretbox_NONCEBYTES);
            return sodium.crypto_secretbox_open_easy(ciphertext, nonce, docKey);
        } catch (e) {
            return null;
        }
    }

    // ─── Master Vault Key (MVK) Management ───

    /**
     * Generate a new MVK (random 256-bit key).
     * This is the root secret that protects the user's private key.
     */
    async generateMVK() {
        await this.ensureReady();
        return sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
    }

    /**
     * Wrap MVK with a symmetric KEK (derived from password, PRF, or Touch ID).
     * Returns base64-encoded blob: [nonce || ciphertext].
     */
    async wrapMVK(mvk, kek) {
        await this.ensureReady();
        const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        const ciphertext = sodium.crypto_secretbox_easy(mvk, nonce, kek);
        const combined = new Uint8Array(nonce.length + ciphertext.length);
        combined.set(nonce);
        combined.set(ciphertext, nonce.length);
        return sodium.to_base64(combined);
    }

    /**
     * Unwrap MVK with a symmetric KEK.
     * Returns the raw MVK bytes.
     */
    async unwrapMVK(wrappedBase64, kek) {
        await this.ensureReady();
        const data = sodium.from_base64(wrappedBase64);
        const nonce = data.slice(0, sodium.crypto_secretbox_NONCEBYTES);
        const ciphertext = data.slice(sodium.crypto_secretbox_NONCEBYTES);
        try {
            return sodium.crypto_secretbox_open_easy(ciphertext, nonce, kek);
        } catch (e) {
            throw new Error('Failed to unwrap MVK — wrong key or corrupted wrap');
        }
    }

    /**
     * Derive a KEK from password using Argon2id.
     * Returns { kek: Uint8Array, salt: string (base64) }
     */
    async deriveKEKFromPassword(password, saltBase64 = null) {
        await this.ensureReady();
        let salt;
        if (saltBase64) {
            salt = sodium.from_base64(saltBase64);
        } else {
            salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
        }
        const kek = sodium.crypto_pwhash(
            sodium.crypto_secretbox_KEYBYTES,
            password,
            salt,
            sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
            sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
            sodium.crypto_pwhash_ALG_ARGON2ID13
        );
        return { kek, salt: sodium.to_base64(salt) };
    }

    /**
     * Derive a KEK from WebAuthn PRF output.
     * The PRF output is already high-entropy, so we just hash it to the right length.
     */
    async deriveKEKFromPRF(prfOutput) {
        await this.ensureReady();
        // BLAKE2b hash to get exactly 32 bytes
        return sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, new Uint8Array(prfOutput));
    }

    /**
     * Encrypt the user's private key with MVK (for local storage).
     * Returns base64-encoded blob.
     */
    async encryptPrivateKeyWithMVK(privateKeyBase64, mvk) {
        await this.ensureReady();
        const privateKey = sodium.from_base64(privateKeyBase64);
        const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
        const ciphertext = sodium.crypto_secretbox_easy(privateKey, nonce, mvk);
        const combined = new Uint8Array(nonce.length + ciphertext.length);
        combined.set(nonce);
        combined.set(ciphertext, nonce.length);
        return sodium.to_base64(combined);
    }

    /**
     * Decrypt the user's private key with MVK.
     * Returns base64-encoded private key.
     */
    async decryptPrivateKeyWithMVK(encryptedBase64, mvk) {
        await this.ensureReady();
        const data = sodium.from_base64(encryptedBase64);
        const nonce = data.slice(0, sodium.crypto_secretbox_NONCEBYTES);
        const ciphertext = data.slice(sodium.crypto_secretbox_NONCEBYTES);
        try {
            const privateKey = sodium.crypto_secretbox_open_easy(ciphertext, nonce, mvk);
            return sodium.to_base64(privateKey);
        } catch (e) {
            throw new Error('Failed to decrypt private key with MVK');
        }
    }

    /**
     * Generate a fresh local vault key (32 random bytes), same shape as an MVK.
     * Used for accountless / local-first E2EE where there is no password.
     */
    async generateVaultKey() {
        await this.ensureReady();
        return sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
    }

    // ─── Ed25519 identity signing (P2P team roster) ───
    //
    // The roster proves "who is alice" by storing the Ed25519 PUBLIC key derived
    // from her username+password. To act as alice you must re-derive the matching
    // private key (you can't, without the password) and sign with it. These are
    // the low-level primitives; team-keys.js owns the domain-separated salt and
    // the (teamId, username, password) → keypair convenience wrapper.

    /** Build an Ed25519 keypair from a 32-byte seed (deterministic). */
    async generateSigningKeyPairFromSeed(seed) {
        await this.ensureReady();
        if (!(seed instanceof Uint8Array) || seed.length !== sodium.crypto_sign_SEEDBYTES) {
            throw new Error(`Seed must be ${sodium.crypto_sign_SEEDBYTES} bytes`);
        }
        const kp = sodium.crypto_sign_seed_keypair(seed);
        return {
            publicKey: sodium.to_base64(kp.publicKey),
            privateKey: sodium.to_base64(kp.privateKey),
        };
    }

    /** Detached Ed25519 signature over `message` (string or Uint8Array). Returns base64. */
    async signDetached(message, privateKeyBase64) {
        await this.ensureReady();
        const msg = typeof message === 'string' ? sodium.from_string(message) : message;
        const sk = sodium.from_base64(privateKeyBase64);
        return sodium.to_base64(sodium.crypto_sign_detached(msg, sk));
    }

    /** Verify a detached Ed25519 signature. Never throws — returns false on any error. */
    async verifyDetached(signatureBase64, message, publicKeyBase64) {
        await this.ensureReady();
        try {
            const sig = sodium.from_base64(signatureBase64);
            const msg = typeof message === 'string' ? sodium.from_string(message) : message;
            const pk = sodium.from_base64(publicKeyBase64);
            return sodium.crypto_sign_verify_detached(sig, msg, pk);
        } catch (e) {
            return false;
        }
    }

    /**
     * Deterministically derive an Ed25519 identity keypair from a password and a
     * caller-supplied, already-domain-separated salt (team-keys.js builds the
     * salt as BLAKE2b("notionless:id:salt" ‖ teamId ‖ username), so the same
     * credentials yield DIFFERENT keys in different teams).
     *
     * Argon2id runs at MODERATE limits by default: this key IS the identity
     * proof, and anyone holding the team link can read the roster (every public
     * key) and brute-force a weak password offline against it (caveat R5).
     *
     * @param {Uint8Array} saltBytes crypto_pwhash_SALTBYTES (16) salt
     * @param {string} password
     * @returns {Promise<{publicKey:string, privateKey:string}>}
     */
    async deriveIdentityKeyPair(saltBytes, password, { moderate = true } = {}) {
        await this.ensureReady();
        if (!(saltBytes instanceof Uint8Array) || saltBytes.length !== sodium.crypto_pwhash_SALTBYTES) {
            throw new Error('deriveIdentityKeyPair: salt must be crypto_pwhash_SALTBYTES bytes');
        }
        const seed = sodium.crypto_pwhash(
            sodium.crypto_sign_SEEDBYTES,
            password,
            saltBytes,
            moderate ? sodium.crypto_pwhash_OPSLIMIT_MODERATE : sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
            moderate ? sodium.crypto_pwhash_MEMLIMIT_MODERATE : sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
            sodium.crypto_pwhash_ALG_ARGON2ID13,
        );
        const kp = sodium.crypto_sign_seed_keypair(seed);
        return {
            publicKey: sodium.to_base64(kp.publicKey),
            privateKey: sodium.to_base64(kp.privateKey),
        };
    }

    /**
     * Domain-separated BLAKE2b hash. Concatenates a label and any number of
     * string/Uint8Array parts and returns `outLen` bytes. The single hashing
     * primitive used by team-keys.js for all key/salt derivations.
     */
    async hashConcat(outLen, label, ...parts) {
        await this.ensureReady();
        const chunks = [sodium.from_string(String(label))];
        for (const p of parts) {
            chunks.push(p instanceof Uint8Array ? p : sodium.from_string(String(p)));
        }
        let total = 0;
        for (const c of chunks) total += c.length;
        const buf = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
        return sodium.crypto_generichash(outLen, buf);
    }

    toBase64(arr) {
        return sodium.to_base64(arr);
    }

    fromBase64(str) {
        return sodium.from_base64(str);
    }

    toHex(arr) {
        return sodium.to_hex(arr);
    }
}

export const e2eeManager = new E2EEManager();
