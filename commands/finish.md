---
allowed-tools: Bash(git*), Bash(cd*), Bash(npx*), Bash(npm*), Bash(cargo*), Bash(go*), Bash(node*), Bash(cat*)
description: Branch completion workflow — verify tests, present options, execute choice, clean up
---

```bash
# Set active skill for routing enforcement
node scripts/lib/active-skill.js write orientation
```


## Pipeline Finish

Guide completion of development work by presenting clear options and handling the chosen workflow.

### Preflight — Orientation check

<!-- checkpoint:MUST orientation -->

Before any other step — including reading any skill file — locate the
orientation skill (read `$PIPELINE_DIR/skills/orientation/SKILL.md` if
`$PIPELINE_DIR` is set, otherwise Glob `**/pipeline/skills/orientation/SKILL.md`)
and execute its preflight. State the six context values (cwd, repo root, branch,
HEAD, worktree, dirty count) in prose and confirm they match this command's
intent. Do not continue until done.

---

### Step 1 — Load config and verify tests

Read `.claude/pipeline.yml` for `commands.test`, `project.branch`, `integrations.github.enabled`, `integrations.github.issue_tracking`, `project.repo`, `docs.plans_dir`, and `dashboard.enabled`.

<!-- checkpoint:MUST finish-tests-pass -->

Run the test suite. If tests fail:
```
Tests failing (N failures). Must fix before completing:

[Show failures]

Cannot proceed with merge/PR until tests pass.
```

You MUST NOT present merge/PR options until tests pass. If tests fail, the ONLY option is: fix the failures.

| Rationalization | Reality |
|---|---|
| "The failing test is unrelated" | ALL tests MUST pass. No exceptions. |
| "It was already failing before my change" | Then fix it or revert your change. No merge with red tests. |
| "I'll fix it in a follow-up" | There is no follow-up. Fix it now. |

Stop. Don't proceed to Step 2.

If tests pass: continue.

---

### Step 2 — Determine base branch

Read `project.branch` from pipeline.yml (e.g., `main`). This is the base branch.

Capture the current branch name and the base branch name for use in Step 4:
- Feature branch: `git branch --show-current`
- Base branch: `project.branch` from pipeline.yml (fallback: `main`)

If the current branch IS the base branch (e.g., `main`), report: "You are on the base branch. /pipeline:finish is for feature branches. Use /pipeline:commit or /pipeline:release instead." Stop.

---

### Step 3 — Present options

<!-- checkpoint:SHOULD finish-completion -->

```
Implementation complete. Tests passing. What would you like to do?

1. Commit + merge to [base-branch] + push  (the full workflow)
2. Commit + merge to [base-branch] locally  (no push)
3. Push and create a Pull Request
4. Keep the branch as-is  (I'll handle it later)
5. Discard this work

Which option? (default: 1)
```

**Default to the most complete option.** If the user says "finish it", "do it all", "merge it", or similar — execute option 1 without further prompting. Only ask for clarification when the intent is genuinely ambiguous.

---

### Step 4 — Execute choice

**Option 1: Merge PR + push (full workflow)**

<!-- checkpoint:MUST finish-merge-verify -->

If a PR exists for the feature branch, merge via `platform.js pr merge` to preserve the audit trail:

```bash
# Check if PR exists
node '[SCRIPTS_DIR]/platform.js' pr view [feature-branch] 2>/dev/null
```

If the command fails, notify the user with the error and ask for guidance.

If a PR exists:
```bash
node '[SCRIPTS_DIR]/platform.js' pr merge [PR_NUMBER] --squash --delete-branch
git checkout [base-branch]
# `--prune` drops the stale remote-tracking ref left behind by `--delete-branch`.
# Without it, `refs/remotes/origin/[feature-branch]` persists as an orphan
# pointing at a commit no longer on the remote. Default git does not prune.
git pull --prune
# Clean up the local ref. `--delete-branch` above removes only the remote;
# the local ref persists. `git branch -d` refuses after a squash merge
# because the squashed commit on base has no ancestral link to the
# feature-branch commits — git sees them as "not fully merged". `-D` is
# safe here: `platform.js pr merge` only exits 0 when GitHub confirms
# the merge, and `git pull` above brought the squash commit into base.
git branch -D [feature-branch]
```

If the command fails, notify the user with the error and ask for guidance.

| Rationalization | Reality |
|---|---|
| "`--delete-branch` deleted the branch, so we're done" | It deleted the remote ref only. `gh` has no knowledge of the local checkout — the local ref persists, and so does the remote-tracking ref unless `--prune` is passed to fetch/pull. |
| "I'll use `git branch -d` to be safe" | `-d` refuses after a squash merge (no ancestral link to the new squashed commit). You'll be left with the stale ref. `-D` is required and correct here. |
| "Force-deleting is dangerous" | Not in this flow. The PR is verified MERGED via the gh API and the squash commit is in local base. No commits are at risk. |
| "`git pull` will clean up remote-tracking refs" | It won't — default git does not prune. Set `fetch.prune = true` globally OR pass `--prune` explicitly. We pass it explicitly to avoid relying on user git config. |

If NO PR exists, fall back to local merge:
```bash
git checkout [base-branch]
git pull
git merge [feature-branch]
# Run tests on merged result — MUST pass before push
git push
git branch -d [feature-branch]
```

If tests fail on the merged result, do NOT push. Report the failure and stop.

| Rationalization | Reality |
|---|---|
| "Tests passed on the branch, so they'll pass after merge" | Merge can introduce conflicts or interact with changes landed on the base branch. Verify. |
| "I'll fix it after pushing" | A broken main branch blocks everyone. Fix before push. |
| "The merge was clean, no conflicts" | Clean merges can still break tests — semantic conflicts exist. |

Then cleanup worktree (Step 5).

**Option 2: Merge locally (no push)**

<!-- checkpoint:MUST finish-merge-verify (same checkpoint as Option 1) -->

```bash
git checkout [base-branch]
git pull
git merge [feature-branch]
# Run tests on merged result — MUST pass before proceeding
git branch -d [feature-branch]
```
Then cleanup worktree (Step 5).

**Option 3: Push and create PR**

Only offer the Push+PR option if `integrations.github.enabled` is true in pipeline.yml. If false, offer: "Push branch and create PR manually in browser."

Read `git log [base-branch]..HEAD --oneline` to populate the summary bullets and derive the PR title.

Before creating the PR, check the most recent plan file in `docs.plans_dir` for `github_epic: N`. If found, include `Part of #[EPIC_N]` at the end of the PR body.

```bash
git push -u origin [feature-branch]
cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' pr create --title '[title]' --stdin
## Summary
[2-3 bullets]

## Test Plan
- [ ] [verification steps]

[If epic found: Part of #[EPIC_N]]
EOF
```

If the command fails, notify the user with the error and ask for guidance.
Then cleanup worktree (Step 5).

**Option 4: Keep as-is**
Report: "Keeping branch [name]. Worktree preserved at [path]. Finish checkpoint: branch kept, no merge."
Don't cleanup.

**Option 5: Discard**

<!-- checkpoint:MUST finish-discard-confirm -->

Confirm first:
```
This will permanently delete:
- Branch [name]
- All commits: [list]
- Worktree at [path]

Type 'discard' to confirm.
```
Wait for exact confirmation. If confirmed:
```bash
git checkout [base-branch]
git branch -D [feature-branch]
# If branch was pushed to remote, delete it there too
git push origin --delete [feature-branch] 2>/dev/null || true
```
Then cleanup worktree (Step 5).

---

### Step 4a — Compile epic summary from Postgres

**Runs for Options 1 and 2 (merge paths).** Skip if issue tracker is not enabled or no epic is found.

This is the single compiled summary posted to the epic — no other command posts to the epic.

**Validate epic number** before any issue tracker operations:
```bash
echo '[EPIC_N]' | grep -qE '^[0-9]+$' || { echo "Invalid epic number: [EPIC_N]"; }
```

**Scope filter:** Use the workflow start time from `build-state.json` (the `started_at` field)
to filter knowledge rows to the current workflow only. If no start time is available, fall back
to results from the last 7 days.

Query Postgres for phase results from this workflow:

```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js query "$(cat <<'SQL'
SELECT label, body FROM knowledge WHERE category IN ('review', 'qa', 'redteam', 'remediation') AND created_at >= '[WORKFLOW_START]' ORDER BY created_at
SQL
)"
```

Also query for deferred features from the brainstorm/spec:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js query "$(cat <<'SQL'
SELECT label, body FROM knowledge WHERE category = 'deferred' AND created_at >= '[WORKFLOW_START]' ORDER BY created_at
SQL
)"
```

Compile into a single comment and post to the epic:
```bash
cat <<'EOF' | node '[SCRIPTS_DIR]/platform.js' issue comment '[EPIC_N]' --stdin
## Ship Summary

### Review
[verdict, finding counts from review knowledge rows]

### QA
[verdict, pass/fail counts from qa knowledge rows]

### Security
[finding counts by domain from redteam knowledge rows]

### Remediation
[fixes applied, commits from remediation knowledge rows]

### Deferred Features
[list deferred items for future work, or "None"]

**Merged:** [SHA] → [base-branch]
EOF
```

If the command fails, notify the user with the error and ask for guidance.

This is the ONLY comment posted to the epic by any command. All phase-level
detail lives on task issues. The epic summary is a compiled bird's-eye view.

**Deployment Handoff Checklist** — When `build.artifact` is set in pipeline.yml (not null and not "source"), append a "Deployment Handoff" section to the ship summary:

```markdown
### Deployment Handoff

Source review complete. The following require out-of-band verification before deployment:

| Artifact | Verification |
|----------|-------------|
| [artifact type from config] | Build, test compiled output, verify in target environment |
| Container image (if docker-image) | Image scan, secret-free layers, runtime smoke test |
| Obfuscated output (if noted) | Verify obfuscation didn't break runtime behavior |

Pipeline reviewed source code and configuration. Build artifacts, container images, and deployment topology are outside Pipeline's scope.
```

If `build.artifact` is null or "source", skip this section entirely — source-only projects have no handoff gap.

---

### Step 4b — Ship transition

**Runs only for Options 1 and 2 (merge paths).** Skip entirely if `knowledge.tier` is not `"postgres"` or `integrations.postgres.enabled` is false.

**Find the associated roadmap task:**

1. Read the most recent plan file in `docs.plans_dir` for `github_epic: N` (same pattern as Step 4 Option 3).
2. Query Postgres for the roadmap task:
   ```bash
   PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js query "$(cat <<'SQL'
   SELECT * FROM tasks WHERE github_issue = [N] AND category = 'roadmap'
   SQL
   )"
   ```
3. If no match, fallback — extract keywords from the branch name (split on `-`, drop common prefixes like `feat`, `fix`, `chore`) and query:
   ```bash
   PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js query "$(cat <<'SQL'
   SELECT * FROM tasks WHERE category = 'roadmap' AND status != 'done' AND title ILIKE '%[branch-name-keyword]%'
   SQL
   )"
   ```
4. If still no match, skip the rest of this step silently. Not all branches are roadmap items.

**Update Postgres** — mark the task as done:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update task [id] done
```

**Close issue** — only if `platform.issue_tracker` is not `none` AND the task has an `issue_ref` value:
```bash
node '[SCRIPTS_DIR]/platform.js' issue close [N] --comment '## Shipped'
```

If the command fails, notify the user with the error and ask for guidance.

**Report:**
```
Shipped: [task title] (task #[id], issue #[N] closed)
```

If there was no issue to close, omit the issue portion:
```
Shipped: [task title] (task #[id])
```

**Auto-load memory** — read `finish.auto_load_memory` from `.claude/pipeline.yml` (default `false`).

If `true`:
```bash
node '[SCRIPTS_DIR]/pipeline-memory-loader.js' all --quiet
```
If the loader exits non-zero, print:
```
Memory loader exited with error — merge succeeded, embedding skipped.
```
and continue.

If `false` or absent, print:
```
Run node '[SCRIPTS_DIR]/pipeline-memory-loader.js' all to embed this session.
```

`$SCRIPTS_DIR` is already resolved in the "Persist to knowledge tier" section — use the same value here.

| Rationalization | Reality |
|---|---|
| "No task matched, so nothing to do" | If the branch clearly shipped a roadmap feature but no task matched, report the gap so it can be fixed manually. |
| "I'll mark it done later" | The merge just happened. Mark it now or it will be forgotten. |
| "The issue will be closed by the PR" | PRs close issues on merge only if the body contains `Closes #N`. Don't assume — close explicitly. |

---

### Step 4c — Routing Report

**Runs for Options 1 and 2 (merge paths).** Skip if `knowledge.tier` is not `"postgres"` and no `logs/routing-events.jsonl` exists.

Run the routing report and include it in the ship summary:

```bash
PROJECT_ROOT=$(pwd) node scripts/pipeline-routing-report.js
```

Include the full markdown output as a `## Routing Report` section in the ship summary comment posted to the epic issue (append to the Step 4a comment body before posting, or post as a follow-up comment if 4a already ran).

---
### Step 5 — Cleanup worktree

For Options 1, 2, 3, 5: if in a worktree (git-dir path contains 'worktrees'), clean up after merge/discard.

Run as a single Bash call — variables are lost between calls:
```bash
# Check if we're in a worktree (not the main working tree)
git rev-parse --git-dir | grep -q "worktrees" && echo "IN_WORKTREE"

# If IN_WORKTREE: switch to main working tree, then remove worktree
WORKTREE_PATH=$(pwd)
cd "$(git rev-parse --path-format=absolute --git-common-dir)/.."
git worktree remove "$WORKTREE_PATH" --force
```
For Option 4: keep worktree.

---

### Persist to knowledge tier

**Resolve `$SCRIPTS_DIR`:** Locate the pipeline plugin's `scripts/` directory:
1. If `$PIPELINE_DIR` is set: `$PIPELINE_DIR/scripts/`
2. Check `${HOME:-$USERPROFILE}/dev/pipeline/scripts/`
3. Search: find `pipeline-db.js` under `${HOME:-$USERPROFILE}/.claude/`

**If `knowledge.tier` is `"postgres"` AND `integrations.postgres.enabled`:**

Record the session (use `query "SELECT COALESCE(MAX(number),0)+1 FROM sessions"` to get next session number):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update session [next_number] [test_count] "$(cat <<'EOF'
Finish: merged [feature-branch] to [base-branch]. [option chosen]
EOF
)"
```

Record the decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-db.js update decision 'branch-completion' "$(cat <<'SUMMARY'
Merged [feature-branch] to [base-branch] [date]
SUMMARY
)" "$(cat <<'DETAIL'
[1-sentence summary of what the branch accomplished]
DETAIL
)"
```

**If `knowledge.tier` is `"files"`:**

Record session (auto-rotates to keep 5 most recent):
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js session [next_number] [test_count] "$(cat <<'EOF'
Finish: merged [feature-branch] to [base-branch]
EOF
)"
```

Record the decision:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js decision 'branch-completion' "$(cat <<'SUMMARY'
Merged [feature-branch] to [base-branch] [date]
SUMMARY
)" "$(cat <<'DETAIL'
[1-sentence summary of what the branch accomplished]
DETAIL
)"
```

Prune stale decisions:
```bash
PROJECT_ROOT=$(pwd) node [scripts_dir]/pipeline-files.js prune
```

---

### Dashboard Regeneration

If `dashboard.enabled` is true in pipeline.yml (or `docs/dashboard.html` already exists):

Locate and read the dashboard skill:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/skills/dashboard/SKILL.md`
2. Otherwise: use Glob `**/pipeline/skills/dashboard/SKILL.md` to find it

Follow the dashboard skill to regenerate `docs/dashboard.html` with current project state.

---

### Orchestrator

Record step completion after the merge is done and all three stores are updated:

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete finish PASS
```

If finish failed (tests failed, merge conflict, user abandoned):

```bash
node '[SCRIPTS_DIR]/orchestrator.js' complete finish FAIL
```

---

### Safety rules

- Never proceed with failing tests
- Never merge without verifying tests on result
- Never delete work without typed confirmation
- Never force-push without explicit request
