# UI Migration Plan: From Polaris to Platform-Agnostic UI Kit

## 1. Objective
Transform the frontend from a tightly coupled Shopify/Polaris/Remix application into a modular, multi-platform system. The goal is to enable the same UI components to run seamlessly on **Shopify**, **WooCommerce**, and **Standalone Dashboards** without carrying heavy platform-specific dependencies.

## 2. The Problem
The current frontend relies heavily on `@shopify/polaris`. While visually excellent, Polaris:
1.  **Tight Coupling**: Often assumes a Shopify App Bridge context.
2.  **Remix Dependency**: Many existing components import directly from `@remix-run/react`.
3.  **Platform Lock-in**: Hard to use inside a WordPress admin panel or a standalone React SPA without pulling in the entire Shopify stack.

## 3. Design Philosophy: "Aesthetic Adaptation"
We love the clean, professional aesthetic of Polaris. We don't want to lose that trust-building look, but we need the flexibility to adapt.

**The Strategy:**
*   **Rebuild, Don't Import**: We are recreating Polaris-style components from scratch using **Tailwind CSS**.
*   **Headless Functionality**: Logic (state, handlers) is separated from styling.
*   **Theming**: Use CSS variables and Tailwind config to allow "Themes".
    *   *Theme A (Default)*: Polaris-like (Clean, white, crisp borders) for Shopify.
    *   *Theme B*: WooCommerce-like (Purple accents, slightly different spacing) for WordPress.
    *   *Theme C*: Modern SaaS (Dark mode support, gradients) for Standalone.

## 4. Architecture

### 4.1 The `ui-kit` Package
Located in `frontend/packages/ui-kit`. This is a pure React library.
*   **Dependencies**: `react`, `clsx`, `tailwind-merge`, `lucide-react`, `recharts`.
*   **Forbidden Dependencies**: `@shopify/polaris`, `@shopify/app-bridge`, `@remix-run/*`.

### 4.2 Handling Navigation & Data
Since the UI kit cannot import Remix's `Link` or `useNavigate`:
*   **Navigation**: Components accept `onAction` or `href` props. The consuming app (Shopify/Standalone) wraps these or passes its own routing logic.
*   **Data**: Components are "dumb". They accept data via props (`score`, `data`, `isOpen`) and emit events (`onChange`, `onClose`).

## 5. Migration Roadmap

### Phase 1: Primitives (The Building Blocks) ✅
Rebuilding the atoms required to construct complex views.
- [x] **Button**: Supporting variants (Primary, Secondary, Ghost, Destructive) and loading states.
- [x] **Checkbox**: Accessible, custom-styled checkbox.
- [x] **Input / TextField**: Text inputs with labels, errors, and help text.
- [x] **Select / Dropdown**: Native or custom select menus.
- [x] **Badge / Tag**: Status indicators (Success, Warning, Critical).
- [x] **Spinner / Loader**: Platform-neutral loading indicators.

### Phase 2: Core Business Components (High Impact) ✅
Components unique to our application logic.
- [x] **ScoreGauge**: The circular progress chart for SEO/AI scores.
- [x] **OnboardingHero**: The welcome banner for new users.
- [x] **DiffCard**: The complex "Before vs After" AI suggestion card.
- [ ] **PlanUsage**: Visualizing credit usage.

### Phase 3: Complex Interactive Components (The Hard Stuff) 🚧
Components that require heavy state management or complex DOM interactions.
- [x] **DataFilters**: The filtering bar (Time range, Source, Region). *Complexity: High*
- [x] **DataTable**: Sortable, paginated tables for Lists (Competitors, Mentions).
- [ ] **Modal**: accessible dialog overlays.
- [x] **Popover**: For dropdown menus and tooltips.

### Phase 4: Layouts & Shells
- [x] **PageLayout**: Standard header/content structure.
- [ ] **NavMenu**: Sidebar or Top bar navigation (responsive).

## 6. Implementation Guidelines

### Styling with Tailwind
Use `cn()` (clsx + tailwind-merge) for dynamic classes.
```tsx
<div className={cn("p-4 bg-white border", isSelected && "border-blue-500 ring-2")}>
```

### Icons
Replace `@shopify/polaris-icons` with `lucide-react`.
*   Shopify `ArrowRightIcon` -> Lucide `ArrowRight`
*   Shopify `CheckIcon` -> Lucide `Check`

### Typography
Do not use Polaris `<Text>`. Use standard HTML tags with Tailwind classes.
*   `variant="headingXl"` -> `text-2xl font-bold`
*   `variant="bodyMd"` -> `text-sm text-gray-700`
*   `tone="subdued"` -> `text-gray-500`

## 7. Component Inventory & Status (43 Total)

### A. Core Components (Migrated)
| Legacy Component | New Component | Status | Notes |
| :--- | :--- | :--- | :--- |
| `dashboard/ScoreGauge.tsx` | `ScoreGauge` | ✅ Done | Using Recharts |
| `dashboard/OnboardingHero.tsx` | `OnboardingHero` | ✅ Done | Decoupled nav |
| `DiffCard.tsx` | `DiffCard` | ✅ Done | Replaced Polaris Card |
| `optimization/DashboardCard.tsx` | `DashboardCard` | ✅ Done | Generic Card component |

### B. Filters & Navigation (Pending)
| Legacy Component | Priority | Status | Plan |
| :--- | :--- | :--- | :--- |
| `DataFilters.tsx` | High | ✅ Done | Implemented with Popover |
| `FixFilters.tsx` | High | ✅ Done | Replaced by `DataFilters` |
| `MultiSelectFilters.tsx` | Medium | ✅ Done | Replaced by `DataFilters` |
| `SubNavs.tsx` | Medium | ✅ Done | Replaced by `Button` variants |
| `monitor/ViewConfigButton.tsx` | Low | ✅ Done | Replaced by `Button` |

### C. Monitoring Dashboards & Charts (Pending)
*Complexity: High - Requires Recharts & Tailwind Grid*

| Component | Type | Plan |
| :--- | :--- | :--- |
| `monitor/MonitorDashboard.tsx` | Container | ✅ Done (Decomposed) |
| `monitor/MonitorOverviewCards.tsx` | Grid | ✅ Done (Split into 3 cards) |
| `monitor/MetricLineChart.tsx` | Chart | ✅ Done (`MetricLineChart`) |
| `monitor/MetricBarChart.tsx` | Chart | ✅ Done (`MetricBarChart`) |
| `monitor/RegionGraph.tsx` | Chart | ✅ Done (Use `MetricBarChart`) |
| `monitor/CitationGraph.tsx` | Chart | ✅ Done (Use `MetricLineChart`) |
| `monitor/ShareOfVoiceCard.tsx` | Chart | ✅ Done (Use `ScoreGauge`) |
| `monitor/PlatformMetricCard.tsx` | Card | ✅ Done (Use `DashboardCard`) |
| `monitor/MonitorKPIBar.tsx` | Stats | ✅ Done (Use Flex + Cards) |
| `monitor/VisibilityRankingsCard.tsx` | List | ✅ Done (Use `DataTable`) |
| `monitor/VisibilityTab.tsx` | Layout | ✅ Done (Use Layout) |
| `monitor/CitationShareTab.tsx` | Layout | ✅ Done (Use Layout) |
| `monitor/AveragePositionTab.tsx` | Layout | ✅ Done (Use Layout) |
| `monitor/MonitorAlertsStrip.tsx` | Alert | ✅ Done (Use `Badge`/`Banner`) |
| `monitor/MatrixView.tsx` | Grid | ✅ Done (Use CSS Grid) |

### D. Detailed Views & Tables (Pending)
*Complexity: Medium - Requires DataTable*

| Component | Type | Plan |
| :--- | :--- | :--- |
| `monitor/MonitorCompetitors.tsx` | View | ✅ Done (Decomposed) |
| `monitor/MonitorPlatforms.tsx` | View | ✅ Done (Use `DataTable`) |
| `monitor/MonitorCitationsTable.tsx` | Table | ✅ Done (Use `DataTable`) |
| `monitor/MonitorExecutionsTable.tsx` | Table | ✅ Done (Use `DataTable`) |
| `monitor/MonitorTracking.tsx` | View | ✅ Done (Use Components) |
| `monitor/MonitorCitation.tsx` | View | ✅ Done (Use Components) |
| `monitor/MonitorMentions.tsx` | List | ✅ Done (Use `DataTable`) |
| `monitor/MonitorSentiment.tsx` | View | ✅ Done (Use Components) |
| `monitor/MonitorPersonas.tsx` | List | ✅ Done (Use Grid) |
| `monitor/ExpandedModalTable.tsx` | Modal | ✅ Done (Use `Popover`/`DataTable`) |
| `monitor/ExecutionDetailsModal.tsx` | Modal | ✅ Done (Use `Popover`) |

### E. Optimization & Utilities
| Component | Plan |
| :--- | :--- |
| `SideBySideDiff.tsx` | ✅ Done (Integrated in `DiffCard`) |
| `optimization/OptimizationCharts.tsx` | ✅ Done (Split into 3 charts) |
| `onboarding/AnimatedFeatureCard.tsx` | ✅ Done (Use `Card`) |
| `monitor/SimpleMarkdownRenderer.tsx` | ✅ Done (Use Markdown) |
| `GlobalRunningPrompts.tsx` | ✅ Done (Use `Badge`) |
| `LimitReachedModal.tsx` | ✅ Done (Use `Popover`/Overlay) |
| `BillingGuard.tsx` | **Skip** (App Logic) |
| `ClientOnly.tsx` | **Skip** (Remix Logic) |

## 8. Decomposition Strategy (Micro-Components)

To solve the "massive file" issue, we will enforce a strict breakdown of monolithic views into reusable atoms.

### A. Monitor Dashboard (`MonitorDashboard.tsx`)
**Current Size:** ~1000 lines
**Target Components:**
1.  **`MonitorHeader`**: Ticker, Title, and Action buttons.
2.  **`MetricGrid`**: Container for the top-level KPI cards.
3.  **`ShareOfVoiceChart`**: The main Area Chart (with extracted `CustomTooltip`).
4.  **`SentimentChart`**: The bottom Bar/Line chart.
5.  **`CompetitorMiniList`**: The sidebar list of competitor rankings.
6.  **`DashboardLayout`**: The grid shell holding these pieces together.

### B. Competitor View (`MonitorCompetitors.tsx`)
**Current Size:** ~600 lines
**Target Components:**
1.  **`CompetitorLogo`**: Complex image handling + ColorThief logic.
2.  **`RankBadge`**: The #1, #2, #3 visual indicators.
3.  **`CompetitorGridItem`**: The Card view for a single competitor.
4.  **`CompetitorListItem`**: The Table Row view for a single competitor.

### C. Data Filters (`DataFilters.tsx`)
**Current Size:** ~450 lines
**Target Components:**
1.  **`FilterBar`**: The horizontal container.
2.  **`DateRangePicker`**: Dedicated component for time selection.
3.  **`FilterPopover`**: Generic reusable popover for Source/Region/Topic.
4.  **`ProductCombobox`**: Searchable product selector.

### D. Monitor Overview Cards (`MonitorOverviewCards.tsx`)
**Target Components:**
1.  **`AIBrandViewCard`**: Brand clarity score, top adjectives, and "Why Chosen/Excluded".
2.  **`CompetitorPressureCard`**: Threat score, keyword gaps, and overlap matrix.
3.  **`LandscapeCard`**: Model bias, top sources, and citation growth.

### E. Optimization Charts (`OptimizationCharts.tsx`)
**Target Components:**
1.  **`AutopilotActivityChart`**: Bar chart showing automated actions over time.
2.  **`FixSuccessTrendChart`**: Line chart correlating fixes with ranking improvements.
3.  **`CategoryTreemap`**: Treemap visualization of issue categories.

## 9. Next Steps
1.  **Build Primitives**: Finish Input, Select, and Badge to unblock Forms.
2.  **Decompose & Migrate**: Tackle the large components (Dashboard, Filters) by splitting them first.
3.  **App Integration**: Replace imports in `frontend/apps/shopify` to use `@test-app/ui-kit`.