# Testing Anti-Patterns

## Common pitfalls when writing tests

### 1. Testing Mock Behavior Instead of Real Behavior

**Anti-pattern:**
```typescript
test('sends email', async () => {
  const mockSend = jest.fn().mockResolvedValue(true);
  await sendEmail(mockSend, 'test@example.com');
  expect(mockSend).toHaveBeenCalledWith('test@example.com');
});
```
This tests that you called a mock, not that email sending works.

**Better:**
```typescript
test('sends email', async () => {
  const result = await sendEmail(testSmtpClient, 'test@example.com');
  expect(result.delivered).toBe(true);
});
```

### 2. Adding Test-Only Methods to Production Code

**Anti-pattern:** Adding `_getInternalState()` or `testHelper()` methods to production
classes just to make testing easier.

**Better:** Test through the public interface. If you can't, the design needs work.

### 3. Mocking Without Understanding Dependencies

**Anti-pattern:** Mocking everything because "it's a unit test."

**Better:** Only mock at system boundaries (network, filesystem, external APIs).
Internal code should be tested with real implementations.

### 4. Tests That Never Fail

**Anti-pattern:** Tests that pass regardless of implementation correctness.

**Better:** Follow TDD — see the test fail first, then make it pass.

### 5. Testing Implementation Details

**Anti-pattern:** Asserting on internal state, private methods, or specific call sequences.

**Better:** Assert on observable behavior — outputs, side effects, state changes visible
through the public API.
