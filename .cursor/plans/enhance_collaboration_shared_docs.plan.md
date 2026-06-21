---
name: ""
overview: ""
todos: []
isProject: false
---

# Plan: Enhanced Collaboration & Shared Documents

## Goal

Improve the robustness and user experience of Shared Documents and Real-time Collaboration features.

## Current State

- **Shared Docs**: Can be shared via email/team. Listed in Sidebar > Shared (flat list). Projected to `Shared/{Owner}/{Doc}.md` on Desktop.
- **Collaboration**: Yjs syncing works. User cursors and avatars (Presence) are implemented.
- **Notifications**: WebSocket-based notifications for invites exist.

## Objectives

### 1. Real-time Sidebar Updates

- **Problem**: When a document is shared with the user, the Sidebar "Shared" list doesn't update until a refresh or restart.
- **Solution**: Listen for `INVITE`/`SHARE` notifications in `SidebarManager` (or via global event) and trigger a refresh of the Shared list.

### 2. Grouped Shared Documents

- **Problem**: `SidebarManager` renders shared documents as a flat list, but `SharedFileManager` projects them into folders by Owner.
- **Solution**: Update `SidebarManager` to render the "Shared" section as a tree, grouping documents by Owner (e.g., "Shared > Alice > Project Specs").

### 3. Typing Indicators

- **Problem**: Users see cursors but don't know if someone is actively typing.
- **Solution**: Utilize Yjs `awareness` to broadcast a "typing" state and display a "User is typing..." indicator in the active document header or near their cursor.

### 4. Robust "Offline" Sharing Status

- **Problem**: If offline, `authClient` calls fail, and the Sidebar might show empty/error states for Teams/Shared.
- **Solution**: Cache the list of shared documents and teams in `localStorage` (or `Store`) so the Sidebar remains populated (albeit read-only/disconnected) when offline.

## Execution Steps

1. **Sidebar Grouping**: Modify `src/renderer/src/sidebar-manager.js` to group shared documents by `creator`.
2. **Real-time List Refresh**: Add an event listener in `SidebarManager` for `notification:new` (dispatched by `NotificationCenter` or global socket handler) to re-fetch shared docs.
3. **Typing Indicators**: Update `src/renderer/src/presence.js` to track and broadcast typing status. Update `src/renderer/src/main.js` to render it.

