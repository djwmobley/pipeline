# Root Cause Tracing

## Backward Tracing Technique

When an error is deep in the call stack, trace backward to find the original trigger.

### The Process

1. **Start at the crash site** — the exact line and function where the error occurs
2. **Identify the bad value** — what variable/parameter has an unexpected value?
3. **Trace one level up** — who called this function with the bad value?
4. **Repeat** — keep tracing up the call stack until you find where the bad value was created
5. **Fix at the source** — don't patch the symptom, fix where the bad value originates

### Example

```
Error: Cannot read properties of undefined (reading 'name')
  at renderUser (UserCard.tsx:15)
  at UserList (UserList.tsx:42)
  at Dashboard (Dashboard.tsx:28)
```

**Step 1:** Crash at UserCard.tsx:15 — `user.name` where `user` is undefined

**Step 2:** Who passes `user` to UserCard? → UserList.tsx:42 maps `users` array

**Step 3:** Where does `users` come from? → useUsers hook returns it

**Step 4:** What makes useUsers return undefined in the array? → The API returns
users with missing profiles, and the hook doesn't filter nulls

**Fix:** Filter nulls in the hook (source), not guard in UserCard (symptom)

### When to Use

- Error messages with stack traces
- Null/undefined access errors
- Type mismatches at runtime
- Any error where the symptom is far from the cause

### Key Rules

- Always trace to the SOURCE, not the first place you can add a guard
- A guard at the symptom hides the bug — it will manifest elsewhere
- If you find yourself adding `?.` or `if (!x) return` to fix a crash,
  ask: "Why is this value null in the first place?"
