# Project Scope: Standalone EF Core Power Tools

## Problem

EF Core Power Tools' reverse-engineering GUI (pick tables, set naming and code-gen options, generate DbContext and entities) only exists as a **Visual Studio for Windows extension**. People using VS Code, Rider, or macOS/Linux only get the headless `efcpt` CLI, where choosing tables means hand-editing a large JSON file.

## Goal

A **standalone, cross-platform tool** that:

1. Installs and runs from **npm**, from inside any .NET project.
2. Targets a **specific config file** (`efcpt-config.json`). A project can have **several**, for example one per DbContext or database.
3. Opens a **GUI** to choose tables, views, procedures and functions, and to edit code-generation settings. It then saves the config and generates the code.
4. Works **without Visual Studio**. It depends only on the .NET SDK/runtime (already present in any .NET project) and Node.

## Target user workflow

```bash
# once per machine or repo
npm i -D efcpt-ui           # name TBD, see open questions

# in package.json
"scripts": {
  "db:sales":   "efcpt-ui --config ./Data/Sales/efcpt-config.json",
  "db:billing": "efcpt-ui --config ./Data/Billing/efcpt-config.json"
}

npm run db:sales
```

1. The launcher resolves the config file and the target `.csproj` (nearest one above the config, or `--project`).
2. It works out the EF Core major version (8/9/10) from the project's package references.
3. It resolves the connection string (see [Connection strings](#connection-strings)).
4. It starts a local server on `127.0.0.1:<random port>` and opens the browser.
5. The UI shows the database objects as a tree, with the current selection loaded from the config, and the settings as a form.
6. The user clicks **Save** (writes the config only) or **Save & Generate** (writes the config, runs generation, and shows the output files, warnings and errors).
7. There's also a headless path: `efcpt-ui --config ... --generate` (or just use `efcpt`) for CI and scripts.

## In scope (v1)

| Area | Requirement |
| --- | --- |
| Launch | `npx efcpt-ui [--config <path>] [--project <csproj>] [--connection <str> \| --connection-env <VAR>] [--port <n>] [--no-open] [--generate]` |
| Multiple configs | If `--config` is left out, find all `efcpt-config*.json` / `*.efcpt.json` files under the project and let the user pick one in the UI (the same idea as the VS "Pick config" dialog) |
| Object selection | Tree grouped by type (tables, views, stored procedures, functions) then schema. Tri-state checkboxes, search/filter, select all/none. Selection saved as the `exclude` flags in the config. Existing wildcard `exclusionWildcard` entries are kept |
| Column/index exclusion | Expand a table to exclude single columns or indexes. The config already supports this (`excludedColumns`, `excludedIndexes`) |
| Settings | Form covering the `efcpt-config.json` schema: `names`, `file-layout`, `code-generation`, `type-mappings`, `replacements`. Tooltips come from the schema/sample docs |
| Generation | Runs the engine for the right EF Core version, streams progress, and shows generated paths, warnings and errors |
| Providers | Everything `efcpt` supports: SQL Server, `.dacpac`, PostgreSQL, SQLite, MySQL, Oracle, Firebird, Snowflake |
| NuGet guidance | After generating, list the provider packages the project is missing and offer to run `dotnet add package` |
| Cross-platform | Windows, macOS, Linux |
| Config compatibility | The files we write must stay valid for the stock `efcpt` CLI (no breaking format changes) |

## Out of scope (v1)

- Parity with the VS extension's other features: DGML/model diagrams, ER diagrams, Data API Builder, schema compare, dacpac analyzer, migrations UI, item templates.
- Handlebars templates (the CLI doesn't support them either; T4 is supported).
- Visual Studio Server Explorer / DDEX connection reuse, and Windows Credential Manager integration.
- Building `.sqlproj` projects from the UI. v1 accepts a built `.dacpac` path. (Stretch goal: `dotnet build` of an MSBuild.Sdk.SqlProj project.)
- Hosted or remote use. The server is local-only.
- Replacing or removing the VS extension. The fork keeps building it. We add alongside it and don't fork the engine.

## Stretch (v1.x)

- Per-column and per-table **rename** (the VS "Pick tables" rename feature), written to `efpt.renaming.json` (already supported by `efcpt -r`).
- Import an existing VS `efpt.config.json` and convert it to `efcpt-config.json`.
- Diff preview before overwriting generated files.
- Mermaid ER diagram preview (`generate-mermaid-diagram` already exists in the CLI).
- A `dotnet tool` distribution of the launcher for people who don't want Node.

## Target architecture

```
┌──────────── npm package: efcpt-ui (Node/TS) ──────────────┐
│ bin/efcpt-ui  -> arg parsing, csproj + EF version detect, │
│                  connection resolution, start server      │
│ server/       -> local HTTP API (127.0.0.1 + session      │
│                  token), config read/write + validation   │
│ web/          -> SPA (object tree, settings form, run log)│
└───────────────┬───────────────────────────────────────────┘
                │ spawn (JSON over stdout)
                ▼
┌──────── .NET engine CLI (this repo's efcpt.8/9/10, extended) ─────────┐
│ efcpt <conn> [provider] --list-objects --json -> List<TableModel>     │   NEW flag
│ efcpt <conn> [provider] -i cfg --json   -> ReverseEngineerResult JSON │   NEW flag
│ efcpt <conn> [provider] -i cfg          -> unchanged behaviour        │
└───────────────┬───────────────────────────────────────────────────────┘
                ▼
        RevEng.Core.{80,90,100}  (unchanged)
```

Key decisions (full reasoning in [PLAN.md](PLAN.md#architecture-decisions)):

- **Node orchestrates, .NET does the database work.** The engine has to be .NET because it uses EF Core's scaffolding. We add a small, stable JSON interface to the existing `efcpt` CLI rather than inventing a new host.
- **Web UI, not a desktop framework.** It's cross-platform with nothing extra to install, since the browser is already there.
- **`efcpt-config.json` is the source of truth.** The UI is just an editor for it plus a runner. Anything the UI can do, the CLI can reproduce.

## Connection strings

`efcpt-config.json` deliberately doesn't hold the connection string. The resolution order we'll use:

1. `--connection "<str>"` flag
2. `--connection-env VAR` flag, or `EFCPT_CONNECTION` env var
3. An optional `efcpt-ui` section in the config file that points at a secret instead of containing it, for example:
   ```json
   "efcpt-ui": { "connection": { "user-secrets": "ConnectionStrings:Sales" } }
   ```
   Also supported: `{ "env": "SALES_DB" }`, `{ "appsettings": "appsettings.Development.json", "key": "ConnectionStrings:Sales" }`, `{ "dacpac": "../Db/bin/Db.dacpac" }`.
4. Typed into the UI. Kept in memory only, unless the user explicitly saves it to user-secrets.

We never write a plain-text connection string into `efcpt-config.json`.

> ⚠️ Found during scoping: today, when `efcpt` rewrites the config (first run, or `refresh-object-lists: true`), it re-serializes `CliConfig`. That **drops any unknown section**, including an `efcpt-ui` block, and resets `$schema` to the upstream URL. Option 3 therefore needs a small engine change: `[JsonExtensionData]` on `CliConfig` (task E4). The fallback is a sidecar file (`efcpt-config.ui.json`) next to the config.

## Non-functional requirements

- **Security:** bind to `127.0.0.1` only, with a random per-session token in the URL. Reject any other origin. Connection strings never go in logs or files.
- **Speed:** the UI should open in under 3 s. Object discovery and generation are limited by the engine (a few seconds for typical DBs).
- **Low maintenance:** keep upstream merges cheap. .NET changes are additive and small.
- **Tests:** unit tests for the config read/write round-trip (no lost fields, comments preserved where possible) and a SQLite end-to-end test in CI on Linux.

## Open questions (need a decision)

1. **Package and command name.** `efcpt-ui`? Something new? Avoid implying it's the official EF Core Power Tools.
2. **Engine distribution.** Options: (a) require the user to install our fork's `efcpt` as a dotnet tool, (b) ship prebuilt framework-dependent engine binaries inside the npm package (~tens of MB for each EF version), (c) download on first run. Recommendation: **(b) for v1** (one install, works offline), with (c) as a later size optimisation.
3. **Upstream contribution.** Do we try to upstream the `efcpt list --json` / `--json` changes to ErikEJ? That would let us use the official NuGet tool and drop our fork of the engine. Recommendation: yes, try it. They're small and generally useful.
4. **UI stack.** Recommendation: Vite + React + TypeScript (largest ecosystem, tree/form components readily available). Svelte would also be fine.
5. **Config file naming.** Should we support `efpt.*config.json` (VS format) in v1 or only `efcpt-config.json`? Recommendation: `efcpt-config.json` only in v1, with an importer as a stretch goal.
6. **Minimum Node version.** Recommendation: Node 20 LTS+.

## Success criteria

- From a fresh clone of a sample .NET 10 web API with a SQL Server or SQLite DB, `npm i -D efcpt-ui && npx efcpt-ui --config ./efcpt-config.json` opens the UI, lets you pick 3 tables, and generates a DbContext and entities that compile. Tested on Windows, macOS and Linux.
- The config it writes gives identical output when run through the stock `efcpt` CLI.
- Two configs in one project can be managed independently.
