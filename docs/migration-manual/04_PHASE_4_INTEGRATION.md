# Phase 4: Integration & Verification

**Goal:** Connect the new domain logic to the application layer and ensure the system runs correctly.

## Step 1: Update Application Layer

The `application` layer needs to use the new Domain Services.

**Target:** `backend/application/common/src/monitoring`

**Action:**
1. Compare `backend/application/common/src/monitoring` with `temp_reference/backend/application/common/src/monitoring`.
2. If the reference has updated Use Cases (e.g., `GetCompetitorAnalysis.ts`) that use the new `StatisticsCalculator` (Domain Service), copy or refactor the local Use Case to match.

## Step 2: Verify Dependencies

Ensure all internal packages are linked.

```bash
cd backend
pnpm install
```

## Step 3: Run Tests

Run the existing E2E tests to ensure no regressions.

```bash
cd backend/test/e2e
# Run your test command, e.g.:
npx playwright test
# or
pnpm test
```

## Step 4: Cleanup (Optional)

Once the migration is confirmed stable:

1.  **Consolidate Scripts:** Move the root-level `.ts` scripts (e.g., `seed-*.ts`) into a `scripts/` folder to match the clean structure of the reference.
    ```bash
    mkdir -p backend/scripts
    mv backend/*.ts backend/scripts/
    # Update paths in package.json scripts if necessary
    ```

2.  **Remove Legacy Code:** If any old monitoring logic is fully replaced by the new Domain Services, delete the dead code.

## Final Check

*   [ ] `libs/queue` builds.
*   [ ] `libs/search` builds.
*   [ ] `domain` builds with new Compliance and Monitoring logic.
*   [ ] `infrastructure` builds with Events.
*   [ ] E2E tests pass.

**Congratulations!** The migration to the hybrid "Super-Backend" is complete.
