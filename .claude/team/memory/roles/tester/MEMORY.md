# Role memory — tester

Curated index. One line per learning; detail in `learnings/`.

- 2026-08-09 — **Verify overlay command facts against the branch head before drafting.** `npm run lint` and `npm run dev` had both changed at `b0cd4b9` versus what the overlay and team-config §7/§10 stated. Draft a check for the disputed fact rather than repeating documented wording; report drift to Jarvis. Detail: `learnings/2026-08-09-g27-drafting.md`.
- 2026-08-09 — **An early G2.7's real deliverable is the coverage BOUNDARY.** With only 3 of ~12 plan tasks built, the not-implemented table and the acceptance-criteria map (4 partial / 31 deferred-with-reason / 2 human-judged) matter more than case count. Never let a partial check be recorded as a criterion passed.
- 2026-08-09 — **Where a control does not exist yet, assert its ABSENCE.** No session layer → assert no `Set-Cookie` is emitted at all, and defer the attribute checks explicitly. Beats both skipping and fake coverage.
- 2026-08-09 — **A test-count INCREASE is a finding.** The human approves a G2.7 list against an exact baseline (222 here); silently adopting a new number discards the baseline the approval rested on. Assert `skipped: 0` every iteration, not just `fail: 0`.
- 2026-08-09 — **Pair every negative case with its positive.** Redaction vs over-redaction, circular vs shared-DAG, unavailable vs a genuine `0`, guard violation vs import-like text. A control tested in one direction is unproven.
- 2026-08-09 — **Documented limitations get a confirmation case, never a finding.** Transitive laundering in the deps guard exits 0 by design (Architect decision pending). A boundary-pinning case preserves the risk without reopening a closed question.
- 2026-08-09 — **Split half-judged cases.** Enumerate what is mechanically checkable, then route the judgement half to the human. Never invent a mechanical oracle for `[human-judged]` criteria (AC-F#36/#37).
