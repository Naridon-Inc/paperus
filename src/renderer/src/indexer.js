export class Indexer {
  constructor() {
    this.index = []
  }

  async buildIndex(rootPath) {
    console.log('[Indexer] Building index for:', rootPath)
    
    // Use a local index to avoid parallel interference, then assign at end
    const newNodes = []
    
    const queue = [{ path: rootPath, depth: 0 }]
    const maxDepth = 10
    const processed = new Set()
    
    while (queue.length > 0) {
        const { path: currentPath, depth } = queue.shift()
        if (processed.has(currentPath) || depth > maxDepth) continue
        processed.add(currentPath)
        
        try {
            const tree = await window.api.invoke('fs:getDirectoryTree', currentPath)
            if (!tree || !tree.children) continue
            
            for (const item of tree.children) {
                if (item.type === 'directory') {
                    // Safety: Skip dotfiles, node_modules, dist, etc.
                    const name = item.name.toLowerCase();
                    if (!name.startsWith('.') && name !== 'node_modules' && name !== 'dist' && name !== 'out' && name !== 'build') {
                        queue.push({ path: item.path, depth: depth + 1 })
                    }
                } else if (item.extension === '.md') {
                    const nodes = await this.indexFile(item.path, item.name)
                    if (nodes) newNodes.push(...nodes)
                }
            }
            
        } catch (e) {
            console.warn('[Indexer] Failed to scan:', currentPath, e)
        }
    }
    
    this.index.push(...newNodes)
    console.log('[Indexer] Index expanded with', newNodes.length, 'nodes for:', rootPath)
    return this.index
  }
  
  async indexFile(filePath, fileName) {
      try {
          const content = await window.api.invoke('fs:readFile', filePath)
          if (!content) return null
          
          const fileNodes = []
          
          // Parse Markdown Headers
          const lines = content.split('\n')
          let currentSection = {
              title: fileName, 
              path: filePath,
              level: 0,
              content: '', 
              line: 0
          }
          
          fileNodes.push({ ...currentSection }) 
          
          lines.forEach((line, index) => {
              const match = line.match(/^(#{1,6})\s+(.*)/)
              if (match) {
                  const level = match[1].length
                  const title = match[2].trim()
                  
                  currentSection = {
                      title: title,
                      path: filePath,
                      level: level,
                      line: index + 1,
                      content: '' 
                  }
                  fileNodes.push(currentSection)
              } else {
                  if (currentSection.content.length < 200) {
                      currentSection.content += line + ' '
                  }
              }
          })
          return fileNodes
      } catch (e) {
          console.error('[Indexer] Error indexing file:', filePath, e)
          return null
      }
  }
  
  search(query) {
      // Basic fuzzy search on title and content
      const lowerQuery = query.toLowerCase()
      return this.index.filter(node => 
          node.title.toLowerCase().includes(lowerQuery) || 
          node.content.toLowerCase().includes(lowerQuery)
      )
  }
}
