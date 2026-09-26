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
- [x] **F5** Test fixtures: a sample .NET 10 project + SQLite DB (checked in), a SQL Server schema script (`packages/efcpt-ui/test/fixtures/mssql/tricky.sql`) run in a CI service container
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
- [x] **L8** Config I/O: load (BOM), schema validation with Ajv draft-04 (type errors only: efcpt has defaults for every "required" option), write keeping key order, indentation, line endings and BOM. Selection logic mirrors the engine including `refresh-object-lists` (on by default). New configs come from a template (`src/config/template.ts`)
- [x] **L9** `--generate` headless mode (exit codes 0 / 1 generation failed / 2 setup problem) and `--list` (objects with what the next generate will create)
- [x] **L10** 56 unit tests (fake engine, runs on all OSes) + end-to-end test against the real engine incl. `dotnet build` of the generated code

## Phase 3: GUI v1

### Server (`packages/efcpt-ui/src/server`)

- [x] **S1** Local HTTP server (`node:http`) on `127.0.0.1`, free port or `--port`. One-time token in the URL → HttpOnly SameSite=Strict cookie (name includes the port). Host check (DNS rebinding), Origin check and `x-efcpt-ui` header on the API, CSP, no path traversal. Every JSON response and stream event is deep-redacted
- [x] **S2** `GET /api/session`: config, configs in the project, project, EF version, provider, connection *source* (never the value), warnings
- [x] **S3** `POST /api/session` switches config; a path that doesn't exist yet creates a config from a template (DbContext name from the database/file name or the project, root namespace, `efcpt-ui` section copied from the current config)
- [x] **S4** `GET /api/objects`: discovery through the engine, cached per config/connection, `?refresh=1` to reload
- [x] **S5** `GET /api/config` and `PUT /api/config` (type errors rejected with details; formatting preserved)
- [x] **S6** `POST /api/generate`: runs the engine on the saved config and streams progress and the result as newline-delimited JSON; reloads the config afterwards (the engine may update the object lists)
- [~] **S7** `POST /api/connection`: a connection typed in the UI is tested by reading the database and kept in memory only. Still to do: optional save to user-secrets
- [x] **S8** Lifecycle: opens the browser (no dependency), heartbeat every 10 s, stops 15 s after the tab closes (unless reloaded), after 60 s without heartbeat, or on Ctrl+C

### Web (`packages/efcpt-ui/src/web`)

- [x] **W1** App shell: header (project, EF version, config picker, connection source), tabs Objects / Settings / Generate, light/dark from the OS
- [x] **W2** Config picker (several configs or none) and "New config…" in the header
- [x] **W3** Connection panel (shows the source, enter a value, provider, test by connecting, hint for the `efcpt-ui` section)
- [~] **W4** Object tree: type → schema → object, tri-state group checkboxes, filter, select all/none (of what's shown), counts. Large schemas (>150 objects) start collapsed. Still to do: true virtualisation for very large databases, regex filter (the VS extension has one)
- [~] **W5** Column exclusion for tables and views (`excludedColumns`; primary keys can't be excluded). Still to do: `excludedIndexes` (the engine's object list doesn't include indexes yet)
- [x] **W6** Exclusion rules (`exclusionWildcard`) per section: shown, added, removed; the checkboxes follow them
- [x] **W7** Settings form generated from the schema with the engine's real defaults (the schema's are incomplete: `use-nullable-reference-types` defaults to true, `use-typed-tvp-parameters` is missing). Unchanged options stay out of the file; "default" removes one. Dependent options: T4 template path, T4 vs EntityTypeConfiguration T4 vs Split DbContext, merge-dacpacs. Irregular words and plural/singular rules are edited in the file
- [x] **W8** Save / Save & Generate with an unsaved-changes indicator and a warning when leaving the page
- [~] **W9** Generate tab: engine output, generated files grouped by folder, warnings/errors, readme link. Still to do: missing NuGet packages with a `dotnet add package` action
- [x] **W10** Compared with the VS extension (`PickTablesViewModel`, `ObjectTreeViewModel`, `ModelingOptionsModel`); intentional differences are listed below

### Differences from the Visual Studio extension (W10)

- **Config format:** the UI edits `efcpt-config.json` (the CLI format), not the extension's `efpt.config.json`. `--import-vs` and the UI convert one (X2).
- **Options not in `efcpt-config.json`** (so not in the UI): Handlebars templates, "no default constructor" and "install NuGet packages". "No object filter" imports as `refresh-object-lists`. `IncludeConnectionString` is `enable-on-configuring`.
- **Renaming** tables and columns (`efpt.renaming.json`) is X1. The engine already applies an existing renaming file.
- **Search** is plain text; the extension also has a regex mode.
- **Connections** come from the config's `efcpt-ui` section, environment, user secrets or appsettings rather than Server Explorer, and are never stored by the UI.

## Phase 4: Hardening and release

- [ ] **R1** Playwright end-to-end test: open the UI against the SQLite fixture, pick 3 tables, generate, `dotnet build` the sample project
- [ ] **R2** Check the config written by the UI gives identical output through the stock `efcpt -i`
- [x] **R7** Pre-test hardening against real databases (SQL Server 2022 in Docker with EF 8 and 10, PostgreSQL 16, 1,500 tables): fixed the provider not being inferred (Postgres vs Firebird), `namespace .Models;` when a config has no root namespace, `--list` refusing to run without a config, crashes on EPIPE; engines built in a checkout are found automatically
- [x] **R9** SQL Server focus: EF 8/9/10 against a schema with triggers, sequences, spatial/hierarchyid, XML, sql_variant, filtered indexes, keyless tables, same-named tables across schemas, C# keyword names, temp-table/dynamic-SQL/multi-result/TVP procedures and functions; `.dacpac` (sqlpackage extract and AdventureWorks2014); appsettings and user-secrets connections. Fixed a nullable warning in the generated TVP helper (broke `TreatWarningsAsErrors` builds, also in the VS extension); added plain-language hints for certificate, Windows auth, login, database and server errors. CI runs this against a SQL Server 2022 service container
- [x] **R8** Parity with the VS extension: an imported `efpt.config.json` generates byte-identical code to the extension's generator (`efreveng100`); checked in CI on SQLite, and by hand on SQL Server with two option sets
- [ ] **R3** Security pass on the local server (token, CORS/Origin, path traversal on config paths, secret redaction)
- [ ] **R4** Package README: install, quick start, multi-config `package.json` scripts, connection options, troubleshooting
- [ ] **R5** Release workflow: publish trimmed engines (EF 8/9/10 × win-x64, win-arm64, osx-arm64, osx-x64, linux-x64, linux-arm64) as GitHub Release assets with checksums → `npm publish --provenance`. Versioning scheme documented
- [ ] **R6** Update the root `README.md` of the fork to describe the standalone tool and credit upstream

## Phase 5: Stretch (unordered)

- [ ] **X1** Rename UI for tables and columns → `efpt.renaming.json` (passed with `-r`)
- [x] **X2** Importer: VS `efpt.config.json` → `efcpt-config.json` (`--import-vs`, and in the UI's config picker)
- [ ] **X3** Diff preview of generated files before writing (generate into a temp folder, then diff)
- [ ] **X4** Mermaid ER diagram preview (`generate-mermaid-diagram`)
- [ ] **X5** Build `.sqlproj` / MSBuild.Sdk.SqlProj with `dotnet build` and use the resulting `.dacpac`
- [ ] **X6** Engine download-on-demand with a local cache
- [ ] **X7** Ship the launcher as a `dotnet tool` too, for people without Node
- [ ] **X8** Remember UI state per config (last tab, tree expansion) in a gitignored `.efcpt-ui/` folder
- [x] **X9** New configs created from the UI get a DbContext name from the database or file name (or the project), instead of the engine's name derived from the whole `Data Source` path
