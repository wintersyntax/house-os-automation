# Architecture and trust boundaries

## Two distinct read-only capabilities

**Fixture-driven Daily Brief.** A fictional normalized snapshot is passed to pure functions in `src/husbot/facts.js`. These validate timestamps, chores, absences, urgent issues and inventory status, and render deterministic Norwegian output. The local CLI does not load provider credentials or perform network calls. `openrouter-draft.js` is a separately gated, opt-in *draft-only* component; its output is not allowed to change facts or become an automatic Slack post.

**Interactive Husbot slice.** The signed Slack Events ingress validates raw bytes, bounded payloads, app/team/channel and durable handoff. A named Cloud Tasks task delivers to a private worker (Cloud Run IAM is a deployment obligation). The worker classifies a small deterministic command set; inventory and optional shopping-list facts come from strict GET-only Trello projections. Before sending a reply, it writes a create-only Firestore event claim and refuses to send on duplicates.

```text
Slack request -- HMAC, timestamp, allowlist --> ingress
                                            |
                                            v
                          durable Cloud Tasks event ID
                                            |
                                            v
                  private worker: validated GET-only Trello
                                            |
                                            v
                     Firestore create-only reply claim
                          /                 \
                     new claim          duplicate claim
                       |                     |
                one Slack POST             no POST
```

## Design decisions and failure handling

| Decision | Mechanism in the public source | Why this boundary exists |
| --- | --- | --- |
| Reject untrusted webhook requests | Original Slack request bytes verified with HMAC-SHA256 and timing-safe comparison; five-minute timestamp window; 32 KiB ingress bound; approved app, team and channel | A request with the right-looking JSON is not evidence of a signed, in-scope event |
| Acknowledge only durable work | Ingress requires the queue adapter to confirm durable storage or an existing named task before returning HTTP 200 | An instance crash after premature acknowledgement would silently lose work |
| Handle retry/replay | A deterministic Cloud Tasks task name derived from the event identity, plus an atomic Firestore create-only claim at reply time | Queue deduplication alone does not guarantee a unique external effect after retries |
| Choose the failure side deliberately | Read and validate current facts before claiming. Claim before sending. Ambiguous Slack acknowledgements can lose a reply | Correctness and duplicate suppression take precedence over pretending there is exactly-once delivery |
| Preserve domain meaning | Trello inventory and incomplete manual shopping entries form two read sources; matching names are presentation grouping only | A checked item or text match does not prove a purchase, a restock, or a safe write authorization |
| Separate AI from authority | Deterministic state transitions and facts are not inferred from an LLM response; optional wording draft needs review and is off in demos | A plausible generated answer must not become a false operational fact |

In the public edition, provider transports are replaced with mocks for tests and demos. The diagram and source show implementation structure, **not** a claim that the public repository operates an independent live service.

## Guarantees and non-guarantees

- The worker intentionally guarantees **at most one external Slack attempt per retained event claim**, not delivery exactly once. A crash or ambiguous provider response can lose the reply.
- Cloud Tasks uses at-least-once delivery; the event-derived task name is stable across retry requests.
- `expiresAt` is included in source. The owner observed the 30-day Firestore TTL policy active in one private environment; actual asynchronous deletion was not observed. Replay protection ends once a claim is deleted.
- Source validation is not the same as proof that Cloud Run IAM, Slack scopes, Trello authorizations, Firestore retention and billing were correctly applied in every environment.
- The inventory source of truth is current Trello status. A shopping answer may include incomplete manual checklist entries even without a matching inventory card; matching names are display grouping only and never authorize writes. A checked or empty checklist alone does **not** confirm payment, restocking or transfer of money.
- Hardware sensors, receipt interpretation, an autonomous planner and Trello writes are not implemented by the included modules.

## Separation of roles

- Ingress: Slack signing secret + Cloud Tasks enqueue permission; no Trello or bot token.
- Worker: read-scoped Trello access, Firestore claim create and single-channel Slack send; no ingress signing secret.
- Local demos: no secrets and no provider requests.

## Dated evidence, not broad deployment claims

On 16 October 2026 the owner independently observed a restricted private worker rollout and a genuine read-only Husbot response containing a manually added shopping-list entry. This verifies that narrow path. Mixed inventory/checklist grouping, unavailable-source handling and repeated-delivery behavior are tested with mocks; no separate mixed-source live demonstration, write-capable Engine, receipt processing, operational Daily Brief or physical sensor integration is claimed.

Production container image creation, IAM, cloud resources and private secrets are intentionally excluded from this public project. This repo does not deploy services automatically.
