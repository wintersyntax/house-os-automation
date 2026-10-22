# House OS Automation

[![Portfolio CI](https://github.com/wintersyntax/house-os-automation/actions/workflows/portfolio-ci.yml/badge.svg)](https://github.com/wintersyntax/house-os-automation/actions/workflows/portfolio-ci.yml)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)
[![MIT License](https://img.shields.io/badge/License-MIT-2ea44f)](LICENSE)
![Portfolio Project](https://img.shields.io/badge/Portfolio-Project-6f42c1)
![Status: Active development](https://img.shields.io/badge/Status-Active%20development-f59e0b)

**A practical engineering case study: turning an everyday coordination problem into secure, testable automation with carefully bounded AI assistance.**

House OS turns everyday household signals—shopping needs, inventory, chores, and Slack requests—into structured, verifiable workflows. This repository is a **standalone public portfolio edition** of a larger private project: real implementation code, fictional household data, and reproducible offline demos.

> **Real code. Synthetic data. No credentials required.** The demos never connect to the private household, Slack, Trello, or Google Cloud.

## From operational problem to working system

**The problem.** Inventory states, manually added shopping requests, and questions from household members originate in different places. A naive integration could omit manual entries, confuse a checked checklist item with a completed purchase, or send duplicate replies when Slack re-delivers an event.

**The implementation.** I designed a read-only, event-driven slice: strict Trello data projections; signed Slack event validation; durable Cloud Tasks handoff; deterministic Norwegian answers; and Firestore-backed duplicate suppression before a Slack send attempt. Writes, purchases, expenses, and autonomous AI decisions are deliberately outside this slice.

**How to verify it.** This public edition contains actual application modules, fictional fixtures, automated tests, and in-memory end-to-end/failure simulations. A narrow shopping-list response was separately observed in one approved private test channel on **16 October 2026**; the public demos themselves do not use that environment.

**Business value hypothesis, not a claimed outcome:** fewer missed requests and manual status checks, safer response handling, and clearer ownership of household facts. A broader rollout would need baseline measurements for task time, answer accuracy, duplicate-message rate, adoption, and operating cost. **No time savings or ROI figures are claimed for this portfolio edition.**

## Engineering highlights

- **Source-of-truth discipline** — validates household snapshots, dates, inventory states, and incomplete shopping-list items instead of guessing from missing data.
- **Read-only API integration** — projects Trello inventory and shopping checklists through bounded GET requests, strict parsing, and explicit failures.
- **Signed event processing** — verifies Slack requests using raw-body HMAC, timestamp checks, and app/workspace/channel allowlists before durable handoff.
- **Replay and failure handling** — uses stable Cloud Tasks event identities and Firestore create-only claims to suppress duplicate reply attempts.
- **Grounded AI boundaries** — an optional OpenRouter adapter can draft wording for human review; it cannot change household facts, money, assignments, or inventory.
- **Reproducible verification** — dependency-free Node.js tests, in-memory integration simulations, a public release scanner, and GitHub-hosted CI.

## Five-minute technical walkthrough

| Inspect | What it demonstrates |
| --- | --- |
| [Trello data projections](src/trello/inventory.js) | Strict schema checks, explicit inventory states, manual checklist entries, and conservative error handling |
| [Slack event ingress](src/husbot/slack-events.js) | Raw-body HMAC-SHA256 verification, constant-time comparison, replay-window enforcement, scope allowlists, and durable-acknowledgement contract |
| [Cloud transport and reply claims](src/husbot/cloud-platform.js) | Named Cloud Tasks requests, authenticated worker delivery, and atomic Firestore create-only deduplication |
| [Deterministic worker](src/husbot/cloud-worker.js) | Read-first/claim-second processing and a single permitted Slack reply attempt per retained event claim |
| [Offline simulation](demos/husbot-simulation.mjs) / [failure scenarios](demos/failure-modes.mjs) | Fictional end-to-end behavior, duplicate suppression, retryable reads, and ambiguous send results |

**Stack:** JavaScript (Node.js 22, native modules and tests), Python 3 release checks, Trello REST, Slack Events API, Google Cloud Run, Cloud Tasks, Firestore, and optional OpenRouter wording drafts. The public edition has **no third-party npm dependencies** and runs offline by default.

## Try the synthetic demos

**Requirements:** Node.js 22+ and Python 3. No npm dependencies, API keys, cloud resources, or configuration are needed.

~~~bash
git clone https://github.com/wintersyntax/house-os-automation.git
cd house-os-automation

npm run check          # Public-release gate, 61 Node tests, offline demos
npm run demo:brief     # Deterministic Norwegian household brief
npm run demo:after     # Fictional after-purchase snapshot
npm run demo:husbot    # Shopping question + duplicate event
npm run demo:failures  # Read outage + ambiguous send acknowledgement
~~~

**Example: Husbot shopping reply**

~~~text
🛒 Må kjøpes (2):
• Fictional flowers — HANDLELISTE
• Fictional coffee — KJØP

Same event delivered twice; only one simulated Slack reply.
~~~

The two items deliberately come from **different sources**: an incomplete manual checklist entry and an inventory item marked `KJØP`. The simulation does not call Slack or Trello; every external response is replaced with an in-memory fake.

The [demo guide](docs/DEMO.md) explains the other scenarios, including why a checked shopping-list item does *not* automatically prove a purchase or restock.

## Architecture

The code separates the **deterministic, offline Daily Brief** from the **event-driven Husbot integration**.

~~~mermaid
flowchart TB
    subgraph BRIEF["Daily Brief · offline fixture workflow"]
        Snapshot["Synthetic household snapshot"] --> Facts["Validate and derive facts"]
        Facts --> Daily["Deterministic Norwegian brief"]
        Daily -. "optional wording draft; human review" .-> AI["OpenRouter adapter<br/>(disabled in demos)"]
    end

    subgraph BOT["Husbot · read-only source architecture"]
        Slack["Slack Events API"] --> Ingress["Raw-body HMAC<br/>allowlist + timestamp"]
        Ingress --> Queue["Cloud Tasks<br/>stable event identity"]
        Queue --> Worker["Private Cloud Run worker"]
        Trello["Trello inventory<br/>+ evergreen shopping checklist"] -->|"GET only"| Worker
        Worker --> Claim["Firestore create-only<br/>reply claim"]
        Claim --> Send["Single approved<br/>Slack send attempt"]
    end
~~~

**What the diagram represents:** implemented source-code boundaries, tested using mocks, plus a narrowly observed private test-channel deployment. **The public repository does not deploy or connect to those services.** Its demos substitute fictional data and local transports for every external edge.

**Key design trade-off:** Slack retries and Cloud Tasks deliveries can occur more than once; the worker uses a create-only event claim to prevent repeated send attempts. If Slack's acknowledgement is ambiguous, a reply may be lost. That is an intentional **at-most-once attempt** policy, not an exactly-once delivery claim. See the [architecture decision notes](docs/ARCHITECTURE.md).

## Implementation status

| Component | Included and testable here | Evidence boundary |
| --- | --- | --- |
| **Daily Brief** | Deterministic facts, Norwegian text, before/after shopping fixtures | Tested with synthetic data; not a live whole-household brief |
| **Trello inventory + shopping** | GET-only adapter, `KJØP` status, manual checklist union, failure checks | Mock-tested broadly; a manual-only shopping reply was separately owner-observed in one approved private channel on 16 October 2026 |
| **Signed Slack ingress** | HMAC verification, scope filters, durable-enqueue contract | Mock-tested |
| **Cloud Tasks → Firestore → Slack worker** | Stable identity, create-only reply claim, read-only answers | Mock-tested end to end; a limited private test-channel worker and the manual-only shopping path were owner-observed, not general household operation |
| **OpenRouter draft adapter** | Bounded, opt-in wording assistance | Mock-tested only; disabled in demos, never authoritative |
| **Cleaning automation and Guardian** | Not included in the public extraction | Private test-card Guardian and one protected business cycle separately verified 21–22 October; Make v3 OFF, no normal household rollout |
| **Receipt OCR, Trello writes, physical sensors** | Not implemented in this edition | Research or planned work only |

**Dated private integration evidence (16 October 2026):** the owner observed an approved worker-image rollout and a real Husbot reply showing an incomplete, manually added shopping item with `HANDLELISTE` provenance. The source also combines inventory `KJØP` signals with manual checklist entries and groups matching names, but **mixed-source deduplication has fixture/mock coverage only**, not a separately witnessed mixed live run. The public demo remains entirely offline and is not connected to that private environment.

### Private engineering milestones — 17–22 October 2026

The private project advanced read-only shopping reconciliation,
immutable assignment/Action evidence, transactional outbox protections,
guarded Cleaning corrections and fail-closed business recovery. Selected
attended tests verified one restricted Guardian flow and one protected
Cleaning business cycle, not recurring household automation.

These private modules are **not exported** into this public edition.
Its existing source, fictional data and offline demonstrations are unchanged.
See the dated [changelog](CHANGELOG.md) for details.

For precise distinctions between source tests, owner-observed live evidence, and future plans, see [Implementation status](docs/IMPLEMENTATION_STATUS.md).

## Reliability is part of the design

A chatbot answer is only useful if it is correct—and repeated events do not create unintended side effects.

1. **Fail closed:** missing, malformed, or ambiguous source data cannot turn into a reassuring but false “all clear.”
2. **Read first, claim second:** if a Trello read fails, the worker can retry without consuming the event’s reply claim.
3. **Claim before sending:** a stored Firestore claim prevents the same event from triggering another Slack send attempt.
4. **Accept the trade-off:** if Slack’s send acknowledgement is ambiguous, the response may be lost. This is **at-most-once attempts**, *not exactly-once delivery*.
5. **Keep decisions deterministic:** an LLM may assist with phrasing, but never decides whether something was bought, paid, restocked, or completed.

You can inspect these boundaries with `npm run demo:failures` and the tests under `tests/`.

## Repository layout

~~~text
src/husbot/     Signed events, deterministic facts, brief and worker adapters
src/trello/     Read-only inventory and shopping-list projections
tests/         Synthetic unit and mocked integration regression tests
examples/      Fictional household lifecycle snapshots
demos/         In-memory Husbot and failure/replay demonstrations
scripts/       Brief preview and public-release safety gate
docs/          Architecture, evidence, AI safety, privacy and roadmap
.github/       Public GitHub-hosted validation (no private runners)
~~~

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Implementation status](docs/IMPLEMENTATION_STATUS.md) · [Demo guide](docs/DEMO.md) · [AI safety](docs/AI_SAFETY.md) · [Security & privacy](docs/SECURITY.md) · [Roadmap](docs/ROADMAP.md) · [Changelog](CHANGELOG.md)

## Development approach and scope

House OS combines human-directed workflow design and testing with AI-assisted programming. The focus is on practical integration engineering: explicit trust boundaries, verifiable business rules, replay behavior, and small, observable steps rather than unrestricted autonomy. The separate private development workflow also uses staged, exact-revision CI evidence and bounded deployment checks; its local runners, internal scripts and cloud operations are **not** exported in this repository.

The public release intentionally excludes **private Git history, real household records, API credentials, deployment identifiers, receipts, and self-hosted CI infrastructure**. The release scanner adds a safety check but does not replace manual review.

**Status:** actively developed, with a runnable synthetic portfolio edition. Future work may include a separately authorized write-capable House OS Engine, receipt processing, and hardware integrations. Those are **not shipped features** in this repository.

Released under the [MIT License](LICENSE).
