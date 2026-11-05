# Implementation status

Reviewed for the 5 November 2026 public source snapshot; private operational
evidence is summarized in sanitized form, not exported.

| Domain | Included in public source | Evidence and exclusions |
| --- | --- | --- |
| Cleaning | Pure six-zone planning, fairness, absence and room-handover rules | Private test-board cycles; executing Guardian absent |
| Away status | Pure Borte til status/date/comment rules, handover comment formatting, foreign-change explanation and synthetic tests | Private tested writer is excluded; public functions make no provider writes |
| Shopping | Pure linked need/checklist decisions and GET-only display | Private attended keeper checks; writer excluded |
| Expenses and PANT | Exact-øre arithmetic, vouchers, validation and settlement proposal | Private attended test-board evidence; no payment, receipt OCR or writer |
| Husbot | Signed event ingress, deterministic GET-only replies and claim/retry rules | Synthetic integration tests; private limited read observation |
| Daily Brief | Deterministic facts and Norwegian output | Synthetic before/after previews; no scheduled real-household brief |
| Overview/monitoring | Documentation of private boundary | Private Power-Up and monitoring not exported |
| Maintenance/sensors | Roadmap only | Not implemented here |

The private environment uses test identities and fictional points. Do not
conflate source verification, private attended tests, actual provider rollout
and ordinary household use.

The handover planner books no completion points for the departing holder.
Only the private execution layer verifies the event actor and performs profile
restoration or room writes; public comment helpers do not enforce authorization.
