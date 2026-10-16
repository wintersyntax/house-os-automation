# Security, privacy and scope

This project publishes a **sanitized allowlist**, not a clone or fork of the private source. It excludes git history, real household identities, live Trello boards and cards, Slack IDs, private URLs, real receipts, tokens, billing/project configuration, internal operations ledgers and private self-hosted runner scripts.

The release candidate uses a fail-closed source extraction process plus `npm run check:release`. The release checker rejects unapproved paths, secret-looking tokens, private URLs, personal paths, personal email addresses and binaries. It cannot prove absence of all secrets or personal context, so human line-by-line review remains mandatory.

Synthetic examples use invented identifiers and datasets. Tests contain only generated/mock credentials and never initiate real network requests. The publicly visible CI uses GitHub-hosted runners and needs no repository secrets. No public deployment endpoint exists as part of this edition.

Production caution: the application source is **not a turnkey secure deployment**. Cloud Run IAM, least-privilege service accounts, Secret Manager, Cloud Tasks retry horizon, Firestore TTL and provider spend limits are operational boundaries requiring separate review.
