# Process Cost & Performance Analysis

This document outlines the operational processes in the Naridon/Shoppeec platform, analyzing their cost (AI/API credits), compute requirements, and scalability risks.

* * *

## 1\. Monitoring & Intelligence (High Latency, High Value)

These processes generate the strategic data for the dashboard.

### A. Deep Competitor Analysis (The "Deep Dive")

1.  **Trigger:** Automated Cron (`POST /cron/deep-dive`) or Manual.
2.  **Workflow:**
3.  **Search:** Executes **5 distinct search queries** per competitor (SearchAPI).
4.  **Scrape & Read:** Processes ~25 search snippets/pages.
5.  **Synthesis:** GPT-4o (Azure) generates detailed SWOT.
6.  **Cost:** **79379$ (Very High)**
7.  SearchAPI: 5 units per competitor.
8.  LLM: ~4k tokens input per competitor.
9.  **Scale Risk:** Linear with (Competitors \* Shops). A shop with 50 competitors triggers 250 searches.
10.  **Control:** Strict limits (3/10/50 competitors) + Frequency limits (Weekly/Monthly).

### B. Daily Monitor Run (The "Rank Tracker")

1.  **Trigger:** Daily Scheduler (Autopilot).
2.  **Workflow:** 1 Search query per Prompt -> LLM Rank Extraction.
3.  **Cost:** **79379 (Moderate)**
4.  SearchAPI: 1 unit per prompt.
5.  LLM: ~1k tokens.
6.  **Scale Risk:** Linear with Prompts. 1,000 shops with 100 prompts = 100k daily searches.
7.  **Control:** Plan limits on Prompts (25/100/500).

* * *

## 2\. Optimization & Automation (High Volume, Token Intensive)

These processes act on the user's store data (Products, Collections).

### C. Auto-Fix Generation (SEO & Content)

1.  **Trigger:** User clicks "Fix" or "Fix All", or "Autopilot" background job.
2.  **Workflow:**
3.  Fetch Product Data (Title, Desc, Images).
4.  **LLM Generation:** Generate Meta Title, Description, Alt Text, JSON-LD.
5.  **Write Back:** GraphQL Mutation to Shopify.
6.  **Cost:** **79379 (Variable)**
7.  LLM: ~500-1k tokens *per product*.
8.  Shopify API: Leaky bucket limit usage.
9.  **Scale Risk:** **Explosive**. A user with 10,000 products clicking "Fix All" triggers 10k LLM calls instantly.
10.  **Control:**
11.  **Daily Fix Limits:** (e.g., 50/day on Starter).
12.  **Queueing:** Background job processing (BullMQ/QStash) to prevent API rate limits.

### D. Smart Redirects (Traffic Handling)

1.  **Trigger:** Real-time 404 traffic on the storefront (App Proxy/Pixel).
2.  **Workflow:**
3.  **Ingest:** Receive 404 URL path.
4.  **Vector Search:** Compare path embedding against Product Catalog embeddings.
5.  **Resolution:** Determine best matching product URL.
6.  **Action:** Create Redirect via Shopify API.
7.  **Cost:** **$ (Compute/Vector)**
8.  Vector DB: Read/Write IOPS.
9.  LLM (Embeddings): Cost per 404 event if calculating embeddings live (better to cache).
10.  **Scale Risk:** High Traffic stores can generate thousands of 404s/minute.
11.  **Control:**
12.  **Sampling/Debounce:** Only resolve unique 404s.
13.  **Caching:** Store resolutions in Redis.

### E. Sitemap/Link Scanning (Crawler)

1.  **Trigger:** Weekly/Monthly Health Check.
2.  **Workflow:** Crawl entire storefront -> Check status codes.
3.  **Cost:** **$ (Bandwidth/Compute)**
4.  Proxy/Bandwidth costs.
5.  Execution time (Lambda timeouts).
6.  **Scale Risk:** Large catalogs (100k pages) take hours to crawl.
7.  **Control:** Depth limits, rate limiting the crawler.

### F. Prompt Generation (AI-Assisted Setup)

1.  **Trigger:** Onboarding or Manual "Generate Suggestions" button.
2.  **Workflow:**
3.  Fetch Top Products (Shopify).
4.  **LLM Generation:** Send product data to LLM to generate high-intent keywords.
5.  **Cost:** **$ (Low/Variable)**
6.  LLM: 1 call per product batch.
7.  **Scale Risk:** Low, usually one-time per shop.
8.  **Control:** User-triggered.

### G. Social Deep Dive (Part of Monitor Run)

1.  **Trigger:** When a Monitor Run detects a social media link (Reddit, etc.) in search results.
2.  **Workflow:**
3.  **Detection:** \`RunAnalysisUseCase\` spots a social URL.
4.  **Analysis:** Calls \`SocialAnalysisService\` -> Perplexity to analyze that specific thread.
5.  **Cost:** **$$ (Medium/High)**
6.  Perplexity API call per social link found.
7.  **Scale Risk:** If a brand goes viral on Reddit, 1 search could trigger 5 social deep dives.
8.  **Control:** Limit deep analysis to top N results.

### H. Brand Normalization (Identity Resolution)

1.  **Trigger:** Post-Analysis or Scheduled Job.
2.  **Workflow:**
3.  **Detection:** Identify duplicate brand names (e.g., "VW", "Volkswagen").
4.  **Resolution:** Use LLM to determine canonical brand name.
5.  **Merge:** Update database records to link aliases to a single \`Competitor\` entity.
6.  **Cost:** **$ (Low)**
7.  LLM: Batch processing of names (low token usage).
8.  **Scale Risk:** Low, scales with unique brand names found.
9.  **Control:** Run periodically or on-demand.

* * *

## 3\. Platform & Infrastructure
### I. Product Sync & Embeddings

1.  **Trigger:** Install, Webhook (Product Update), or Manual Sync.
2.  **Workflow:** Fetch all products -> Generate Vector Embeddings -> Store in Vector DB.
3.  **Cost:** **79379 (Setup)**
4.  Embedding Model: Cost per product.
5.  Vector Storage: Monthly storage cost.
6.  **Scale Risk:** Initial sync for a 50k product store is heavy.
7.  **Control:** Bulk mutation webhooks vs naive polling.

* * *

## Summary of Limits & Gates

<table><tbody><tr><td data-row="1">Process</td><td data-row="1"><strong>Primary Cost Driver</strong></td><td data-row="1"><strong>Control Mechanism</strong></td></tr><tr><td data-row="2"><strong>Deep Dive</strong></td><td data-row="2">SearchAPI + GPT-4</td><td data-row="2"><code>deep_dive_frequency_days</code>, <code>deep_dive_competitors_limit</code></td></tr><tr><td data-row="3"><strong>Rank Tracker</strong></td><td data-row="3">SearchAPI</td><td data-row="3"><code>plan.prompts</code> limit</td></tr><tr><td data-row="4"><strong>Auto-Fix</strong></td><td data-row="4">LLM Tokens</td><td data-row="4"><code>plan.daily_fixes</code> limit, Queue System</td></tr><tr><td data-row="5"><strong>Redirects</strong></td><td data-row="5">Vector DB</td><td data-row="5">Unique 404 Caching</td></tr><tr><td data-row="6"><strong>Prompt Gen</strong></td><td data-row="6">LLM Tokens</td><td data-row="6">Manual Trigger</td></tr><tr><td data-row="7"><strong>Social Dive</strong></td><td data-row="7">Perplexity API</td><td data-row="7">Top N results only</td></tr><tr><td data-row="8"><strong>Brand Norm</strong></td><td data-row="8">LLM Tokens</td><td data-row="8">Batch Processing</td></tr><tr><td data-row="9"><strong>Product Sync</strong></td><td data-row="9">Embeddings</td><td data-row="9">Webhook-driven updates (Incremental)</td></tr></tbody></table>