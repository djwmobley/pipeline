---
allowed-tools: Bash(*), Read(*), Write(*), Edit(*), Glob(*), Grep(*), Agent(*)
description: Full security loop — red team, remediate, purple team with user gates between phases
---

## Pipeline Security

Full security assessment loop. Orchestrates red team → remediate → purple team in sequence with explicit user review gates between each phase.

**This command is a thin orchestrator.** It reads and follows the logic in `commands/redteam.md`, `commands/remediate.md`, and `commands/purpleteam.md` — it does not duplicate their logic. All internal gates within each phase (specialist selection, triage plan approval, verification approval) are preserved exactly as defined in those commands.

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `project.name`, `project.repo`
- `redteam.*`, `remediate.*`, `purpleteam.*`
- `models.*`
- `commands.*`
- `routing.source_dirs`
- `knowledge.tier`
- `integrations.*`

If no config exists: "No `.claude/pipeline.yml` found. Run `/pipeline:init` first." Stop.

---

### Step 1 — Present the security loop

**source_dirs shell safety:** Validate each `routing.source_dirs` entry matches `[a-zA-Z0-9/_.-]+` only. If any entry contains shell metacharacters, reject it and stop.

Count source files across `routing.source_dirs`:

```bash
find [source_dirs joined with space] -type f 2>/dev/null | wc -l
```

Present:

```
## Security Assessment Loop

This runs the full security pipeline:

1. **Red Team** — Find vulnerabilities (attack simulation)
2. **Review Gate** — You review findings, mark false positives
3. **Remediate** — Fix confirmed findings (one commit per fix)
4. **Review Gate** — You review fixes before verification
5. **Purple Team** — Verify fixes actually work, assess posture

**Project:** [project.name]
**Estimated scope:** ~[N] source files in [source_dirs]

Start the security assessment? (Y/n)
```

If user declines, stop.

---

### Step 2 — Phase 1: Red Team

Locate and read the red team command:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/commands/redteam.md`
2. Otherwise: use Glob `**/pipeline/commands/redteam.md` to find it

Read the file in full. Follow every step in it from Step 0 through the final report, including all internal user approval gates (the sell step, specialist selection). Honor those gates — do not skip them.

After the red team report is generated and saved to `docs/findings/redteam-[date].md`:

Capture:
- `REDTEAM_REPORT_FILE` — path to the generated report
- `REDTEAM_TOTAL` — total finding count
- `REDTEAM_CRITICAL` — critical count
- `REDTEAM_HIGH` — high count
- `REDTEAM_MEDIUM` — medium count
- `REDTEAM_LOW` — low count
- `REDTEAM_INFO` — informational count

Present Gate 1:

```
## Phase 1 Complete: Red Team

**Report:** [REDTEAM_REPORT_FILE]
**Findings:** [REDTEAM_TOTAL] total ([REDTEAM_CRITICAL] critical, [REDTEAM_HIGH] high, [REDTEAM_MEDIUM] medium, [REDTEAM_LOW] low, [REDTEAM_INFO] info)

Review the findings in the report before proceeding to remediation.
You can:
- Open `[REDTEAM_REPORT_FILE]` to review
- Mark false positives (edit the report, prefix finding lines with `INTENTIONAL:`)

Continue to remediation? (Y/n)
```

If user declines, stop with:

```
Security assessment paused after red team. Resume with `/pipeline:remediate --source redteam` when ready.
```

---

### Step 3 — Phase 2: Remediate

Locate and read the remediate command:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/commands/remediate.md`
2. Otherwise: use Glob `**/pipeline/commands/remediate.md` to find it

Read the file in full. Follow every step in it using `--source redteam` logic (latest red team report). Honor the internal user approval gate (triage plan presentation) — do not skip it.

After remediation completes and the summary is saved to `docs/findings/remediation-[date].md`:

Capture:
- `REMEDIATION_SUMMARY_FILE` — path to the generated summary
- `REMEDIATION_FIXED` — number of findings fixed
- `REMEDIATION_REMAINING` — number of findings remaining
- `REMEDIATION_COMMITS` — number of new commits made
- `BASELINE_SHA` — the baseline SHA recorded at the start of remediation

Present Gate 2:

```
## Phase 2 Complete: Remediation

**Fixed:** [REMEDIATION_FIXED] findings
**Remaining:** [REMEDIATION_REMAINING] findings
**Commits:** [REMEDIATION_COMMITS] new commits

Review the fixes before verification.
You can:
- Run `/pipeline:review --since [BASELINE_SHA]` for a code review of the fixes
- Check `[REMEDIATION_SUMMARY_FILE]` for the summary

Continue to purple team verification? (Y/n)
```

If user declines, stop with:

```
Security assessment paused after remediation. Resume with `/pipeline:purpleteam` when ready.
```

---

### Step 4 — Phase 3: Purple Team

Locate and read the purple team command:
1. If `$PIPELINE_DIR` is set: read `$PIPELINE_DIR/commands/purpleteam.md`
2. Otherwise: use Glob `**/pipeline/commands/purpleteam.md` to find it

Read the file in full. Follow every step in it from Step 0 through the final report. Honor the internal user approval gate (verification plan presentation) — do not skip it.

After the purple team report is generated and saved to `docs/findings/purpleteam-[date].md`:

Capture:
- `PURPLETEAM_REPORT_FILE` — path to the generated report
- `POSTURE_RATING` — one of: HARDENED, IMPROVED, PARTIAL, UNCHANGED
- `PT_VERIFIED` — count of VERIFIED findings
- `PT_INCOMPLETE` — count of INCOMPLETE findings
- `PT_REGRESSION` — count of REGRESSION findings

---

### Step 5 — Final Summary

After all three phases complete, present:

```
## Security Assessment Complete

### Red Team
[REDTEAM_TOTAL] findings identified ([REDTEAM_CRITICAL] critical, [REDTEAM_HIGH] high, [REDTEAM_MEDIUM] medium, [REDTEAM_LOW] low)

### Remediation
[REMEDIATION_FIXED] findings fixed, [REMEDIATION_REMAINING] remaining

### Purple Team
**Posture:** [POSTURE_RATING]
[PT_VERIFIED] verified, [PT_INCOMPLETE] incomplete, [PT_REGRESSION] regressions

### Reports
- Red team: `[REDTEAM_REPORT_FILE]`
- Remediation: `[REMEDIATION_SUMMARY_FILE]`
- Purple team: `[PURPLETEAM_REPORT_FILE]`

### What next?
a) Push all changes
b) Run another remediation cycle for regressions/incompletes
c) Leave as-is
```

If the user says "finish it", "ship it", "push it", or similar — execute option a without further prompting.
