# Implementation and evidence ledger (public edition)

**Snapshot basis:** private source verified on 16 October 2026. Public code is a reviewed allowlisted selection; this document does not disclose private infrastructure identifiers.

| Component | Status | Evidence available in this repo | Outside this repo |
| --- | --- | --- | --- |
| Deterministic facts and Daily Brief | Implemented | Source, synthetic fixtures, Node regression tests and local preview | Live all-category household data normalization |
| Read-only inventory Trello adapter | Implemented | GET-only source and mocked tests | Historical owner-observed read and one Cloud Run Job execution |
| Shopping checklist union | Implemented in source | Matching, manual-only and malformed-input tests | Owner-observed manual-only checklist response on 16 October 2026; a live mixed-source deduplication run was not separately demonstrated |
| Signed Slack ingress | Implemented | HMAC, deadline and allowlist tests | Private app/workspace and ingress runtime |
| Cloud Tasks/Firestore/Slack worker | Implemented | Mocked end-to-end pipeline and failure/replay tests | Owner-observed limited test-channel deployment |
| Firestore 30-day claim field | Implemented | Source and tests | Owner-observed active 30-day TTL policy in private environment; asynchronous deletion has not been observed |
| Optional OpenRouter wording draft | Implemented, disabled | Mock provider tests, explicit approval gate | No confirmed real AI provider request |
| Cleaning rotation | Exists externally | Documentation only | Owner-observed private Make v3 workflow |
| Receipt OCR, payment and restock automation | Planned | Synthetic scenario only | No production engine in this edition |
| Multi-purpose autonomous AI agent | Planned | Architectural boundaries | No live general agent claim |
| Physical sensors / embedded control | Research/planned | Roadmap only | No shipped device integration |

## Dated private evidence — 16 October 2026

The owner verified a rollout to the already authorized private read-only worker, including a new ready revision with full worker traffic. A fresh question in one approved private test channel received a genuine reply including an independently added, incomplete shopping-list item marked `HANDLELISTE`. This demonstrates that manual-only shopping read path; it does **not** prove the combined live inventory-and-checklist case, automatic purchasing, restocking, write-capable Engine, general-channel access or a scheduled Daily Brief. Those distinctions remain visible in the offline tests and architecture.

The separate private project uses staged CI and release checks. Private runner scripts, deployment specifics, URLs, identifiers and operating records are **not** part of this public extraction. The public GitHub Actions workflow independently runs the fictional, no-credential portfolio checks.

**Do not claim:** that the public demo talks to the private household, that the AI layer autonomously controls workflows, or that replay and delivery are exactly once.
