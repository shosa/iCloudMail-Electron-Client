# iCloud Mail Desktop — Upgrade Plans

Four sequential sub-plans. Each must be completed and verified before starting the next.

| Plan | Phases | File | Stop Conditions |
|------|--------|------|-----------------|
| 1. Foundation | 1-2 | `2026-05-27-phase1-2-foundation.md` | None |
| 2. Accounts + Threading | 3-4 | `2026-05-27-phase3-4-accounts-threading.md` | IPC contract change — human sign-off required before Task 2 |
| 3. Composer + Attachments | 5, 7 | `2026-05-27-phase5-7-composer-attachments.md` | None |
| 4. Features + Polish | 6, 8, 9, 10 | `2026-05-27-phase6-8-10-features-polish.md` | None |

## Dependency order

```
Plan 1 → Plan 2 → Plan 3 → Plan 4
  ↑
  FTS5 table created here (used by Plan 4 search)
  sync_state created here (used by Plan 2 threading)
  accounts table created here (used by Plan 2 multi-account)
```

## Packages that may need to be added

| Package | Phase | Justification | Status |
|---------|-------|---------------|--------|
| None required | — | All needed packages already in package.json | ✅ |

## Architectural decisions requiring human sign-off

1. **Multi-account IPC contract** (before Plan 2 Task 2): Should `imap:connect` gain an optional `email` param, or should multi-account use a completely new `accounts:connect` channel? The plan implements Option A (optional email param + getClient() fallback).
