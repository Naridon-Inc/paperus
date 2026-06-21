# Measurable Goals Implementation Progress

- [x] **Backend Domain Update**
    - [x] Update `Fix` entity in `backend/domain/src/optimization/entities/fix.ts` to include `measurableGoal`.
    - [x] Define `MeasurableGoal` enum/type.

- [x] **Database Schema Update**
    - [x] Find and update `schema.prisma` to add `measurableGoal` column to `Fix` table.
    - [x] Run migration/db push (simulated or actual if possible, usually just file update in this context).

- [x] **Business Logic Update**
    - [x] Update `GenerateFixesUseCase` or Rule definitions to assign goals to fixes.
    - [x] Review existing rules and map them to goals:
        - Missing GTIN -> VISIBILITY
        - Weak Title -> VISIBILITY
        - Missing Alt Text -> VISIBILITY
        - Weak Description -> CLICK_THROUGH
        - Missing FAQ -> CONVERSION
        - etc.

- [x] **Frontend Update**
    - [x] Update `OptimizationFixes.tsx` / `FixesTable.tsx` to consume and display `measurableGoal`.
    - [x] Update "In Review" tab to show the specific goal instead of generic "Objective: Increase Visibility".

- [x] **Verification**
    - [x] Verify types match between backend and frontend.
