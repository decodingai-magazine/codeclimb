# 04: Greet everyone

**What to build:** `src/greet.ts` also exports `greetAll(names: string[]): string`, the `greet` of each name joined with a space, then the `farewell` of the last.

**Blocked by:** 02 (A farewell function), 03 (A shout function)

**Status:** ready-for-agent

- [ ] `greetAll(["Ada", "Bo"])` returns `Hello, Ada! Hello, Bo! Goodbye, Bo!` (a unit test runs it with `node --test`)
- [ ] the tests of 01 to 03 still pass
