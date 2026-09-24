# Tasks

Checklist for the standalone effort. The phases match [PLAN.md](PLAN.md). IDs are stable, so they can be referenced from commits and PRs (for example `E4`).

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

## Phase 0: Foundations

- [x] **F0** Scoping: current-state report, scope, plan, tasks (`planning/`)
- [ ] **F1** Decide the open questions in SCOPE.md: package/command name, engine distribution, UI stack, config formats, Node minimum, whether to upstream
- [ ] **F2** Enable GitHub Actions on the fork. Confirm `cli-tool.yml` goes green (NUnitTestCore + build efcpt.8/9/10 on Ubuntu). Turn off or skip upstream publish steps (NuGet/VSIX secrets) so they don't fail on the fork
- [ ] **F3** Create the `packages/efcpt-ui/` workspace: TypeScript, ESLint, Prettier, Vitest, `bin` entry, `npm pack` smoke test
- [ ] **F4** Generate TS types from `samples/efcpt-config.schema.json` (for example `json-schema-to-typescript`) as a build step
- [ ] **F5** Test fixtures: a sample .NET 10 project + SQLite DB (checked in) + a SQL Server docker compose (reuse `test/ScaffoldingTester` Northwind/Chinook scripts)
- [ ] **F6** Measure engine publish size for each EF version (`dotnet publish src/Core/efcpt.10 -c Release`) to settle AD-4 (bundle vs. download)
- [ ] **F7** CI matrix job for the npm package on ubuntu, windows and macos

## Phase 1: Engine JSON interface (`src/Core/efcpt.8`, shared by 9/10)

- [ ] **E1** Add a `--list-objects` option to `ScaffoldOptions`. Add a new `ListObjectsHostedService` that runs `TableListBuilder` (tables/views + procedures + functions) and **doesn't** read, write or generate anything else
- [ ] **E2** Add a `--json` option. When set, route `DisplayService` output to stderr or silence it, and write one JSON document to stdout:
  - list mode: `{ "objects": [TableModel...], "databaseType": ..., "efCoreVersion": ... }`
  - generate mode: `{ "result": ReverseEngineerResult, "configWarnings": [...], "readmePath": ..., "outputPaths": [...] }`
  - on error: `{ "error": { "message", "details" } }`, exit code 1
- [ ] **E3** Make sure a failed provider resolution (`Environment.Exit(1)` in `Program.ResolveProvider`) also produces JSON errors when `--json` is set
- [ ] **E4** Add `[JsonExtensionData] Dictionary<string, JsonElement>` to `RevEng.Common.Cli.Configuration.CliConfig` so unknown sections survive a rewrite. Keep the incoming `$schema` value instead of the hardcoded upstream URL
- [ ] **E5** Add a `--no-config-write` option (skip the `File.WriteAllText` in `CliConfigMapper.TryGetCliConfig`) for runs started by the UI
- [ ] **E6** NUnit tests: list-objects JSON shape (SQLite), config round-trip with an unknown section, `--json` generate output
- [ ] **E7** Update `src/Core/efcpt.8/readme.md` with the new options
- [ ] **E8** (optional) Open an upstream PR to ErikEJ/EFCorePowerTools with E1–E5

## Phase 2: Launcher and headless path (`packages/efcpt-ui`)

- [ ] **L1** CLI argument parsing: `--config`, `--project`, `--connection`, `--connection-env`, `--provider`, `--port`, `--no-open`, `--generate`, `--engine`, `--verbose`
- [ ] **L2** Config discovery: find `efcpt-config*.json` / `*.efcpt.json` under the project root, skipping `bin/`, `obj/` and `node_modules/`
- [ ] **L3** Project discovery: nearest `*.csproj` above the config. Read `RootNamespace`, `TargetFramework(s)`, and the `Microsoft.EntityFrameworkCore*` PackageReference version (plus `Directory.Packages.props` for central package management). Map to EF major 8/9/10
- [ ] **L4** Connection resolution in order: flag → env → `efcpt-ui.connection` config section (`env` / `user-secrets` / `appsettings` / `dacpac`) → UI prompt. User-secrets are read via `dotnet user-secrets list --project` or the secrets.json path
- [ ] **L5** Engine locator: bundled `engines/efN/efcpt.dll` → `--engine` override → global `efcpt` on PATH (warn if it's the upstream build without `--json`)
- [ ] **L6** Runtime check: `dotnet --list-runtimes` has a suitable `Microsoft.NETCore.App`, with a clear error and install link if not
- [ ] **L7** Engine runner: spawn with arguments (never through a shell, to avoid quoting and injection issues with connection strings), timeout and cancel, parse JSON, keep stderr for logs, redact connection strings
- [ ] **L8** Config I/O: load, validate against the schema (Ajv), write with minimal diff and preserved key order, create a new config from a template (defaults matching `CliConfigMapper` new-config defaults)
- [ ] **L9** `--generate` headless mode, with exit codes suitable for CI
- [ ] **L10** Unit tests for L2–L8

## Phase 3: GUI v1

### Server (`packages/efcpt-ui/src/server`)

- [ ] **S1** Local HTTP server bound to `127.0.0.1`, random port, per-session token (URL query, then a cookie), Origin/Host checks, serving the static SPA
- [ ] **S2** `GET /api/session`: config path, project, EF version, provider, connection source (never the value)
- [ ] **S3** `GET /api/configs` and `POST /api/configs` (list and create configs)
- [ ] **S4** `GET /api/objects`: discovery through E1, cached for the session, `?refresh=1` to reload
- [ ] **S5** `GET /api/config` and `PUT /api/config` (schema-validated)
- [ ] **S6** `POST /api/generate`: saves the config, runs the engine, and streams progress and the result over SSE
- [ ] **S7** `POST /api/connection/test` and `POST /api/connection` (in-memory only, optional save to user-secrets)
- [ ] **S8** Lifecycle: open the browser (`open` package), heartbeat, exit when the tab closes or on SIGINT

### Web (`packages/efcpt-ui/src/web`)

- [ ] **W1** App shell: header (project, config, EF version, provider), navigation between the steps, dark/light theme
- [ ] **W2** Config picker screen (several configs or none)
- [ ] **W3** Connection screen (shows the source, enter a value, test)
- [ ] **W4** Object tree: type → schema → object, tri-state checkboxes, search, select all/none, counts, virtualised for large DBs (1k+ objects)
- [ ] **W5** Column and index exclusion when a table is expanded (`excludedColumns` / `excludedIndexes`)
- [ ] **W6** Show existing `exclusionWildcard` rules and show which objects they affect. Basic add/remove
- [ ] **W7** Settings form generated from the schema: Names, File layout, Code generation, Type mappings, Replacements. Tooltips from the schema and the `samples/*.md` docs. Handle dependent fields (T4 ↔ T4 split/template path, dacpac-only options)
- [ ] **W8** "Save" and "Save & Generate" with an unsaved-changes indicator
- [ ] **W9** Run screen: live log, generated files grouped by folder, warnings/errors, missing NuGet packages with a copy/run `dotnet add package` action
- [ ] **W10** Keep behaviour in line with the VS view models (`PickTablesViewModel`, `ObjectTreeViewModel`, `ModelingOptionsModel`): write down any intentional differences

## Phase 4: Hardening and release

- [ ] **R1** Playwright end-to-end test: open the UI against the SQLite fixture, pick 3 tables, generate, `dotnet build` the sample project
- [ ] **R2** Check the config written by the UI gives identical output through the stock `efcpt -i`
- [ ] **R3** Security pass on the local server (token, CORS/Origin, path traversal on config paths, secret redaction)
- [ ] **R4** Package README: install, quick start, multi-config `package.json` scripts, connection options, troubleshooting
- [ ] **R5** Release workflow: build/publish engines for EF 8/9/10 → assemble the npm package → `npm publish --provenance`. Versioning scheme documented
- [ ] **R6** Update the root `README.md` of the fork to describe the standalone tool and credit upstream

## Phase 5: Stretch (unordered)

- [ ] **X1** Rename UI for tables and columns → `efpt.renaming.json` (passed with `-r`)
- [ ] **X2** Importer: VS `efpt.config.json` → `efcpt-config.json`
- [ ] **X3** Diff preview of generated files before writing (generate into a temp folder, then diff)
- [ ] **X4** Mermaid ER diagram preview (`generate-mermaid-diagram`)
- [ ] **X5** Build `.sqlproj` / MSBuild.Sdk.SqlProj with `dotnet build` and use the resulting `.dacpac`
- [ ] **X6** Engine download-on-demand with a local cache
- [ ] **X7** Ship the launcher as a `dotnet tool` too, for people without Node
- [ ] **X8** Remember UI state per config (last tab, tree expansion) in a gitignored `.efcpt-ui/` folder
