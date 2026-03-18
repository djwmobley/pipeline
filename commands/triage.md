---
allowed-tools: Bash(git*), Bash(cd*), Read(*), Grep(*)
description: Assess change size and recommend the appropriate workflow
---

## Pipeline Triage

Assess the size of the current change and recommend the correct workflow.

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `routing.source_dirs`, `routing.tiny_max_files`, `routing.tiny_max_lines`, `routing.medium_max_files`

If no config file exists, use defaults: source_dirs=["src/"], tiny_max_files=1, tiny_max_lines=30, medium_max_files=3.

---

### Step 1 — Count changes

```bash
# Files changed in source dirs
git diff --name-only HEAD | grep -E "^(SOURCE_DIR_PATTERN)"

# Lines changed
git diff --stat HEAD | tail -1

# Untracked source files
git ls-files --others --exclude-standard SOURCE_DIRS
```

If the user described a task but hasn't started yet, estimate from the description instead of git diff.

---

### Step 2 — Classify

| Size | Criteria | Workflow |
|------|----------|----------|
| **TINY** | ≤ `tiny_max_files` files AND ≤ `tiny_max_lines` lines | read → implement → `/pipeline:commit` |
| **MEDIUM** | ≤ `medium_max_files` files, known pattern | grep patterns → implement → `/pipeline:review` → fix → `/pipeline:commit` |
| **LARGE** | New feature, multi-file, new flow | `/pipeline:brainstorm` → `/pipeline:plan` → `/pipeline:build` → `/pipeline:review` → `/pipeline:simplify` (if flagged) → `/pipeline:commit` |
| **MILESTONE** | End of feature, full codebase review | `/pipeline:audit` → fix 🔴 → fix 🟡 → `/pipeline:commit reviewed:✓` |

---

### Step 3 — Report

```
## Triage

**Change size:** [TINY/MEDIUM/LARGE/MILESTONE]
**Source files:** N changed, M new
**Lines:** +N / -M
**Reason:** [why this classification]

**Recommended workflow:**
[step-by-step workflow for this size]
```

The user can override the classification. If they say "treat this as MEDIUM", follow that workflow instead.
