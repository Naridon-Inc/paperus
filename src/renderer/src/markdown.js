import Showdown from 'showdown'
import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'

const converter = new Showdown.Converter({
  tables: true,
  tasklists: true,
  strikethrough: true,
  simpleLineBreaks: true, // Reverted to true for better "Notion-like" behavior
  omitExtraWLInCodeBlocks: true,
  ghCodeBlocks: true,
  smoothLivePreview: true,
  smartIndentationFix: true
})

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  bulletListMarker: '-'
})

turndownService.use(gfm)

// Ensure headers have proper spacing
turndownService.addRule('headerSpacing', {
  filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  replacement: function (content, node) {
    var hLevel = Number(node.nodeName.charAt(1))
    var hPrefix = '#'.repeat(hLevel)
    return '\n' + hPrefix + ' ' + content + '\n'
  }
})

// Properly handle blank lines
turndownService.addRule('blankLine', {
  filter: function (node) {
    return node.nodeName === 'P' && (node.innerHTML === '<br>' || node.textContent.trim() === '')
  },
  replacement: function () {
    return '\n'
  }
})

// Preserve page-link embeds as Markdown links
turndownService.addRule('pageLink', {
  filter: function (node) {
    return node.classList.contains('page-link-embed')
  },
  replacement: function (content, node) {
    const title = node.getAttribute('data-title') || 'Untitled'
    const docId = node.getAttribute('data-doc-id')
    
    if (docId) {
        return `[${title}](doc:${docId})`
    }

    let href = node.getAttribute('data-href') || '#'
    // Escape spaces for Markdown link compatibility
    href = href.replace(/ /g, '%20')
    return `[${title}](${href})`
  }
})

export const Markdown = {
  toHTML(markdown) {
    if (!markdown) return '';
    
    // Normalize newlines and ensure block-level elements have space
    // We use a more aggressive normalization to force Showdown to recognize blocks
    const normalized = markdown
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n{3,}/g, '\n\n'); 
    
    // Preprocess: Ensure tables and headers have a blank line before them
    // This is critical for Showdown's block parser
    let safeMarkdown = normalized
        .replace(/^([^|\n].*)\n(\s*\|)/gm, '$1\n\n$2') // Table fix
        .replace(/^([^#\n].*)\n(#+ )/gm, '$1\n\n$2')  // Header fix
        .replace(/^([^\-\n].*)\n(\s*[-*+] )/gm, '$1\n\n$2'); // List fix

    // If the whole thing is just one big blob without double newlines, 
    // Showdown might treat it as one paragraph. Let's try to break it if it looks like MD.
    if (!safeMarkdown.includes('\n\n') && safeMarkdown.includes('\n')) {
        console.log('[Markdown] Single-newline doc detected, attempting to force block separation');
        // Replace newline with double newline if next line starts with a block element
        safeMarkdown = safeMarkdown.replace(/\n(?=(#+ |[-*+] |[0-9]+\. |> |\||```))/g, '\n\n');
    }
    
    let html = converter.makeHtml(safeMarkdown)
    
    // Transform doc: links to page-link embeds
    html = html.replace(/<a href="doc:([^"]+)">([^<]+)<\/a>/g, (match, docId, title) => {
        return `<div class="page-link-embed" data-doc-id="${docId}" data-title="${title}"><span class="page-icon"><i class="far fa-file-alt"></i></span><span class="page-text">${title}</span></div>`
    })

    // Transform .md links to page-link embeds
    // Matches <a href="... .md">Title</a>
    html = html.replace(/<a href="([^"]+\.md)">([^<]+)<\/a>/g, (match, href, title) => {
        const decodedHref = decodeURI(href)
        return `<div class="page-link-embed" data-href="${decodedHref}" data-title="${title}"><span class="page-icon"><i class="far fa-file-alt"></i></span><span class="page-text">${title}</span></div>`
    })
    
    // Transform THEAD/TH for Quill 2.0 Compatibility
    // Quill 2.0 table module doesn't support THEAD. We must merge it into TBODY.
    
    if (html.includes('<table')) {
        // 1. Replace <th>Content</th> with <td><strong>Content</strong></td>
        html = html.replace(/<th(.*?)>(.*?)<\/th>/gs, '<td$1><strong>$2</strong></td>')
        
        // 2. Remove THEAD/TBODY tags and wrap everything in a single TBODY
        // We do this by finding each table and processing its inner content
        html = html.replace(/<table(.*?)>(.*?)<\/table>/gs, (match, attrs, content) => {
            const inner = content
                .replace(/<\/?thead>/g, '')
                .replace(/<\/?tbody>/g, '')
                .trim();
            return `<table${attrs}><tbody>${inner}</tbody></table>`;
        });
    }
    
    // Transform checklist (task lists) to match Quill's list format if needed.
    // Showdown converts `- [ ]` to `<input type="checkbox">`.
    // Quill expects `<li data-list="checked">` or similar for task lists.
    // Actually, Quill uses `<li>` with `data-list="checked"` or `unchecked`.
    // Showdown output: <ul class="task-list"><li class="task-list-item"><input type="checkbox"> ...</li></ul>
    
    // Convert Showdown's task lists to Quill-friendly structure
    // Quill uses <ul><li>...</li></ul> but attributes are handled via Delta or specific classes?
    // Quill recognizes <li data-list="checked">.
    
    html = html.replace(/<li[^>]*task-list-item[^>]*>\s*<input[^>]*type="checkbox"[^>]*checked[^>]*>\s*(.*?)<\/li>/gi, '<li data-list="checked">$1</li>')
    html = html.replace(/<li[^>]*task-list-item[^>]*>\s*<input[^>]*type="checkbox"[^>]*>\s*(.*?)<\/li>/gi, (match, content) => {
        if (match.includes('checked')) return `<li data-list="checked">${content}</li>`;
        return `<li data-list="unchecked">${content}</li>`;
    });
    
    // Clean up empty ULs if any remains (unlikely but safe)
    
    // console.log('[Markdown] Converted HTML:', html) // Uncomment for debug
    return html
  },
  
  toMarkdown(html) {
    try {
      // Safety: Turndown can sometimes struggle with extremely messy HTML or empty strings
      if (!html || html.trim() === '' || html === '<p><br></p>') return '';

      // Clean up Quill specific artifacts before Turndown
      const cleanHtml = html
        .replace(/<span class="ql-cursor">.*?<\/span>/g, '') // Remove remote cursors
        .replace(/<p><br><\/p>/g, '\n'); // Normalize empty paragraphs

      const md = turndownService.turndown(cleanHtml)
      return md
    } catch (e) {
      console.error('[Markdown] Turndown conversion failed:', e)
      // Return raw HTML as a last resort instead of plain text, 
      // so it's at least visible and possibly reparsable by Showdown.
      return html; 
    }
  }
}
