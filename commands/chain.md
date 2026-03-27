---
allowed-tools: Bash(*), Read(*), Glob(*), Grep(*), Skill(pipeline:*)
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
node '[SCRIPTS_DIR]/orchestrator.js' next 2>&1 | tail -1
```

The last line of output is JSON when a step is available (e.g., `{"next":"brainstorm","inputs":"met"}`), or plain text when no workflow exists. If the output does not contain valid JSON with a `next` field, report "No active workflow or workflow complete" and stop. Otherwise, chain from the reported `next` step through the end of the graph.

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
node '[SCRIPTS_DIR]/orchestrator.js' next 2>&1 | tail -1
```

Parse the last line as JSON. Possible shapes:
- `{"next":"<step>","inputs":"met"}` — inputs satisfied, ready to run
- `{"next":"<step>","inputs":"blocked","missing":[...]}` — blocked, report missing inputs and stop
- `{"next":"<step>","reason":"failure"}` — a prior step failed and the orchestrator is routing to a recovery step
- `{"next":"<step>","reason":"loopback","fails":N}` — loopback triggered after repeated failures
- No JSON on last line — workflow complete or no active workflow, stop

**Routing logic:**

1. If `next` matches the expected step and `inputs` is `"met"` → proceed to 4b.
2. If `next` is a step further along the graph than expected → the orchestrator skipped optional steps. Report "Skipped [step] (optional, inputs not met)." Advance the chain to match and proceed.
3. If `next` is a step earlier in the graph (failure loopback) or `reason` is `"failure"` or `"loopback"` → stop the chain. Report: "Orchestrator routed to [step] (reason: [reason]). Run `/pipeline:[step]` to address the issue, then resume with `/pipeline:chain [remaining steps...]`."
4. If `inputs` is `"blocked"` → stop, report what's missing.

**4b. Invoke the step** using the Skill tool:

Use the mapping from Step 2 to invoke the correct command. Example: for step `purple`, invoke Skill `pipeline:purpleteam`.

Each sub-command handles its own:
- User interaction (findings review, approval gates)
- Orchestrator completion call (`orchestrator.js complete <step> PASS|FAIL`)
- Three-store A2A writes

The chain does NOT call `orchestrator.js complete` — each sub-command already does this.

**4c. Check the result:**

After the sub-command returns, query the orchestrator for the next step:
```bash
node '[SCRIPTS_DIR]/orchestrator.js' next 2>&1 | tail -1
```

Parse the JSON. The result tells you what happened:

- If `next` is the chain's next expected step (or further along) with `inputs: "met"` → the step passed. Continue.
- If `next` points backward with `reason: "failure"` → the step failed and the orchestrator is routing to a recovery step. Stop the chain:
  ```
  ## Chain Stopped

  Step [step_name] failed.
  Orchestrator routes to: /pipeline:[recovery_step]

  Resume after fixing: /pipeline:chain [remaining steps...]
  ```
- If `next` points backward with `reason: "loopback"` → repeated failure triggered loopback. Stop and report.
- If `next` is the same step that just ran → the step failed but the orchestrator has no failure routing (optional step with no onFail). The orchestrator advanced past it. Check if `next` is actually pointing to the step AFTER the one that failed — if so, the optional step failed but the workflow continues. Proceed with the chain.
- If no JSON → workflow complete. Report and end chain.

**Key insight:** Do NOT check the result code directly. Instead, let the orchestrator's routing tell you what happened. The orchestrator already handles the PASS/FAIL/optional logic — the chain just follows its routing decisions.

### Step 5 — Chain completion

After all steps complete:

```
## Chain Complete

Steps executed:
- [step_name]: done
- [step_name]: done
- [step_name]: skipped (optional)
...

[If more steps remain in the graph:]
Continue: /pipeline:chain (auto-continues from current position)

[If workflow is complete:]
Workflow complete.
```

---

### Rules

- Never skip human interaction gates — each sub-command handles its own gates
- Never call `orchestrator.js complete` — sub-commands already do this
- Never fight the orchestrator — if it routes somewhere unexpected, report and stop
- Always use `orchestrator.js next` (not `status`) to determine routing — `next` outputs machine-readable JSON on the last line
- Always pipe orchestrator output through `2>&1 | tail -1` to get the JSON line and strip ANSI color codes
- Follow the orchestrator's routing, not the result code — optional steps can FAIL and the workflow still advances
