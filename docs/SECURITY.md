# Security model

Paperus is **end‑to‑end encrypted, zero‑account, and peer‑to‑peer**. No server
ever holds a readable copy of your notes, your password, or your keys. This
document describes exactly what is protected, how, and — just as importantly —
what is *not*. (See also the per‑feature caveats `R1`–`R9` in `CLAUDE.md`.)

## What the relay / a self‑hosted box can see

Nothing readable. Every byte that crosses the wire or rests on a server is one of:

- a **BLAKE2b‑hashed room name** (`notionless-<hash>`) — a one‑way hash of a
  secret it doesn't have, so it can't tell which note or team a room belongs to;
- **AEAD ciphertext** — the encrypted note state.

The relay stores nothing by default. A [self‑hosted sync box](./SELF_HOSTED_SYNC.md)
can optionally persist the ciphertext, but it is still only ciphertext keyed by a
hash.

## How a note is encrypted

1. **One team secret.** A team is one random `teamRootKey` (the thing inside a
   `notionless-team:` link). Every other key — team id, swarm topics, and each
   note's content key — is derived from it with **domain‑separated BLAKE2b**
   hashes (`team-keys.js`). The link is the team's entire access boundary.
2. **Per‑note keys.** Each note gets its own swarm key (who may *replicate* its
   ciphertext) and its own content key (who may *decrypt* it). Distinct notes
   derive distinct keys, so one note's key can never read another's blobs.
3. **AEAD on every update.** Note content is encrypted with
   **XChaCha20‑Poly1305‑IETF** (`e2ee.js encryptUpdate`):
   - a fresh 192‑bit random nonce per update (no nonce‑reuse risk);
   - the **note's docId is bound in as associated data**, so a ciphertext
     authenticated for note A fails to open if replayed into note B;
   - the Poly1305 tag rejects any tampering — a single flipped bit ⇒ `null`,
     never a silent corruption.
4. **Plaintext never leaves the device.** When a doc is encrypted, the WebRTC /
   cloud providers bind to a separate **transport doc** (a Y.Array of ciphertext
   blobs), never the plaintext CRDT (`p2p.js`, `engine.js`). Peers and servers
   exchange only ciphertext.
5. **Sealing to a person.** Restricted‑note grants and direct "send to a contact"
   seal a content key to the recipient's identity key (Ed25519 → X25519
   `crypto_box_seal`). Only that recipient can unwrap it; a non‑recipient cannot.

## Identity (anti‑impersonation)

A member's identity is a deterministic **Ed25519 keypair** =
`Argon2id(password, salt = H(teamId ‖ username))`. Same credentials re‑derive the
same key on any device (nothing stored); the `teamId` in the salt means the same
username+password yields a *different* key in every team. The roster is a
**signed, append‑only CRDT** — forged entries fail signature checks and are
ignored. The private key lives in session memory only, never on disk.

## Transport‑log compaction (forward privacy of deletions)

Because **every member replicates every note's ciphertext**, the encrypted update
log would otherwise be an *append‑only* record of every keystroke — meaning any
key‑holder could decrypt the full history, **including text that was later
deleted**, forever.

Paperus **compacts** that log (`engine.js _compactTransport`): once it grows
past a threshold it is replaced, in one atomic step, with a **single snapshot
taken from a garbage‑collected clone of the document**. The clone has no undo
history holding deleted content, so the snapshot encodes only what is *currently
visible*. After compaction:

- the replicated log is one blob, not a full edit history (much less to store);
- **a member who joins later can never recover previously‑deleted text** — they
  only ever receive the clean snapshot.

This is verified end‑to‑end in `tests/crdt-sync.test.cjs` (deleted text is
recoverable from the log *before* compaction and gone *after*, including for a
fresh joiner).

## Honest limitations

- **Insider integrity (shared‑key writes).** "Everyone reads everything" implies
  "everyone can write everything": any team member holding the content key can
  forge or vandalize a note's CRDT. Confidentiality vs. the relay and outsiders
  is strong; integrity is the team's mutual trust. Per‑writer signatures are
  out of scope today.
- **Metadata.** Members can see that a (restricted) note *exists* and observe its
  ciphertext size and update cadence; only the content/title is hidden.
- **Offline guessing.** Anyone with the team link can read the roster (public
  keys) and brute‑force a *weak* member password offline. Mitigated by
  Argon2id‑MODERATE, a strength meter, and an optional `joinSecret`. Use a strong
  password.
- **No revocation / no forward secrecy.** Removing a member means rotating the
  team key (i.e. a new team). Someone who already replicated a note's ciphertext
  keeps that copy; compaction protects *future* joiners, not past holders.
- **Local plaintext at rest.** On your own device, a note you can read is stored
  in plaintext (IndexedDB / local Markdown files) and its in‑memory undo history
  may retain recently‑deleted text until the doc is reloaded. This never leaves
  your device. Protect the device itself (full‑disk encryption).
- **Availability needs ≥1 online holder** in pure P2P mode. Run a
  [self‑hosted sync box](./SELF_HOSTED_SYNC.md) if you want 24/7 availability
  without giving up E2EE.

## Tests

| Suite | Proves |
|---|---|
| `npm run test:crypto` | AEAD round‑trip, tamper‑reject, note‑bound AAD, wrong‑key/cross‑note isolation, seal‑to‑person, deterministic per‑team identity |
| `npm run test:sync` | two‑ and four‑peer realtime convergence, ciphertext‑only on the wire, compaction destroys deleted‑content history, no lost writes under concurrent team editing |
| `npm run test:relay` | self‑hosted box persists ciphertext to disk and serves it with no peer online |
