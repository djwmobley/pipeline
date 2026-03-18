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
Implementation complete. What would you like to do?

1. Merge back to [base-branch] locally
2. Push and create a Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work

Which option?
```

---

### Step 4 — Execute choice

**Option 1: Merge locally**
```bash
git checkout [base-branch]
git pull
git merge [feature-branch]
# Run tests on merged result
git branch -d [feature-branch]
```
Then cleanup worktree (Step 5).

**Option 2: Push and create PR**

Only offer the Push+PR option if `integrations.github.enabled` is true in pipeline.yml. If false, offer: "Push branch and create PR manually in browser."

Read `git log [base-branch]..HEAD --oneline` to populate the summary bullets and derive the PR title.

```bash
git push -u origin [feature-branch]
gh pr create --title "[title]" --body "$(cat <<'EOF'
## Summary
[2-3 bullets]

## Test Plan
- [ ] [verification steps]
EOF
)"
```
Then cleanup worktree (Step 5).

**Option 3: Keep as-is**
Report: "Keeping branch [name]. Worktree preserved at [path]."
Don't cleanup.

**Option 4: Discard**
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

For Options 1, 2, 4: if in a worktree (git-dir path contains 'worktrees'), clean up after merge/discard.

Run as a single Bash call — variables are lost between calls:
```bash
# Check if we're in a worktree (not the main working tree)
git rev-parse --git-dir | grep -q "worktrees" && echo "IN_WORKTREE"

# If IN_WORKTREE: switch to main working tree, then remove worktree
WORKTREE_PATH=$(pwd)
cd "$(git rev-parse --path-format=absolute --git-common-dir)/.."
git worktree remove "$WORKTREE_PATH" --force
```
For Option 3: keep worktree.

---

### Safety rules

- Never proceed with failing tests
- Never merge without verifying tests on result
- Never delete work without typed confirmation
- Never force-push without explicit request
