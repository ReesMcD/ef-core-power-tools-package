# efcpt-ui: EF Core Power Tools UI

Reverse engineer a database into EF Core `DbContext` and entity classes from any .NET project, driven by an `efcpt-config.json`. No Visual Studio needed.

This is a fork of [EF Core Power Tools](https://github.com/ErikEJ/EFCorePowerTools) by ErikEJ (MIT). It is not the official tool.

> **Status: early.** The web UI, `--generate` and `--list` work. Engine downloads are not available yet, so you need to build the engine once (see [Engine](#engine)).

## Quick start

```bash
npm i -D efcpt-ui
```

In `package.json`, one script per config (a project can have several):

```json
"scripts": {
  "db:sales": "efcpt-ui --config ./Data/Sales/efcpt-config.json",
  "db:sales:generate": "efcpt-ui --config ./Data/Sales/efcpt-config.json --generate"
}
```

`npm run db:sales` opens the UI in your browser. Without `--config`, it uses the project's only config, or lets you pick one or create a new one.

### The UI

- **Objects**: tables, views, stored procedures and functions, grouped by schema. Tick what to generate, filter by name, select whole groups, expand a table or view to leave out single columns, and add or remove exclusion rules such as `*Log`.
- **Settings**: the config's options (names, file layout, code generation, type mappings, uncountable words). Options you don't change stay out of the file and keep the engine's defaults. Irregular words and plural/singular rules are edited in the file.
- **Generate**: saves and runs the engine, showing the generated files, warnings and errors.
- If no connection string is configured, the UI asks for one. It is kept in memory only, never written to disk.

The UI runs on `127.0.0.1` only, behind a one-time token in the URL it prints. It stops when you close the tab or press Ctrl+C. Use `--no-open` to not open a browser and `--port` to choose the port.

### Without the UI

```bash
export SALES_DB="Server=.;Database=Sales;Trusted_Connection=True;Encrypt=false"
npm run db:sales:generate
```

What happens:

1. The project is the nearest `.csproj` at or above the config (or `--project`).
2. The EF Core version (8, 9 or 10) comes from the project's `Microsoft.EntityFrameworkCore*` package reference, including central package management. Without one, it comes from the target framework.
3. The matching engine generates code into the project folder, using the config's `file-layout` settings.
4. If the config file doesn't exist yet, the engine creates it, listing every database object.

## Connection strings

Connection strings are never stored in `efcpt-config.json`. They are looked up in this order:

1. `--connection "<connection string or path to .dacpac>"`
2. `--connection-env MY_VAR`
3. the `EFCPT_CONNECTION` environment variable
4. an `efcpt-ui` section in the config file that says where to read it from:

```jsonc
{
  "efcpt-ui": {
    "provider": "mssql", // optional, usually inferred
    "connection": { "env": "SALES_DB" }, // environment variable
    // or { "user-secrets": "ConnectionStrings:Sales" }         // dotnet user-secrets of the project
    // or { "appsettings": "appsettings.Development.json", "key": "ConnectionStrings:Sales" }
    // or { "dacpac": "../Database/bin/Debug/Database.dacpac" }
  },
}
```

Paths in this section are relative to the project folder. The engine keeps this section when it rewrites the config.

## Choosing objects

`--list` shows every table, view, stored procedure and function, and marks the ones the next `--generate` will create:

```
tables:
  [ ] AuditLog  (Id*, Message)
  [x] Customers  (Id*, Name, Email)
```

The rules follow the engine exactly. With `refresh-object-lists` on (the default), new database objects are added and generated. Use `"exclude": true` on an entry or `exclusionWildcard` patterns to leave objects out. See the [efcpt config documentation](https://github.com/ReesMcD/ef-core-power-tools-package/blob/master/src/Core/efcpt.8/readme.md).

## Engine

efcpt-ui runs a .NET engine (a fork of the `efcpt` CLI with a JSON interface) matching the project's EF Core version. It looks for it in this order:

1. `--engine <path>` (`efcpt.<N>.dll` or an executable)
2. the `EFCPT_UI_ENGINE` environment variable
3. the download cache (downloads are coming with the first release)
4. an `efcpt-ui-engine` dotnet tool on `PATH` built for the same EF Core version

Until downloads are available, build it from this repository:

```bash
dotnet build src/Core/efcpt.10/efcpt.10.csproj -c Release   # or efcpt.8 / efcpt.9
export EFCPT_UI_ENGINE=$PWD/src/Core/efcpt.10/bin/Release/net10.0/efcpt.10.dll
```

The engine needs the .NET 8 runtime (EF Core 8 and 9) or the .NET 10 runtime (EF Core 10), or newer.

## Options

Run `efcpt-ui --help`. Exit codes: `0` success, `1` generation failed, `2` usage or setup problem.

## Development

```bash
cd packages/efcpt-ui
npm ci
npm test            # unit tests (fake engine)
npm run build && npm run test:ui   # browser tests of the web UI (Playwright)
npm run lint && npm run format:check && npm run typecheck
npm run sync-schema # after changing samples/efcpt-config.schema.json

# end to end against the real engine, including dotnet build of the generated code
EFCPT_UI_E2E_ENGINE=<path to efcpt.10.dll> EFCPT_UI_E2E_BUILD=1 npx vitest run test/e2e.test.ts
```

Requires Node 22 or newer.
