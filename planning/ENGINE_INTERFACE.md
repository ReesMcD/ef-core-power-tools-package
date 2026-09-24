# Engine Interface (efcpt `--list-objects` / `--json`)

How the npm package talks to the .NET engine, plus the rules the UI has to follow so it agrees with what the CLI generates. Built and verified in Phase 1 (tasks E1–E4, E6, E7). The user-facing summary is in `src/Core/efcpt.8/readme.md`.

## Invocation

Always spawn **without a shell** (`spawn('dotnet', [engineDll, ...args])`), so connection strings are passed through untouched.

| Purpose | Arguments | Side effects |
| --- | --- | --- |
| Discover objects | `<conn> [provider] --list-objects --json [-i config]` | None. Doesn't write the config or any code. `-i` is read only for `merge-dacpacs` |
| Generate | `<conn> [provider] -i <config> [-o <outdir>] [-r <renaming>] --json` | Writes code, readme, T4 templates. **Rewrites the config** if the file doesn't exist yet or `refresh-object-lists` is `true` |

- stdout: exactly **one line** of JSON. stderr: human-readable progress (can be streamed to the UI log).
- Exit code: `0` success, `1` failure. On failure there's still a JSON document with `success: false` and `errors`.
- The provider can be left out only when it can be inferred from the connection string. The UI should always pass it.
- Reference implementation: `planning/spikes/list-objects.mjs`. Test: `tools/cli-json-smoke-test.sh`.

## Document shape (`schemaVersion: 1`)

```jsonc
// common to every document
{ "schemaVersion": 1, "command": "list-objects" | "generate", "success": true, "errors": [], "warnings": [] }

// list-objects adds
{ "efCoreVersion": 10, "databaseType": "SQLServer",
  "objects": [ { "displayName": "[dbo].[Users]", "schema": "dbo", "name": "Users",
                 "type": "table" | "view" | "storedProcedure" | "function",
                 "columns": [ { "name": "Id", "storeType": "int", "isPrimaryKey": true, "isForeignKey": false } ] } ] }

// generate adds
{ "efCoreVersion": 10, "databaseType": "SQLite", "configPath": "...", "contextFilePath": "...",
  "contextConfigurationFilePaths": [], "entityTypeFilePaths": [], "outputFolders": [],
  "readmePath": "...", "diagramPath": "..." /* only with generate-mermaid-diagram */ }
```

- `schema` is left out when the provider has no schemas (SQLite). `columns` may be left out for procedures and functions.
- `databaseType` is the `RevEng.Common.DatabaseType` enum name: `SQLServer`, `SQLServerDacpac`, `SQLite`, `Npgsql`, `Mysql`, `Oracle`, `Firebird`, `Snowflake`.
- On `generate`, `success` is `false` when the engine reports entity errors, even though the exit code is `0` (files may still have been written).
- Contract types live in `src/GUI/RevEng.Shared/Cli/CliJsonOutput.cs`. Any breaking change bumps `schemaVersion`.

## Rules the UI must follow

1. **Match objects to config entries by `displayName`.** That's the `name` the CLI writes and reads in `tables` / `views` / `stored-procedures` / `functions`. The format depends on the provider: `[schema].[name]` for SQL Server and dacpac, `schema.name` or just `name` for others.
2. **Selection semantics** (mirrors `CliConfigMapper.ExclusionFilter`; implemented and verified in the spike):
   - An object with **no entry** in the config is **not** generated.
   - `exclusionWildcard: "*"` in a section excludes everything except entries with an explicit `"exclude": false`.
   - Other wildcards: `abc*` starts-with, `*xyz` ends-with, `*mno*` contains. Case-sensitive, matched on `displayName`. A `*` in the middle of the pattern is ignored.
   - An explicit `"exclude": false` beats any wildcard. Otherwise the object is generated unless `"exclude": true`.
3. **Config files written by efcpt start with a UTF-8 BOM.** Strip it before `JSON.parse`. Writing without a BOM is fine; the CLI reads both.
4. **The CLI reorders keys when it rewrites the config** (`$schema`, `code-generation`, `file-layout`, `names`, `tables`, …, then unknown sections). The UI should write in the same order so diffs stay small.
5. Unknown **top-level** sections (for example `efcpt-ui`) survive rewrites. Unknown keys **inside** known sections (for example inside `code-generation`) do **not**. Keep UI metadata at the top level.
6. Only `efcpt-config.json` is the source of truth. `--list-objects` has no side effects, so it's safe to call repeatedly (cache it per session anyway: large databases can take several seconds).

## Engine behaviour fixed along the way

These were bugs in the upstream code, found while building this and fixed in the fork only:

- A failing connection (for example an unreadable database) was **silently ignored with exit code 0**, because the hosted service exception was swallowed. It's now reported, with exit code 1.
- An unreadable config file made the CLI **hang forever** after printing the error (no hosted service was registered to stop the host). It now exits with code 1.
- An unknown provider reported a second, misleading "unsupported database type: Undefined" error. It now reports one clear error.
- `$schema` in the config was always reset to the upstream URL. It's now kept.

Also observed: when stdout is **redirected** (not a terminal), the normal human output mostly disappears. That's Spectre.Console behaviour. It's one more reason to rely on `--json` and not scrape text.

## Engine size (task F6), measured 2026-09-24

| Build | On disk | gzipped |
| --- | --- | --- |
| efcpt.8, framework-dependent, all platforms and languages | 276 MB | 83 MB |
| efcpt.9, same | 278 MB | 84 MB |
| efcpt.10, same | 261 MB | 76 MB |
| All three together | — | 243 MB |
| efcpt.10, `-r linux-x64 -p:SatelliteResourceLanguages=en` | 123 MB | 42 MB |

The biggest parts are 13 satellite language folders (74 MB), native `runtimes/` for every platform (104 MB), and `libmsalruntime.so` (37 MB, Azure AD auth via SqlClient). The trimmed build passes the full smoke test. See PLAN AD-4 for what this means for distribution.
