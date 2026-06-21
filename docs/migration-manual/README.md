# Backend Migration Manual

**Project:** Test-app Backend Migration
**Date:** January 14, 2026
**Strategy:** Hybrid / Surgical Graft

This manual provides step-by-step instructions to migrate the production backend to the new clean DDD architecture found in the reference implementation, without breaking existing features.

## Table of Contents

### 1. [Phase 1: Preparation](./01_PHASE_1_PREPARATION.md)
*   **Goal:** Set up new workspaces (`libs/queue`, `libs/search`) and dependencies.
*   **Key Actions:** Create folders, copy library code, update `pnpm-workspace.yaml`.

### 2. [Phase 2: Domain Architecture](./02_PHASE_2_DOMAIN_ARCHITECTURE.md)
*   **Goal:** Upgrade the core business logic.
*   **Key Actions:** Port `Compliance` domain, add `Monitoring` services & value objects, update Database Schema.

### 3. [Phase 3: Infrastructure](./03_PHASE_3_INFRASTRUCTURE.md)
*   **Goal:** Modernize the plumbing.
*   **Key Actions:** Implement Event Bus, integrate new libraries into `infrastructure` adapters.

### 4. [Phase 4: Integration & Verification](./04_PHASE_4_INTEGRATION.md)
*   **Goal:** Wire it all together and verify.
*   **Key Actions:** Update Application layer to use new services, run E2E tests, clean up scripts.

### 5. [Appendix: Code Diffs](./05_APPENDIX_CODE_DIFFS.md)
*   **Content:** Concrete code examples showing "Before" vs "After" for key components like Monitoring Services and Event Bus.

---

## How to Use This Manual

1.  Start with **Phase 1** and work sequentially.
2.  Each file contains shell commands you can copy-paste.
3.  Do **not** skip the Verification steps at the end of each phase.
4.  If you encounter issues, refer to the [Detailed Comparison Report](../backend-migration-plans/DETAILED_FILE_LEVEL_COMPARISON.md) for context.

### [Phase 2: Domain Architecture](./02_PHASE_2_DOMAIN_ARCHITECTURE.md)
*   **Goal:** Adopt clean DDD patterns and add missing domains.
*   **Key Actions:** Port `Compliance` domain, upgrade `Monitoring` domain with Services & Value Objects, update Database Schema.

### [Phase 3: Infrastructure](./03_PHASE_3_INFRASTRUCTURE.md)
*   **Goal:** Modernize the infrastructure layer.
*   **Key Actions:** Implement Event Bus, integrate new Queue and Search libraries.

### [Phase 4: Integration & Verification](./04_PHASE_4_INTEGRATION.md)
*   **Goal:** Connect everything and ensure stability.
*   **Key Actions:** Update Application layer, run E2E tests, clean up legacy scripts.

### [Appendix: Code Diffs](./05_APPENDIX_CODE_DIFFS.md)
*   Detailed side-by-side code comparisons of critical components to illustrate the specific changes required.

## How to use this guide

1.  Start with Phase 1 and work sequentially.
2.  Each phase assumes the previous phase is complete.
3.  Do not skip "Verification" steps.
