# Coverage Domains & Work Package Slicing

Reference file for the QA skill. Defines how to divide test scenarios into non-overlapping work packages and how to identify integration seams.

## Work Package Slicing Strategies

The QA lead chooses a slicing strategy based on the project structure. The goal: no two workers test the same routes, features, or code paths.

### Route-Based Slicing (web apps)

Each worker owns a set of URL routes/pages. Best for:
- Next.js / SPA applications with distinct page routes
- Multi-page applications with clear route boundaries

Example:
```
WP-001: Auth routes       — /login, /register, /forgot-password
WP-002: Dashboard routes  — /dashboard, /dashboard/settings
WP-003: API routes        — /api/users, /api/orders, /api/webhooks
```

**Overlap risk:** Shared layouts, middleware that runs on all routes, session state. These are seam test candidates.

### Feature-Based Slicing (APIs, backends)

Each worker owns a feature boundary. Best for:
- API services with distinct feature modules
- CLI tools with distinct commands
- Libraries with distinct exports

Example:
```
WP-001: User management   — createUser, updateUser, deleteUser, getUser
WP-002: Order processing  — createOrder, updateStatus, cancelOrder, refund
WP-003: Notification system — sendEmail, sendPush, notificationPreferences
```

**Overlap risk:** Shared services (user lookup in order processing), shared database tables, event buses. These are seam test candidates.

### Layer-Based Slicing (complex systems)

Each worker owns a testing layer. Best for:
- Systems where the same code needs testing at multiple levels
- When unit and integration tests need different setup

Example:
```
WP-001: Unit tests        — pure functions, utilities, validators
WP-002: Integration tests — API endpoints with real DB
WP-003: E2E tests         — browser flows with Playwright
```

**Overlap risk:** Minimal — layers test the same features but through different interfaces. The seam pass verifies that layers agree on behavior.

### Hybrid Slicing

Combine strategies when no single approach fits:
```
WP-001: Auth feature (unit + integration)  — all auth-related code
WP-002: Data pipeline (unit + integration) — all data processing
WP-003: UI flows (e2e only)                — browser-based verification
```

## Seam Identification

Seams are integration boundaries where the hardest bugs live. The QA lead MUST identify the top 3-5 seams for every test plan.

### How to Find Seams

1. **Read the implementation plan tasks** — where does one task's output become another task's input?
2. **Check the file structure** — which modules import from each other?
3. **Look at data flow** — where does data cross a module/service/layer boundary?
4. **Check state transitions** — where does a state change in one component trigger behavior in another?
5. **Examine error paths** — where does an error in component A affect component B?

### Common Seam Types

| Seam Type | Example | What to Test |
|-----------|---------|-------------|
| **API-to-DB** | Route handler writes to database | Transaction boundaries, constraint violations, partial writes |
| **Auth-to-Feature** | Auth middleware gates feature access | Expired tokens, missing permissions, role escalation |
| **Form-to-API** | Frontend form submits to backend | Validation mismatch (client vs server), payload shape, error display |
| **Service-to-Service** | Order service calls inventory service | Timeout handling, partial failure, retry behavior |
| **State-to-UI** | State change triggers re-render | Stale state, race conditions, optimistic update rollback |
| **New-to-Existing** | New feature integrates with existing code | Interface compatibility, assumption mismatches, side effects |

### Seam Test Structure

Every seam test follows this pattern:
1. **Set up both sides** of the boundary
2. **Trigger the interaction** (the data flow, state change, or API call)
3. **Assert on BOTH sides** — verify the sender sent correctly AND the receiver processed correctly

```javascript
// Verifies: order creation updates inventory count (SEAM-001)
test('order creation decrements inventory', async () => {
  // Setup BOTH sides
  const product = await createProduct({ stock: 10 });

  // Trigger the interaction
  await createOrder({ productId: product.id, quantity: 3 });

  // Assert on BOTH sides
  const order = await getLatestOrder();
  expect(order.status).toBe('confirmed');

  const updatedProduct = await getProduct(product.id);
  expect(updatedProduct.stock).toBe(7); // inventory side
});
```

## Flake Management

### Retry Policy

| Test Type | Retries | Rationale |
|-----------|---------|-----------|
| Unit | 0 | Flaky unit test = concurrency bug. Investigate, don't retry. |
| Integration (no network) | 0 | Should be deterministic. Flake = test isolation issue. |
| Integration (with network/DB) | 1 | Network jitter or DB connection pool timing. 1 retry acceptable. |
| E2E / Browser | 1 | Browser rendering timing, animation delays. 1 retry acceptable. |
| Visual / Screenshot | 1 | Font rendering, viewport timing. 1 retry acceptable. |

### Screenshot Comparison

**Do NOT use pixel-perfect comparison.** Use structural analysis:
- DOM snapshot: verify elements exist, have correct text, are in correct order
- Layout check: verify element positions are within tolerance (not exact pixel)
- Accessibility audit: verify ARIA labels, roles, tab order

This follows the existing `ui-review` pattern which uses structural analysis, not pixel diffing.

### Flake Quarantine

Tests that fail-then-pass on retry are **flaky** and must be:
1. Flagged in the test report with likely cause assessment
2. Tracked if the same test flakes across multiple QA runs
3. Not used to block builds (flaky ≠ failing)
4. Investigated as a separate task (timing issue, test isolation, resource contention)

## Coverage Metrics

### What to Track (reported, never gated)

| Metric | Definition | Why It Matters |
|--------|-----------|----------------|
| P0 AC coverage | % of P0 acceptance criteria with at least one passing test | Core functionality verified |
| P1 AC coverage | % of P1 acceptance criteria with at least one passing test | Important features verified |
| Seam coverage | % of identified integration boundaries with a seam test | Cross-component behavior verified |
| Code line coverage | Lines executed / total lines (from test runner) | Informational — execution breadth |

### What NOT to Track

- P2 scenarios (noted as manual test notes, not automated)
- Branch coverage thresholds (too easy to game with low-value tests)
- Mutation testing scores (too expensive for AI-generated test suites)

### No Gating

Coverage metrics are **reported in the test report** but NEVER used to gate builds, commits, or deployments. A team chasing a coverage number writes garbage tests. Quality comes from risk-driven scenario selection and seam testing, not from hitting an arbitrary percentage.
