# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Native mobile companion** (iOS / Android) under `apps/mobile-native` — pair a
  phone to a desktop team with one link or a QR scan, then read and edit notes on
  the same end-to-end-encrypted P2P swarm. Reuses the desktop engine (key
  derivation, signed roster, Yjs + E2EE transport) on a native build (libsodium,
  WebRTC, camera). Light/dark, system-driven.
- **Device pairing** — `notionless-pair:` links (72h TTL) and a desktop
  "Link a device" QR dialog; the phone self-claims its own identity in the team.
- Open-source project files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, root
  `SECURITY.md`, GitHub issue/PR templates, and this changelog.

## [1.0.8] — 2026-06-03

### Added
- **Company Brain** — local-first RAG Q&A over your workspace (offline retrieval
  plus optional LLM generation), with a redesigned drawer.

### Changed
- Company Brain redesign; chevron-in-circle affordance; sidebar alignment polish.

## [1.0.0]

### Added
- Initial public-shape release: CodeMirror 6 native-Markdown editor, Yjs CRDT
  collaboration over WebRTC, end-to-end encryption (libsodium), zero-account
  teams with a signed roster, per-note least-privilege sharing, databases,
  full-text search, and the sandboxed plugin system.

[Unreleased]: ../../compare/v1.0.8...HEAD
[1.0.8]: ../../releases/tag/v1.0.8
[1.0.0]: ../../releases/tag/v1.0.0
