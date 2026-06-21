# UI Component Migration Plan: Monorepo & Shared Design System

## 1. Objective
To transition the frontend from a tightly coupled, Shopify-specific "Polaris" interface into a **platform-agnostic Design System**. This enables us to deploy the same high-quality UI across Shopify, WooCommerce, and standalone dashboards without code duplication.

## 2. Architecture: The `ui-kit` Strategy

We are using a Monorepo structure (Turbo/NPM Workspaces) to decouple UI logic from application logic.

### Structure
```
frontend/
├── apps/
│   ├── shopify/         # Shopify App Bridge wrapper (consumes ui-kit)
│   └── standalone/      # WooCommerce/Web Dashboard (consumes ui-kit)
└── packages/
    └── ui-kit/          # SHARED LIBRARY
        ├── src/
        │   ├── components/  # Atoms & Molecules (Button, Card)
        │   ├── layouts/     # Page templates
        │   └── lib/         # Utilities (cn, tailwind-merge)
```

### Technology Stack Change
| Feature | Legacy (Shopify App) | New (Shared UI Kit) | Reason |
| :--- | :--- | :--- | :--- |
| **Styling** | Polaris (CSS Modules) | **Tailwind CSS** | Portable, smaller bundle, infinite customization. |
| **Icons** | Polaris Icons | **Lucide React** | Standard industry set, lighter weight. |
| **Components** | Polaris React | **Custom (Shadcn-like)** | Removes dependency on Shopify's heavy runtime. |
| **Charts** | Recharts | **Recharts** | Kept same (works well). |
## 4. Full Component Inventory

Based on a comprehensive audit of `temp-shopeec-branch/app/components`, here is the complete migration status.

### A. Core Primitives (The Foundation)
| Component | Status | Notes |
| :--- | :--- | :--- |
| `Button` | ✅ Done | Variants: primary, ghost, outline, danger |
| `Card` | ✅ Done | Replaces Polaris Card with proper header/content composition |
| `Input` | ✅ Done | Standard text input |
| `Select` | ✅ Done | Native select dropdown |
| `Checkbox` | ✅ Done | Custom styled checkbox |
| `Badge` | ✅ Done | Success, Warning, Critical, Info variants |
| `Skeleton` | ✅ Done | Loading states |
| `ProgressBar` | ✅ Done | For sentiment/score bars |
| `EmptyState` | ✅ Done | Generic empty placeholder |
| `Tabs` | ✅ Done | Navigation tabs replacement |
| `Popover` | ✅ Done | Custom popover for filters |
| `DateRangePicker` | ✅ Done | Simplified date input range |

### B. Business Components (Monitor)
| Component | Status | Notes |
| :--- | :--- | :--- |
| `LiveTicker` | ✅ Done | Header status indicator |
| `MonitorKPIBar` | ✅ Done | Horizontal metrics strip |
| `AIBrandViewCard` | ✅ Done | Overview card 1 |
| `CompetitorPressureCard` | ✅ Done | Overview card 2 |
| `LandscapeCard` | ✅ Done | Overview card 3 |
| `ShareOfVoiceCard` | ✅ Done | Donut chart + Legend + Logic |
| `VisibilityRankingsCard` | ✅ Done | Expandable table for topics |
| `RankBadge` | ✅ Done | Gold/Silver/Bronze badges |
| `CompetitorLogo` | ✅ Done | Smart image handling |
| `CompetitorGridItem` | ✅ Done | Card view for competitors |

### C. Business Components (Citations)
| Component | Status | Notes |
| :--- | :--- | :--- |
| `CitationTypesChart` | ✅ Done | Source distribution pie chart |
| `TopDomainsCard` | ✅ Done | Ranked list of domains |
| `CategoryBadge` | ✅ Done | Earned, Owned, Social coloring |
| `MentionedStatus` | ✅ Done | Check/X status indicator |
| `DomainIcon` | ✅ Done | Favicon fetcher |

### D. Business Components (Optimization)
| Component | Status | Notes |
| :--- | :--- | :--- |
| `AutopilotActivityChart` | ✅ Done | Bar chart |
| `FixSuccessTrendChart` | ✅ Done | Line chart |
| `CategoryTreemap` | ✅ Done | Treemap visualization |
| `DiffCard` | ✅ Done | Before/After comparison |

### E. Complex Organisms
| Component | Status | Notes |
| :--- | :--- | :--- |
| `DataTable` | ✅ Done | Generic sortable table |
| `DataFilters` | ✅ Done | Filter bar with Popovers |
| `MetricLineChart` | ✅ Done | Generic Line Chart wrapper |
| `MetricBarChart` | ✅ Done | Generic Bar Chart wrapper |

## 5. Next Steps
1.  **Platform Tab**: Implement `MatrixView` and `PlatformMetricCard`.
2.  **Mentions Tab**: Implement `MentionCard`.
3.  **Sentiment Tab**: Implement `ThemeDetailRow`.