# House OS

[![Portfolio CI](https://github.com/wintersyntax/house-os-automation/actions/workflows/portfolio-ci.yml/badge.svg)](https://github.com/wintersyntax/house-os-automation/actions/workflows/portfolio-ci.yml)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)
[![MIT License](https://img.shields.io/badge/License-MIT-2ea44f)](LICENSE)
![Portfolio Project](https://img.shields.io/badge/Portfolio-Project-6f42c1)
![Status: Active development](https://img.shields.io/badge/Status-Active%20development-f59e0b)

**One connected system for running a household.**

House OS brings cleaning routines, grocery shopping, inventory and everyday responsibilities into one shared workflow. Instead of scattered reminders and disconnected automations, household members should be able to see **what needs doing, who is responsible, what needs buying and what has actually been completed**.

The product connects **Trello** as a shared workspace, a deterministic **Node.js Engine** for event-driven rules, and **Husbot in Slack** for quick household answers. Expenses, maintenance and optional sensors are future parts of the same system.

## From a household task to a connected workflow

A cleaning card has an assignee and due date. When the correct person completes it, House OS should apply points, prepare the next routine and keep the history consistent. A guest should not be able to complete the task by checking the same box. **Private attended tests have already verified Guardian corrections and one complete Cleaning business cycle with seven effects and a protected successor.** Repeatable household-wide operation is not yet enabled.

Shopping is another shared process: a product may need replenishment, or someone might manually add an item to the evergreen shopping list. Husbot can report **both sources** without confusing a checked box with a confirmed purchase. The public demo reproduces this read-only behavior with fictional data. Safe inventory-to-list synchronization, confirmed purchases, restocking and expense/PANT accounting come later.

This is the product goal: **one household operating system, not a collection of unrelated scripts**.

## Product areas

| Area | Household benefit | Current maturity |
| --- | --- | --- |
| **Cleaning & rotation** | Clear assignments, fair points, protected completion and next tasks | One attended private business pilot; second-cycle source accepted but not yet executed live |
| **Inventory & shopping** | Permanent stock records and one evergreen shared checklist | Public read-only source and demo; limited private live reply |
| **Husbot** | Grounded household answers in Slack | Public source and selected private-channel tests |
| **Expenses & PANT** | Confirmed purchases and shared expense tracking | Planned; fictional lifecycle only |
| **Maintenance** | Recurring home upkeep and repairs | Roadmap |
| **Waste Monitor** | Optional compact sensors for bin levels | Research; no installed hardware |

**What does this public repository include?** Executable read-only Husbot/Trello modules, fictional household records, regression tests and offline simulations. The newer Cleaning Guardian, business and Shopping Engine source remains private; dated limited test evidence is summarized here without publishing the operational data.

[Explore the full product roadmap](docs/ROADMAP.md).

## Engineering behind the experience

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

| Capability | What is available | What has been verified |
| --- | --- | --- |
| **Deterministic Daily Brief** | Real source and fictional fixtures in this public repo | Offline regression tests; not a scheduled household brief |
| **Inventory and shopping read model** | Trello GET-only adapters, manual checklist union and failure handling in this public repo | Mocked validation plus one separately observed private manual-list Slack reply (16 October) |
| **Signed Slack → Tasks → worker** | Signed ingress, scope checks, durable handoff and Firestore create-only reply claims in public source | Offline replay/failure tests and a limited private test-channel deployment |
| **Shopping Engine foundations** | Private source only: transaction records, authenticated rechecks, conservative state reconciliation | Synthetic/official local-emulator evidence; **no general live shopping writer** |
| **Cleaning Guardian** | Private source only: signed completion evidence, original-assignee safeguards, durable repairs and comments | **Attended live TEST-card verification** on 21–22 October, including guest/self-add correction and accepted owner completion |
| **Bot membership protection** | Private source only: authenticated, removal-only card guard | **Three attended live scenarios** including ordinary, repeated and archived cards |
| **Cleaning business integration** | Private source only: gated absolute points effects, protected successor and recoverable receipts | **One attended live test cycle** with seven corroborated effects and one protected successor (22 October) |
| **Optional AI wording** | Disabled-by-default draft adapter in public source | Synthetic tests only; never authoritative |
| **Receipt processing and physical sensors** | Planning/research only | No working device integration or automatic accounting deployment |

**Important distinction:** the public repository includes the earlier read-only
Husbot and Trello source, tests and synthetic demos. The newer Cleaning Guardian,
transactional Cleaning pilot and Shopping Engine modules remain in the **private**
project; their observed results are documented here, but their private source,
live data and infrastructure are not published.

## Verification highlights

The private project has tested real Guardian corrections, three bot-membership removal cases and **one** protected Cleaning business cycle. A private source milestone passed **1,343 Node and 87 Python tests**, while a later focused Guardian suite passed **177/177**; these are separate exact-source checkpoints. The private Main has also passed three acceptance checks. New second-cycle source has since been accepted, but its live execution is **not** claimed.

The publicly available read-only code has its own independently passing CI and runnable fictional demos. Passing tests and attended pilots are not equivalent to enabling normal household operation.

[Full evidence status](docs/IMPLEMENTATION_STATUS.md) · [Dated changelog](CHANGELOG.md)

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
docs/          Product roadmap, architecture, demos and evidence
.github/       Public GitHub-hosted validation (no private runners)
~~~

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Implementation status](docs/IMPLEMENTATION_STATUS.md) · [Demo guide](docs/DEMO.md) · [AI safety](docs/AI_SAFETY.md) · [Roadmap](docs/ROADMAP.md) · [Changelog](CHANGELOG.md)

## Development approach and scope

House OS combines human-directed workflow design and testing with AI-assisted programming. The focus is on practical integration engineering: explicit trust boundaries, verifiable business rules, replay behavior, and small, observable steps rather than unrestricted autonomy. The separate private development workflow also uses staged, exact-revision CI evidence and bounded deployment checks; its local runners, internal scripts and cloud operations are **not** exported in this repository.

The public release intentionally excludes **private Git history, real household records, API credentials, deployment identifiers, receipts, and self-hosted CI infrastructure**. The release scanner adds a safety check but does not replace manual review.

**Status:** actively developed, with a runnable synthetic portfolio edition. Future work may include a separately authorized write-capable House OS Engine, receipt processing, and hardware integrations. Those are **not shipped features** in this repository.

Released under the [MIT License](LICENSE).
