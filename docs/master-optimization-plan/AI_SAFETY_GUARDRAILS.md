# AI Safety & Hallucination Guardrails

**Status**: Draft
**Version**: 1.0

**Core Mandate**: Naridon uses AI to *rewrite and format* existing truth. It must never *invent* facts.

---

## 1. The "Zero-Invention" Protocol

All prompts must explicitly forbid hallucination.

**Standard System Prompt**:
```text
You are an e-commerce optimization assistant.
You are given RAW PRODUCT DATA.
Your task is to REFORMAT, SUMMARIZE, or EXTRACT information.
You MUST NOT invent new features, materials, or specifications not present in the source.
If information is missing, do not guess. State "Unknown" or omit the section.
```

## 2. Verification Layers

### Layer 1: Prompt Engineering
*   Use `temperature=0` or `0.1` for deterministic outputs.
*   Use "Chain of Thought" only for complex logic, otherwise "Direct Answer".
*   Force JSON output schema to prevent conversational fluff.

### Layer 2: Fact-Check Heuristics (Post-Processing)
Before saving a fix, run these checks:

1.  **Numeric Consistency**: Does the generated text contain numbers (prices, dimensions) not found in the source?
    *   *Pass*: "50% Cotton" (found in specs)
    *   *Fail*: "50% Cotton" (specs say "100% Polyester")
2.  **Brand Safety**: Does the text mention competitor brands not present in the source?
3.  **URL Safety**: Are there fake links? (Only allow links from the `Product` entity).

### Layer 3: Human-in-the-Loop
*   **Critical Changes** (Titles, Prices, Claims) ALWAYS require explicit user approval (`status: SUGGESTED`).
*   **Safe Changes** (Alt Text, Meta Descriptions) can be `AUTOPILOT` enabled if confidence is high.

## 3. Risk Categories

| Risk Level | Feature | Policy |
|:---|:---|:---|
| **High** | Price, Availability, Warranty | **Deterministic Only**. No AI generation. |
| **Medium** | Product Title, Health Claims | **Human Review**. AI suggests, user approves. |
| **Low** | Alt Text, Meta Description | **Autopilot Allowed**. |

## 4. Forbidden Patterns

Naridon filters will block:
*   "Best in the world" / "Number 1" (unless substantiable)
*   "Guaranteed to cure..." (Medical claims)
*   "As seen on..." (unless verified)
*   Fake reviews or testimonials.

## 5. Incident Response

If a user reports hallucination:
1.  **Isolate**: Disable the specific `OptimizationRule` globally.
2.  **Trace**: Log the Input Prompt + Output + Model Version.
3.  **Patch**: Update the prompt constraints.
4.  **Re-verify**: Run regression tests on "edge case" products.
