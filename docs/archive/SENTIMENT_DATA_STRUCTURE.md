# Sentiment Data Structure - Complete Reference

## Overview

Both `/api/v1/monitor/dashboard?timeRange=30` and `/api/v1/monitor/sentiment` endpoints now return **consistent sentiment data structures** with proper three-category sentiment classification and platform breakdown.

---

## Sentiment Data Response Object

### Response Fields

```typescript
{
  positiveSentiment: number;        // Percentage (0-100) of runs classified as positive
  negativeSentiment: number;        // Percentage (0-100) of runs classified as negative
  neutralSentiment: number;         // Percentage (0-100) of runs classified as neutral
  currentValue: number;             // Average sentiment score across all runs (0-100)
  positiveReasons: string[];        // Top 3 themes/topics with positive sentiment
  negativeReasons: string[];        // Top 3 themes/topics with negative sentiment
  lineChartData: ChartDataPoint[];  // Sentiment trend by date
  barChartData: ChartDataPoint[];   // Sentiment breakdown by platform
  themes: Theme[];                  // List of themes with metadata
  yAxisDomain: [number, number];    // Y-axis range for charts [0, 100]
}
```

---

## Sentiment Classification Logic

**Three-Category Classification** (used consistently across both endpoints):

```typescript
if (sentimentScore >= 60) {
  sentiment = "positive";
} else if (sentimentScore <= 40) {
  sentiment = "negative";
} else {
  sentiment = "neutral"; // 41-59 range
}
```

### Thresholds:

- **Positive**: Score ≥ 60
- **Negative**: Score ≤ 40
- **Neutral**: Score between 41-59

---

## Data Structures

### ChartDataPoint (Line Chart - By Date)

```typescript
{
  date: string;           // Format: "Mon 15" or "2024-01-15"
  sentiment: number;      // Average sentiment for that date (0-100)
  dateShort?: string;     // Format: "15 Jan"
  fullDate?: Date;        // Full date object
}
```

**Example:**

```json
{
  "date": "Jan 15",
  "sentiment": 72,
  "dateShort": "15 Jan"
}
```

### ChartDataPoint (Bar Chart - By Platform)

```typescript
{
  date: string; // Platform name (e.g., "chatgpt-search", "perplexity-sonar")
  sentiment: number; // Average sentiment for that platform (0-100)
}
```

**Example:**

```json
{
  "date": "chatgpt-search",
  "sentiment": 65
}
```

### Theme Object

```typescript
{
  theme: string;          // Topic/theme name (e.g., "Product Quality")
  sentiment: string;      // Classification: "positive" | "negative" | "neutral"
  score: number;          // Average sentiment score for this theme (0-100)
  occurrences: number;    // Number of runs for this theme
  runs: Run[];           // Array of run data for filtering capability
}
```

### Run Object (Inside Theme)

```typescript
{
  id: string;                    // Run ID (UUID)
  sentiment: number;             // Sentiment score (0-100)
  model: string;                 // AI model used (e.g., "chatgpt-search")
  platform: string;              // Platform identifier
  source: string;                // Source name
  createdAt: string;             // ISO 8601 timestamp
  date: string;                  // Date in format "2024-01-15"
  fullResponse: string;          // AI response text
  promptText: string;            // Original prompt text
  region: string;                // Geographic region
  citations?: Citation[];        // Related citations
}
```

---

## API Endpoints

### 1. GET /api/v1/monitor/dashboard

**Query Parameters:**

```
timeRange: "30"      # Days to look back
productId?: string   # Optional product filter
topic?: string       # Optional topic filter
region?: string      # Optional region filter
source?: string      # Optional source filter
```

**Response:**
Full `DashboardResponse` including sentiment data (+ other dashboard data like stats, competitors, etc.)

**Sentiment Data Structure:**

```json
{
  "sentimentData": {
    "positiveSentiment": 65,
    "negativeSentiment": 20,
    "neutralSentiment": 15,
    "currentValue": 72,
    "positiveReasons": ["Product Quality", "Customer Service", "Value for Money"],
    "negativeReasons": ["Shipping Delays", "Price Point"],
    "lineChartData": [...],
    "barChartData": [...],
    "themes": [...],
    "yAxisDomain": [0, 100]
  }
}
```

---

### 2. GET /api/v1/monitor/sentiment

**Query Parameters:**

```
days?: number        # Number of days to look back (default: 30)
topic?: string       # Optional topic filter
productId?: string   # Optional product filter
model?: string       # Optional model/platform filter
region?: string      # Optional region filter
```

**Response:**
Standalone sentiment data object (identical structure to sentimentData from dashboard)

```json
{
  "positiveSentiment": 65,
  "negativeSentiment": 20,
  "neutralSentiment": 15,
  "currentValue": 72,
  "positiveReasons": ["Product Quality", "Customer Service"],
  "negativeReasons": ["Shipping Delays"],
  "lineChartData": [...],
  "barChartData": [...],
  "themes": [...],
  "yAxisDomain": [0, 100]
}
```

---

## Frontend Implementation

### MonitorSentiment Component

The component uses the sentiment data as-is but applies platform filtering:

**Data Flow:**

1. API returns complete sentiment data with all runs
2. Frontend receives data with `themes` containing `runs` array
3. User selects platform filter
4. Frontend re-filters `themes` by matching `run.model`/`run.source`/`run.platform`
5. Frontend recalculates metrics from filtered runs
6. Display updates with filtered sentiment, reasons, and chart data

**Platform Filtering Example:**

```typescript
const selectedPlatforms = new Set(["chatgpt-search"]);

// Filter themes based on runs from selected platforms
const filteredThemes = themes
  .map((theme) => {
    const filteredRuns = theme.runs.filter((run) =>
      selectedPlatforms.has(run.model || run.source || run.platform)
    );

    if (filteredRuns.length === 0) return null;

    // Recalculate sentiment from filtered runs
    return {
      ...theme,
      runs: filteredRuns,
      occurrences: filteredRuns.length,
      sentiment: calculateSentiment(filteredRuns),
    };
  })
  .filter(Boolean);
```

---

## Backend Implementation

### GetDashboardDataUseCase

**Location:** `backend/application/common/src/monitoring/get-dashboard-data.use-case.ts`

**Key Processing Steps:**

1. **Fetch runs** within time range from database
2. **Calculate sentiment counts** (three categories):

   ```typescript
   if (sentiment >= 60) sentimentPos++;
   else if (sentiment <= 40) sentimentNeg++;
   else sentimentNeu++;
   ```

3. **Generate trend data** by grouping runs by date
4. **Generate platform breakdown** by grouping runs by model/source
5. **Build themes** with runs array for filtering
6. **Calculate reasons** from themes

---

### GetSentimentDataUseCase

**Location:** `backend/application/common/src/monitoring/use-cases/dashboard/get-sentiment-data-use-case.ts`

**Key Processing Steps:**

1. **Parse filters** from query parameters
2. **Fetch runs** with filters applied
3. **Calculate sentiment counts** (three categories)
4. **Generate trend data** with date initialization
5. **Generate platform breakdown** from platform sentiment map
6. **Build themes** with enriched run data
7. **Calculate reasons** from three-category sentiment classification

---

## Common Issues & Fixes

### Issue 1: Binary Sentiment (Before Fix)

**Problem:** Sentiment only had positive/negative, no neutral category
**Fix:** Added `<= 40` check for negative classification
**Impact:** Now correctly identifies neutral sentiment (41-59 range)

### Issue 2: Empty barChartData (Before Fix)

**Problem:** Bar chart showed no data or duplicate line chart data
**Fix:** Generate platform breakdown instead of lineChartData
**Impact:** Bar chart now shows platform-level sentiment breakdown

### Issue 3: No Platform Filtering (Before Fix)

**Problem:** Frontend couldn't filter themes by platform
**Fix:** Added `runs` array to themes with platform metadata
**Impact:** Frontend can now filter and recalculate metrics

### Issue 4: Inconsistent Endpoints (Before Fix)

**Problem:** /dashboard and /sentiment returned different structures
**Fix:** Unified both to use three-category classification and include runs
**Impact:** Consistent data structure across both endpoints

---

## Testing & Validation

### Test Cases

**1. Three-Category Classification:**

- Score 75 → should be "positive" ✓
- Score 46 → should be "neutral" ✓
- Score 35 → should be "negative" ✓

**2. Percentage Calculation:**

- 10 positive, 5 negative, 5 neutral (out of 20) → 50%, 25%, 25% ✓

**3. Platform Breakdown:**

- Runs from "chatgpt-search" average 72 → platform shows 72 ✓
- Runs from "perplexity-sonar" average 58 → platform shows 58 ✓

**4. Reasons Derivation:**

- Top 3 positive themes extracted correctly ✓
- Top 3 negative themes extracted correctly ✓
- Empty reasons when no themes of that type ✓

---

## Migration Notes

- **Backwards Compatibility:** Old client code expecting binary sentiment will need updates
- **Field Names:** Use `sentiment` not `value` for chart data
- **Percentages:** All percentages now sum to 100% (with neutral category)
- **Platform Names:** Bar chart uses platform/model names (not dates)
