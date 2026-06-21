# Frontend Migration & Implementation Plan

**Status**: Draft
**Version**: 1.0

This document outlines the frontend updates required to support the full **Naridon Optimization Engine** capability catalog. It maps backend capabilities to frontend components in `@naridon/shared-features`.

---

## 1. Component Architecture Updates

### A. Fix Visualization (Smart Diffing)
*Goal: Move beyond simple text diffs to context-aware comparisons.*

1.  **`RichDiffViewer` Component** (New)
    *   **Text Mode**: Existing red/green text diff.
    *   **Schema Mode**: Tree-view JSON diff for `D-11` to `D-22` (Structured Data).
    *   **Image Mode**: Side-by-side or slider comparison for `D-24` (Rename) and `D-27` (Hero).
    *   **List Mode**: Checklist view for `AI-37`/`AI-39` (Bullets), allowing item-level selection.

2.  **`AIPreviewCard` Component** (New)
    *   *Purpose*: Show users the "Why".
    *   *Visual*: Simulates a ChatGPT/Perplexity citation.
    *   *Props*: `productTitle`, `summary`, `citationUrl`.
    *   *Usage*: Display inside `FixReviewModal` to show the downstream impact of the fix.

### B. Dashboard & Reporting
*Goal: Visualize the new pillars of optimization.*

1.  **`HealthScorecard` Component** (New)
    *   Replaces generic "Visibility Score".
    *   **4 Quadrants**:
        *   ✅ **Eligibility** (Hard Gates, GTIN, Schema)
        *   🧠 **Clarity** (Descriptions, Titles)
        *   💬 **Usability** (FAQs, Comparison)
        *   🛡️ **Trust** (Reviews, Policies)
    *   *Drill-down*: Clicking a quadrant filters the `FixesTable` to that category.

2.  **`MonitoringWidgets`** (Update)
    *   Add `ShareOfVoiceChart`: Time-series of brand mentions in AI answers.
    *   Add `CitationFrequency`: Bar chart of how often products are cited.

### C. Guided Workflows
*Goal: Support "Human-Action-Required" fixes.*

1.  **`GuidedFixDrawer`** (New)
    *   *Usage*: For Section 3 items (e.g., `G-61` Return Policy).
    *   *Content*: Rich text instructions, external links to Shopify Admin/Merchant Center.
    *   *Actions*: "I Fixed This" (Manual Verification) or "Ignore".

---

## 2. Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
*Focus: Supporting the diverse data types of the new fixes.*

*   [ ] **Update `FixDTO`**: Ensure frontend types match the expanded backend `Fix` entity (handling `images`, `json`, `bullets` payloads).
*   [ ] **Refactor `FixesTable`**: Add columns/badges for "Category" (Eligibility, Trust, etc.).
*   [ ] **Create `RichDiffViewer`**: Implement JSON and basic Image support.

### Phase 2: Interactive Review (Weeks 3-4)
*Focus: Giving users control over AI generation.*

*   [ ] **Update `FixReviewModal`**: Integrate `RichDiffViewer`.
*   [ ] **Add Edit Capability**: Allow editing `suggestedValue` before applying (crucial for `AI-35` Title Rewrites).
*   [ ] **Implement `AIPreviewCard`**: Add "Simulated Answer" view to the modal.

### Phase 3: Dashboard & Analytics (Weeks 5-6)
*Focus: Showing value and progress.*

*   [ ] **Build `HealthScorecard`**: Visualize the 4 pillars.
*   [ ] **Connect Monitoring APIs**: Wire up the new monitoring widgets to real backend data.
*   [ ] **Refactor `OptimizationDashboard`**: Layout changes to accommodate new metrics.

### Phase 4: Guided Fixes (Week 7+)
*Focus: Completing the coverage.*

*   [ ] **Build `GuidedFixDrawer`**: UI for manual tasks.
*   [ ] **Implement "Mark as Fixed"**: API integration for manual resolution status.

---

## 3. Mockups & Data Structures

### Fix Category Mapping
```typescript
type FixCategory = 'ELIGIBILITY' | 'CLARITY' | 'USABILITY' | 'TRUST';

const CATEGORY_MAP: Record<string, FixCategory> = {
  'MISSING_GTIN': 'ELIGIBILITY',
  'WEAK_TITLE': 'CLARITY',
  'MISSING_FAQ': 'USABILITY',
  'VAGUE_RETURN_POLICY': 'TRUST',
  // ... map all 80 rules
};
```

### Rich Diff Props
```typescript
interface RichDiffProps {
  type: 'TEXT' | 'JSON' | 'IMAGE' | 'LIST';
  original: any;
  suggested: any;
  context?: {
    productImage?: string;
    productTitle?: string;
  };
  onEdit?: (newValue: any) => void;
}
```
