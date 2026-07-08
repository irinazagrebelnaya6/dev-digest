# Public API — PRD

## Goals
The public API namespace (`/api/public/*`) exposes read endpoints for
third-party integrators without authentication, plus a webhook receiver.

## Requirements
- All public endpoints MUST be rate-limited per client IP.
- Rate-limited responses MUST return 429 with a `Retry-After` header.
- Webhook receiver MUST verify the `stripe-signature` header.
- No endpoint may expose internal account IDs.

## Non-goals
- Authentication for public endpoints (out of scope).
- GraphQL surface (deferred to Q3).
