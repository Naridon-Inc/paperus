# Phase 3: Infrastructure Modernization

**Goal:** Implement the Event Bus pattern and integrate the new `libs/queue` and `libs/search` into the infrastructure layer.

## Step 1: Port Event Bus

The reference architecture uses an in-memory or decoupled Event Bus.

```bash
# Create events directory
mkdir -p backend/infrastructure/src/events

# Copy implementation
cp -r temp_reference/backend/infrastructure/src/events/* backend/infrastructure/src/events/
```

## Step 2: Integrate Search Library

Refactor the existing `searchapi-adapter.ts` to use the new `libs/search` client instead of raw HTTP calls (if applicable).

**File:** `backend/infrastructure/src/external/searchapi-adapter.ts`

**Action:**
1. Import the client from `@libs/search` (check `package.json` name).
2. Replace manual `fetch` calls with client methods.

```typescript
import { SearchClient } from '@libs/search';

export class SearchApiAdapter {
  constructor(private client: SearchClient) {}
  // ...
}
```

## Step 3: Integrate Queue Library (Optional/Advanced)

If you wish to replace the direct QStash usage with the `libs/queue` abstraction:

**File:** `backend/infrastructure/src/jobs/qstash-adapter.ts`

**Action:**
1. Check if `libs/queue` provides a compatible interface.
2. If `libs/queue` uses BullMQ, verify if you want to switch or if you can wrap QStash in the same interface.
3. Update `backend/infrastructure/src/index.ts` to export the new queue providers.

## Step 4: Wire up Events

Ensure the Event Bus is initialized and exported.

**File:** `backend/infrastructure/src/index.ts`

```typescript
export * from './events';
```

**Verification:**
Check that `backend/infrastructure` compiles with the new additions.

```bash
cd backend/infrastructure
pnpm build
```
