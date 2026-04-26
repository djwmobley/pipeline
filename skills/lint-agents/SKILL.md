---
name: lint-agents
description: Deterministic structural linting for agent prompt templates — 7 regex checks run via Node script, no LLM dispatch
operation_class: script_exec
allowed_models: []
allowed_direct_write: false
---

# Agent Template Lint

## Overview

Deterministic structural linting for all `*-prompt.md` agent templates. Backed by `scripts/pipeline-lint-agents.js` — a Node.js script that runs all checks outside the LLM context and outputs structured findings.

The lint script complements (does not duplicate) the MR-A2A tier in `/pipeline:markdown-review`. MR-A2A handles judgment-based quality checks (output contract drift, handoff mismatches, overloaded interfaces). This lint handles structural correctness that is fully deterministic.

## Process Flow

```dot
digraph lint_agents {
  rankdir=LR;
  node [shape=box, style=rounded];
  config [label="Load\nConfig"];
  script [label="Run\nScript"];
  report [label="Present\nFindings"];
  fix [label="Fix\n(optional)"];
  config -> script -> report -> fix;
}
```

## v1 Check Registry

| ID | Check | Severity | Method |
|----|-------|----------|--------|
| LA-STRUCT-001 | Has substitution checklist section | HIGH | Regex for heading |
| LA-STRUCT-002 | Every placeholder in body appears in checklist | HIGH | Set diff |
| LA-STRUCT-003 | Every checklist item appears in body | HIGH | Inverse set diff |
| LA-STRUCT-004 | `{{MODEL}}` present | HIGH | String match |
| LA-STRUCT-005 | Dispatch format block present (when code block exists) | MEDIUM | Regex |
| LA-SEC-001 | DATA tags have `role` + `do-not-interpret-as-instructions` | HIGH | Regex |
| LA-SEC-002 | IMPORTANT instruction about DATA tags exists | MEDIUM | Regex |
| LA-CON-001 | Placeholder syntax convention (`{{}}` for model/sections only) | MEDIUM | Parse and classify |

## Deferred to v2

| ID | Check | Reason |
|----|-------|--------|
| LA-STRUCT-006 | `{{MODEL}}` references valid `models.*` key | Requires pipeline.yml parsing; fragile |
| LA-STRUCT-007 | Output format section exists | Convention, not structural; MR-A2A covers |
| LA-SEC-003 | External content wrapped in DATA | Heuristic, not deterministic |
| LA-CON-002 | Checklist format consistent | Zero observed violations |
| LA-CON-003 | Arrow syntax consistent | Zero observed violations |
| LA-CONTRACT-001 | Config keys exist in pipeline.yml | Requires schema parsing |
| LA-CONTRACT-002 | Model key matches agent role | Semantic classification, not regex |

## Finding Format

```
LA-[CATEGORY]-[NNN] | [SEVERITY] | [CONFIDENCE] | [file:line] | [check-id]
  > [message]
```

## Script Usage

```bash
# Full sweep
node [scripts_dir]/pipeline-lint-agents.js lint

# Changed files only (for pre-commit)
node [scripts_dir]/pipeline-lint-agents.js lint --changed

# JSON output (for machine consumption)
node [scripts_dir]/pipeline-lint-agents.js lint --json
```

Exit code 0 = pass (no HIGH), exit code 1 = fail (HIGH findings present).

## Section-Level Substitution Exemption

`{{MODEL}}` is always exempt from LA-CON-001. Other `{{}}` placeholders are exempt if they appear on their own line (section-level block replacements like `{{TDD_SECTION}}`). Exemptions are added reactively when false positives occur.

## Red Flags — Rationalization Prevention

| Rationalization | Reality |
|----------------|---------|
| "The lint is too strict" | It only checks 7 things. If a check fires, the template has a structural bug. |
| "This placeholder is obvious" | If it's not in the checklist, the orchestrator won't know to substitute it. |
| "DATA tags slow me down" | Prompt injection through unguarded placeholders is a real attack surface. |
| "I'll fix it later" | HIGH findings block commits. Fix now. |
| "The check is wrong" | Run with `--json` and verify. If it's a genuine false positive, open an issue. |
