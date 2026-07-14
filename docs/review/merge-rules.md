# Review Merge Rules

These rules define how individual findings from multiple review dimensions
are aggregated into a single pass/fail verdict.

## Aggregation Logic

```
overall.passed = all reviews.passed === true
```

A merge is blocked if **any** review dimension reports `passed: false`.

### Field-Level Merging

When aggregating findings lists across reviews:

1. **Concatenate** — all findings from all reviews are collected into a single list.
2. **Deduplicate** — identical `file` + `line` + `issue` combinations are collapsed (keep the highest severity and confidence).
3. **Sort** — by severity (P0 first), then by confidence descending, then by file path.

### Severity Escalation

If the same issue is reported by multiple review dimensions at different severities,
the **highest severity wins**:

| Correctness | Security | Merged |
|-------------|----------|--------|
| P1          | P0       | P0     |
| P2          | P1       | P1     |
| (not found) | P1       | P1     |

### Pass/Fail Rules

| Condition | Verdict |
|-----------|---------|
| Any P0 finding across all dimensions | `passed: false` |
| Any P1 finding across all dimensions | `passed: false` |
| Only P2 and/or P3 findings | `passed: true` |
| Zero findings across all dimensions | `passed: true` |

### Review Dimensions

The coordinator applies guidance from these specialised review dimensions
(order does not matter):

1. **correctness** — logical soundness, edge cases, data integrity
2. **standards** — coding conventions, naming, file structure
3. **security** — vulnerabilities, injection, secrets handling
4. **perf** — algorithmic efficiency, memory, I/O
5. **architecture** — SRP, DI, abstraction boundaries, modularity
6. **docs** — JSDoc coverage, README, inline documentation
7. **migration** — data migration safety, reversibility (if applicable)

### Special Cases

- **Migration review** is only required when the diff contains migration scripts or schema changes.
- If a review dimension produces an empty findings list, it is equivalent to `passed: true`.
- Reviews that fail to parse or error during execution are treated as `passed: false` with a single P0 finding describing the failure.
