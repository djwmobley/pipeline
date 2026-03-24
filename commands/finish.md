---
allowed-tools: Bash(git*), Bash(cd*), Bash(npx*), Bash(npm*), Bash(cargo*), Bash(go*), Bash(gh*)
description: Branch completion workflow — verify tests, present options, execute choice, clean up
---

## Pipeline Finish

Guide completion of development work by presenting clear options and handling the chosen workflow.

### Step 1 — Load config and verify tests

Read `.claude/pipeline.yml` for `commands.test`, `project.branch`, and `integrations.github.enabled`.

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

**Option 1: Commit + merge + push (full workflow)**
```bash
git checkout [base-branch]
git pull
git merge [feature-branch]
# Run tests on merged result
git push
git branch -d [feature-branch]
```
Then cleanup worktree (Step 5).

**Option 2: Commit + merge locally (no push)**
```bash
git checkout [base-branch]
git pull
git merge [feature-branch]
# Run tests on merged result
git branch -d [feature-branch]
```
Then cleanup worktree (Step 5).

**Option 3: Push and create PR**

Only offer the Push+PR option if `integrations.github.enabled` is true in pipeline.yml. If false, offer: "Push branch and create PR manually in browser."

Read `git log [base-branch]..HEAD --oneline` to populate the summary bullets and derive the PR title.

```bash
git push -u origin [feature-branch]
gh pr create --title "$(cat <<'TITLE'
[title]
TITLE
)" --body "$(cat <<'EOF'
## Summary
[2-3 bullets]

## Test Plan
- [ ] [verification steps]
EOF
)"
```
Then cleanup worktree (Step 5).

**Option 4: Keep as-is**
Report: "Keeping branch [name]. Worktree preserved at [path]."
Don't cleanup.

**Option 5: Discard**
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

### Safety rules

- Never proceed with failing tests
- Never merge without verifying tests on result
- Never delete work without typed confirmation
- Never force-push without explicit request
