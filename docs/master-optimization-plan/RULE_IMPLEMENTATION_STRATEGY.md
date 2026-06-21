# Rule Implementation Strategy

**Status**: Draft
**Version**: 1.0

This document outlines the technical strategy for implementing new Optimization Rules in the Naridon backend.

---

## 1. Rule Architecture

Each rule is a self-contained class that implements the `OptimizationRule` interface.

```typescript
export interface OptimizationRule {
    ruleId: string;
    type: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';

    // Returns true if the product HAS an issue (fails the check)
    check(product: Product): boolean | Promise<boolean>;

    // Generates the fix content (string payload)
    generate(product: Product): Promise<string>;

    // Returns the field name this rule targets (e.g., 'title', 'description')
    getFieldName(): string;
}
```

## 2. Rule Categorization & Priority

Rules are categorized to help with prioritization and user filtering.

### Categories
*   **ELIGIBILITY**: Hard gates preventing indexing (e.g., Missing GTIN).
*   **CLARITY**: Issues affecting understanding (e.g., Vague Title).
*   **USABILITY**: Issues affecting answer quality (e.g., Missing FAQs).
*   **TRUST**: Issues affecting confidence (e.g., No Returns Policy).

### Priority Levels
*   **CRITICAL**: Prevents indexing or basic function. (GTIN, Price).
*   **HIGH**: Significantly hurts visibility. (Title, Description).
*   **MEDIUM**: Optimization opportunity. (Alt Text, Schema).
*   **LOW**: Polish / nitpicks. (Filename normalization).

## 3. Implementation Process

### Step 1: Define the Rule
Create a new file in `backend/domain/src/optimization/rules/`.
Name it `[issue-name].rule.ts`.

### Step 2: Implement Logic
1.  **Check Phase**: Keep it fast. Avoid external API calls if possible. Use regex, length checks, or simple logic.
2.  **Generate Phase**: Can be expensive (LLM calls). This only runs if `check()` returns true.

### Step 3: Register Rule
1.  Export from `backend/domain/src/index.ts`.
2.  Instantiate in `backend/delivery/api/src/index.ts` (DI Container).
3.  Add to the `optimizationRules` array.

### Step 4: Test
1.  Unit test the `check()` logic with various product states.
2.  Integration test the `generate()` logic (mocking LLM calls).

## 4. Testing & Validation

### Mock Data
Use standard mock products:
*   `product_perfect`: Passes all checks.
*   `product_empty`: Fails all checks.
*   `product_edge`: Contains edge cases (unicode, weird formatting).

### LLM Guardrails
*   **Determinism**: If possible, use low temperature (0.1) for generation.
*   **Validation**: Generated content must be validated against the product data (no hallucination).
    *   *Implementation*: A simple "Fact Check" pass can verify if the generated text contradicts the original input.

## 5. Deployment Strategy

*   **Feature Flags**: Wrap new rules in feature flags if experimental.
*   **Batching**: Run rules in parallel batches to avoid timeouts on large catalogs.
*   **Caching**: Cache `check()` results to avoid re-scanning unchanged products.
