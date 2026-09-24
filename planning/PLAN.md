# Delivery Plan

See [SCOPE.md](SCOPE.md) for goals and requirements, and [TASKS.md](TASKS.md) for the checklist.

## Architecture decisions

### AD-1: Reuse the engine and add a JSON interface to `efcpt`

The engine (`RevEng.Core.*`) is .NET and EF Core-version specific, so it can't be rewritten in Node. We have three ways to reach it:

| Option | Pros | Cons |
| --- | --- | --- |
| **A. Extend the `efcpt` CLI with `--list-objects` and `--json` (chosen)** | Small, additive change in code that's already cross-platform. Same multi-targeting as today (shared source linked into efcpt.8/9/10). Could be upstreamed | We parse process output (already how the VS extension works) |
| B. Package `efreveng*` and speak its existing stdout protocol | Zero .NET changes | The protocol is ad-hoc (positional args, `Result:` / `Error:` markers). It takes the full `ReverseEngineerCommandOptions`, so we'd have to re-implement `CliConfigMapper` in TS |
| C. New ASP.NET "engine server" that hosts the API and UI | One process, typed access | Much more .NET code to maintain against a fast-moving upstream. The UI build gets tied to three EF targets |

Why A: `efcpt` already owns the config → options mapping (`CliConfigMapper`), exclusion wildcards, T4 drop and readme generation. The UI only needs **discovery** and **run** in JSON form. Everything else is editing the JSON file.

### AD-2: The npm package is the product, and runs a local web UI

- A Node launcher (`bin`) plus a small HTTP server (Fastify or plain `node:http`) plus a SPA (Vite + React + TS).
- It binds to `127.0.0.1` with a random session token, opens the browser, and shuts down when the tab closes (heartbeat) or on Ctrl+C.
- Why not Electron or Tauri: a large download or an extra toolchain, with no real benefit for a local form-and-tree UI.

### AD-3: `efcpt-config.json` is the single source of truth

- The UI reads the file, lets the user edit it, validates it against `efcpt-config.schema.json`, and writes it back. It preserves key order and unknown keys, and keeps the diff small (only the fields that changed).
- TS types are generated from `samples/efcpt-config.schema.json`, so there's no hand-maintained second schema.
- Anything done in the UI can be reproduced with `efcpt -i <config>` in CI.

### AD-4: Engine distribution. Ship binaries in the npm package (v1)

- CI builds framework-dependent `efcpt.8/9/10` outputs (`dotnet publish`, no RID, `RollForward=Major`, as today) and puts them in the npm tarball under `engines/ef8|ef9|ef10/`. The launcher runs `dotnet engines/ef10/efcpt.dll ...`.
- This avoids a global `dotnet tool` install and version clashes with the official `efcpt`.
- Size check needed (provider packages make each engine tens of MB). If it's too big, split into optional platform packages (`@efcpt-ui/engine-ef10`) or download on first run into a cache (keyed by the version hash).
- Override: `--engine <path-to-efcpt.dll|efcpt>` for local development or a globally installed tool.

### AD-5: Keep the fork mergeable

- New .NET code goes in **new files** where possible (for example `Services/ListObjectsService.cs`, `Services/JsonOutput.cs`). Edits to existing upstream files are limited to option wiring.
- The Node/TS package lives in a new top-level folder `packages/efcpt-ui/`, away from `src/`.
- Merge upstream `master` monthly. Try to upstream the `--list-objects` / `--json` / `[JsonExtensionData]` changes (see SCOPE open question 3).

## Phases

### Phase 0: Foundations (≈2–3 days)

- Decide the open questions in SCOPE (name, UI stack, distribution).
- Set up the repo: `packages/efcpt-ui` workspace, lint/format, a TS build, and a CI job on Ubuntu, Windows and macOS.
- Confirm the fork builds `efcpt.10` and runs NUnit tests on Linux in CI (the workflows already exist; they may need enabling on the fork).
- A sample target project with SQLite and SQL Server (docker) fixtures for end-to-end tests.

**Exit:** CI green on the fork. Empty package publishes to a local registry (verdaccio or `npm pack`).

### Phase 1: Engine JSON interface (≈3–5 days)

- `--list-objects`: discovery only. Prints `List<TableModel>` JSON (tables, views, procs, functions, with columns and schema). **Doesn't touch the config file** and doesn't generate anything.
- `--json`: machine-readable output for normal generation runs. Suppresses the Spectre UI, and writes a single JSON document (`ReverseEngineerResult` + config warnings + readme path) to stdout, with errors as JSON on stderr and a non-zero exit code.
- `[JsonExtensionData]` on `CliConfig` so the file round-trips unknown sections. Keep the existing `$schema` value instead of forcing the upstream URL.
- `--no-config-write` (or reuse `refresh-object-lists` semantics), so a run started by the UI doesn't unexpectedly rewrite a file the user is editing.
- NUnit tests for each, following the existing `CliObjectListTest.cs` style.

**Exit:** `efcpt "Data Source=test.db" sqlite --list-objects --json` returns valid JSON on Linux. Generation with `--json` matches normal output file-for-file.

### Phase 2: Launcher and headless path (≈3–4 days)

- `efcpt-ui` CLI: argument parsing, find config(s), find the `.csproj`, detect the EF Core major (`Microsoft.EntityFrameworkCore*` PackageReference; fall back to TargetFramework), and resolve the connection (order in SCOPE).
- Engine runner: spawn, time out and cancel, parse JSON, map errors to friendly messages (missing dotnet runtime, bad connection, unknown provider).
- `--generate` headless mode, which is effectively a thin wrapper around `efcpt -i`.
- Config I/O module: load, validate, minimal-diff write, and create a new config from a template.

**Exit:** `npx efcpt-ui --config x --generate` works against SQLite and SQL Server on all three OSes.

### Phase 3: GUI v1 (≈1.5–2.5 weeks)

- Server API: `GET /api/session` (config path, project, EF version, provider), `GET /api/objects` (runs discovery, cached), `GET/PUT /api/config`, `POST /api/generate` (streams progress over SSE), `GET /api/configs` (for multi-config picking).
- Screens:
  1. **Config picker** (when there are several or none; can create a new one)
  2. **Connection** (shows the resolved source; lets you enter one or test it)
  3. **Objects**: tree with search, tri-state checkboxes, counts, column/index exclusion, and wildcard rules shown read-only with an "edit" option
  4. **Settings**: schema-driven form grouped as Names / File layout / Code generation / Type mappings / Replacements, with docs tooltips
  5. **Run**: log output, generated files, warnings, errors, and missing NuGet packages with a "copy / run `dotnet add package`" button
- Behaviour details to copy from the VS view models (`PickTablesViewModel`, `ObjectTreeViewModel`, `ModelingOptionsModel`): defaults, which options depend on others (for example T4 vs. split), and provider-specific options.

**Exit:** the success criteria in SCOPE pass manually on Windows, macOS and Linux.

### Phase 4: Hardening and release (≈1 week)

- End-to-end tests (Playwright) against the SQLite fixture in CI. Unit tests for config round-trips.
- Security review of the local server (token, origin check, no secrets in logs).
- Docs: package README, quick start, `package.json` script examples for several configs.
- Release pipeline: build the engines, then the npm package, then publish (with provenance). Versioning scheme.

**Exit:** v1.0.0 published.

### Phase 5: Stretch (v1.x, prioritise after feedback)

Renaming UI (`efpt.renaming.json`), `efpt.config.json` importer, diff preview, Mermaid diagram preview, `.sqlproj` build, engine download-on-demand, `dotnet tool` distribution of the launcher.

## Rough timeline

| Phase | Effort |
| --- | --- |
| 0 Foundations | 2–3 d |
| 1 Engine JSON interface | 3–5 d |
| 2 Launcher + headless | 3–4 d |
| 3 GUI v1 | 8–12 d |
| 4 Hardening + release | ~5 d |
| **Total to v1** | **≈ 4–6 weeks** for one developer |

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| npm tarball too big with 3 engines bundled | Slow installs, npm size limits | Measure in Phase 0. Split into per-EF-version optional packages, or download on demand |
| Upstream refactors `efcpt` / `CliConfigMapper` | Merge conflicts | Additive code, monthly merges, try to upstream the changes |
| `dotnet` runtime missing or wrong major | Engine won't start | Check `dotnet --list-runtimes` up front (as the VS extension does) and show a clear message. `RollForward=Major` already helps |
| Provider-specific surprises (Oracle schemas, Snowflake, dacpac merge) | Broken edge cases | v1 officially tests SQL Server, SQLite and PostgreSQL; others are "best effort". Pass through the engine's own options |
| Secrets leaking into config or logs | Security | Connection-resolution design in SCOPE. Redact in logs (the CLI already redacts in the readme) |
| Config rewrite clobbers user edits | Lost work | `[JsonExtensionData]`, a no-write mode, and minimal-diff writes on the Node side |
