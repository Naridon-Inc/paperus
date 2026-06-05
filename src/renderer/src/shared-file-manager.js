import { authClient } from './auth-client'
import Store from './store'

export class SharedFileManager {
    constructor() {
        this.isSyncing = false
    }

    async sync() {
        if (this.isSyncing) return
        if (!authClient?.token) return
        this.isSyncing = true

        try {
            const projectPath = Store.projectPath
            if (!projectPath) return

            const sharedDocs = await authClient.getSharedDocuments().catch(e => {
                console.warn('[SharedFileManager] Failed to fetch shared docs:', e)
                return []
            })

            if (sharedDocs.length === 0) return

            const currentUser = authClient.user || await authClient.getMe().catch(() => null)
            const currentUserId = currentUser?.id

            // For own shared docs, just tag them as cloud-backed in the manifest
            for (const doc of sharedDocs) {
                if (doc.creator && doc.creator.id === currentUserId) {
                    const existingPath = await window.api.invoke('fs:getPathByDocId', doc.id).catch(() => null)
                    if (existingPath) {
                        try { await window.api.invoke('fs:tagCloudDoc', doc.id) } catch (_) {}
                    }
                }
            }

            // Shared docs from others are rendered in the sidebar from the API response.
            // No need to create physical Shared/ placeholder files — they just clutter the file tree.
            // The sidebar's Shared section handles display; opening a shared doc uses cmd:open-cloud-doc.

        } catch (e) {
            console.error('[SharedFileManager] Sync failed:', e)
        } finally {
            this.isSyncing = false
        }
    }
}

export const sharedFileManager = new SharedFileManager()
