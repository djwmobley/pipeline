---
name: orientation
description: Mandatory preflight for every phase command — assert cwd, branch, HEAD, worktree identity, and dirty flag before any other step. Prevents silent operation on the wrong branch.
operation_class: script_exec
allowed_models: []
allowed_direct_write: false
---

# Orientation Preflight

Phase commands (`/pipeline:build`, `/pipeline:review`, `/pipeline:qa`,
`/pipeline:redteam`, `/pipeline:audit`, `/pipeline:remediate`, `/pipeline:commit`,
`/pipeline:finish`) share a single failure mode: the Bash tool's shell persists
`cwd` between calls, so a `cd` earlier in the session silently changes every
subsequent `git` / `node scripts/*` invocation.

Every phase command's first instruction is to execute this preflight. No exceptions.

<!-- checkpoint:MUST orientation -->

## Step 1 — Run the preflight probe

```bash
node scripts/preflight-probe.js
```

The probe emits a single JSON object on stdout with the six mechanical context
values. Example output:

```json
{
  "cwd": "/c/Users/user/dev/pipeline",
  "repo_root": "/c/Users/user/dev/pipeline",
  "branch": "main",
  "head": "abc1234",
  "worktree": "MAIN",
  "dirty_count": 0
}
```

The probe spawns git subprocesses via an argv-array API (no shell interpretation)
and passes `cwd` explicitly to each invocation. On any probe failure it exits
non-zero with a one-line stderr message naming which step failed — if that
happens, stop and surface the error instead of guessing context.

The worktree detector uses the only authoritative git signal: `--git-dir` and
`--git-common-dir` return the same path in the main working tree and different
paths in a linked worktree. Substring-matching a path for `worktrees` gives false
positives when the repo itself lives under a directory named `worktrees/`.

## Step 2 — State context in prose

Print the six values explicitly:

- Working directory: `[pwd]`
- Repo root: `[toplevel]`
- Branch: `[branch]`
- HEAD: `[sha]`
- Worktree: `[MAIN | WORKTREE]`
- Dirty files: `[count]`

Do not skip. The goal is to force a read of the actual state, not trust memory
of earlier Bash output.

## Step 3 — Compare against intent

Compare the stated context against the command's ARGUMENTS:

- If the arguments name a branch and `git branch --show-current` returns a
  different branch — **stop and ask** how to proceed.
- If the arguments imply a feature branch (build, remediate) and the current
  branch matches the base branch (`project.branch` from pipeline.yml, default
  `main`) — **stop and ask** the user to create a feature branch first. The
  caller should enforce this with (POSIX-portable — avoids `\s`, which BSD sed
  on macOS does not handle reliably):
  ```bash
  BASE=$(grep -E '^[[:space:]]*branch:' .claude/pipeline.yml | head -1 | sed 's/.*branch:[[:space:]]*"\?\([^"]*\)"\?.*/\1/')
  [ "$(git branch --show-current)" = "${BASE:-main}" ] && echo 'STOP: on base branch'
  ```
  Do not append `&& exit 1` — that would terminate the persistent Bash tool
  shell. The echo is the signal; the agent halts on the STOP message.
- If the worktree is dirty and the command modifies source code unexpectedly —
  ask before proceeding.

If all three checks pass, continue to the command's next step.

## Rationalization prevention

| Rationalization | Reality |
|---|---|
| "I ran `pwd` earlier, I know where I am" | The Bash shell persists `cwd` between calls — one `cd` since then moved you. Re-check. |
| "The last command succeeded on what looked like the right branch" | Commands succeed silently on the wrong branch. Verify from `git branch --show-current`, not from past output. |
| "The ARGUMENTS name the branch, that's enough" | Arguments name intent, not location. Only `pwd` and `git branch` reveal where you actually are. |
| "Edit/Write with a relative path is fine, it's not Bash" | Edit/Write resolve against `cwd` too. If `cwd` drifted, the wrong file gets written. Use absolute paths. |
| "Adding orientation everywhere is ceremony" | Ceremony is the point. The cost of six lines of echoed state is nothing compared to committing to the wrong branch. |

## Caller contract

Every phase command MUST begin with this exact block (copy verbatim — do not paraphrase):

```markdown
### Preflight — Orientation check

<!-- checkpoint:MUST orientation -->

Before any other step — including reading any skill file — locate the
orientation skill (read `$PIPELINE_DIR/skills/orientation/SKILL.md` if
`$PIPELINE_DIR` is set, otherwise Glob `**/pipeline/skills/orientation/SKILL.md`)
and execute its preflight. State the six context values (cwd, repo root, branch,
HEAD, worktree, dirty count) in prose and confirm they match this command's
intent. Do not continue until done.
```

Commands that modify source code (`build`, `remediate`) additionally include a
caller-specific guard block (see `commands/build.md` or `commands/remediate.md`
for the current form). The guard uses POSIX-portable regex (`[[:space:]]`, not
`\s`) and **never** appends `&& exit 1` — the STOP echo is the signal, `exit`
would kill the persistent Bash tool shell.

This block replaces the ~20-line preflight previously inlined in each phase
command. If this template changes, re-sync every caller in a single commit.
