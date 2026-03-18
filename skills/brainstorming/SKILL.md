---
name: brainstorming
description: "Design before LARGE changes. Explores user intent, requirements, and design before implementation."
---

# Brainstorming Ideas Into Designs

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine
the idea. Once you understand what you're building, present the design and get user approval.

<HARD-GATE>
Do NOT invoke any implementation skill, write any code, scaffold any project, or take any
implementation action until you have presented a design and the user has approved it.
This applies to EVERY project regardless of perceived simplicity.
</HARD-GATE>

## Checklist

Complete these steps in order:

1. **Explore project context** — check files, docs, recent commits
2. **Offer visual companion**
3. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
4. **Propose 2-3 approaches** — with trade-offs and your recommendation
5. **Present design** — in sections scaled to their complexity, get user approval after each section
6. **Evaluate security checklist** — apply `security[]` checks from pipeline.yml
7. **Write spec** — save to config's `docs.specs_dir`
8. **Spec review loop** — dispatch spec-reviewer subagent; fix issues; max 3 iterations
9. **User reviews written spec** — ask user to review before proceeding
10. **Transition to implementation** — invoke /pipeline:plan

## The Process

**Visual companion (optional):**
When upcoming questions will involve visual content (mockups, layouts, diagrams), offer:
> "Some of what we're working on might be easier to show in a browser — mockups, diagrams, comparisons.
> Want to try it? (Requires opening a local URL)"

This offer MUST be its own message. If declined, proceed text-only.

Even after acceptance, decide per question: use browser for visual content (mockups, wireframes, layout comparisons), use terminal for text (requirements, conceptual choices, tradeoff lists). A question about a UI topic is not automatically visual.

**Understanding the idea:**
- Check out the current project state first (files, docs, recent commits)
- Before asking detailed questions, assess scope: if the request describes multiple independent
  subsystems, flag this immediately. Help decompose into sub-projects first.
- For appropriately-scoped projects, ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible
- Only one question per message
- Focus on understanding: purpose, constraints, success criteria

**Exploring approaches:**
- Propose 2-3 different approaches with trade-offs
- Lead with your recommended option and explain why

**Presenting the design:**
- Scale each section to its complexity
- Ask after each section whether it looks right
- Cover: architecture, components, data flow, error handling, testing
- Include files-to-create/modify list (from drawn-near's arch pattern)
- Include data flow diagram
- Include build sequence (ordered, dependency-aware)

**Security evaluation:**
- Read `security[]` from pipeline.yml
- For each check, answer whether this design is affected
- Flag any security concern in the design

**Design for isolation and clarity:**
- Break into smaller units with one clear purpose each
- Well-defined interfaces between units
- Can be understood and tested independently

**Working in existing codebases:**
- Explore current structure before proposing changes
- Follow existing patterns
- Include targeted improvements where existing code has problems affecting the work

## After the Design

**Write spec:** Save to `{docs.specs_dir}/YYYY-MM-DD-{topic}-design.md`

**Spec review loop:**
1. Dispatch spec-reviewer subagent (see spec-reviewer-prompt.md)
2. If Issues Found: fix, re-dispatch, repeat until Approved
3. If loop exceeds 3 iterations, surface to human

**User review gate:**
> "Spec written to `<path>`. Please review and let me know if you want changes before
> we start the implementation plan."

Wait for approval. Then invoke /pipeline:plan.

## Key Principles

- **One question at a time** — don't overwhelm
- **Multiple choice preferred** — easier to answer
- **YAGNI ruthlessly** — remove unnecessary features
- **Explore alternatives** — always propose 2-3 approaches
- **Incremental validation** — present design, get approval
- **Non-negotiable respect** — load config, never flag intentional patterns
