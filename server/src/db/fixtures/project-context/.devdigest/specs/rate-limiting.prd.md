# Rate Limiting — PRD

## Problem
Unauthenticated public endpoints are vulnerable to abuse and noisy-neighbor load.

## Requirements
- Per-client-IP token bucket, default 100 req/min.
- Exceeding the bucket returns `429` with `Retry-After` (seconds).
- Limits are configurable per endpoint class (read vs webhook).

## Non-goals
- Global (cross-region) rate coordination — per-node limits are acceptable for v1.
