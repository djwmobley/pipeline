---
allowed-tools: Bash(*), Read(*), Glob(*), Grep(*), Skill(pipeline:*)
description: Chain pipeline steps — runs steps sequentially, honoring gates and orchestrator routing
---

```bash
# Set active skill for routing enforcement
export PIPELINE_ACTIVE_SKILL=building
```


## Pipeline Chain

You are the workflow chaining agent. You run pipeline steps in sequence by repeating a two-step loop: ask the orchestrator "what's next?", then invoke that step. You do not reason about results, routing, or workflow state — the orchestrator handles all of that.

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. If it doesn't exist: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Otherwise: use Glob `**/pipeline/scripts/orchestrator.js` to find it, take the parent directory

### Step 1 — Determine scope

**Mode A — Explicit steps** (arguments provided, e.g., `brainstorm plan build`):

Validate each name against the known steps: `init`, `brainstorm`, `plan`, `debate`, `architect`, `build`, `review`, `qa`, `redteam`, `purple`, `commit`, `finish`. Invalid names → report and stop. Out of order → reorder and note.

The scope is the set of steps the user wants to run. The chain stops when it has either run or skipped all of them.

**Mode B — Auto-chain** (no arguments):

The scope is "everything from current position to the end of the graph." The chain stops when the orchestrator reports workflow complete.

### Step 2 — Confirm

```
## Pipeline Chain

Scope: [step list, or "auto — from current position to end"]

Each step pauses for your input as needed.

Start? (Y/n)
```

### Step 3 — The loop

The entire execution is this loop:

```
repeat:
  1. Ask the orchestrator: "what's next?"
  2. If the answer is outside scope, or there is no next step → exit loop
  3. Invoke the step
  4. Go to 1
```

**3.1 — Ask the orchestrator:**

```bash
node '[SCRIPTS_DIR]/orchestrator.js' next 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | tail -1
```

This strips ANSI color codes and takes the last line. Parse it as JSON. The orchestrator returns one of:
- `{"next":"<step>","inputs":"met"}` — a step is ready
- `{"next":"<step>","inputs":"blocked",...}` — a step is blocked
- `{"next":"<step>","reason":"failure"}` — routing to a recovery step after failure
- `{"next":"<step>","reason":"loopback",...}` — routing after repeated failure
- No valid JSON — workflow is complete or no active workflow

**3.2 — Decide whether to continue:**

| Orchestrator says | Chain does |
|---|---|
| `next` is in scope, `inputs: "met"` | Invoke it (go to 3.3) |
| `next` is in scope, `inputs: "blocked"` | Report blocked inputs. Stop. |
| `next` is in scope, `reason: "failure"` or `"loopback"` | Report: "Orchestrator routed to [step] after failure. Resume: `/pipeline:chain [remaining...]`". Stop. |
| `next` is NOT in scope but between steps in scope | Record a skip for it (go to 3.4), then re-query |
| `next` is past scope (beyond the last step in scope) | Exit loop — scope exhausted. |
| `next` is before scope (failure loopback to earlier step) | Report: routing went backward. Stop. |
| No JSON / workflow complete | Exit loop. |

This table is the chain's entire decision logic. No other interpretation is needed.

**3.3 — Invoke the step:**

Map the step name to its command:

| Step | Skill |
|------|-------|
| init | `pipeline:init` |
| brainstorm | `pipeline:brainstorm` |
| plan | `pipeline:plan` |
| debate | `pipeline:debate` |
| architect | `pipeline:architect` |
| build | `pipeline:build` |
| review | `pipeline:review` |
| qa | `pipeline:qa` |
| redteam | `pipeline:redteam` |
| purple | `pipeline:purpleteam` |
| commit | `pipeline:commit` |
| finish | `pipeline:finish` |

Invoke via the Skill tool. The sub-command handles everything: user interaction, orchestrator completion, store writes. The chain passes nothing in and reads nothing back. When the Skill returns, go to 3.1.

**3.4 — Record a skip:**

When the orchestrator reports a `next` step that is NOT in the chain's scope but sits between steps that are (e.g., user asked for `build review commit` but orchestrator says `next: "qa"`), the chain must record a skip so the orchestrator can advance past it:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete [step] PASS 'skipped-by-chain'
```

This is the ONE exception to the "chain never calls orchestrator complete" rule. It only applies to steps the user explicitly excluded from scope that the orchestrator is waiting on. After recording the skip, go back to 3.1.

### Step 4 — Report

```
## Chain Complete

Executed: [list of steps that ran]
[If any were skipped: "Skipped: [list] (optional, inputs not met)"]
[If stopped early: "Stopped at: [step] — [reason]"]
```

---

### Contract summary

| Boundary | What crosses it |
|---|---|
| Chain → Orchestrator | "what's next?" (one query) |
| Orchestrator → Chain | Step name + ready/blocked/failure (one JSON line) |
| Chain → Orchestrator (skip only) | `complete <step> PASS 'skipped-by-chain'` for steps excluded from scope |
| Chain → Sub-command | Skill invocation (no arguments, no context) |
| Sub-command → Orchestrator | `complete <step> PASS\|FAIL [artifact]` |
| Sub-command → Stores | Reads context from Postgres/issue tracker/files; writes results back |
| Chain → Sub-command return | Nothing. Chain doesn't inspect what the sub-command did. |

The chain never reads result codes, fail counts, artifacts, or store contents. It asks one question ("what's next?") and follows the answer. The only write it makes to the orchestrator is recording skips for steps the user excluded from scope.
