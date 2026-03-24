---
name: reviewing
description: Per-change quality review process — config-driven criteria, severity tiers, non-negotiable filtering
---

# Code Review Process

## Overview

Review changed code against configurable criteria. Find real problems only.
Never flag intentional architectural decisions listed in `review.non_negotiable[]`.

**Core principle:** Evidence-based findings with actionable fixes. No praise. No rubber-stamping.

<ADVERSARIAL-MANDATE>
Every review MUST produce at least one finding OR an explicit "Clean Review Certificate" that lists:
- What was checked (each criterion)
- Why no issues were found (specific evidence, not "looks good")
- What the riskiest part of the change is and why it's acceptable

An empty review with no findings and no certificate is a FAILED review. Start over.
If you catch yourself thinking "this looks fine" — that thought is a red flag. Read the code again.
</ADVERSARIAL-MANDATE>

**Confidence Levels:** Every finding MUST include a confidence level.
- **HIGH** — You verified the issue exists in the code (traced the execution path, confirmed the type, read the call site)
- **MEDIUM** — Strong inference from patterns, but not fully traced (e.g., likely null but didn't confirm all callers)
- **LOW** — Possible issue based on common pitfalls, but not verified in this specific code

## The Process

1. Load non-negotiable decisions from `review.non_negotiable[]` in pipeline.yml
2. Run static analysis (typecheck + lint) — tool findings are automatic 🔴 HIGH
3. Get the diff — understand what changed
4. Read each changed file in full — understand context
5. Review against `review.criteria[]` — apply each configured criterion
6. Report with severity tiers — 🔴 HIGH / 🟡 MEDIUM / 🔵 LOW format

## Severity Calibration

**🔴 HIGH — Must fix** — Will cause bugs, security issues, crashes, or data loss in production.
Includes: type errors, unhandled rejections on user actions, security vulnerabilities,
access control gaps, null dereferences on reachable paths.
**Confidence requirement: HIGH only.** You MUST have verified the bug or vulnerability exists. If you cannot trace the execution path to confirm, downgrade to 🟡 MEDIUM.

**🟡 MEDIUM — Should fix** — Quality issues that degrade maintainability or user experience.
Includes: dead code, unused imports, UX clarity issues, premature abstractions,
SOLID violations that manifest as real problems.
**Confidence requirement: HIGH or MEDIUM.** You MUST have strong evidence. If your reasoning is "this might be a problem," downgrade to 🔵 LOW.

**🔵 LOW — Consider** — Suggestions that would improve the code but are not problems.
Includes: alternative approaches, performance optimizations, readability improvements.
**Any confidence level accepted, but you MUST state it.** A LOW confidence 🔵 LOW is valid; an unstated confidence is not.

## Review Dimensions

The Big 4 dimensions apply to code review, not just design:
- **Functionality** — correctness, spec compliance (core of every review)
- **Usability** — user-facing clarity, error messages, accessibility (when task touches UI/API)
- **Performance** — scalability, resource usage, query efficiency (when task touches data/compute)
- **Security** — already enforced via safety guards and non-negotiables

Not every review touches all four. Apply the dimensions relevant to the changed files.

## Non-Negotiable Filtering

Before flagging ANY finding, check it against `review.non_negotiable[]`.
Each entry describes an intentional pattern and why it exists.
If a finding matches a non-negotiable, suppress it completely — do not even mention it.

## Framework Detection

Detect the project's framework from dependencies:
- `react` / `react-dom` → React correctness checks
- `vue` → Vue correctness checks
- `@angular/core` → Angular correctness checks
- `svelte` → Svelte correctness checks

Apply framework-specific correctness checks automatically based on detection.

## Key Principles

- **Real problems only** — if you wouldn't block a PR for it, it's 🔵 LOW at most
- **Full context** — read the whole file, not just the diff
- **Non-negotiable respect** — never flag intentional patterns
- **Actionable fixes** — every 🔴 HIGH finding includes a specific fix description
- **Simplify handoff** — collect simplicity/SOLID findings for /pipeline:simplify
