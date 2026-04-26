---
allowed-tools: Bash(git*), Bash(cd*), Read(*), Grep(*)
description: Assess change size and recommend the appropriate workflow
---

```bash
# Set active skill for routing enforcement
export PIPELINE_ACTIVE_SKILL=debugging
```


## Pipeline Triage

Assess the size of the current change and recommend the correct workflow.

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `routing.source_dirs`, `routing.tiny_max_files`, `routing.tiny_max_lines`, `routing.medium_max_files`

If no config file exists, use defaults: source_dirs=["src/"], tiny_max_files=1, tiny_max_lines=30, medium_max_files=3.

**source_dirs sanity check:** If `routing.source_dirs` contains `["."]`, warn: "source_dirs is set to [\".\"] which counts ALL files (config, docs, lockfiles) as source. Run `/pipeline:update` to set a specific source directory. Proceeding with extension-based filtering (.ts, .tsx, .js, .jsx, .rs, .go, .py)." Then filter by those extensions instead of directory paths.

---

### Step 1 — Count changes

**Zero-commit detection:** First check if any commits exist:

```bash
git rev-parse HEAD 2>/dev/null
```

If this fails (exit code non-zero), the repo has no commits yet. In that case, skip all `git diff HEAD` commands and instead count untracked files as the entire change set:

```bash
git ls-files --others --exclude-standard <each_source_dir>
```

Use the count of those files as "files changed" and estimate lines by summing `wc -l` on each. Skip to Step 2.

**source_dirs shell safety:** Before constructing the regex, validate each `routing.source_dirs` entry matches `[a-zA-Z0-9/_.-]+` only. If any entry contains shell metacharacters, reject it and stop.

**Normal case (commits exist):** Construct a grep regex from `routing.source_dirs` (e.g., if `["src/", "lib/"]` then regex is `^(src/|lib/)`). Run:

git diff --name-only HEAD | grep -E "<constructed_regex>" || true

Count lines changed:

git diff --stat HEAD | tail -1

Count untracked source files:

git ls-files --others --exclude-standard <each_source_dir>

Replace `<constructed_regex>` and `<each_source_dir>` with the actual values from `routing.source_dirs` in pipeline.yml.

If the user described a task but hasn't started yet, estimate from the description instead of git diff.

---

### Step 2 — Classify

| Size | Criteria | Workflow |
|------|----------|----------|
| **TINY** | ≤ `tiny_max_files` files AND ≤ `tiny_max_lines` lines | read → implement → `/pipeline:commit` |
| **MEDIUM** | ≤ `medium_max_files` files, known pattern | grep patterns → implement → `/pipeline:review` → fix → `/pipeline:commit` |
| **LARGE** | New feature, multi-file, new flow | `/pipeline:brainstorm` → `/pipeline:architect` → `/pipeline:plan` → `/pipeline:build` → `/pipeline:qa verify` → `/pipeline:review` → `/pipeline:finish` |
| **MILESTONE** | End of feature, full codebase review | `/pipeline:brainstorm` → `/pipeline:architect` → `/pipeline:plan` (includes QA plan) → `/pipeline:build` → `/pipeline:qa verify` → `/pipeline:review` → `/pipeline:audit` → `/pipeline:finish` |

---

### Step 3 — Report

```
## Triage

**Change size:** [TINY/MEDIUM/LARGE/MILESTONE] **[HIGH/MEDIUM/LOW confidence]**
**Source files:** N changed, M new
**Lines:** +N / -M
**Reason:** [why this classification]

**Recommended workflow:**
[step-by-step workflow for this size]
```

If confidence in the size classification is LOW (e.g., the change touches an area with hidden dependencies, or the scope is hard to estimate), recommend the LARGER workflow as a safety measure.

The user can override the classification. If they say "treat this as MEDIUM", follow that workflow instead.
