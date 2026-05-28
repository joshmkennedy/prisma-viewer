# Prisma Pad PRD

## Problem Statement

Prisma Studio is useful for inspecting development data, but it is not optimized for quickly reading individual records in wide tables. When a model has many fields or deeply structured values, table cells become difficult to scan, and opening a record-level view is not as direct as needed for day-to-day debugging.

Developers need a local-only Prisma data viewer that can run inside an existing app, use that app's Prisma setup, show model rows in a readable table, and let them click a row to inspect the full record in a right sidebar as a compact field table or formatted JSON.

## Solution

Build a local CLI-launched viewer for development databases. The CLI starts from an app directory, loads environment variables from `.env.local` with fallback to `.env`, uses the app's installed Prisma packages and generated Prisma Client, and spins up a Vite-powered React app with Node middleware for database access.

The app presents a three-pane data viewing interface:

- A left sidebar lists Prisma models.
- The center pane shows rows for the selected model.
- A right sidebar shows the selected row in a readable record preview, with a compact field table and JSON view.

The viewer is explicitly read-only, development-focused, and refresh-based. It is not intended for production data access, record editing, or live synchronization.

## User Stories

1. As a developer, I want to start the viewer from my app directory, so that it uses the same Prisma setup as my application.
2. As a developer, I want the CLI to load `.env.local` first, so that local development overrides are respected.
3. As a developer, I want the CLI to fall back to `.env`, so that apps without `.env.local` still work.
4. As a developer, I want the viewer to use my app's installed `prisma` package, so that Prisma behavior matches my app.
5. As a developer, I want the viewer to use my app's generated Prisma Client, so that model names and field types match my schema.
6. As a developer, I want startup errors to explain missing Prisma dependencies, so that setup problems are easy to fix.
7. As a developer, I want startup errors to explain missing environment files or database URLs, so that connection problems are clear.
8. As a developer, I want startup errors to explain Prisma Client generation problems, so that I know when to run `prisma generate`.
9. As a developer, I want the app to start a local dev server, so that I can open the viewer in my browser.
10. As a developer, I want the CLI to print the local URL, so that I can navigate to the app quickly.
11. As a developer, I want the left sidebar to list all Prisma models, so that I can choose a table without remembering exact names.
12. As a developer, I want model names to be searchable or easy to scan, so that large schemas remain usable.
13. As a developer, I want the selected model to be visually highlighted, so that I know which table I am viewing.
14. As a developer, I want the center pane to show rows for the selected model, so that I can inspect records in context.
15. As a developer, I want table columns to be readable even when there are many fields, so that wide records are easier to browse than in Prisma Studio.
16. As a developer, I want scalar fields to render directly in cells, so that common values are immediately visible.
17. As a developer, I want long text values to be truncated in table cells, so that rows remain scannable.
18. As a developer, I want null values to be visually distinct, so that missing data is easy to notice.
19. As a developer, I want date values to be formatted consistently, so that timestamps are readable.
20. As a developer, I want JSON fields to be summarized in table cells, so that structured values do not overwhelm the table.
21. As a developer, I want relation fields to be omitted or summarized in the table, so that the first version stays focused on viewing model rows.
22. As a developer, I want rows to be clickable, so that I can inspect one record without losing the table context.
23. As a developer, I want the clicked row to remain selected, so that I know which record is open in the preview.
24. As a developer, I want the right sidebar to show the selected record, so that detailed inspection is separate from table browsing.
25. As a developer, I want the right sidebar to support a compact field table, so that I can scan field names and values vertically.
26. As a developer, I want the right sidebar to support formatted JSON, so that I can copy or inspect the raw record shape.
27. As a developer, I want to switch between field table and JSON preview, so that I can use the best view for the current record.
28. As a developer, I want object and array values to be readable in the preview, so that JSON and nested data can be inspected.
29. As a developer, I want the right sidebar to handle very large values gracefully, so that one field does not break the layout.
30. As a developer, I want a useful empty state before selecting a row, so that the interface is clear.
31. As a developer, I want a useful empty state when a model has no rows, so that I can distinguish empty data from loading failure.
32. As a developer, I want loading states for model metadata and table rows, so that slow database queries are understandable.
33. As a developer, I want database query errors to be visible in the UI, so that I can diagnose schema or connection problems.
34. As a developer, I want refresh-by-browser-reload behavior, so that the first version avoids live sync complexity.
35. As a developer, I want table data to be paginated or limited, so that large tables do not overload the browser or database.
36. As a developer, I want the current page size to be predictable, so that query cost is bounded.
37. As a developer, I want a manual refresh action if practical, so that I can reload a table without restarting the app.
38. As a developer, I want the viewer to be read-only, so that I do not accidentally mutate local data.
39. As a developer, I want no edit controls in the UI, so that the app's purpose is unambiguous.
40. As a developer, I want server endpoints to expose only read operations, so that the implementation enforces the read-only constraint.
41. As a developer, I want the app to work with Tailwind v4 and shadcn components, so that the UI can be built quickly with consistent primitives.
42. As a developer, I want the UI to feel dense and tool-like, so that it supports repeated debugging work instead of looking like a marketing page.
43. As a developer, I want the layout to fit desktop development workflows, so that sidebars and tables are useful on a laptop or monitor.
44. As a developer, I want the app to degrade clearly on small widths, so that it remains usable enough when the browser is narrow.
45. As a maintainer, I want Prisma access isolated behind a small server module, so that querying behavior is testable and not spread through the UI.
46. As a maintainer, I want schema introspection isolated behind a small metadata module, so that model and field discovery can evolve independently.
47. As a maintainer, I want the Vite middleware boundary to be explicit, so that frontend and backend responsibilities remain clear.
48. As a maintainer, I want the CLI startup flow isolated from server request handling, so that environment loading and runtime wiring are testable.
49. As a maintainer, I want simple API contracts between frontend and middleware, so that the React app does not need to know Prisma internals.
50. As a maintainer, I want the project to avoid production deployment assumptions, so that security scope remains constrained to local development.

## Implementation Decisions

- Build the tool as a local development CLI plus Vite app using React, Vite, Node, Tailwind v4, shadcn UI primitives, Prisma, and the target app's generated Prisma Client.
- The CLI accepts or infers an application root directory. The initial default should be the current working directory.
- Environment loading order is `.env.local` first, then `.env` as fallback. Values from `.env.local` should take precedence when both exist.
- The tool should resolve Prisma dependencies from the target app directory instead of bundling assumptions about schema or generated client output.
- The server process should create and own the Prisma Client instance. The browser should communicate through local read-only HTTP endpoints.
- Vite should be started programmatically with middleware that mounts the read API and serves the React app in one local dev server.
- The metadata module should expose a stable list of models and fields derived from Prisma's runtime metadata or DMMF-compatible information.
- The query module should expose a narrow interface for listing rows for a model with bounded pagination.
- The first row query should use `findMany` with a default limit. Sorting can default to Prisma/database order unless a safe primary-key or unique-field strategy is added.
- API endpoints should validate model names against discovered metadata before querying Prisma Client delegates.
- API endpoints should not expose arbitrary query execution.
- API endpoints should not include create, update, upsert, delete, raw SQL, or transaction mutation handlers.
- The left sidebar should render discovered model names and selection state.
- The center table should render a bounded set of columns from model fields with horizontal scrolling for wide schemas.
- The table should preserve row height and truncate long values to keep scanning efficient.
- The right preview sidebar should open when a row is selected and remain visible while switching rows.
- The record preview should include a segmented control or tabs for field table and JSON views.
- The field table view should render field name, type when available, and formatted value.
- The JSON view should render stable pretty-printed JSON with indentation.
- Frontend state should be simple client state: selected model, loaded rows, selected row, loading state, error state, pagination state, and preview mode.
- The first version should favor page refresh or manual reload over subscriptions, polling, or live database change tracking.
- The interface should be explicitly local-development oriented and should avoid production deployment affordances.

## Testing Decisions

- Tests should verify external behavior and contracts, not implementation details.
- CLI startup tests should cover environment resolution order, target app root resolution, and clear failures for missing Prisma prerequisites.
- Metadata module tests should cover model and field discovery from representative Prisma metadata fixtures.
- Query module tests should cover safe model validation, bounded `findMany` calls, empty results, and Prisma error propagation.
- API contract tests should cover listing models, listing rows for a selected model, rejecting unknown models, and guaranteeing no mutation endpoints exist.
- UI tests should cover model selection, row rendering, row click behavior, right sidebar preview, JSON preview formatting, loading states, empty states, and error states.
- Component tests should use mocked API responses so the table and preview can be tested without a real database.
- Integration tests can use a small fixture Prisma project with a temporary development database to verify CLI-to-server-to-client behavior.
- The best high-value test boundary is the server-side Prisma adapter because it concentrates the most risk: dynamic model access, schema metadata, and read-only guarantees.
- The next highest-value test boundary is the record preview UI because it directly addresses the product's main usability problem.

## Out of Scope

- Production data viewing.
- Editing records.
- Creating records.
- Deleting records.
- Running arbitrary SQL.
- Running arbitrary Prisma queries from the browser.
- Live synchronization.
- Background polling.
- Real-time database subscriptions.
- Authentication or multi-user access.
- Production deployment.
- Advanced relation traversal.
- Inline relation editing.
- Schema editing.
- Prisma migration management.
- Database seeding.
- Full Prisma Studio parity.

## Further Notes

- The product should optimize for local debugging speed and record readability, not broad database administration.
- The first release should be conservative about data volume by defaulting to bounded row queries.
- The core experience is the three-pane layout: models, rows, record preview.
- A polished preview sidebar is more important than broad table manipulation features in the initial version.
- Future enhancements could include column visibility, sorting, filtering, relation drill-down, copy-to-clipboard actions, and persisted UI preferences, but those should not block the initial viewer.
