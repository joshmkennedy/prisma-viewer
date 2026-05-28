# Query Lab PRD

## Problem Statement

Prisma Viewer is currently useful for browsing models, scanning rows, filtering data, and inspecting individual records in a read-only local interface. However, developers often need to answer more specific debugging questions than a table browser can handle:

- Which records match a nested Prisma `where` condition?
- What would this Prisma Client query return before I paste it into app code?
- Is this query overfetching data?
- Did this filter produce expensive SQL?
- Can I save this useful debug query and reuse it later?

Prisma Studio and general database clients are strong at browsing and editing data, but they are not optimized for a safe, Prisma-native query-debugging loop. Developers need a local, read-only query workbench that lets them experiment with Prisma-shaped queries, inspect results, understand generated SQL and timing, and save repeatable debugging views without exposing mutation capabilities.

## Solution

Add Query Lab: a read-only Prisma query workbench inside Prisma Viewer.

Query Lab lets a developer choose a model and operation, write a constrained Prisma args object in a full code editor, run it safely against the target app's generated Prisma Client, inspect the result as a table or JSON, review the normalized Prisma Client call, inspect generated SQL/params/timing when available, and receive performance and safety warnings.

The first version should support Args Mode only. The user selects the model and read operation in the UI, and the editor contains only the operation args object. This avoids executing arbitrary TypeScript while still supporting the core Prisma query workflow. The editor should be a real code editor, preferably Monaco, with syntax highlighting from the first Query Lab slice and Prisma metadata-backed autocomplete added as soon as the basic query path exists.

The feature should reinforce Prisma Viewer's positioning as a safe local Prisma data debugger, not a general database editor or raw SQL client.

## User Stories

1. As a developer, I want to open a Query Lab route, so that I can experiment with Prisma queries without leaving Prisma Viewer.
2. As a developer, I want to open Query Lab from a selected model, so that the scratchpad starts in the context I am already inspecting.
3. As a developer, I want to choose a Prisma model from metadata, so that I can query real models from my app schema.
4. As a developer, I want to choose a read-only Prisma operation, so that I can safely control the shape of the query.
5. As a developer, I want the first version to support `findMany`, so that I can inspect filtered result sets.
6. As a developer, I want the first version to support `findFirst`, so that I can quickly inspect one matching record.
7. As a developer, I want the first version to support `findUnique`, so that I can look up records by unique fields.
8. As a developer, I want the first version to support `count`, so that I can measure matching records without loading them all.
9. As a developer, I want to write a Prisma args object in an editor, so that the query shape feels familiar from app code.
10. As a developer, I want the editor to accept common Prisma args like `where`, `select`, `include`, `orderBy`, `skip`, and `take`, so that I can express useful real-world queries.
11. As a developer, I want the scratchpad to use a real code editor with syntax highlighting and bracket matching, so that query editing feels polished and reliable.
12. As a developer, I want autocomplete for operation-supported top-level args, so that I do not have to remember every Prisma option.
13. As a developer, I want autocomplete for model fields, relation fields, enum values, and common operators, so that writing queries is faster and less error-prone.
14. As a developer, I want validation errors to appear as editor diagnostics when practical, so that syntax and safety feedback appears where I am editing.
15. As a developer, I want to use safe literal values in args, so that strings, numbers, booleans, nulls, arrays, and objects work naturally.
16. As a developer, I want to use `new Date("...")` in args, so that DateTime filters are practical.
17. As a developer, I want invalid scratchpad syntax to show a clear parse error, so that I know what to fix.
18. As a developer, I want unsupported expressions to be rejected clearly, so that the read-only safety boundary is understandable.
19. As a developer, I want mutation operations to be blocked entirely, so that Query Lab cannot create, update, upsert, or delete data.
20. As a developer, I want raw SQL methods to be blocked entirely, so that Query Lab is not a raw SQL console.
21. As a developer, I want transaction APIs to be blocked entirely, so that Query Lab cannot bundle unsafe operations.
22. As a developer, I want the backend to validate the selected model, so that unknown model names cannot reach Prisma delegates.
23. As a developer, I want the backend to validate selected operations, so that only read-only operations can execute.
24. As a developer, I want the backend to validate query args, so that unsupported or dangerous query shapes fail before execution.
25. As a developer, I want `findMany` queries without `take` to receive a safety cap, so that I do not accidentally load an unbounded table.
26. As a developer, I want excessive `take` values to be clamped or rejected, so that query cost stays bounded.
27. As a developer, I want a maximum response size, so that a large result does not freeze the browser.
28. As a developer, I want a query timeout, so that a slow query does not hang the viewer indefinitely.
29. As a developer, I want clear messages when caps are applied, so that the result is not misleading.
30. As a developer, I want to run a query manually, so that changes only hit the database when I choose.
31. As a developer, I want keyboard-friendly run behavior, so that repeated query iteration is fast.
32. As a developer, I want loading state while a query runs, so that slow database calls are understandable.
33. As a developer, I want query errors to appear in the UI, so that Prisma validation and database errors are visible.
34. As a developer, I want query errors to preserve useful Prisma error detail, so that I can fix the query quickly.
35. As a developer, I want the result to render as a table when the result is row-shaped, so that I can scan records efficiently.
36. As a developer, I want the result to render as JSON, so that I can inspect the raw returned shape.
37. As a developer, I want the existing record preview patterns to work for Query Lab results, so that detailed inspection is consistent with the model table view.
38. As a developer, I want count results to render clearly, so that scalar query responses do not look like table failures.
39. As a developer, I want nested results to remain readable, so that `include` and JSON fields do not break the layout.
40. As a developer, I want the inspector to show the effective model and operation, so that I can confirm what ran.
41. As a developer, I want the inspector to show normalized args, so that I can see the exact query shape after caps/defaults are applied.
42. As a developer, I want the inspector to show a copyable Prisma Client call, so that I can paste the query into app code or tests.
43. As a developer, I want the inspector to show generated SQL when available, so that I can understand what Prisma sent to the database.
44. As a developer, I want the inspector to show SQL params when available, so that placeholders are understandable.
45. As a developer, I want the inspector to show query duration, so that I can identify slow queries.
46. As a developer, I want the inspector to show selected field count, so that I can recognize broad selects.
47. As a developer, I want the inspector to show returned row count, so that I can understand result volume.
48. As a developer, I want the inspector to show approximate payload size, so that I can recognize overfetching.
49. As a developer, I want warnings for `findMany` without `take`, so that unbounded reads are discouraged.
50. As a developer, I want warnings for selecting all scalar fields, so that I can reduce payload size when needed.
51. As a developer, I want warnings for large `skip` values, so that I understand offset pagination costs.
52. As a developer, I want warnings for `include` without nested limits, so that relation fanout risk is visible.
53. As a developer, I want warnings for sorting by fields that are not known identifiers, unique fields, or indexed fields, so that possible performance issues are visible.
54. As a developer, I want warnings for filtering on fields that are not known identifiers, unique fields, or indexed fields, so that possible full scans are easier to spot.
55. As a developer, I want warnings to be deterministic and explainable, so that I can trust them even when they are conservative.
56. As a developer, I want warnings not to block reads by default, so that debugging remains flexible.
57. As a developer, I want to save a working Query Lab query as a named view, so that I can reuse common debugging workflows.
58. As a developer, I want saved views to include model, operation, args source, and presentation preferences, so that they reopen exactly as expected.
59. As a developer, I want saved views to appear near the model/sidebar navigation, so that project-specific debug queries are easy to find.
60. As a developer, I want to rename saved views, so that their purpose stays clear.
61. As a developer, I want to delete saved views, so that old debugging queries do not clutter the app.
62. As a developer, I want saved views to remain local by default, so that debug queries do not accidentally become shared project state.
63. As a maintainer, I want the parser and validator isolated behind a small interface, so that query safety can be tested thoroughly.
64. As a maintainer, I want the executor isolated behind a small interface, so that read-only Prisma execution and instrumentation are testable.
65. As a maintainer, I want performance warnings isolated behind a small interface, so that heuristics can evolve independently.
66. As a maintainer, I want Query Lab editor completion logic isolated behind a metadata-backed interface, so that suggestions can evolve independently from query execution.
67. As a maintainer, I want API contracts to be explicit, so that the frontend does not need to know Prisma internals.
68. As a maintainer, I want Query Lab to reuse existing metadata discovery, so that model and field handling stays consistent across the app.
69. As a maintainer, I want Query Lab to reuse existing result/preview UI patterns where practical, so that the product remains coherent.
70. As a maintainer, I want the API to remain mutation-free, so that the core safety promise is enforced server-side.

## Implementation Decisions

- Add Query Lab as a first-class route in the React app.
- Add a model-specific entry route that can open Query Lab with a preselected model.
- Implement Args Mode first. The UI selects model and operation; the editor only contains the args object.
- Use a real code editor for the scratchpad, preferably Monaco, instead of a plain textarea.
- Include syntax highlighting, bracket matching, formatting-friendly behavior, and keyboard-friendly editing in the first Query Lab slice.
- Add Prisma metadata-backed autocomplete after the basic Query Lab execution path is in place.
- Autocomplete should suggest operation-supported top-level args, model fields, relation fields, enum values, and common Prisma operators.
- Editor diagnostics should display parse and validation errors when practical, while backend validation remains the source of truth.
- Defer Prisma snippet mode until Args Mode is proven useful and the safety model is mature.
- Do not execute arbitrary TypeScript.
- Parse the editor source into a constrained expression AST.
- Allow only safe data literals and explicitly supported constructors such as `new Date("...")`.
- Reject imports, variables, function calls, loops, callbacks, member expressions, template execution, and arbitrary code.
- Support read-only operations in the first version: `findMany`, `findFirst`, `findUnique`, and `count`.
- Defer `aggregate` and `groupBy` until the basic read workflow is stable.
- Block all mutation operations: `create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, and `deleteMany`.
- Block raw SQL methods: `$queryRaw`, `$queryRawUnsafe`, `$executeRaw`, and `$executeRawUnsafe`.
- Block transaction APIs.
- Introduce a read-only query preview endpoint that accepts large query bodies.
- Use POST for the preview endpoint because query source can be too large or structured for query parameters.
- Preserve the product invariant as "no mutations are exposed," not "all endpoints must be GET."
- Validate selected model names against discovered Prisma metadata before resolving delegates.
- Validate selected operations against the allowed read-only operation list.
- Validate top-level args against a supported subset for the selected operation.
- Validate fields referenced in `where`, `select`, `include`, and `orderBy` against Prisma metadata where practical.
- Enforce a maximum `take` value for result-returning operations.
- Apply a default safety `take` for uncapped `findMany` queries.
- Enforce a maximum nested depth for args.
- Enforce a maximum serialized response size.
- Enforce a query timeout.
- Execute through a reused Prisma Client runtime owned by the server process.
- Do not create a new Prisma Client for each Query Lab run.
- Add query instrumentation around execution to capture logical model, operation, args, duration, and errors.
- Use Prisma query event logging to capture generated SQL, params, and database query duration when available.
- If query event logging requires a specific Prisma Client configuration, make that configuration part of the server runtime initialization.
- Avoid Prisma Client Metrics as a foundation because that feature is deprecated/removed in newer Prisma versions.
- Defer OpenTelemetry tracing to a future advanced profiling mode.
- Return a response containing result data, normalized args, generated Prisma call text, SQL events, timing, caps applied, and warnings.
- Keep raw SQL read-only and non-editable in the UI.
- Do not expose a raw SQL editor.
- Reuse existing table and record-preview presentation patterns for row-shaped results.
- Add a JSON result view for arbitrary result shapes.
- Add an inspector area with tabs for result, Prisma, SQL, performance, and warnings.
- Add deterministic warning heuristics for unbounded reads, overfetching, large offsets, relation fanout, and likely unindexed filters/sorts.
- Use known Prisma metadata such as `isId` and `isUnique` for early index-like warnings.
- Extend metadata discovery later if true index metadata is needed for better warning accuracy.
- Add saved Query Lab views after the basic run/inspect loop works.
- Store saved views locally in the first version.
- Treat project-shared saved views as a future decision because it changes collaboration and repository-state expectations.

## Testing Decisions

- Tests should verify external behavior and safety contracts, not parser implementation details.
- Add parser tests that prove safe literals and `new Date("...")` are accepted.
- Add parser tests that prove variables, imports, function calls, loops, callbacks, and arbitrary expressions are rejected.
- Add operation validation tests that prove only allowed read operations execute.
- Add safety tests that prove mutation, raw SQL, and transaction operations cannot be expressed through Query Lab.
- Add args validation tests for supported top-level keys by operation.
- Add metadata validation tests for unknown model and unknown field references.
- Add cap tests for missing `take`, excessive `take`, nested depth, response size, and timeout behavior.
- Add executor tests that verify Prisma delegates receive only validated read operation calls.
- Add instrumentation tests that verify duration and SQL event data are returned when available.
- Add warning tests for no `take`, overfetching, large `skip`, unbounded nested include, and likely unindexed filter/sort fields.
- Add API contract tests for the query preview endpoint, matching the existing server middleware tests.
- Add UI tests for selecting model, selecting operation, editing args, running a query, rendering results, showing errors, and displaying inspector data.
- Add UI tests proving Query Lab uses the code-editor path and does not regress to a plain textarea.
- Add completion-provider tests for operation args, model fields, enum values, and common operators when autocomplete is implemented.
- Add UI tests for cap/warning presentation.
- Add UI tests for saving and reopening a Query Lab view when saved views are implemented.
- Reuse the existing fixture Prisma app integration pattern to verify Query Lab can run against a real generated Prisma Client.
- Keep integration tests focused on one or two high-value query paths to avoid slow test growth.
- Run the repository test suite with `npm test`.

## Out of Scope

- Editing records.
- Creating records.
- Updating records.
- Upserting records.
- Deleting records.
- Running arbitrary SQL from user input.
- Building a general SQL console.
- Executing arbitrary TypeScript.
- Supporting variables, imports, loops, callbacks, helper functions, or user-defined query fragments in the first version.
- Supporting Prisma snippet mode in the first version.
- Supporting `aggregate` and `groupBy` in the first version.
- Live query reruns or polling.
- Production deployment.
- Authentication or multi-user access.
- OpenTelemetry trace UI in the first version.
- EXPLAIN plans in the first version.
- EXPLAIN ANALYZE in the first version.
- Project-shared saved views in the first version.
- Prisma Studio feature parity.
- DataGrip, DBeaver, TablePlus, or Beekeeper Studio feature parity.

## Further Notes

- Query Lab should become a major differentiator for Prisma Viewer: a safe local Prisma query workbench with inspection and performance feedback.
- The product should continue to position itself as read-only and app-context-aware rather than as a general database editor.
- The strongest MVP is not "a scratchpad" by itself; it is the full loop of args editing, safe execution, result preview, query inspector, warnings, and saved views.
- The feature should make Prisma Viewer useful when a developer wants to understand records, relations, and query behavior without risking accidental data mutation.
- If Prisma snippet mode is added later, it should compile down to the same validated internal query description used by Args Mode.
- If EXPLAIN support is added later, it should only run against SQL generated from an already-validated read-only Prisma query and should remain opt-in.
