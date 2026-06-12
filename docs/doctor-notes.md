# Doctor's notes — the id vocabulary

Every doctor's note carries a **stable id**. Locally you see the full rendered text
(`vibecheck doctor`); the team export carries **id + level only** — never the text,
which can contain file basenames or project names. These ids are the aggregation
key: a team dashboard can count "how many devs have a `context-tax` warning"
without seeing anyone's details.

Every note is deterministic and threshold-gated — same logs, same notes, and a note
that doesn't clear its bar simply doesn't fire. The doctor stays silent entirely
below **50 turns or $1** of usage.

| id | levels | fires when | meaning |
|---|---|---|---|
| `cache-health` | `good` / `warn` | ≥1M cacheable input tokens; `good` at ≥80% cache hit rate, `warn` below 50% | Cache reads cost ~10% of fresh input. Low hit rate means frequent restarts or >5min idle gaps are breaking the prompt cache. |
| `cache-thrash` | `warn` | cache-write premium > $1 **and** exceeds what cache reads saved | Writes cost a 1.25× premium. If reads never recoup it, caching is a net loss — short sessions write cache nobody reads. |
| `executing-share` | `info` | >40% of spend is command-running turns | Verbose build/test output is token-hungry — pipe through tail/grep, silence noisy commands. |
| `reasoning-share` | `info` | >35% of spend is no-tool turns | Fine if intentional — but long Q&A may belong in a cheaper chat surface. |
| `subagent-share` | `info` | subagents >25% of spend | Each spawn re-derives context — batch related work into fewer agents. |
| `whale-session` | `info` | ≥5 sessions and one is >30% of all spend | One session dominates. Locally the note names its project; the export never does. |
| `night-owl` | `info` | >15% of turns between midnight and 5am | The doctor recommends sleep. |
| `context-tax` | `warn` / `info` | ≥1 session past 100 turns and >$5 of excess cache reads vs that session's own early baseline; `warn` when the tax exceeds 20% of total cost | A session re-pays its whole history as cache reads every turn — context is rent, not a purchase. `/compact` or restart between tasks. |
| `idle-gaps` | `info` | ≥10 in-session pauses >5min costing >$2 of post-gap cache rebuilds | The prompt cache expires after ~5min; every return re-writes it at the 1.25× premium. |
| `failure-tax` | `info` | ≥100 tool-using turns, ≥20 with errors, error rate >8% | Each failing call usually buys a retry turn — and the error output rides in context for the rest of the session. |
| `result-diet` | `good` / `warn` | ≥100 tool turns with measured results; `warn` above ~8KB/turn average, `good` under 3KB | Tool results are re-read as cache every later turn, so fat results compound. |
| `verbosity-drift` | `info` | two consecutive months with ≥200 turns each and avg output/turn up >30% | Output tokens are the 5×-priced line item — ask for tighter diffs and less narration. |
| `compaction-receipts` | `info` | ≥3 compactions and ≥80% auto-forced at the context ceiling | Each forced compaction sheds tokens you'd been re-paying every turn; a manual `/compact` between tasks captures that earlier. |
| `re-read-tax` | `warn` / `info` | ≥50 repeat reads of the same file within a session and ≥200KB re-entering context; `warn` at ≥1MB or a single file read ≥25× | Repeats re-enter context in full and are then re-paid as cache reads. Locally the note names the hottest file (basename only); the export never does. |

Notes sort warns first. Source of truth: [`src/insights.ts`](../src/insights.ts) —
a test asserts this table and the code agree on the id list.
