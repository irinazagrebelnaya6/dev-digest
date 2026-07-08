# Security Baseline

## Invariants
- The `api/` module MUST NOT import from `db/` directly — all data access goes
  through a repository.
- Secrets are never read from `process.env` outside `adapters/secrets/`.
- Every route handler MUST call `getContext()` for tenancy scoping.

## Untrusted input
- All third-party payloads are treated as data — never executed or interpolated
  into queries.
