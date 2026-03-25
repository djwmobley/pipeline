# Architectural Domain Definitions

Reference file for the architecture skill. Recon determines which domains are relevant — this is NOT a fixed roster. Most projects use 2-4 domains, not all six.

## Domains

### DATA — Data Layer
**Scope:** Database technology, ORM/query builder, schema patterns, migration strategy, data modeling conventions.

**Checklist:**
- What database technology is in use (or should be)?
- What ORM or query builder? Direct SQL?
- Schema design patterns: normalized, denormalized, event-sourced?
- Migration tool and strategy (versioned, auto-generate, manual)?
- Connection pooling, transaction boundaries, isolation levels?
- Data validation layer: where is it enforced (app, DB, both)?

**Relevant when recon finds:** Database drivers/ORMs in dependencies, migration files, schema definitions, SQL files, `.env` with DB connection strings.

---

### STATE — State Management
**Scope:** Client-side state, server-side state, caching strategy, data revalidation patterns.

**Checklist:**
- Client state management (useState, Zustand, Redux, Jotai, signals)?
- Server state management (React Query, SWR, server components, loader patterns)?
- Cache strategy: what is cached, where, for how long?
- Revalidation: on-demand, time-based, event-driven?
- Session/auth state: where stored, how propagated?
- Optimistic updates: used? rollback strategy?

**Relevant when recon finds:** State management libraries in dependencies, store/context files, cache configuration, `use client` directives, React Query/SWR usage.

---

### UI — UI Patterns
**Scope:** Component architecture, styling approach, routing patterns, layout system, design system usage.

**Checklist:**
- Component library or design system (shadcn, MUI, custom)?
- Styling approach (Tailwind, CSS Modules, styled-components, vanilla CSS)?
- Component composition patterns (compound components, render props, slots)?
- Routing architecture (file-based, config-based)?
- Layout patterns (nested layouts, parallel routes)?
- Responsive strategy, accessibility baseline?
- Form handling patterns?

**Relevant when recon finds:** Component files (`.tsx`, `.vue`, `.svelte`), styling config (tailwind.config, postcss), component library in dependencies, layout files, route definitions.

---

### API — API Design
**Scope:** Endpoint conventions, authentication middleware, input validation, error handling, API documentation.

**Checklist:**
- API style (REST, GraphQL, tRPC, gRPC)?
- Route/endpoint naming conventions?
- Authentication middleware chain?
- Input validation strategy (Zod, Joi, class-validator, manual)?
- Error response format and status code conventions?
- Rate limiting, CORS, request size limits?
- API versioning strategy?
- Documentation approach (OpenAPI, auto-generated)?

**Relevant when recon finds:** Route handlers, API directories, middleware files, validation schemas, auth utilities, OpenAPI/Swagger files.

---

### INFRA — Infrastructure
**Scope:** Deployment target, CI/CD pipeline, environment management, monitoring, logging.

**Checklist:**
- Deployment target (Vercel, AWS, GCP, self-hosted)?
- CI/CD pipeline (GitHub Actions, GitLab CI, none)?
- Environment management (env vars, config files, feature flags)?
- Monitoring and alerting (Sentry, Datadog, PostHog)?
- Logging strategy (structured, levels, transport)?
- Container strategy (Docker, serverless, bare metal)?

**Relevant when recon finds:** CI config files (`.github/workflows/`, `.gitlab-ci.yml`), Dockerfiles, deployment config (`vercel.json`, `fly.toml`), monitoring SDK imports, `.env` files.

---

### TEST — Testing Strategy
**Scope:** Test framework, coverage approach, fixture management, mocking strategy, test organization.

**Checklist:**
- Test framework (Vitest, Jest, pytest, Go test)?
- Test organization (colocated, `__tests__/`, `tests/`, `spec/`)?
- Coverage tool and current coverage level?
- Mocking strategy (MSW, test doubles, dependency injection)?
- Fixture management (factories, seeds, snapshots)?
- E2E framework (Playwright, Cypress, none)?
- Test data strategy (hardcoded, generated, production snapshots)?
- CI test execution (parallel, sharded)?

**Relevant when recon finds:** Test files, test config (`vitest.config`, `jest.config`), test utilities/fixtures, mock directories, E2E config, coverage config.

## Domain Dependencies

Domains are NOT independent. When the lead architect synthesizes specialist recommendations, it MUST reconcile cross-domain dependencies:

```
DATA decisions → constrain STATE management (caching, revalidation tied to data layer)
STATE management → constrains UI patterns (component state model, data flow)
API surface → constrained by DATA + STATE (what's available, how it's cached)
INFRA → constrained by all above (deployment must support chosen stack)
TEST → must know all above (what to test, how to mock, what fixtures need)
```

The lead architect's synthesis step is where conflicts between specialists get resolved. If DATA recommends event sourcing but STATE recommends normalized client cache, the architect must choose one coherent path.
