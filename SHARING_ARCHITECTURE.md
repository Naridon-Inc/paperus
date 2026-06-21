# Notionless Sharing & Permissions Architecture

## Overview
This document details the final implementation of the sharing, permission, and username system for Notionless, built on a PostgreSQL + Prisma backend.

## 1. Database Schema (PostgreSQL)

### User Model
- **`username`**: Unique, case-insensitive identifier (e.g., `user123`, `jane.doe`).
- **`isUsernameSet`**: Boolean flag. If false, user is prompted to set a username.
- **`notifications`**: Relation to Notification model.
- **`permissions`**: Relation to DocumentPermission model.

### DocumentPermission Model (Granular Access)
Tracks individual and team access to documents.
- **`docId`**: Foreign key to Document.
- **`userId`**: Optional link to a specific User.
- **`teamId`**: Optional link to a Team.
- **`role`**: ENUM (`VIEW`, `COMMENT`, `EDIT`, `MANAGE`).
- **Constraint**: Unique composite keys ensure one role per user/team per document.

### Notification Model
Stores alerts for invites and shares.
- **`type`**: `INVITE`, `SHARE`, `MENTION`.
- **`data`**: JSON payload (e.g., `{ docName: "My Note", inviterId: 1, role: "EDIT" }`).
- **`read`**: Boolean status.

## 2. Backend Features

### Username System
- **Auto-Generation**: New users get a default `user[timestamp]` username.
- **Onboarding**: Users can set their username exactly once (enforced by `isUsernameSet` check).
- **Search**: `GET /auth/users/search?q=...` performs a fuzzy search on username and email.

### Permissions API
- **Share**: `POST /teams/documents/:id/share` adds a permission entry.
- **Revoke**: `DELETE /teams/documents/:id/share` removes access.
- **List**: `GET /teams/documents/:id/permissions` returns all active shares.

### Notifications & Real-time
- **WebSocket**: `/notifications?token=...` endpoint pushes events (like `INVITE`) to connected clients instantly.
- **Persistence**: Notifications are stored in DB and fetched on app load (`GET /auth/notifications`).

## 3. Frontend Implementation

### Username Onboarding
- Located in **Settings > Account**.
- Shows a banner prompting to set a unique username if not set.
- Validates uniqueness in real-time.

### Share Popover (`SharePopover`)
- Triggered via **File Properties > Share File**.
- **Features**:
  - **Search**: Find users by name, email, or `@username`.
  - **Access List**: Shows current users/teams and their roles.
  - **Remove**: Admins can revoke access directly from the list.
  - **Team Share**: Quick dropdown to share with existing teams.

### Notification Center (`NotificationCenter`)
- **Bell Icon**: Added to the main header. shows a red badge for unread items.
- **List**: Displays recent invites with timestamps.
- **Action**: Clicking a notification marks it read and opens the linked document.

## 4. Migration Notes
- **Fresh Start**: The database was reset to implement this clean schema.
- **Team Logic**: Sharing with a Team now "explodes" permissions, adding individual access rules for current members to ensure granular control. Future team logic can be adjusted to link `teamId` directly if dynamic access is preferred.

## 5. Development
- **Backend Port**: `9008`
- **Database**: PostgreSQL 15 (Docker)
- **Run Dev**: `npm run dev` (Frontend) + `docker compose up` (Backend)
