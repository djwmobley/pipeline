---
allowed-tools: Bash(*), Read(*), Glob(*), Grep(*)
description: Changelog generation + version bump + git tag + optional deploy trigger
---

## Pipeline Release

You ship verified code to users. This command runs AFTER `/pipeline:commit` when you're ready to cut a release.

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `project.name`, `project.repo`, `project.branch`
- `commands.test` — run tests one final time before release
- `commit.push_after_commit` — whether to push tags

If no config file exists, report: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." and stop.

---

### Step 1 — Determine version bump

Find the current version:
```bash
git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0"
```

Also check `package.json` version field if it exists.

Analyze commits since last tag. First check if any tags exist:
```bash
git describe --tags --abbrev=0 2>/dev/null
```

If no tags exist, show all commits on the current branch:
```bash
git log --oneline
```

If a previous tag exists, show commits since that tag:
```bash
git log <previous_tag>..HEAD --oneline
```

Recommend a version bump based on conventional commits:
- `feat` commits with breaking changes → **major**
- `feat` commits → **minor**
- `fix`, `perf`, `refactor` only → **patch**

Present the recommendation:
> "Current version: [version]
> Commits since last release: [count]
> - [N] feat, [M] fix, [P] other
>
> Recommended bump: **[patch/minor/major]** → [new version]
> Confirm or specify a different version?"

---

### Step 1b — Security assessment check

Check for existing red team reports:

```bash
ls docs/security/redteam-*.md 2>/dev/null
```

**If no red team report exists AND this is a minor or major release:**

> "No security assessment found for this project.
> Consider running `/pipeline:redteam` before release — it probes for
> injection, auth bypass, XSS, and other vulnerabilities from an attacker's perspective.
>
> Skip for now? (y/N)"

If user chooses N (default), stop and suggest: "Run `/pipeline:redteam`, address findings, then `/pipeline:release` again."

**If a red team report exists:**

Read the most recent report. Extract the date and finding counts from the Assessment Metadata section.

> "Last security assessment: [date] — [N] critical, [M] high findings
> [If critical + high > 0: 'Ensure these have been addressed before release.']
> [If critical + high == 0: 'No critical or high findings — good to proceed.']"

This is a recommendation, not a gate — the user can skip regardless.

---

### Step 2 — Verify before release

Run the full test suite one final time:
```bash
[commands.test from config]
```

If tests fail: **STOP. Do not release.** Report failures.

Check for uncommitted changes:
```bash
git status --porcelain
```

If dirty: **STOP.** "Uncommitted changes detected. Run `/pipeline:commit` first."

---

### Step 3 — Generate changelog

Generate a changelog entry from commits since last tag. First check if any tags exist:

```bash
git describe --tags --abbrev=0 2>/dev/null
```

If no tags exist, use all commits on the current branch:
```bash
git log --pretty=format:"- %s (%h)" --no-merges
```

If a previous tag exists, use commits since that tag:
```bash
git log <previous_tag>..HEAD --pretty=format:"- %s (%h)" --no-merges
```

Group by type:
```
## [version] — [YYYY-MM-DD]

### Features
- [feat commits]

### Fixes
- [fix commits]

### Other
- [remaining commits]
```

If `CHANGELOG.md` exists, prepend the new entry. If not, create it.

---

### Step 4 — Bump version

If `package.json` exists, update the `version` field.
If `Cargo.toml` exists, update `version` under `[package]`.
If `pyproject.toml` exists, update `version`.

Stage the changelog and version file changes. Commit:
```
chore(release): v[version]
```

---

### Step 5 — Tag and push

```bash
git tag -a v[version] -m "Release v[version]"
```

If `commit.push_after_commit` is true, push to the branch configured in `project.branch`:
```bash
git push origin [project.branch from config] --follow-tags
```

---

### Step 6 — Report

> "Released **v[version]**
> - [N] commits included
> - Changelog updated
> - Tagged and pushed
>
> [If GitHub integration enabled: 'Create a GitHub release? (y/N)']"

If yes and GitHub CLI available, extract only the new version's section from CHANGELOG.md (from `## [version]` to the next `## ` heading or end of file) and pass it as release notes:
```bash
# Extract just this release's changelog section (not the entire file)
gh release create v[version] --title "v[version]" --notes "$(cat <<'NOTES'
[extracted changelog section for this version only]
NOTES
)"
```
