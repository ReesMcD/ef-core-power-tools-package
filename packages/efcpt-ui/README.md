# efcpt-ui: EF Core Power Tools UI

Reverse engineer a database into EF Core `DbContext` and entity classes from any .NET project, driven by an `efcpt-config.json`. No Visual Studio needed.

This is a fork of [EF Core Power Tools](https://github.com/ErikEJ/EFCorePowerTools) by ErikEJ (MIT). It is not the official tool.

> **Status: early.** The web UI, `--generate` and `--list` work, tested against SQL Server, PostgreSQL and SQLite. It is not on npm yet and engine downloads are not available yet: [try it from a checkout](#try-it-from-a-checkout).

## Try it from a checkout

Needs the .NET 10 SDK (plus the .NET 8 runtime for EF Core 8 or 9 projects) and Node 22 or newer. It runs from PowerShell, cmd, WSL, macOS and Linux.

**PowerShell or cmd**

```powershell
git clone https://github.com/ReesMcD/ef-core-power-tools-package.git
cd ef-core-power-tools-package
dotnet build src\Core\efcpt.10\efcpt.10.csproj -c Release   # the engine for your EF Core version: efcpt.8, efcpt.9 or efcpt.10
cd packages\efcpt-ui
npm ci
npm run build
npm link                                                    # puts efcpt-ui on your PATH

cd <your .NET project>
efcpt-ui                                                    # or: efcpt-ui --list
```

Connection strings in an environment variable: `$env:MY_DB = "Server=...;Integrated Security=True;TrustServerCertificate=True"` in PowerShell, `set "MY_DB=Server=...;Integrated Security=True;TrustServerCertificate=True"` in cmd, then `efcpt-ui --connection-env MY_DB`.

If PowerShell says _running scripts is disabled on this system_, your execution policy blocks the `efcpt-ui.ps1` launcher that npm creates. Run `efcpt-ui.cmd` instead, which works under any policy, or allow local scripts with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**WSL, macOS and Linux**

The same steps with `/` paths, and `export MY_DB="..."`. In WSL, efcpt-ui opens the UI in your Windows browser. A connection in the config's `efcpt-ui` section works there too: `appsettings` files are read from the project, and user secrets set with `dotnet user-secrets` on Windows are found. Windows environment variables are not visible in WSL unless you share them with `WSLENV`.

**Windows authentication** (`Integrated Security=True` / `Trusted_Connection=True`) needs efcpt-ui to run on Windows, from PowerShell or cmd. In WSL, efcpt-ui and the engine are Linux programs without your Windows login, so use WSL only with SQL logins. Keep one checkout per side: `npm ci` and `npm link` are per operating system.

efcpt-ui finds the engine built in the checkout by itself. Try it on a branch or a copy of your project: generating overwrites the output folder and removes files it generated before that are no longer needed (`soft-delete-obsolete-files`).

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

`npm run db:sales` opens the UI in your browser. Without `--config`, it uses the project's only config, or lets you pick one, create a new one, or import one from the Visual Studio extension.

### Coming from the Visual Studio extension

```bash
efcpt-ui --import-vs efpt.config.json
```

This writes `efcpt-config.json` next to `efpt.config.json` (`efpt.Sales.config.json` becomes `efcpt-config.Sales.json`) with the same selected objects and options, and leaves the original alone. The UI offers the same import. The result is the same code the extension generates: a CI test compares the two file by file.

- As in Visual Studio, only the imported objects are generated and new database objects are not added (`refresh-object-lists` is off). Tick new ones in the UI.
- `efpt.renaming.json` next to the config keeps working. A config specific `efpt.Sales.renaming.json` is carried over as `"efcpt-ui": { "renaming": "efpt.Sales.renaming.json" }`.
- The connection string is not in `efpt.config.json`; see [Connection strings](#connection-strings).
- Handlebars templates and "no default constructor" are not supported outside Visual Studio. Stored procedure calls are always async. The import warns about these.

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
3. The database provider comes from the project's EF Core provider package (for example `Npgsql.EntityFrameworkCore.PostgreSQL`), unless `--provider` or the config says otherwise.
4. If there is no config yet, efcpt-ui creates `efcpt-config.json` with the project's `RootNamespace`. A config without `names.root-namespace` or `names.dbcontext-name` gets them filled in, and says so.
5. The matching engine generates code into the project folder, using the config's `file-layout` settings, and adds every database object to the config.

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

The section can also name the renaming file, relative to the config: `"renaming": "efpt.Sales.renaming.json"` (default `efpt.renaming.json`).

### SQL Server

- **Local servers:** Microsoft.Data.SqlClient encrypts connections by default, so a local or Docker SQL Server with a self-signed certificate needs `TrustServerCertificate=True` in the connection string. efcpt-ui points this out when it's the problem, and explains other common connection errors too.
- **Windows authentication** works when efcpt-ui runs on Windows (PowerShell or cmd, not WSL), as the account running it (tested in CI against LocalDB). For example:

  ```text
  Server=sqlserver01;Database=Sales;Integrated Security=True;TrustServerCertificate=True
  Server=.\SQLEXPRESS;Database=Sales;Trusted_Connection=True;TrustServerCertificate=True
  Server=(localdb)\MSSQLLocalDB;Database=Sales;Trusted_Connection=True
  ```

  A Windows authentication connection string holds no password, so an `appsettings.Development.json` entry you already have is a fine place for it: `"efcpt-ui": { "connection": { "appsettings": "appsettings.Development.json", "key": "ConnectionStrings:Sales" } }`. If it fails, efcpt-ui says whether the account has no access, Kerberos couldn't get a ticket (VPN, server name, SPN), or your identity didn't reach the server. On macOS and Linux, use a SQL login or `Authentication=Active Directory Default` (Azure SQL) instead.

- **Database projects:** point at the built `.dacpac` instead of a database, with `--connection path/to/Database.dacpac` or `"efcpt-ui": { "connection": { "dacpac": "../Database/bin/Debug/Database.dacpac" } }`.
- **Spatial and hierarchyid columns** are skipped (with a warning) unless you turn on `use-spatial` / `use-HierarchyId` under Settings → Type mappings and add the `Microsoft.EntityFrameworkCore.SqlServer.NetTopologySuite` / `.HierarchyId` packages.
- **Stored procedures** whose result set can't be discovered (dynamic SQL) get a warning with options, for example `"use-legacy-resultset-discovery": true` on that procedure. Temp tables are handled by the fallback discovery.
- Tested in CI against SQL Server 2022 with triggers, sequences, temporal tables, filtered indexes, table-valued parameters, same-named tables in different schemas and C# keyword names. The generated code must build with warnings as errors.

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
3. an engine built in this repository, when efcpt-ui runs from a checkout (`src/Core/efcpt.<N>/bin/Release` or `Debug`)
4. the download cache (downloads are coming with the first release)
5. an `efcpt-ui-engine` dotnet tool on `PATH` built for the same EF Core version

Until downloads are available, build it from this repository: `dotnet build src/Core/efcpt.10/efcpt.10.csproj -c Release` (or `efcpt.8` / `efcpt.9`).

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

# end to end against the real engine, including dotnet build of the generated code, and parity with
# the Visual Studio extension's code generator (dotnet build src/Core/efreveng100/efreveng100.csproj -c Release)
EFCPT_UI_E2E_ENGINE=<path to efcpt.10.dll> EFCPT_UI_E2E_BUILD=1 \
  EFCPT_UI_E2E_REVENG=<path to efreveng100.dll> npx vitest run test/e2e.test.ts
```

Requires Node 22 or newer.
