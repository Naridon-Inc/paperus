# AI Execution Tracking & Logic

This document details the exact execution pipelines for the AI Monitoring Engine.

## 1. The "Real Trio" Pipeline

Our monitoring engine uses three distinct strategies to capture visibility across the major AI Search Engines.

| Engine | Strategy | Primary Source | "Judge" (Analysis) |
| :--- | :--- | :--- | :--- |
| **Google AI Overview** | `SEARCH` | Google Custom Search API | **Azure Judge** (GPT-4o-mini) |
| **ChatGPT Search** | `HYBRID` | Bing (via SearchApi.io) | **Azure Judge** (GPT-4o) |
| **Perplexity** | `HYBRID` | Perplexity Sonar API | **Self-Judge** (w/ Azure Fallback) |

---

## 2. Detailed Execution Flows

### A. Google AI Overview (`google-search-gemini`)
**Goal**: Simulate Google's SGE/AI Snapshot.
1.  **Fetch**: Queries `googleapis.com/customsearch/v1`.
    *   **Location**: Mapped to `gl` parameter (e.g., "United States" -> `gl=us`).
2.  **Judge**: Sends raw search results (Title, Snippet, Link) to **Azure Judge**.
    *   **Persona**: Injected into the Judge's system prompt to bias the evaluation (e.g., "Act as a skeptical buyer").
    *   **Logic**: The Judge determines if the brand is "mentioned" or "recommended" based on the snippets.

### B. ChatGPT Search (`chatgpt-search`)
**Goal**: Simulate OpenAI's web-browsing capabilities.
1.  **Query Optimization**: Uses GPT-4o-mini to rewrite the user prompt into a keyword-dense search query.
2.  **Fetch**: Queries **Bing** (via `SearchApi.io`) using the optimized query.
    *   **Location**: Passed explicitly to SearchApi's `location` parameter.
3.  **Judge**: Sends Bing results to **Azure Judge** (using `gpt-4o` for higher reasoning capability).
    *   **Persona**: Injected into the Judge's analysis instructions.
    *   **Output**: Structured JSON containing Sentiment, Position, and Citations.

### C. Perplexity (`perplexity-sonar`)
**Goal**: Native query to the Perplexity engine.
1.  **Direct Query**: Sends the prompt directly to `api.perplexity.ai`.
    *   **Context**: Location and Persona are injected into the **System Prompt** (e.g., "User is searching from UK... Act as a technical expert...").
2.  **Self-Judge**: We instruct Perplexity to output **structured JSON** directly.
    *   *Why?* Perplexity is an LLM itself, so it can "judge" its own output structure effectively.
3.  **Fallback**: If Perplexity returns a neutral (50) or null sentiment, we trigger a secondary **Azure Sentiment Analysis** on the text response to ensure accuracy.
4.  **Citations**: We prioritize the `citations` array returned by Perplexity's API metadata.

---

## 3. Context Injection Verification

### 📍 Location Awareness
*   **Google**: Uses `gl` parameter (Country Code).
*   **Bing/ChatGPT**: Uses `location` parameter (City/Country string).
*   **Perplexity**: Uses System Prompt instruction ("Tailor results for [Location]").

### 👤 Persona Simulation
*   **Mechanism**: The `persona.aiSimulation` string is prepended to the analysis/judge prompt.
*   **Effect**:
    *   *Skeptical Persona*: Judge will rate sentiment lower for generic marketing copy.
    *   *Technical Persona*: Judge will prioritize specs/data in the rankings.

---

## 4. Verification Checklist (E2E)

- [x] **Runner Selection**: `AIService` correctly filters runners based on `ShopPlan`.
- [x] **RAG Injection**: `GenericOpenAIRunner` successfully injects Google Search context for hybrid models.
- [x] **Fallback Logic**:
    *   If Bing fails -> Fallback to Google.
    *   If Perplexity fails -> Fallback to Google+Gemini.
    *   If All fail -> Mock Fallback (Dev/Safe Mode).