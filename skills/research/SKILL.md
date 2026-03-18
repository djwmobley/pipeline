# Research Skill

## Purpose

Investigate technical unknowns before planning or implementation. Prevents building on stale assumptions.

## When to invoke

- LARGE tasks with unfamiliar technology
- Architectural decisions with multiple viable approaches
- Any integration with external systems not yet used in the project

## Principles

1. **Training data is hypothesis.** Assume 6-18 months stale. Verify version numbers against registries, not memory.
2. **Confidence on everything.** HIGH = verified in docs/code. MEDIUM = multiple sources agree. LOW = single source or inference.
3. **Prescriptive output.** "Use X because Y" — not "Consider X or Y." The developer needs answers, not options.
4. **Negative findings are findings.** "X does NOT support Y" with evidence is more valuable than silence.
5. **Source hierarchy matters.** Codebase patterns → official docs → community sources. Never cite training data without verification.

## Output

Research briefs stored in Postgres (`research` table) or `docs/research/` (files tier). Each brief includes:
- Confidence-scored findings with sources
- Decisions ready to lock (HIGH confidence, no alternatives needed)
- Open questions for brainstorm/arch to resolve
