# AI and business-rule safety

The project treats model output as untrusted presentation assistance. Facts about purchases, inventory, money, assignments, points, absences or completed chores must originate from validated source records and deterministic rules. The model may suggest bounded language for a **fictional brief** only when the adapter is explicitly enabled and approved.

The synthetic classification check uses process-local issuance: copying a `dataClassification` property does not authorize egress. It is a defensive software gate, **not** a cryptographic proof that arbitrary user-supplied text is fictional. Provider calls are off in all public demos.

Failures must not silently become success. Missing or ambiguous source fields, invalid calendar values, provider timeouts, malformed responses and unapproved channels are rejected. A prepared AI draft is not allowed to overwrite the deterministic brief and is not posted by the synthetic Slack transport.

The interactive Husbot currently recognizes only bounded deterministic commands and does not invoke an LLM. Full conversational tool use and policy-enforced mutations are future projects, not existing capabilities.
