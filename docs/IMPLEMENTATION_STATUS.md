# Implementation and evidence ledger (public edition)

**Snapshot basis:** public code selection reviewed 16 October 2026; dated private milestones updated through 23 October 2026. The public source remains allowlisted and does not disclose private infrastructure identifiers.

| Component | Status | Evidence available in this repo | Outside this repo |
| --- | --- | --- | --- |
| Deterministic facts and Daily Brief | Implemented | Source, synthetic fixtures, Node regression tests and local preview | Live all-category household data normalization |
| Read-only inventory Trello adapter | Implemented | GET-only source and mocked tests | Historical owner-observed read and one Cloud Run Job execution |
| Shopping checklist union | Implemented in source | Matching, manual-only and malformed-input tests | Owner-observed manual-only checklist response on 16 October 2026; a live mixed-source deduplication run was not separately demonstrated |
| Signed Slack ingress | Implemented | HMAC, deadline and allowlist tests | Private app/workspace and ingress runtime |
| Cloud Tasks/Firestore/Slack worker | Implemented | Mocked end-to-end pipeline and failure/replay tests | Owner-observed limited test-channel deployment |
| Firestore 30-day claim field | Implemented | Source and tests | Owner-observed active 30-day TTL policy in private environment; asynchronous deletion has not been observed |
| Optional OpenRouter wording draft | Implemented, disabled | Mock provider tests, explicit approval gate | No confirmed real AI provider request |
| Cleaning Guardian and rotation | Private attended test evidence; not publicly extracted | Documentation only | Bounded test-card correction and one verified business pilot; Make v3 reported OFF, no normal household operation |
| Private Shopping Engine foundations | Private source and emulator tests | No write-capable Engine extracted | Signed rechecks, journal/identity reconciliation; no general live writer |
| Bot membership and Cleaning correction | Limited private attended tests | No private Guardian runtime extracted | Actor/assignment-verified corrections and bot-removal tests; no household-wide deployment |
| Cleaning business pilot | One private attended test cycle | No private accounting records extracted | One guarded points effect and protected successor; not recurring automation |
| Incident-specific comment wording | Narrow private evidence | No Guardian comments module extracted | Identity-grounded individual mention tested; later lowercase worker-only release verified, with no additional live comment |
| Receipt OCR, payment and restock automation | Planned for public edition | Synthetic scenario only | No general production receipt, payment or restock engine claimed |
| Multi-purpose autonomous AI agent | Planned | Architectural boundaries | No live general agent claim |
| Physical sensors / embedded control | Research/planned | Roadmap only | No shipped device integration |

## Dated private evidence — 16 October 2026

The owner verified a rollout to the already authorized private read-only worker, including a new ready revision with full worker traffic. A fresh question in one approved private test channel received a genuine reply including an independently added, incomplete shopping-list item marked `HANDLELISTE`. This demonstrates that manual-only shopping read path; it does **not** prove the combined live inventory-and-checklist case, automatic purchasing, restocking, write-capable Engine, general-channel access or a scheduled Daily Brief. Those distinctions remain visible in the offline tests and architecture.

## Dated private progress — 17–23 October 2026

Private development added Shopping state/reconciliation, Cleaning evidence and
transactional claim controls, followed by limited attended Guardian correction
and one business cycle. These changes are not exported into this public source,
and do not prove normal household use, unattended scheduling or a public service.
See the [changelog](../CHANGELOG.md) for the chronological summary.

## Accepted source after the first Cleaning cycle — 23 October 2026

The private project accepted one strictly bounded continuation from the
existing verified successor. Focused source tests passed 234/234, and local
Firestore Emulator cases passed 22/22. Its exact Main passed all three
GitHub checks. **No second live business cycle or unattended household
rotation is claimed.** A separately verified worker-only lowercase wording
release did not generate another live comment.

## Independent private verification snapshots

- **21–22 October:** the signed Cleaning Guardian and dedicated bot identity
  completed narrowly attended TEST-card scenarios with corroborated
  correction, valid assignee acceptance and archival behavior.
- **22 October:** three attended bot-only membership removals retained other
  members and card state; a separately gated business pilot finished one
  controlled cycle with seven verified effects and one protected successor.
- **Source regressions:** the private TASK-096 milestone ran 1,343 Node and
  87 Python tests successfully. Later focused incident-comment cases passed
  177/177, and the accepted 22 October private Main revision passed all
  three GitHub Main CI checkpoints. Each verification belongs to its own
  revision and scope.
- **Not equivalent to rollout:** real TEST-card proof and passing CI do not
  imply general household operation, enabled recurring Cleaning, a general
  Shopping Engine writer, new sensors or a publicly deployable Guardian.

The public repository still contains its original read-only extraction and
synthetic tests. The newer private modules are **not** included.

The separate private project uses staged CI and release checks. Private runner scripts, deployment specifics, URLs, identifiers and operating records are **not** part of this public extraction. The public GitHub Actions workflow independently runs the fictional, no-credential portfolio checks.

**Do not claim:** that the public demo talks to the private household, that the AI layer autonomously controls workflows, or that replay and delivery are exactly once.
