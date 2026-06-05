import sodium from 'libsodium-wrappers'

/**
 * Notionless Cryptography Engine
 * Handles Identity, Key Management, and Document Encryption.
 * 
 * INVARIANTS:
 * 1. Private keys NEVER leave the device.
 * 2. Document keys are symmetric (shared via envelopes).
 * 3. Envelopes are encrypted to specific recipients (Public Key).
 */
export class CryptoManager {
  constructor() {
    this.ready = sodium.ready
    this.identity = null
  }

  async init() {
    await this.ready
    this.loadIdentity()
  }

  /**
   * Load or Generate Identity (Ed25519)
   */
  loadIdentity() {
    const stored = localStorage.getItem('opus_id_private')
    if (stored) {
      const privateKey = sodium.from_hex(stored)
      this.identity = {
        privateKey,
        publicKey: sodium.crypto_sign_ed25519_sk_to_pk(privateKey)
      }
    } else {
      const { privateKey, publicKey } = sodium.crypto_sign_keypair()
      this.identity = { privateKey, publicKey }
      localStorage.setItem('opus_id_private', sodium.to_hex(privateKey))
    }
    console.log('[Crypto] Identity Loaded:', this.getPublicKey())
  }

  getPublicKey() {
    return sodium.to_hex(this.identity.publicKey)
  }

  /**
   * Generate a fresh Document Key (Symmetric)
   */
  generateDocKey() {
    return sodium.crypto_secretbox_keygen()
  }

  /**
   * Encrypt Document Data (Symmetric)
   * Used for Snapshots and P2P Sync.
   */
  encryptData(data, docKey) {
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
    const ciphertext = sodium.crypto_secretbox_easy(data, nonce, docKey)
    
    // Return combined [nonce + ciphertext]
    const combined = new Uint8Array(nonce.length + ciphertext.length)
    combined.set(nonce)
    combined.set(ciphertext, nonce.length)
    return combined
  }

  /**
   * Decrypt Document Data
   */
  decryptData(encryptedBundle, docKey) {
    const nonce = encryptedBundle.slice(0, sodium.crypto_secretbox_NONCEBYTES)
    const ciphertext = encryptedBundle.slice(sodium.crypto_secretbox_NONCEBYTES)
    return sodium.crypto_secretbox_open_easy(ciphertext, nonce, docKey)
  }

  /**
   * Create an Invite Envelope
   * Encrypts the Doc Key for a Recipient's Public Key.
   */
  createEnvelope(docKey, recipientPublicKeyHex) {
    const recipientPK = sodium.from_hex(recipientPublicKeyHex)
    // crypto_box_seal (Anonymous sender is fine for invites, or use authenticated box)
    return sodium.crypto_box_seal(docKey, recipientPK)
  }

  /**
   * Open an Invite Envelope
   */
  openEnvelope(encryptedDocKey) {
    return sodium.crypto_box_seal_open(
      encryptedDocKey, 
      this.identity.publicKey, 
      this.identity.privateKey
    )
  }
}

export const cryptoManager = new CryptoManager()
