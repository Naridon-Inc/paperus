import * as Y from 'yjs'
import { cryptoManager } from './crypto'
import sodium from 'libsodium-wrappers'

/**
 * Opus Snapshot Manager
 * Handles creating and restoring immutable snapshots of the document state.
 * 
 * INVARIANTS:
 * 1. Snapshots are immutable.
 * 2. Restoring creates a NEW state (preserves linearity).
 * 3. Snapshots store CRDT binary, not just text.
 * 4. Snapshots are encrypted before storage.
 */
export class SnapshotManager {
  constructor(engine) {
    this.engine = engine
  }

  /**
   * Create a snapshot of the current state.
   * @param {string} label - Optional user label (e.g. "Draft 1")
   * @returns {Object} Snapshot metadata
   */
  async createSnapshot(label = null) {
    try {
        // 1. Encode Yjs State to Binary
        const stateVector = Y.encodeStateAsUpdate(this.engine.doc)
        
        const snapshotKey = cryptoManager.generateDocKey()
        const encryptedData = cryptoManager.encryptData(stateVector, snapshotKey)
        
        // 2. Prepare Metadata
        const timestamp = Date.now()
        const id = `${timestamp}_${Math.random().toString(36).substr(2, 9)}`
        
        const snapshot = {
          id,
          timestamp,
          label,
          size: encryptedData.byteLength,
          // Store the key locally in metadata
          key: sodium.to_hex(snapshotKey) 
        }

        // 3. Persist (Send to Main Process)
        // We send the binary blob to be saved in .notionless/history
        await window.api.invoke('fs:saveSnapshot', {
          docId: this.engine.docId,
          metadata: snapshot,
          data: encryptedData // ArrayBuffer
        })

        console.log(`[Snapshot] Created ${id} (${label || 'Auto'})`)
        return snapshot
    } catch (e) {
        console.warn('[Snapshot] Create failed:', e)
        return null
    }
  }

  /**
   * Restore a snapshot.
   */
  async restoreSnapshot(snapshotId) {
    // Legacy / Placeholder
    console.warn('Use restoreSnapshotWithKey instead')
  }
  
  // Revised restore signature
  async restoreSnapshotWithKey(snapshotId, keyHex) {
    const buffer = await window.api.invoke('fs:loadSnapshot', {
      docId: this.engine.docId,
      snapshotId
    })

    if (!buffer) throw new Error('Snapshot data not found')

    // Decrypt
    const key = sodium.from_hex(keyHex)
    const decrypted = cryptoManager.decryptData(new Uint8Array(buffer), key)

    // Apply
    const tempDoc = new Y.Doc()
    Y.applyUpdate(tempDoc, decrypted)
    const snapshotText = tempDoc.getText('content').toString()
    
    this.engine.doc.transact(() => {
      const currentText = this.engine.text
      currentText.delete(0, currentText.length)
      currentText.insert(0, snapshotText)
    }, 'restore')
    
    console.log(`[Snapshot] Restored ${snapshotId}`)
  }

  /**
   * Prune snapshots based on retention policy:
   * - Keep all every 10 min for last 1 hour
   * - Keep hourly for last 24 hours
   * - Keep daily for everything else
   */
  async pruneSnapshots() {
      // Fetch all snapshots metadata
      // We don't have a direct method to list all, assuming main process handles storage structure.
      // But we need to implement fs:listSnapshots in main.js if not exists.
      // Assuming we can get list.
      
      try {
          const snapshots = await window.api.invoke('fs:getHistory', this.engine.docId)
          if (!snapshots || snapshots.length === 0) return

          const now = Date.now()
          const oneHour = 60 * 60 * 1000
          const oneDay = 24 * 60 * 60 * 1000
          
          const toDelete = []
          const kept = [] // Track kept timestamps to enforce hourly/daily gaps
          
          // Sort new to old
          snapshots.sort((a, b) => b.timestamp - a.timestamp)
          
          snapshots.forEach(snap => {
              const age = now - snap.timestamp
              
              if (age < oneHour) {
                  // Keep all (10 min interval is natural creation rate)
                  kept.push(snap)
              } else if (age < oneDay) {
                  // Keep hourly
                  // Check if we already have a snapshot for this hour
                  const snapDate = new Date(snap.timestamp)
                  const hourKey = `${snapDate.getDate()}-${snapDate.getHours()}`
                  
                  const hasHour = kept.some(k => {
                      const kDate = new Date(k.timestamp)
                      return `${kDate.getDate()}-${kDate.getHours()}` === hourKey
                  })
                  
                  if (!hasHour) {
                      kept.push(snap)
                  } else {
                      toDelete.push(snap.id)
                  }
              } else {
                  // Keep daily
                  const snapDate = new Date(snap.timestamp)
                  const dayKey = `${snapDate.getFullYear()}-${snapDate.getMonth()}-${snapDate.getDate()}`
                  
                  const hasDay = kept.some(k => {
                      const kDate = new Date(k.timestamp)
                      return `${kDate.getFullYear()}-${kDate.getMonth()}-${kDate.getDate()}` === dayKey
                  })
                  
                  if (!hasDay) {
                      kept.push(snap)
                  } else {
                      toDelete.push(snap.id)
                  }
              }
          })
          
          // Execute deletions
          for (const id of toDelete) {
              await window.api.invoke('fs:deleteSnapshot', { docId: this.engine.docId, snapshotId: id })
          }
          
          if (toDelete.length > 0) {
              console.log(`[Snapshot] Pruned ${toDelete.length} old snapshots`)
          }
          
      } catch (e) {
          console.warn('[Snapshot] Prune failed:', e)
      }
  }
}
