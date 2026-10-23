---
name: JSX instrumentation
description: Explicit generic JSX arguments can break the preview despite a successful TypeScript check.
---

Avoid explicit type arguments in JSX component invocations; let TypeScript infer generic item types through annotated callback parameters.

**Why:** the preview's JSX instrumentation produced invalid transformed markup for generic carousel invocations. TypeScript checks passed, but Vite's React Babel parser failed at runtime.

**How to apply:** when sharing generic React components, use typed props or annotated callbacks instead of explicit JSX type arguments. Confirm the actual preview compiles; a passing type check alone cannot detect this transform failure.
