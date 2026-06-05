// Abstract File System Interface
import { authClient } from './auth-client'

export class CloudFileSystem {
  constructor() {
    this.isCloud = true;
  }
  
  async getDirectoryTree(parentId = null, teamId = null) {
      // Logic to parse "path" if it's passed as a string like "folder:123"
      if (typeof parentId === 'string' && parentId.startsWith('folder:')) {
          parentId = parentId.replace('folder:', '');
      } else if (parentId === 'root') {
          parentId = null;
      }

      const url = await authClient.getUrl(`/fs?${parentId ? `parentId=${parentId}` : ''}${teamId ? `&teamId=${teamId}` : ''}`);
      const res = await fetch(url, { headers: authClient.headers });
      if (!res.ok) throw new Error('Failed to list files');
      const data = await res.json();
      
      return {
          path: parentId ? `folder:${parentId}` : 'root',
          name: 'Cloud Files',
          type: 'directory',
          children: [
              ...data.folders.map(f => ({
                  path: `folder:${f.id}`,
                  name: f.name,
                  type: 'directory',
                  children: [] // Placeholder for lazy load
              })),
              ...data.documents.map(d => ({
                  path: `cloud:${d.id}`,
                  name: d.name,
                  type: 'file',
                  id: d.id
              }))
          ]
      };
  }
  
  async createFolder(name, parentId, teamId) {
      const url = await authClient.getUrl('/fs');
      await fetch(url, {
          method: 'POST',
          headers: authClient.headers,
          body: JSON.stringify({ name, parentId, teamId })
      });
  }

  async updateLinks(oldPath, newPath) {
      // Cloud uses ID-based links, so path changes (renames) don't break links usually.
      // But if we support path-based links in markdown, we might need this.
      // For now, no-op.
  }

  async getSettings(key) {
      try {
          const val = localStorage.getItem(key);
          return val ? JSON.parse(val) : null;
      } catch (e) { return null; }
  }

  async setSettings(key, val) {
      try {
          localStorage.setItem(key, JSON.stringify(val));
      } catch (e) {}
  }
  
  async showOpenDialog(opts) {
      // Mock for web or implement HTML input trigger
      alert('File import not fully supported on Web yet.');
      return { canceled: true, filePaths: [] };
  }

  // File Operations
  async pathExists(path) {
      if (!path) return false;
      // For cloud, we assume the exact virtual path for an existing document exists.
      // But for "root/Untitled.md" or "folder:123/Untitled.md", we return false 
      // to allow the createNewNote while-loop to terminate.
      if (path.startsWith('cloud:') && !path.includes('/')) return true;
      if (path.startsWith('folder:') && !path.includes('/')) return true;
      return false; 
  }

  async readFile(path) {
      // Cloud docs are normally loaded via Yjs/WebSocket (live editing), but the
      // git-sync bridge needs the markdown body OUTSIDE the editor session. The
      // backend reconstructs it from stored Yjs updates at GET /documents/:id/content.
      //
      // Resolve the doc id from the virtual path the same scheme getDirectoryTree
      // emits ("cloud:<id>" or "cloud:<id>:<name>"). Anything else (folders, etc.)
      // has no body — return "".
      const docId = await this.getDocId(path);
      if (!docId) return "";

      try {
          const url = await authClient.getUrl(`/documents/${encodeURIComponent(docId)}/content`);
          const res = await fetch(url, { headers: authClient.headers });

          // 204 = no body available (e.g. RELAY_ONLY mode with no DB persistence).
          if (res.status === 204) return "";
          if (!res.ok) {
              console.warn(`[CloudFileSystem.readFile] content fetch for ${docId} failed: HTTP ${res.status}`);
              return ""; // Preserve prior behavior on failure so nothing breaks.
          }

          const data = await res.json().catch(() => null);
          return (data && typeof data.content === 'string') ? data.content : "";
      } catch (e) {
          console.warn(`[CloudFileSystem.readFile] content fetch for ${docId} errored:`, e && e.message);
          return ""; // Fall back to empty so callers (git sync) never hard-fail.
      }
  }

  async writeFile(path, content) {
      // In cloud, "writing" a new file means creating a Document record.
      // Content is handled by Yjs.
      // If path is "folder:123/NewDoc.md", we need to create it.
      // But main.js generates paths like "Untitled_1.md".
      
      // If we are "creating" a file, we actually call the API to create a doc.
      // main.js logic for "creating" needs to be adapted.
      // For now, we'll assume this is a metadata update or no-op if doc exists.
      console.log('CloudFileSystem.writeFile', path, content);
      
      // If it's a new doc creation (naive check)
      if (path.includes('Untitled')) {
          // create doc?
      }
  }

  async delete(path) {
      const type = path.startsWith('folder:') ? 'folder' : 'document';
      const id = path.replace('folder:', '').replace('cloud:', '');
      
      const url = await authClient.getUrl('/fs');
      await fetch(url, {
          method: 'DELETE',
          headers: authClient.headers,
          body: JSON.stringify({ type, id })
      });
  }

  async rename(path, newName) {
      const type = path.startsWith('folder:') ? 'folder' : 'document';
      const id = path.replace('folder:', '').replace('cloud:', '');
      
      const url = await authClient.getUrl('/fs/rename');
      await fetch(url, {
          method: 'PUT',
          headers: authClient.headers,
          body: JSON.stringify({ type, id, name: newName })
      });
  }

  // Path Utils (Virtual)
  async basename(path) {
      if (!path) return '';
      // cloud:123:MyDoc -> MyDoc
      const parts = path.split(':');
      if (parts.length > 2) return decodeURIComponent(parts[2]);
      if (parts.length === 2) return 'Untitled'; // cloud:123
      return path;
  }

  async dirname(path) {
      if (!path) return 'root';
      // simple mock
      return 'root';
  }

  async extname(path) {
      return ''; 
  }
  
  async getDocId(path) {
      if (path.startsWith('cloud:')) {
          const parts = path.split(':');
          return parts[1]; // cloud:ID:Name -> ID
      }
      return null;
  }

  async getPathByDocId(docId) {
      // In cloud, we don't really have paths like local FS.
      // We could return a virtual path.
      return `cloud:${docId}`;
  }

  async isFullScreen() {
      return !!document.fullscreenElement;
  }

  async saveWorkspace(data) {
      localStorage.setItem('workspace', JSON.stringify(data));
  }

  async loadWorkspace() {
      const data = localStorage.getItem('workspace');
      return data ? JSON.parse(data) : { projects: [], files: [] };
  }
}

export const fileSystem = {
    current: null, 
    
    async init() {
        const isElectron = window.api !== undefined;
        
        if (isElectron) {
             // Local FS (via IPC)
             this.current = {
                isCloud: false,
                getDirectoryTree: (path) => window.api.invoke('fs:getDirectoryTree', path),
                pathExists: (path) => window.api.invoke('fs:pathExists', path),
                writeFile: (path, content) => window.api.invoke('fs:writeFile', path, content),
                readFile: (path) => window.api.readFile(path),
                delete: (path) => window.api.invoke('fs:delete', path),
                rename: (oldPath, newPath) => window.api.invoke('fs:rename', oldPath, newPath),
                basename: (path) => window.api.basename(path),
                dirname: (path) => window.api.invoke('path:dirname', path),
                extname: (path) => window.api.extname(path),
                getDocId: (path) => window.api.invoke('fs:getDocId', path),
                // Add missing methods that main.js uses
                showOpenDialog: (opts) => window.api.showOpenDialog(opts),
                getSettings: (key) => window.api.getSettings(key),
                setSettings: (key, val) => window.api.setSettings(key, val),
                
                getPathByDocId: (docId) => window.api.invoke('fs:getPathByDocId', docId),
                isFullScreen: () => window.api.invoke('win:isFullScreen'),
                saveWorkspace: (data) => window.api.invoke('workspace:save', data),
                loadWorkspace: () => window.api.invoke('workspace:load'),
                
                updateLinks: (oldPath, newPath) => window.api.invoke('fs:updateLinks', oldPath, newPath)
            }
        } else {
             // Web App - Cloud FS
             this.current = new CloudFileSystem();
        }
    }
}
