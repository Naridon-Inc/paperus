import { authClient } from './auth-client'
import { Config } from './config'

export class NotificationCenter {
    constructor() {
        this.isOpen = false
        this.notifications = []
        this.socket = null
        this.render()
        this.connectSocket()
    }
    
    render() {
        // Add Container
        const div = document.createElement('div')
        div.id = 'notification-center'
        div.className = 'inbox-drawer' // Use new class from style.css
        div.innerHTML = `
            <div class="inbox-header">
                <span>Inbox</span>
                <button class="icon-btn" id="mark-all-read" title="Mark all read" style="font-size: 11px;"><i class="fas fa-check-double"></i></button>
            </div>
            <div class="notification-list" id="notification-list">
                <div style="padding: 20px; text-align: center; color: #999;">No new notifications</div>
            </div>
        `
        document.body.appendChild(div) // Append to body to avoid sidebar z-index trap
        
        // Calculate position based on sidebar width
        const sidebar = document.getElementById('sidebar')
        const header = document.querySelector('.app-header') // Get header to calculate top offset
        const updatePosition = () => {
            const isCollapsed = sidebar.classList.contains('collapsed')
            const width = isCollapsed ? 0 : sidebar.offsetWidth
            div.style.left = `${width}px`
        }
        
        // Listen for sidebar toggle
        const observer = new MutationObserver(updatePosition)
        observer.observe(sidebar, { attributes: true, attributeFilter: ['class', 'style'] })
        
        // Initial position
        updatePosition()
        
        // Fetch Initial
        this.refresh()
    }

    async connectSocket() {
        // Connect to notification WebSocket
        const token = authClient.token
        if (!token) return
        
        // Get Dynamic WS URL
        const rawWsUrl = await Config.getWsUrl();
        // Force WSS for HTTPS sites to avoid browser blocks
        const WS_URL = window.location.protocol === 'https:' ? rawWsUrl.replace(/^ws:/, 'wss:') : rawWsUrl;
        
        this.socket = new WebSocket(`${WS_URL}/notifications?token=${token}`)
        
        this.socket.onmessage = (event) => {
            const msg = JSON.parse(event.data)
            if (msg.type === 'INVITE' || msg.type === 'SHARE' || msg.type === 'TEAM_INVITE') {
                this.addNotification(msg)
                this.showBadge(true)
                window.dispatchEvent(new CustomEvent('notification:new', { detail: msg }))
            }
        }
        
        this.socket.onclose = () => {
            setTimeout(() => this.connectSocket(), 5000) // Reconnect
        }
    }
    
    async refresh() {
        const token = authClient.token
        if (!token) {
            this.notifications = []
            this.renderList()
            return
        }

        try {
            this.notifications = await authClient.getNotifications()
            this.renderList()
            this.showBadge(this.notifications.some(n => !n.read))
        } catch (e) {
            console.warn('Failed to fetch notifications', e)
        }
    }
    
    renderList() {
        const list = document.getElementById('notification-list')
        if (this.notifications.length === 0) {
            list.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No new notifications</div>'
            return
        }
        
        list.innerHTML = this.notifications.map(n => {
            const data = n.data
            let text = ''
            let actions = ''
            
            if (n.type === 'INVITE') {
                text = `You were invited to edit <b>${data.docName}</b>`
                if (!n.read) {
                    actions = `
                        <div class="notification-actions" style="margin-top: 8px; display: flex; gap: 8px;">
                            <button class="btn-small accept-invite" data-id="${n.id}" data-doc="${data.docId}" style="background: #2eaadc; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;">Accept</button>
                            <button class="btn-small decline-invite" data-id="${n.id}" data-doc="${data.docId}" style="background: white; border: 1px solid #ddd; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;">Decline</button>
                        </div>
                    `
                }
            } else if (n.type === 'TEAM_INVITE') {
                text = `You were invited to join <b>${data.teamName}</b>`
                if (!n.read) {
                    actions = `
                        <div class="notification-actions" style="margin-top: 8px; display: flex; gap: 8px;">
                            <button class="btn-small accept-team" data-id="${n.id}" data-team="${data.teamId}" style="background: #2eaadc; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;">Accept</button>
                            <button class="btn-small decline-team" data-id="${n.id}" data-team="${data.teamId}" style="background: white; border: 1px solid #ddd; padding: 4px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;">Decline</button>
                        </div>
                    `
                }
            } else if (n.type === 'SHARE') {
                 // Auto-accepted legacy share or just info
                 text = `Shared <b>${data.docName}</b> with you`
            }
            
            return `
                <div class="notification-item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-doc="${data.docId || ''}">
                    <div class="notification-text">${text}</div>
                    ${actions}
                    <div class="notification-meta">
                        <span>${new Date(n.createdAt).toLocaleTimeString()}</span>
                    </div>
                </div>
            `
        }).join('')
        
        // Bind Actions
        const handleAction = async (e, type) => {
            e.stopPropagation()
            const btn = e.target
            const id = btn.dataset.id
            const targetId = btn.dataset.doc || btn.dataset.team
            
            btn.textContent = '...'
            btn.disabled = true
            
            try {
                const { authClient } = await import('./auth-client')
                if (type === 'accept-doc') {
                    await fetch(`${await authClient.getUrl(`/documents/${targetId}/accept`)}`, { method: 'POST', headers: authClient.headers })
                    window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', { detail: targetId }))
                } else if (type === 'decline-doc') {
                    await fetch(`${await authClient.getUrl(`/documents/${targetId}/decline`)}`, { method: 'POST', headers: authClient.headers })
                } else if (type === 'accept-team') {
                    await fetch(`${await authClient.getUrl(`/teams/${targetId}/accept`)}`, { method: 'POST', headers: authClient.headers })
                    window.dispatchEvent(new CustomEvent('teams:updated'))
                } else if (type === 'decline-team') {
                    await fetch(`${await authClient.getUrl(`/teams/${targetId}/decline`)}`, { method: 'POST', headers: authClient.headers })
                }
                
                await authClient.clearNotification(parseInt(id))
                this.refresh()
            } catch (err) {
                console.error(err)
                alert('Action failed')
                btn.disabled = false
            }
        }

        list.querySelectorAll('.accept-invite').forEach(btn => btn.onclick = (e) => handleAction(e, 'accept-doc'))
        list.querySelectorAll('.decline-invite').forEach(btn => btn.onclick = (e) => handleAction(e, 'decline-doc'))
        list.querySelectorAll('.accept-team').forEach(btn => btn.onclick = (e) => handleAction(e, 'accept-team'))
        list.querySelectorAll('.decline-team').forEach(btn => btn.onclick = (e) => handleAction(e, 'decline-team'))

        list.querySelectorAll('.notification-item').forEach(item => {
            item.onclick = async (e) => {
                // Ignore clicks on buttons
                if (e.target.tagName === 'BUTTON') return
                
                const id = item.dataset.id
                const docId = item.dataset.doc
                
                if (docId) {
                    // Only mark read if not pending action? Or just mark read.
                    // If it requires action, maybe don't mark read on click?
                    // Let's mark read only if it's not an actionable invite or if already acted upon.
                    const hasActions = item.querySelector('.notification-actions')
                    if (!hasActions) {
                        const { authClient } = await import('./auth-client')
                        await authClient.clearNotification(parseInt(id))
                        this.refresh()
                        this.toggle()
                        window.dispatchEvent(new CustomEvent('cmd:open-cloud-doc', { detail: docId }))
                    }
                }
            }
        })
        
        const markAllBtn = document.querySelector('#mark-all-read')
        if (markAllBtn) {
            markAllBtn.onclick = async () => {
                 // Loop all unread? Or create endpoint
                 // For now, iterate
                 for (const n of this.notifications.filter(x => !x.read)) {
                     await authClient.clearNotification(n.id)
                 }
                 this.refresh()
            }
        }
    }
    
    showBadge(show) {
        // Implement badge logic if UI has one
    }
    
    addNotification(msg) {
        this.notifications.unshift({
            id: Date.now(), // Temp ID
            read: false,
            type: msg.type,
            data: msg.data,
            createdAt: new Date().toISOString()
        })
        this.renderList()
    }
    
    toggle() {
        const el = document.getElementById('notification-center')
        if (!el) return
        
        if (this.isOpen) {
            el.classList.remove('open')
            setTimeout(() => { if (!this.isOpen) el.style.display = 'none' }, 300)
            this.isOpen = false
        } else {
            el.style.display = 'flex'
            // Trigger reflow for transition
            el.offsetHeight 
            el.classList.add('open')
            this.isOpen = true
            this.refresh()
        }
    }
}
