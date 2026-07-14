# Webhooks

## Receiver
`POST /api/public/webhooks/stripe` accepts Stripe events.

## Requirements
- MUST verify the `stripe-signature` header before processing.
- MUST be idempotent on the event id.
- Unverified or replayed events return `400` and are not processed.
