# Onboarding Flow

## Overview
New integrators register, receive a sandbox key, and exchange it for a scoped
production token.

## Steps
1. Register the integration (name, callback URL).
2. Verify the callback URL challenge.
3. Issue a sandbox key (rate-limited, read-only).
4. Promote to production after a successful test webhook round-trip.
