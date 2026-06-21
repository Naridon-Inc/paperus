# Fix Prioritization Model

**Status**: Draft
**Version**: 1.0

This model determines the order in which fixes are presented to the user. The goal is to maximize **Search Visibility Impact** per unit of effort.

---

## 1. The Impact Score (0-100)

Every `Fix` entity has an `impactScore`.

$$ Score = (BaseImportance \times Multiplier) + ContextBoost $$

### 1.1 Measurable Goals (New)

Every fix must be associated with a primary **Measurable Goal** to help users understand the "Why" and track success.

*   **VISIBILITY**: Increases the chance of being seen (Indexing, Ranking).
    *   *Metrics*: Impressions, Keyword Rankings.
    *   *Examples*: Missing GTIN, Weak Title, Schema Errors.
*   **CLICK-THROUGH**: Increases the chance of being clicked.
    *   *Metrics*: CTR.
    *   *Examples*: Weak Meta Description, Missing Image, Price Competitiveness.
*   **CONVERSION**: Increases the chance of purchase after clicking.
    *   *Metrics*: Conversion Rate, Time on Page.
    *   *Examples*: Missing FAQs, Unstructured Specs, Trust Signals.

### 1.2 Base Importance
Derived from the Rule Priority.

*   **CRITICAL**: 80-100 (e.g., Missing GTIN, Broken URL)
*   **HIGH**: 60-79 (e.g., Weak Title, Missing Desc)
*   **MEDIUM**: 40-59 (e.g., Missing Alt Text)
*   **LOW**: 0-39 (e.g., Typo, Formatting)

### Multipliers
Adjust based on product importance.

*   **Best Seller**: x 1.5
*   **High Inventory**: x 1.2
*   **New Arrival**: x 1.1
*   **Out of Stock**: x 0.1 (Fixes here are low value)

### Context Boost
Dynamic adjustments based on store state.

*   **Cluster Effect**: If 50% of products have the same issue, boost slightly to encourage bulk fixing.
*   **Quick Win**: If the fix is "Deterministic" (one-click), add +5 points.

---

## 2. Priority Buckets (User Facing)

Users don't see raw scores. They see buckets.

1.  **🚨 Critical Issues** (Score 90+)
    *   "These products are invisible to AI."
    *   *Action*: Immediate Fix.

2.  **⚠️ High Priority** (Score 70-89)
    *   "Significant visibility loss."
    *   *Action*: Review this week.

3.  **💡 Opportunities** (Score 40-69)
    *   "Optimization potential."
    *   *Action*: Fix when time permits / Autopilot.

4.  **✨ Polish** (Score < 40)
    *   "Quality of life improvements."
    *   *Action*: Low priority.

---

## 3. Dependency Logic

Some fixes depend on others.

*   *Rule*: **Eligibility > Clarity > Usability > Trust**
*   *Example*: Don't suggest "Add FAQs" (Usability) if the product has "Missing Title" (Eligibility). The product isn't even indexed yet.

**Implementation**:
The `GenerateFixesUseCase` should sort rules by this hierarchy. If a Critical rule fails, skip generating Medium/Low fixes for that same product to reduce noise.

---

## 4. Feedback Loop

The model is adaptive.

*   **User Reject**: If users consistently dismiss a specific rule type, downgrade its Base Importance globally or for that shop.
*   **High CTR**: If applied fixes lead to verified traffic bumps (future state), boost that rule's importance.
