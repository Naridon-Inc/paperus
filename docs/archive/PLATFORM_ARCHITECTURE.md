# Platform Architecture & AI Stack

This document details the backend architecture, specifically focusing on the AI search engine monitoring stack and the economic model for AI usage.

## 1. The "Real Trio" Monitoring

Our system is designed to monitor brand visibility across the three most critical AI-driven search engines. We call this the "Real Trio".

### A. Google AI Overview (SGE)
- **Goal:** Track how Google's AI snapshots present the brand and products.
- **Mechanism:** Scrapes SERP features specifically targeting the AI Overview block.
- **Key Metrics:** Presence of brand, sentiment of summary, citation links.

### B. ChatGPT Search
- **Goal:** Monitor direct answers provided by OpenAI's search capabilities.
- **Mechanism:** Simulates queries via browser automation or official APIs (where available) to capture conversational responses.
- **Key Metrics:** Recommendation frequency, product positioning in lists.

### C. Perplexity
- **Goal:** Analyze citations and synthesized answers from Perplexity's engine.
- **Mechanism:** Focuses heavily on the "Sources" cited and the direct answer summary.
- **Key Metrics:** Source authority, answer accuracy, competitive adjacency.

## 2. AI Economy Stack

To maintain high gross margins (>70%) while delivering AI-heavy features, we utilize a tiered model for Large Language Models (LLMs).

### A. Economy Tier (High Volume)
Used for data extraction, summarization, and routine sentiment analysis.
- **Models:** `gpt-4o-mini`, `gemini-2.0-flash`.
- **Cost Structure:** Low cost per token allows for high-frequency monitoring without eating into margins.
- **Use Cases:**
  - Parsing HTML/JSON from search results.
  - Basic keyword extraction.
  - Initial sentiment classification.

### B. Pro Tier (On-Demand / Deep Dive)
Activated via "Pro" toggles or specific deep-dive audit requests by the user.
- **Models:** `gpt-4o`, `claude-3.5-sonnet`.
- **Cost Structure:** Higher cost, billed or limited by quota.
- **Use Cases:**
  - Complex strategic analysis.
  - Generating personalized marketing copy (e.g., Post-Purchase Emails).
  - Detailed competitive gap analysis.

## 3. Worker Architecture

High-latency tasks, such as running the full monitoring suite across the "Real Trio", are decoupled from the API.

- **Queue System:** Redis-backed queues (BullMQ).
- **Workers:** Located in `backend/workers/`.
- **Flow:**
  1. API receives a "Monitor" request.
  2. Request is pushed to `monitoring-queue`.
  3. Worker picks up job, executes runners in `backend/infrastructure/ai/`.
  4. Results are stored in DB and cached.

## 4. Platform Agnostic Design

While the monitoring is the core value, the delivery is platform agnostic.
- **Data Layer:** Normalized `Shop` model handles identity.
- **Application Layer:** Decides whether to deliver results via Shopify App Bridge or Standalone Dashboard.