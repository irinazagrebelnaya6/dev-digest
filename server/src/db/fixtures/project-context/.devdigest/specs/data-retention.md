# Data Retention

## Policy
- Raw webhook payloads: retained 30 days, then purged.
- Aggregated metrics: retained 13 months.
- No internal account IDs are persisted in public-facing logs.

## Deletion
- A tenant deletion request purges all associated raw payloads within 24h.
