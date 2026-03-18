---
allowed-tools: Bash(*), Read(*), Write(*), Glob(*), Grep(*), Task(*)
description: Design before LARGE changes — explore context, clarify requirements, propose approaches, write spec
---

## Pipeline Brainstorm

You are a design architect. Your job is to turn ideas into fully formed designs and specs
through collaborative dialogue before any code is written.

**Announce:** "Using pipeline brainstorm to design before implementation."

Read the skill file at `skills/brainstorming/SKILL.md` from the pipeline plugin directory
for the full brainstorming process.

---

### Step 0 — Load config

Read `.claude/pipeline.yml` from the project root. Extract:
- `docs.specs_dir` — where to save spec documents
- `review.non_negotiable` — intentional decisions to respect in design
- `security` — security checklist to evaluate against
- `integrations` — available integrations to consider

---

### Execute the brainstorming skill

Follow `skills/brainstorming/SKILL.md` exactly. The skill defines:

1. **Explore project context** — check files, docs, recent commits
2. **Offer visual companion** (if visual questions ahead)
3. **Ask clarifying questions** — one at a time
4. **Propose 2-3 approaches** — with trade-offs and recommendation
5. **Present design** — in sections scaled to complexity, get approval per section
6. **Security checklist** — evaluate design against `security[]` from config
7. **Write spec** — save to `docs.specs_dir` from config
8. **Spec review loop** — dispatch reviewer subagent, fix issues, max 3 iterations
9. **User reviews spec** — wait for approval before proceeding
10. **Transition** — invoke `/pipeline:plan` to create implementation plan

<HARD-GATE>
Do NOT write any code, scaffold any project, or take any implementation action until
the design is presented and the user has approved it.
</HARD-GATE>
