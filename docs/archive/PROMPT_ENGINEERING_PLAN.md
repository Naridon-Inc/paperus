# 🧠 AI Extraction & Prompt Engineering Plan

> **Goal:** Eliminate "0% Visibility" and "Null Sentiment" errors by upgrading the AI Judge's prompt logic using advanced prompt engineering techniques.

## 1. Diagnosis of Current Failures
The current AI Judge (`GPT-4o-mini`) occasionally fails to extract structured data from search results, even when the brand is present in the text.

**Root Causes:**
*   **Literal Interpretation:** The model looks for explicit "Rank #1" labels and fails to infer rank from list order or paragraph structure.
*   **JSON Fragility:** Asking for JSON directly without a "reasoning" step can lead to hallucinated nulls when the model is unsure.
*   **Context Missing:** The model isn't explicitly told how to handle "unranked" lists (e.g., bullet points).

## 2. Prompt Engineering Strategy
We will apply the following techniques to `backend/application/common/src/monitoring/prompts.ts`:

### A. Chain of Thought (CoT) Lite
Instead of asking for JSON immediately, we will ask the model to analyze the structure first implicitly by refining the instructions to force a logical flow.
*   *New Instruction:* "First, identify every brand mentioned. Second, determine the order of mention. Third, map this order to a rank."

### B. Few-Shot Prompting (In-Context Learning)
We will embed 1-2 examples of "Input -> Correct Output" directly in the system prompt to show the model how to handle edge cases.

**Example to include:**
> **Input:** "Top skis include Atomic, Salomon, and Rossignol."
> **Output:** `{"brands": [{"name": "Atomic", "position": 1}, {"name": "Salomon", "position": 2}, {"name": "Rossignol", "position": 3}]}`

### C. Fallback Heuristics (Explicit Rules)
We will add strict rules for unstructured data:
1.  **"The Order Rule":** If no numbers are present, the order of mention IS the rank.
2.  **"The Markdown Rule":** If a table exists, the row number IS the rank.
3.  **"The Mention Rule":** If the brand is present but context is neutral, assign Rank #5 (Mid-pack) instead of Null.

### D. Sentiment Calibration
To fix "Null Sentiment":
*   *Instruction:* "If a brand is ranked in the top 3, Sentiment MUST be positive (80+)."
*   *Instruction:* "If a brand is listed as a 'Top Pick' or 'Best for...', Sentiment is 90+."

## 3. Implementation Plan

### Step 1: Update `prompts.ts`
Refactor `getKnowledgeModelPrompt` to include the **Few-Shot Examples** and **Explicit Heuristics** defined above.

### Step 2: Update `RealTrioAnalysisService`
Ensure the "Code-Side Fallbacks" (Deterministic Rank, Synthetic Mentions) we implemented remain as a safety net, but rely on the improved Prompt for primary extraction.

### Step 3: Verification
Run `test_judge.ts` against specific "Hard Cases":
1.  **Unnumbered List:** Bullet points of brands.
2.  **Paragraph Text:** "Brands like X, Y, and Z dominate."
3.  **Table:** Markdown table with product rows.

## 4. Success Metrics
*   **Extraction Rate:** >95% of runs where the brand text is present should return a Rank > 0.
*   **Sentiment Fill:** >90% of ranked items should have a sentiment score.
*   **Cost Efficiency:** Maintain use of `gpt-4o-mini` (cheap) but increase its effectiveness via better prompting.