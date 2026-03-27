---
allowed-tools: Bash(*), Read(*), Glob(*), Grep(*)
description: Chain pipeline steps — runs steps sequentially, honoring gates and orchestrator routing
---

## Pipeline Chain

You are the workflow chaining agent. Your job is to run multiple pipeline steps sequentially, delegating to each step's command via the Skill tool, and using the orchestrator for routing between steps.

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. If it doesn't exist: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Otherwise: use Glob `**/pipeline/scripts/orchestrator.js` to find it, take the parent directory

### Step 1 — Determine step list

**Mode A — Explicit steps** (arguments provided, e.g., `brainstorm plan build`):

Validate each name against the known orchestrator steps. Valid step names:
`init`, `brainstorm`, `plan`, `debate`, `architect`, `build`, `review`, `qa`, `redteam`, `purple`, `commit`, `finish`

If any name is invalid, report it and stop. If steps are out of graph order, reorder them and note the change.

**Mode B — Auto-chain** (no arguments):

Query the orchestrator:
```bash
node '[SCRIPTS_DIR]/orchestrator.js' next
```

If "No active workflow" or "Workflow complete": report and stop. Otherwise, chain from the reported next step through the end of the graph.

### Step 2 — Step-to-command mapping

Not all orchestrator step names match their command names. Use this mapping:

| Step | Skill invocation |
|------|-----------------|
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

`deploy` is not a pipeline command — report "Deploy is project-specific. Use your deployment tool directly." and end the chain.

### Step 3 — Present the chain plan

Before executing, present what will happen:

```
## Pipeline Chain

Steps to execute:
1. [step_name]
2. [step_name]
...

Note: Each step has its own user interaction (review findings, QA verdict, etc.).
The chain pauses at each step for your input, then continues.

Start the chain? (Y/n)
```

If the user declines, stop.

### Step 4 — Execute loop

For each step in the list:

**4a. Query the orchestrator:**
```bash
node '[SCRIPTS_DIR]/orchestrator.js' next
```

Three outcomes:
- Next step matches expected → proceed
- Next step differs (e.g., failure loopback sent to `build`) → stop the chain, report: "Orchestrator routed to [step] instead of [expected]. Run `/pipeline:[step]` to address the issue, then resume with `/pipeline:chain [remaining steps...]`."
- Inputs not met → stop, report what's missing

**4b. Invoke the step** using the Skill tool:

Use the mapping from Step 2 to invoke the correct command. Example: for step `purple`, invoke Skill `pipeline:purpleteam`.

Each sub-command handles its own:
- User interaction (findings review, approval gates)
- Orchestrator completion call (`orchestrator.js complete <step> PASS|FAIL`)
- Three-store A2A writes

The chain does NOT call `orchestrator.js complete` — each sub-command already does this.

**4c. Check the result:**
```bash
node '[SCRIPTS_DIR]/orchestrator.js' status
```

Parse the output for the step that just ran:
- `PASS` → continue to next step
- `FAIL` → stop the chain, report:
  ```
  ## Chain Stopped

  Step [step_name] failed.
  Orchestrator recommends: /pipeline:[next_from_orchestrator]

  Resume after fixing: /pipeline:chain [remaining steps...]
  ```
- `PARTIAL` or `BLOCKED` → treat as failure, stop and report

**4d. Handle optional step skips:**

If the orchestrator's `next` reports a step beyond the current target (skipping optional steps whose inputs aren't met), update the step list and continue. Report: "Skipped [step] (optional, inputs not met)."

### Step 5 — Chain completion

After all steps complete:

```
## Chain Complete

Steps executed:
- [step_name]: PASS
- [step_name]: PASS
- [step_name]: PASS

[If more steps remain in the graph:]
Continue: /pipeline:chain (auto-continues from current position)

[If workflow is complete:]
Workflow complete. All 13 steps done.
```

---

### Rules

- Never skip human interaction gates — each sub-command handles its own gates
- Never call `orchestrator.js complete` — sub-commands already do this
- Never fight the orchestrator — if it routes somewhere unexpected, report and stop
- If a step fails, stop immediately — do not continue to the next step
- Always query `orchestrator.js next` before each step to confirm routing
