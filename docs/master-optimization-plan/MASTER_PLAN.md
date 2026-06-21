# Naridon Optimization Engine - Master Implementation Plan

**Objective**: To build a robust, platform-agnostic optimization engine that improves e-commerce stores for AI-mediated discovery by ensuring eligibility, answer-readiness, and trust.

**Core Philosophy**: Naridon optimizes for *retrieval readiness* and *fact usability*, not traditional keyword rankings.

---

## 🏗 Architecture Overview

The optimization engine is designed as a standalone domain within the Naridon backend (`backend/domain/src/optimization`). It operates on a standardized `Product` entity, decoupling the logic from specific e-commerce platforms (Shopify, Shopware, etc.).

### Data Flow
1.  **Platform Content Port**: Adapters fetch raw product data and normalize it into the internal `Product` entity.
2.  **Scanner**: The `ScanStoreUseCase` orchestrates the analysis.
3.  **Rule Engine**: A collection of stateless `OptimizationRule` classes inspect the `Product` entity.
4.  **Signal Generation**: Failed checks generate `SmartSignal` records (observations).
5.  **Fix Generation**: The `GenerateFixesUseCase` converts signals into actionable `Fix` entities.
6.  **Fix Execution**: `ApplyFixUseCase` uses platform-specific adapters to write changes back to the store.

---

## 📂 Documentation Structure

This folder contains the detailed specifications and plans for the Naridon Optimization Engine.

### 1. [Capability Catalog](./CAPABILITY_CATALOG.md)
*   **Purpose**: The authoritative list of all 80+ checks and fixes Naridon can perform.
*   **Audience**: Product Managers, Engineers, Stakeholders.
*   **Contents**: Detailed breakdown of Deterministic Fixes, AI-Assisted Fixes, Guided Recommendations, and Monitoring Metrics.

### 2. [Rule Implementation Strategy](./RULE_IMPLEMENTATION_STRATEGY.md)
*   **Purpose**: Technical guide on how to implement new rules.
*   **Audience**: Backend Engineers.
*   **Contents**: Interface definitions, priority levels, category mapping, and testing strategies.

### 3. [Platform Agnostic Layer](./PLATFORM_AGNOSTIC_DESIGN.md)
*   **Purpose**: Architecture design for supporting multiple platforms (Shopify, Shopware, BigCommerce, etc.).
*   **Audience**: System Architects.
*   **Contents**: `IPlatformContentPort` design, normalization standards, and adapter patterns.

### 4. [Fix Prioritization Model](./FIX_PRIORITIZATION_MODEL.md)
*   **Purpose**: Logic for scoring and ranking fixes based on potential impact.
*   **Audience**: Data Scientists, Product Owners.
*   **Contents**: Scoring algorithms (`impactScore`), dependency mapping, and user-facing priority buckets.

### 5. [AI Safety & Hallucination Guardrails](./AI_SAFETY_GUARDRAILS.md)
*   **Purpose**: Safety protocols to ensure AI never invents facts.
*   **Audience**: Trust & Safety Team, Legal.
*   **Contents**: Verification steps, "Human-in-the-loop" requirements, and non-goals.

---

## 🚀 Roadmap Summary

### Phase 1: Core Eligibility (Q1)
*   Focus: Deterministic fixes (GTIN, Titles, Schema).
*   Target: Ensure products are *indexable* and *classifiable*.

### Phase 2: Answer Readiness (Q2)
*   Focus: AI-Assisted content rewrites (Summaries, FAQs).
*   Target: Ensure products are *quotable* by LLMs.

### Phase 3: Trust & Commercial Signals (Q3)
*   Focus: Reviews, Policies, and Authority.
*   Target: Ensure products are *trusted* recommendations.

### Phase 4: Strategic Intelligence (Q4)
*   Focus: Aggregate data analysis (Deep Insights).
*   Target: Move beyond single-product fixes to store-wide strategy (Cannibalization, Brand Voice, Seasonal Decay).

### Phase 5: Feedback Loop (Q5)
*   Focus: Impact tracking and monitoring.
*   Target: Correlate fixes with AI citation growth.
