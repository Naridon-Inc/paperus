# Phase 2: Domain Architecture Migration

**Goal:** Inject the clean DDD patterns (Services, Value Objects) and the new Compliance domain into the production backend.

## Step 1: Port Compliance Domain

The `compliance` domain is missing entirely from production.

```bash
# Create destination
mkdir -p backend/domain/src/compliance

# Copy source files
cp -r temp_reference/backend/domain/src/compliance/* backend/domain/src/compliance/
```

## Step 2: Upgrade Monitoring Domain

The monitoring domain needs to be enriched with Value Objects and Domain Services.

### 2.1 Value Objects
```bash
mkdir -p backend/domain/src/monitoring/value-objects
cp -r temp_reference/backend/domain/src/monitoring/value-objects/* backend/domain/src/monitoring/value-objects/
```

### 2.2 Domain Services
```bash
mkdir -p backend/domain/src/monitoring/services
cp -r temp_reference/backend/domain/src/monitoring/services/* backend/domain/src/monitoring/services/
```

## Step 3: Database Updates

The new `Compliance` domain likely requires database tables. We need to update the Prisma schema.

**File:** `backend/libs/db/prisma/schema.prisma`

**Action:**
1. Open `temp_reference/backend/domain/src/compliance/entities` to see the data structures.
2. Since the reference repo **does not** have a `schema.prisma`, you must infer the schema from the entities.
3. Add a `Compliance` model to your production schema.

**Example Inference (Pseudo-code):**
```prisma
model ComplianceRecord {
  id        String   @id @default(uuid())
  shopId    String
  status    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // Add fields based on entity properties
}
```

## Step 4: Apply Database Changes

After editing the schema:

```bash
cd backend/libs/db
pnpm db:generate
# If you are ready to apply changes locally:
pnpm db:migrate
```

## Step 5: Export New Modules

Update `backend/domain/src/index.ts` (or `monitoring/index.ts`) to export the new services and value objects so they can be used by the application layer.

```typescript
// backend/domain/src/monitoring/index.ts
export * from './value-objects';
export * from './services';
```
