# Offline synthetic demonstrations

Requires Node.js 22+ and Python 3. No `.env`, Trello, Slack or cloud credentials
are required. Tests use mock data and local/loopback adapters.

```bash
npm run check
npm run demo:brief
npm run demo:after
npm run demo:husbot
npm run demo:failures
```

`demo:brief` and `demo:after` render deterministic Norwegian previews from
fictional before/after snapshots. They do not establish that a purchase took
place automatically. `demo:husbot` uses synthetic inventory, a manual shopping
item, a fake claim store and a fake Slack sender. The same event is delivered
twice and produces one simulated reply. `demo:failures` demonstrates that a
failed read happens before claiming, while an ambiguous send after claiming
cannot safely be replayed.

These are not live external-service tests or production deployment proof.
