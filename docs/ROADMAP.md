# House OS — Product roadmap

**One shared system for everyday household life.**

Trello is the current user-facing workspace. The House OS Engine connects events and deterministic rules, and Husbot makes useful facts available through Slack. Cleaning, groceries, expenses, maintenance and optional sensors belong to the same larger product.

This roadmap separates **working public source**, **verified private pilots** and **future product work**. It is not a fixed release calendar.

## At a glance

| Product track | Current evidence | Next milestone |
| --- | --- | --- |
| Cleaning & rotation | Real Guardian corrections and one attended business cycle | Repeatable controlled cycles under normal household conditions |
| Inventory & shopping | Public read-only demo; narrow real private Husbot reply | Controlled inventory-to-checklist synchronization |
| Husbot | Bounded private-channel read-only answers | Richer, grounded household context |
| Purchases & expenses | Fictional lifecycle and design | Confirmed trips, restocking and PANT accounting |
| Maintenance | Product concept | Repairs and recurring-upkeep model |
| Waste Monitor | Small optical-sensor research | Calibrated fill-level prototype |

## 1. Cleaning: fair responsibility without manual bookkeeping

**Household experience.** Every task has a room, assignee and due date. The assigned member completes it in Trello. House OS confirms that person's action, applies points, creates the next routine and retains the history. A guest must not complete somebody else's task by clicking its checkbox.

**Built and observed privately.** Signed Guardian events, original-assignee evidence, corrective behavior, durable operation claims and one guarded business cycle have been tested on real test cards. Guest/self-add corrections and three bot-removal cases were separately observed. Source for admitting a **second controlled cycle** was accepted on 23 October 2026; actual second-cycle live effects have not been observed.

**Next:**
- Exercise multiple successive cycles across rooms and members.
- Validate Normal, Borte/absence, fairness and date-boundary behavior.
- Prove partial-failure and restart recovery without replaying uncertain writes.
- Provide clear activation, pause, operator review and recovery controls.
- Trial ordinary household use before enabling recurring schedules.

**Completion standard:** repeated real cycles preserve assignments, balances and history under normal, duplicate and failure conditions. One attended pilot is not equivalent to ongoing household operation.

## 2. Inventory and the evergreen shopping list

**Household experience.** Permanent inventory cards track stock. When a product needs buying, it appears next to manually added requests on a single persistent shopping checklist. Husbot can describe both sources.

**Built.** Public GET-only Trello adapters and a fictional dual-source Husbot simulation. A narrow private live shopping-list response was observed. Private Shopping Engine source includes transaction identities, signed recheck hints and local emulator coverage, but no general live writer.

**Next:**
- Link one inventory need to one active checklist item with a durable identity.
- Preserve manually added entries and avoid false same-name matches.
- Handle duplicates, stale callbacks, concurrent changes and partial purchases.
- Ensure the existing Butler producer is not duplicated by a new writer.
- Expose unknown states for ambiguous transitions.

**Completion standard:** every corroborated need produces at most one correct linked checklist entry, while manual requests survive retries and failures.

## 3. Purchases, restocking, expenses and PANT

**Household experience.** Each confirmed shopping trip becomes a separate record. Its buyer confirms what was bought and brought home. Eligible stock is replenished and a separate expense is recorded, with any PANT return.

**Planned work:**
- Retain the same evergreen shopping card and checklist between trips.
- Model trip, buyer, product and quantity identities explicitly.
- Distinguish checked, bought, partially bought and fully restocked.
- Match receipt lines conservatively, with human review for uncertainty.
- Validate NOK totals and PANT before recording expenses.
- Prevent duplicate or stale provider events from double-booking money.

**Current limit:** the public purchase example is fictional. Automatic OCR, shared expenses, restocking writes and reimbursements have not been deployed.

## 4. Husbot: practical household answers

**Household experience.** A short Norwegian question such as "Hva trenger vi å kjøpe?" should produce an accurate summary from recorded facts rather than an invented answer.

**Built.** Signed Slack ingress, deterministic responses, fake queue/worker integration and selected privately observed read-only shopping answers.

**Next:**
- Read-only information about upcoming cleaning, assignments and absences.
- Maintenance summaries and helpful Trello context.
- Explicit stale, missing or unavailable source states.
- Optional briefings or constrained natural-language interaction after testing.

**Completion standard:** answers stay grounded, and language generation never decides points, purchases, assignments or money.

## 5. Maintenance and recurring operations

**Direction.** Bring repairs, filter replacement, equipment checks and other easily missed duties into the same household workspace. A report becomes an actionable card with an owner, priority, due date and resolution history. Husbot can eventually show outstanding issues.

**Current limit:** product planning; no complete maintenance subsystem is included.

## 6. Waste Monitor and optional sensors

**Direction.** Small optical or time-of-flight sensors might indicate bin fill levels without installing cameras.

**Research milestones:**
- Compare compact proximity/multizone sensor cost, size and field of view.
- Calibrate an empty bin against its walls, floor and surroundings.
- Explore one suitably placed sensor monitoring two adjacent bins.
- Reject transient lid, hand or bag interference.
- Report obstruction or stale measurements as **unknown**, not empty.
- Measure false positives before any automated Trello follow-up.

**Current limit:** research only, no connected physical device.

## 7. A usable household product

A successful pilot is not the same as normal operation. The product still needs understandable Norwegian UX, member onboarding, observable automation state, predictable pause and recovery, appropriate notifications, and evidence that it reduces missed tasks and duplicate coordination.

## Delivery path

| Stage | User-visible result | Required evidence |
| --- | --- | --- |
| **Public showcase — available** | Read-only Husbot/Trello code and synthetic demos | Reproducible public CI |
| **Private pilot — narrowly verified** | Guardian corrections and one business cycle | Attended real-provider evidence |
| **Next: repeatable Cleaning** | Normal multi-member and multi-cycle workflows | Real fault/restart/end-to-end acceptance |
| **Next: shopping write pilot** | Durable stock-to-list linking | No duplicates, scoped readback and one-writer cutover |
| **Later: purchasing** | Confirmed trip, restock, expenses and PANT | Attribution, arithmetic and partial/replay validation |
| **Later: wider House OS** | Maintenance, richer Husbot and sensors | Household usability and measured reliability |

Make v3 Cleaning was reported OFF by 17 October; this does not imply that the replacement is active. The limited Butler shopping rule remains separate.

[Overview](../README.md) · [Implementation evidence](IMPLEMENTATION_STATUS.md) · [Changelog](../CHANGELOG.md)
