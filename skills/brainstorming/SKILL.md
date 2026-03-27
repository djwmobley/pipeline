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
This applies to EVERY project regardless of perceived simplicity. No exceptions. No rationalizations.
"It's simple enough to just build" is NEVER true — design first, always.
</HARD-GATE>

## Checklist

Complete these steps in order:

1. **Explore project context** — check files, docs, recent commits
2. **Read engagement style** — from `project.engagement` in pipeline.yml (expert/guided/full-guidance). If not set, ask.
3. **Offer visual companion**
4. **Ask clarifying questions** — one at a time, engagement-scaled
5. **Verify technical assumptions** — if unfamiliar tech is involved, dispatch research agents before proposing approaches
6. **Derive implied features** — extract features the user implied but didn't explicitly request
7. **Propose 2-3 approaches** — with trade-offs and your recommendation
8. **Present design** — in sections scaled to their complexity, get user approval after each section
9. **Evaluate Big 4 + Compliance** — functionality, usability, performance, security, compliance
10. **Track TBDs** — collect unresolved questions with user-language descriptions
11. **Write spec** — save to config's `docs.specs_dir`
12. **Spec review loop** — dispatch spec-reviewer subagent; fix issues; max 3 iterations
13. **User reviews written spec** — ask user to review before proceeding
14. **Transition to implementation** — invoke /pipeline:plan

## The Process

**Engagement style (step 2):**

Read `project.engagement` from pipeline.yml. This controls question depth throughout:

| Style | Question behavior |
|-------|------------------|
| `expert` | Minimal questions. Ask only for decisions that block progress. Skip context-obvious answers. |
| `guided` | Standard flow. One question at a time, multiple choice preferred. |
| `full-guidance` | Thorough walkthrough. Explain WHY each question matters. Offer examples with each choice. |

If `project.engagement` is not set, ask the user once:
> "How much guidance do you want during design? (expert / guided / full-guidance)"

**Visual companion (step 3, optional):**
Read `integrations.stitch.enabled` and `integrations.figma.enabled` from pipeline.yml, then offer the appropriate design tool:

If both Stitch and Figma are enabled:
> "I can generate new design mockups with Stitch and pull your existing Figma designs for reference.
> Want to use both, just one, or skip visuals? (both / stitch / figma / skip)"

If only Stitch is enabled:
> "I can generate design mockups using Stitch — AI-generated screens from your descriptions.
> Want to use that as we work through the design?"

If only Figma is enabled:
> "I can pull your Figma designs for reference as we brainstorm.
> Want to use that? (I'll need a Figma file URL)"

If neither is enabled:
> "Some of what we're working on might be easier to show in a browser — mockups, diagrams, comparisons.
> Want to try it? (Requires opening a local URL)"

This offer MUST be its own message. If declined, proceed text-only.

Even after acceptance, decide per question: use the design tool for visual content (mockups, wireframes, layout comparisons), use terminal for text (requirements, conceptual choices, tradeoff lists). A question about a UI topic is not automatically visual.

See `visual-companion.md` for the detailed dispatch logic for each path.

**Understanding the idea (step 4):**
- Check out the current project state first (files, docs, recent commits)
- Before asking detailed questions, assess scope: if the request describes multiple independent
  subsystems, flag this immediately. Help decompose into sub-projects first.
- For appropriately-scoped projects, ask questions one at a time to refine the idea
- Prefer multiple choice questions when possible
- Only one question per message
- Focus on understanding: purpose, constraints, success criteria
- **On indecision:** If the user says "I don't know" or "either works," ask WHY they're undecided. The reason reveals the real constraint. Do not pick for them.

**Verify technical assumptions (step 4):**

After clarifying questions, assess whether the task involves ANY of:
- A library/framework not already used in the project
- An API integration with an external service
- A technology choice between 2+ unfamiliar options
- Anything where confidence in the approach depends on version-specific behavior

If none apply, skip silently and proceed to exploring approaches.

If triggered:
1. Formulate 1-3 specific verification questions — targeted facts, not open-ended research
2. Dispatch parallel agents (model: `models.research` from config) using the `researcher-prompt.md` template in this skill's directory. Substitute all placeholders per its checklist before dispatching.
3. Present findings to user before proceeding to approaches
4. HIGH-confidence findings become constraints for approach proposals (same weight as locked decisions — do NOT propose alternatives that contradict them)
5. If a finding changes the viability of an approach, say so explicitly

Research findings are consumed inline to inform approach proposals. They are NOT persisted separately — the spec document captures the conclusions. If a finding should be locked as a project constraint, persist it as a locked decision through the knowledge tier (same as any other locked decision).

**Skip triggers** (research gate is NOT needed):
- The task uses only libraries/frameworks already in the project's dependencies
- The user has already provided verified documentation or links
- The change is purely within well-understood internal code (refactor, bug fix in known code)

<RESEARCH-RATIONALIZATION-PREVENTION>

| Thought | Reality |
|---------|---------|
| "My training data is recent enough" | It is not. Verify or mark LOW. |
| "The docs probably haven't changed" | APIs break monthly. Check Context7. |
| "One source is enough" | One source = LOW confidence. Period. |
| "This is well-known, skip verification" | Well-known to whom? The codebase has the answer or it doesn't. |
| "I'll just note it might be wrong" | Hedging is not a confidence score. Pick HIGH/MEDIUM/LOW. |
| "Quick lookup, skip the format" | The format exists so findings are actionable. No shortcuts. |

</RESEARCH-RATIONALIZATION-PREVENTION>

**Implied feature derivation (step 6):**

After clarifying questions, review the user's answers and extract features they implied but didn't explicitly request. Present as a table:

| Implied Feature | Derived From | Include? |
|----------------|-------------|----------|
| Error handling for [X] | User said "it should just work" | ✅ Recommended |
| Mobile responsiveness | User mentioned "users on phones" | ✅ Recommended |
| Admin dashboard | User said "I need to manage users" | ❓ Ask — could be CLI instead |

Ask the user to confirm which implied features to include. This prevents scope surprise during build.

**Exploring approaches:**
- Propose 2-3 different approaches with trade-offs
- Each approach MUST include a confidence assessment: how confident are you that this approach will work? HIGH/MEDIUM/LOW with reasoning
- If a research gate ran, cite which findings informed each approach's confidence level
- Do NOT propose approaches that contradict HIGH-confidence research findings
- Lead with your recommended option and explain why

**Presenting the design:**
- Scale each section to its complexity
- Ask after each section whether it looks right
- Cover: architecture, components, data flow, error handling, testing
- Include files-to-create/modify list
- Include data flow diagram
- Include build sequence (ordered, dependency-aware)

**Big 4 + Compliance evaluation (step 9):**

These dimensions are in tension — improving one can hurt another. Evaluate each and surface tradeoffs for the user to decide.

- **Functionality:** Does this design deliver the intended value? Does it fit the bigger picture? Is anything here feature creep?
- **Usability:** Is this the shortest path for the user? Will screens cause confusion? Are error states clear and actionable? Would a first-time user know what to do?
- **Performance:** Will this design meet accepted norms for web/app responsiveness? Are there scalability concerns (unbounded lists, heavy client rendering, large payloads)?
- **Security:** Read `security[]` from pipeline.yml. For each check, answer whether this design is affected — each item MUST have a confidence level (HIGH/MEDIUM/LOW). Are secrets kept secret? Is the user being asked to overshare?
- **Compliance:** Check whether this design touches regulated areas. For each applicable regulation, note what the design must do:
  - **GDPR** — user data collection, consent, right to deletion, data minimization
  - **CASL** — email communications, consent collection, unsubscribe mechanisms
  - **PCI DSS** — payment data handling, encryption, access controls
  - **WCAG** — accessibility requirements for UI components
  - **OSS Licensing** — dependency license compatibility
  - If no compliance constraints apply, state so explicitly — do not invent them.

For each dimension, note whether this design is affected and at what confidence (HIGH/MEDIUM/LOW). If dimensions are in tension (e.g., "confirmation step improves security but adds usability friction"), surface the tradeoff explicitly.

Engagement scaling for Big 4 + Compliance:
- **expert:** One-paragraph summary. Flag only dimensions with real concerns.
- **guided:** Standard section per dimension. Note tensions.
- **full-guidance:** Explain each dimension's relevance. Walk through compliance checklist item by item.

**Design for isolation and clarity:**
- Break into smaller units with one clear purpose each
- Well-defined interfaces between units
- Can be understood and tested independently

**Working in existing codebases:**
- Explore current structure before proposing changes
- Follow existing patterns
- Include targeted improvements where existing code has problems affecting the work

**TBD tracking (step 10):**

Throughout the brainstorm, collect every unresolved question into a TBD table. Use the user's language, not technical jargon:

```markdown
## Open Questions (TBDs)

| # | Question | User said | Blocks |
|---|----------|-----------|--------|
| 1 | How should expired sessions be handled? | "Not sure yet" | Auth flow design |
| 2 | Which payment provider? | "Leaning toward Stripe but not decided" | Payment integration |
```

TBDs are included in the spec as a dedicated section. The plan step resolves them before implementation starts. Each TBD must describe what it blocks — this helps the planner sequence tasks around unresolved decisions.

<ANTI-RATIONALIZATION>
These thoughts mean STOP and reconsider:
- "This is simple enough to just build" → No. Design first, always. The HARD-GATE is non-negotiable.
- "The user seems impatient, I'll skip questions" → Fewer questions = more assumptions = wrong implementation.
- "I know what they want" → You do not. Ask. One question at a time.
- "Compliance doesn't apply to this project" → Check explicitly. If none apply, say so in the evaluation.
- "The user said 'I don't know' so I'll pick for them" → Ask WHY they're undecided. The reason reveals the constraint.
- "I'll derive the implied features later" → Derive them NOW, before approaches. Scope surprise during build is expensive.
- "The spec reviewer approved, so the spec is complete" → The USER must also approve. Reviewer and user are separate gates.
- "This TBD is minor, I'll resolve it myself" → TBDs belong to the user. Track them, don't resolve them unilaterally.
</ANTI-RATIONALIZATION>

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
- **Training data is hypothesis** — assume 6-18 months stale; verify version-specific claims via Context7/WebSearch before committing to an approach
- **Prescriptive over exploratory** — research answers questions ("Use X because Y"), it doesn't generate reading lists ("Consider X or Y")
- **Ask WHY on indecision** — "I don't know" is information. The reason reveals the real constraint.
- **Engagement-scaled** — expert gets minimal questions, full-guidance gets explanations with every choice

## Reporting Model

The brainstorm command handles persistence to all three stores:
- **Postgres:** spec summary written by the brainstorm command after spec approval
- **GitHub:** feature epic created by the brainstorm command with lifecycle checklist
- **Build-state:** not applicable (no build in progress during brainstorm)

Subagents (researcher, spec-reviewer) produce output consumed inline by the brainstorm. They do not self-report to stores.
