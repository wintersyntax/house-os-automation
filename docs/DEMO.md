# Offline synthetic demos

From the root of the extracted candidate (Node 22+, Python 3):

```bash
npm run check
npm run demo:brief
npm run demo:after
npm run demo:husbot
npm run demo:failures
```

The brief shows a `beforePurchase` fictional snapshot, then an `afterPurchase` fictional snapshot. The same evergreen shopping card and checklist persist across both fixtures; an imagined confirmed purchase changes inventory states, not merely checklist check marks. These are **examples**, not proof of a real automated purchase transaction.

The Husbot simulation uses an in-memory inventory reader, event-claim store and Slack sender. It shows a shopping answer sourced from incomplete checklist entries and `KJØP` inventory signals, suppressing the same event on redelivery.

Failure demo asserts that a failed read is retryable **before** consuming the claim and that a send failure **after** claiming cannot trigger another send for that same event. It demonstrates *at-most-once attempts*, not guaranteed delivery.

Run `npm run check` with no `.env` and no credentials. It executes a release gate, Node tests and both in-memory demos. No cloud or provider network is used by these commands.
