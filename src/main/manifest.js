/**
 * @typedef {Object} NotionlessManifest
 * @property {string} version - Schema version (e.g., "1.0")
 * @property {string} deviceId - ID of the current device
 * @property {Object.<string, DocumentEntry>} documents - Map of doc_id to document metadata
 */

/**
 * @typedef {Object} DocumentEntry
 * @property {string} id - Stable UUID (The Source of Truth)
 * @property {string} path - Relative path to the projected file (e.g., "Notes/Meeting.md")
 * @property {number} lastModified - Timestamp of last local edit
 * @property {string} headHash - SHA-256 hash of the latest snapshot
 * @property {string} encryptionKeyId - ID of the key used to encrypt this doc
 * @property {string[]} peers - Public keys of users with access
 */

import fs from 'fs-extra'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

export class ManifestManager {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.manifestPath = path.join(projectPath, '.notionless', 'manifest.json');
    this.data = null;
  }

  /**
   * Initialize or load the manifest.
   * INVARIANT: The manifest tracks identity. The filesystem tracks projection.
   */
  async init() {
    await fs.ensureDir(path.join(this.projectPath, '.notionless'));
    
    if (await fs.pathExists(this.manifestPath)) {
      // Safety check: Is the manifest too large? (e.g. > 5MB implies corruption or massive recursion)
      const stats = await fs.stat(this.manifestPath);
      if (stats.size > 5 * 1024 * 1024) {
          console.warn('[Manifest] File too large, backing up and resetting:', this.manifestPath);
          await fs.move(this.manifestPath, this.manifestPath + '.bak', { overwrite: true });
          this.data = this.createDefaultData();
          await this.save();
      } else {
          try {
            this.data = await fs.readJson(this.manifestPath);
            await this.reconcile();
          } catch (e) {
            console.error('[Manifest] Corrupted, resetting:', e);
            await fs.move(this.manifestPath, this.manifestPath + '.corrupted', { overwrite: true });
            this.data = this.createDefaultData();
            await this.save();
          }
      }
    } else {
      this.data = this.createDefaultData();
      await this.save();
    }
  }

  createDefaultData() {
      return {
        version: "1.0",
        deviceId: uuidv4(),
        documents: {}
      };
  }

  async save() {
    await fs.writeJson(this.manifestPath, this.data, { spaces: 2 });
  }

  /**
   * Get a document ID by its file path.
   * If strictly new, generates a new ID.
   * @param {string} relativePath 
   * @returns {string} doc_id
   */
  getDocIdByPath(relativePath) {
    if (!relativePath) return null;
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    for (const [id, entry] of Object.entries(this.data.documents)) {
      if (entry.path && entry.path.replace(/\\/g, '/').replace(/^\/+/, '') === normalized) return id;
    }
    return null;
  }

  /**
   * Get the file path for a given doc_id
   * @param {string} docId 
   * @returns {string|null} relativePath
   */
  getPathByDocId(docId) {
    if (this.data.documents[docId]) {
      return this.data.documents[docId].path;
    }
    return null;
  }

  /**
   * Register a file in the manifest with an existing/specific Doc ID.
   * Use this for mounting cloud documents or restoring backups.
   */
  async registerCloudFile(relativePath, docId) {
    // Check if docId is already registered
    if (this.data.documents[docId]) {
      const existingPath = this.data.documents[docId].path;
      if (existingPath !== relativePath) {
          const existingNorm = (existingPath || '').replace(/\\/g, '/');
          const newNorm = relativePath.replace(/\\/g, '/');
          // If already registered at a local (non-Shared) path, DON'T remap.
          // The local path is the user's real file; the Shared/ path is just a projection.
          // Just ensure it's tagged as cloud-backed.
          if (!existingNorm.startsWith('Shared/') && newNorm.startsWith('Shared/')) {
              console.log(`[Manifest] DocID ${docId} already at local path "${existingPath}", keeping it (not remapping to "${relativePath}")`);
              const doc = this.data.documents[docId];
              doc.tags = doc.tags || [];
              if (!doc.tags.includes('cloud')) {
                  doc.tags.push('cloud');
                  await this.save();
              }
              return docId;
          }
          console.warn(`[Manifest] Remapping DocID ${docId} from ${existingPath} to ${relativePath}`);
          this.data.documents[docId].path = relativePath;
          await this.save();
      }
      return docId;
    }

    // Check if path is already taken by another ID
    const existingId = this.getDocIdByPath(relativePath);
    if (existingId && existingId !== docId) {
       // Path collision. The Cloud ID is the source of truth.
       // Merge: remap the old local docId to the cloud docId so they converge.
       console.warn(`[Manifest] Path ${relativePath} was registered to local DocID ${existingId}. Migrating to Cloud DocID ${docId}.`);
       const oldEntry = this.data.documents[existingId];
       if (oldEntry) {
           // Transfer the entry to the cloud docId, preserving path
           this.data.documents[docId] = {
               ...oldEntry,
               id: docId,
               tags: [...(oldEntry.tags || []), 'cloud']
           };
           // Remove old entry
           delete this.data.documents[existingId];
           await this.save();
           return docId;
       }
    }

    this.data.documents[docId] = {
      id: docId,
      path: relativePath,
      lastModified: Date.now(),
      headHash: null,
      encryptionKeyId: 'default',
      peers: [],
      tags: ['cloud']
    };
    await this.save();
    return docId;
  }

  /**
   * Register a file in the manifest.
   * INVARIANT: Document identity (doc_id) never changes, even if path changes.
   */
  async registerFile(relativePath) {
    // Normalize path separators
    const normalizedPath = relativePath.replace(/\\/g, '/');
    let id = this.getDocIdByPath(normalizedPath);
    
    if (!id) {
      id = uuidv4();
      this.data.documents[id] = {
        id,
        path: normalizedPath,
        lastModified: Date.now(),
        headHash: null,
        encryptionKeyId: 'default', // Placeholder for Prompt 6
        peers: [],
        tags: []
      };
      await this.save();
    }
    return id;
  }

  async addTag(docId, tag) {
    if (!this.data.documents[docId]) {
        console.warn(`[Manifest] Cannot add tag: docId ${docId} not found in manifest`)
        return
    }
    const doc = this.data.documents[docId]
    doc.tags = doc.tags || []
    if (!doc.tags.includes(tag)) {
      doc.tags.push(tag)
      await this.save()
      console.log(`[Manifest] Added tag "${tag}" to ${doc.path}`)
    }
  }
  
  async removeTag(docId, tag) {
    if (this.data.documents[docId]) {
      const doc = this.data.documents[docId]
      if (doc.tags) {
        doc.tags = doc.tags.filter(t => t !== tag)
        await this.save()
      }
    }
  }

  /**
   * Update the path of a document (Rename/Move).
   * INVARIANT: doc_id remains constant.
   */
  /**
   * Reconcile manifest: remove stale entries, merge duplicates.
   * Call on startup after loading.
   */
  async reconcile() {
    let changed = false;
    const pathToId = new Map();

    for (const [id, entry] of Object.entries(this.data.documents)) {
      if (!entry.path) continue;
      const norm = entry.path.replace(/\\/g, '/');

      // Remove .local_conflict entries — they're stale artifacts
      if (norm.endsWith('.local_conflict')) {
        console.log(`[Manifest] Removing stale conflict entry: ${id} -> ${entry.path}`);
        delete this.data.documents[id];
        changed = true;
        continue;
      }

      // Detect duplicate paths (two different docIds pointing to same file)
      if (pathToId.has(norm)) {
        const existingId = pathToId.get(norm);
        const existingEntry = this.data.documents[existingId];
        // Keep the one tagged as 'cloud' (it's the shared source of truth)
        const existingIsCloud = existingEntry?.tags?.includes('cloud');
        const currentIsCloud = entry.tags?.includes('cloud');
        if (currentIsCloud && !existingIsCloud) {
          console.log(`[Manifest] Merging duplicate path "${norm}": keeping cloud ${id}, removing local ${existingId}`);
          delete this.data.documents[existingId];
          pathToId.set(norm, id);
        } else {
          console.log(`[Manifest] Merging duplicate path "${norm}": keeping ${existingId}, removing ${id}`);
          delete this.data.documents[id];
        }
        changed = true;
        continue;
      }
      pathToId.set(norm, id);
    }

    if (changed) await this.save();
  }

  async updatePath(docId, newPath) {
    if (!this.data.documents[docId]) throw new Error(`Document ${docId} not found`);
    this.data.documents[docId].path = newPath;
    this.data.documents[docId].lastModified = Date.now();
    await this.save();
  }
}
