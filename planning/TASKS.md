# Tasks

Checklist for the standalone effort. The phases match [PLAN.md](PLAN.md). IDs are stable, so they can be referenced from commits and PRs (for example `E4`).

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` dropped

All work happens in the fork `ReesMcD/ef-core-power-tools-package`: branches, PRs, CI and releases. Upstream `ErikEJ/EFCorePowerTools` is only pulled from.

## Phase 0: Foundations

- [x] **F0** Scoping: current-state report, scope, plan, tasks (`planning/`)
- [~] **F1** Decide the open questions in SCOPE.md: package/command name, engine distribution, UI stack, config formats, Node minimum, whether to upstream
  - Decided: package/command name `efcpt-ui` (engine: `ReesMcD.EFCorePowerTools.Engine` / `efcpt-ui-engine`), engine distribution (download on first use), fork-only, Node 22+. Still open: UI stack, config formats (recommendations in SCOPE)
- [x] **F2** GitHub Actions enabled on the fork and green: `cli-tool.yml` (engine tests + efcpt 8/9/10 + JSON smoke test), `vsix.yml` (VS extension build; file-count check updated to 113). Upstream publish/signing steps are skipped on the fork
- [x] **F3** Create the `packages/efcpt-ui/` workspace: TypeScript 6.0 (typescript-eslint doesn't support 7 yet), ESLint, Prettier, Vitest, `bin` entry, `npm pack` smoke test
- [x] **F4** TS types generated from `samples/efcpt-config.schema.json` (`npm run sync-schema`; committed, CI fails if stale via `npm run check-schema`)
- [~] **F5** Test fixtures: a sample .NET 10 project + SQLite DB (checked in) + a SQL Server docker compose (reuse `test/ScaffoldingTester` Northwind/Chinook scripts)
  - Done: `packages/efcpt-ui/test/fixtures/sample-project` (net10.0, EF Core SQLite 10.0.12, `shop.db`). Still to do: SQL Server fixture
- [x] **F6** Measure engine publish size for each EF version to settle AD-4. Result: 243 MB gzipped for all three, 42 MB for a trimmed single engine, so the plan is download on first use (see PLAN AD-4, ENGINE_INTERFACE.md)
- [x] **F8** Fork identity for the engine CLI: our own `PackageId` / `RepositoryUrl` / authors in `efcpt.8/9/10.csproj` (keep MIT attribution to ErikEJ). Disable or repoint `PackageService.CheckForPackageUpdateAsync`, which currently tells users to update to the official `ErikEJ.EFCorePowerTools.Cli`. Don't reuse the `efcpt` command name if it would clash with a globally installed official tool
  - Done: `PackageId` `ReesMcD.EFCorePowerTools.Engine`, command `efcpt-ui-engine`, fork URLs/authors (ErikEJ copyright kept), update check and header link point at the fork. Left for release (R4): the packaged `readme.md` still has the upstream install instructions
- [x] **F7** `.github/workflows/efcpt-ui.yml`: lint/format/schema check, typecheck, tests and pack-install-run on ubuntu, windows and macos; end-to-end job builds the EF Core 10 engine, generates from SQLite and compiles the result

## Phase 1: Engine JSON interface (`src/Core/efcpt.8`, shared by 9/10)

- [x] **E1** Add a `--list-objects` option to `ScaffoldOptions`. Add a new `ListObjectsHostedService` that runs `TableListBuilder` (tables/views + procedures + functions) and **doesn't** read, write or generate anything else
- [x] **E2** Add a `--json` option. When set, route `DisplayService` output to stderr or silence it, and write one JSON document to stdout:
  - list mode: `{ "objects": [TableModel...], "databaseType": ..., "efCoreVersion": ... }`
  - generate mode: `{ "result": ReverseEngineerResult, "configWarnings": [...], "readmePath": ..., "outputPaths": [...] }`
  - on error: `{ "success": false, "errors": [...] }`, exit code 1 (final shape: see ENGINE_INTERFACE.md)
- [x] **E3** Make sure a failed provider resolution (`Environment.Exit(1)` in `Program.ResolveProvider`) also produces JSON errors when `--json` is set
- [x] **E4** Add `[JsonExtensionData] Dictionary<string, JsonElement>` to `RevEng.Common.Cli.Configuration.CliConfig` so unknown sections survive a rewrite. Keep the incoming `$schema` value instead of the hardcoded upstream URL
- [ ] **E5** Add a `--no-config-write` option (skip the `File.WriteAllText` in `CliConfigMapper.TryGetCliConfig`) for runs started by the UI
- [x] **E6** Tests: 9 xUnit tests in `src/Core/NUnitTestCore/CliJsonOutputTest.cs` (JSON contract, config round-trip incl. the `TryGetCliConfig` rewrite path) + end-to-end `tools/cli-json-smoke-test.sh` against SQLite, run in CI for EF 8/9/10
- [x] **E7** Update `src/Core/efcpt.8/readme.md` with the new options
- [x] **E9** Fix upstream bugs found along the way: connection failures silently exited 0; an unreadable config file made the CLI hang; unknown provider gave a misleading second error
- [-] **E8** ~~Open an upstream PR~~ Dropped: all work stays in the fork

## Phase 2: Launcher and headless path (`packages/efcpt-ui`)

- [x] **L1** CLI argument parsing (`node:util` parseArgs): `--config`, `--project`, `--connection`, `--connection-env`, `--provider`, `--port`, `--no-open`, `--generate`, `--list`, `--engine`, `--verbose`, `--help`, `--version`. `--port`/`--no-open` are parsed for the UI (Phase 3)
- [x] **L2** Config discovery: `efcpt-config.json`, `efcpt-config.*.json`, `*.efcpt.json` (not `*.schema.json`) under the project, skipping `bin/`, `obj/`, `node_modules/`, `.git/`. Several configs → asks for `--config` (UI picker in Phase 3)
- [x] **L3** Project discovery: nearest folder at or above the config with exactly one `.csproj`. Reads `RootNamespace`, `TargetFramework(s)`, `UserSecretsId`, and the EF version from `Microsoft.EntityFrameworkCore*` (then Npgsql/Pomelo/Oracle/Firebird providers), incl. `Directory.Packages.props`, `VersionOverride`, `$(Property)` values; falls back to the target framework. EF < 8 rejected, > 10 uses the 10 engine with a warning
- [~] **L4** Connection resolution in order: flag → `--connection-env` → `EFCPT_CONNECTION` → `efcpt-ui.connection` section (`env` / `user-secrets` / `appsettings` with JSONC comments / `dacpac`). Reads secrets.json directly. Still to do: the UI prompt (Phase 3)
- [~] **L5** Engine locator: `--engine` (.dll via dotnet, .js/.mjs via node, else executable) → `EFCPT_UI_ENGINE` → download cache → `efcpt-ui-engine` on PATH if built for the same EF version (checked with `--version`). Still to do: the download itself (needs release assets, R5)
- [x] **L6** Runtime check: `dotnet --list-runtimes` must have .NET 8+ (EF 8/9 engines) or .NET 10+ (EF 10), with a clear error and install link
- [x] **L7** Engine runner: no shell, timeout, abort signal, parses the single JSON line, checks `schemaVersion`, streams stderr as progress, redacts connection strings and password-like values everywhere
- [~] **L8** Config I/O: load (BOM), schema validation with Ajv draft-04 (type errors only: efcpt has defaults for every "required" option), write keeping key order, indentation, line endings and BOM. Selection logic mirrors the engine including `refresh-object-lists` (on by default). Still to do: creating a new config from a template (Phase 3; with a sensible `dbcontext-name`, see X9)
- [x] **L9** `--generate` headless mode (exit codes 0 / 1 generation failed / 2 setup problem) and `--list` (objects with what the next generate will create)
- [x] **L10** 56 unit tests (fake engine, runs on all OSes) + end-to-end test against the real engine incl. `dotnet build` of the generated code

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
- [ ] **R5** Release workflow: publish trimmed engines (EF 8/9/10 × win-x64, win-arm64, osx-arm64, osx-x64, linux-x64, linux-arm64) as GitHub Release assets with checksums → `npm publish --provenance`. Versioning scheme documented
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
- [ ] **X9** When a config is new (or has no `names.dbcontext-name`), suggest a DbContext name from the project/database: the engine otherwise derives it from the connection string, which for SQLite file paths gives names like `tmpcachedbshopdbContext`
