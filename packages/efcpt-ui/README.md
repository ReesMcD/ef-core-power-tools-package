# efcpt-ui: EF Core Power Tools UI

Reverse engineer a database into EF Core `DbContext` and entity classes from any .NET project, driven by an `efcpt-config.json`. No Visual Studio needed.

This is a fork of [EF Core Power Tools](https://github.com/ErikEJ/EFCorePowerTools) by ErikEJ (MIT). It is not the official tool.

> **Status: early.** The web UI, `--generate` and `--list` work, tested against SQL Server (including Windows authentication), PostgreSQL and SQLite. It is not on npm yet and engine downloads are not available yet, so you install it from this repository (below).

## Getting started

Six steps, each with commands to copy and paste. Pick the block for your shell.

| Where you run it      | Shells          | SQL Server sign-in                                                    |
| --------------------- | --------------- | --------------------------------------------------------------------- |
| Windows               | cmd, PowerShell | SQL login, Windows authentication or Microsoft Entra ID               |
| WSL (or Linux, macOS) | bash, zsh, fish | SQL login or Microsoft Entra ID. Windows authentication needs Windows |

Install it separately on each side you use, because the build is per operating system. Try it on a branch of your project first: generating overwrites the output folder and removes files it generated before that are no longer needed.

### 1. Prerequisites

You need git, the .NET 10 SDK, the .NET 8 runtime (only for EF Core 8 or 9 projects) and Node 22 or newer.

#### Windows

In cmd or PowerShell:

```cmd
winget install Git.Git
winget install Microsoft.DotNet.SDK.10
winget install Microsoft.DotNet.Runtime.8
```

Then Node, one of:

- **Plain Node** (simplest):

  ```cmd
  winget install OpenJS.NodeJS.LTS
  ```

- **nvm-windows**: install it, then open a new window **as administrator** (`nvm use` needs it):

  ```cmd
  winget install CoreyButler.NVMforWindows
  ```

  ```cmd
  nvm install 22
  nvm use 22
  ```

asdf doesn't run on Windows. Close the window and open a new one so the new programs are on your PATH, then check:

```cmd
node --version
dotnet --list-runtimes
```

#### WSL

In bash, zsh or fish:

```bash
sudo apt update && sudo apt install -y git dotnet-sdk-10.0 dotnet-runtime-8.0
```

If apt can't find `dotnet-sdk-10.0`, follow [Microsoft's .NET install guide](https://learn.microsoft.com/dotnet/core/install/linux) for your distribution. Ubuntu's own Node is too old, so install Node with asdf or nvm. Skip this if `node --version` already shows v22 or newer.

**asdf** ([install asdf](https://asdf-vm.com/guide/getting-started.html) first):

```bash
# bash or zsh
asdf plugin add nodejs
v=$(asdf latest nodejs 22)
asdf install nodejs $v
asdf set --home nodejs $v     # asdf before 0.16: asdf global nodejs $v
```

```fish
# fish
asdf plugin add nodejs
set v (asdf latest nodejs 22)
asdf install nodejs $v
asdf set --home nodejs $v     # asdf before 0.16: asdf global nodejs $v
```

**nvm**:

```bash
# bash or zsh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
exec $SHELL                   # reload the shell so nvm is available
nvm install 22
nvm alias default 22
```

```fish
# fish: nvm.fish, installed with fisher
curl -sL https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish | source && fisher install jorgebucaran/fisher
fisher install jorgebucaran/nvm.fish
nvm install 22
set --universal nvm_default_version 22
```

Check:

```bash
node --version
dotnet --list-runtimes
```

### 2. Install efcpt-ui

This clones the repository into your home folder and builds the engines for EF Core 8, 9 and 10. Building all three is the simplest; you only need the ones your projects use.

**Windows, cmd:**

```cmd
cd /d %USERPROFILE%
git clone https://github.com/ReesMcD/ef-core-power-tools-package.git
cd ef-core-power-tools-package
dotnet build src\Core\efcpt.8\efcpt.8.csproj -c Release
dotnet build src\Core\efcpt.9\efcpt.9.csproj -c Release
dotnet build src\Core\efcpt.10\efcpt.10.csproj -c Release
cd packages\efcpt-ui
npm ci
npm run build
npm link
```

**Windows, PowerShell:**

```powershell
cd ~
git clone https://github.com/ReesMcD/ef-core-power-tools-package.git
cd ef-core-power-tools-package
dotnet build src\Core\efcpt.8\efcpt.8.csproj -c Release
dotnet build src\Core\efcpt.9\efcpt.9.csproj -c Release
dotnet build src\Core\efcpt.10\efcpt.10.csproj -c Release
cd packages\efcpt-ui
npm ci
npm run build
npm link
```

**WSL (bash, zsh or fish):**

```bash
cd ~
git clone https://github.com/ReesMcD/ef-core-power-tools-package.git
cd ef-core-power-tools-package
dotnet build src/Core/efcpt.8/efcpt.8.csproj -c Release
dotnet build src/Core/efcpt.9/efcpt.9.csproj -c Release
dotnet build src/Core/efcpt.10/efcpt.10.csproj -c Release
cd packages/efcpt-ui
npm ci
npm run build
```

### 3. Add the `efcpt-ui` command

**Windows:** `npm link` in step 2 already added it. Open a new window and check with `efcpt-ui --version`.

- **PowerShell says _running scripts is disabled on this system_:** run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or type `efcpt-ui.cmd` instead of `efcpt-ui`.
- **With nvm-windows**, global commands belong to one Node version. If you `nvm use` another version, run `nvm use 22` again before using efcpt-ui.

**WSL:** add a shell function that runs efcpt-ui with the Node you just used. With asdf or nvm, a project can pin another Node version (`.tool-versions`, `.nvmrc`). An `npm link`ed command then fails in that project with _No executable efcpt-ui found for current version_; the function works in every folder. Run these from `~/ef-core-power-tools-package/packages/efcpt-ui`, where step 2 ended:

```bash
# zsh
echo "efcpt-ui() { '$(asdf which node 2>/dev/null || command -v node)' '$PWD/dist/cli.js' \"\$@\"; }" >> ~/.zshrc
exec zsh
```

```bash
# bash
echo "efcpt-ui() { '$(asdf which node 2>/dev/null || command -v node)' '$PWD/dist/cli.js' \"\$@\"; }" >> ~/.bashrc
exec bash
```

```fish
# fish
mkdir -p ~/.config/fish/functions
printf "function efcpt-ui\n    '%s' '%s' \$argv\nend\n" (command -q asdf; and asdf which node; or command -v node) (pwd)/dist/cli.js > ~/.config/fish/functions/efcpt-ui.fish
```

Check with `efcpt-ui --version`. The function points at your clone, so updates (step 6) need no reinstall. If you later uninstall that Node version, run these lines again.

### 4. Connection string

Using a Microsoft account (Windows authentication or Entra ID)? See [Signing in with a Microsoft account](#signing-in-with-a-microsoft-account) below.

**If your project keeps its connection string in user secrets** (`dotnet user-secrets`), there is nothing to do. efcpt-ui reads them like your app does. In WSL it reads `~/.microsoft/usersecrets` and also finds secrets you set on the Windows side. If there are several connection strings, the UI asks which one to use and remembers your choice.

To add one, run this in your project folder:

```bash
# bash, zsh, fish and PowerShell
dotnet user-secrets init   # only if the project has no UserSecretsId yet
dotnet user-secrets set "ConnectionStrings:Default" 'Server=YOURSERVER;Database=YourDb;User Id=youruser;Password=yourpassword;TrustServerCertificate=True'
```

```cmd
:: cmd, here with Windows authentication
dotnet user-secrets init
dotnet user-secrets set "ConnectionStrings:Default" "Server=YOURSERVER;Database=YourDb;Integrated Security=True;TrustServerCertificate=True"
```

#### Signing in with a Microsoft account

There are two kinds, depending on where the database runs.

**Windows authentication** (`Integrated Security=True`) is for SQL Server on your company network, with your domain account. It works only from **cmd or PowerShell on Windows**, not from WSL.

1. Open cmd or PowerShell as yourself. To use a different domain account, open a window for it with `runas /netonly /user:CORP\otheruser cmd`.
2. Save the connection string in the project's user secrets. It contains no password:

   ```cmd
   cd C:\path\to\YourProject
   dotnet user-secrets init
   dotnet user-secrets set "ConnectionStrings:Default" "Server=sqlserver01;Database=YourDb;Integrated Security=True;TrustServerCertificate=True"
   ```

   - Named instance: `Server=sqlserver01\INSTANCE`.
   - LocalDB: `Server=(localdb)\MSSQLLocalDB`.
   - If it can't reach the server, connect to the VPN and try the full name: `Server=sqlserver01.corp.example.com`.

3. Check it with `efcpt-ui --list`. On a failure, efcpt-ui says what to change: no access for your account, a Kerberos or VPN problem, or the wrong server name.

**Microsoft Entra ID** (`Authentication=Active Directory Default`) is for Azure SQL Database and Azure SQL Managed Instance, with your work account. It works from Windows (cmd, PowerShell) and WSL (bash, zsh, fish).

1. Install the Azure CLI and sign in. Windows and WSL keep separate sign-ins, so sign in on each side you use.

   ```cmd
   :: Windows (cmd or PowerShell); open a new window after the install
   winget install Microsoft.AzureCLI
   az login
   ```

   ```bash
   # WSL (bash, zsh or fish)
   curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
   az login --use-device-code
   ```

   With several tenants, add `--tenant yourcompany.onmicrosoft.com`. On Windows, being signed in to Visual Studio with the same account also works.

2. Save the connection string in the project's user secrets. It contains no password:

   ```bash
   dotnet user-secrets set "ConnectionStrings:Default" "Server=tcp:yourserver.database.windows.net,1433;Database=YourDb;Authentication=Active Directory Default;Encrypt=True"
   ```

   For a Managed Instance, the server name looks like `yourmi.abc123def456.database.windows.net`. Copy it from the Azure portal.

3. Check it with `efcpt-ui --list`.
   - If sign-in fails, run `az login` again: sign-ins expire.
   - Your account must be a user in the database. A DBA adds it with `CREATE USER [you@company.com] FROM EXTERNAL PROVIDER`.

`Active Directory Interactive` also works, but it opens a sign-in window each time efcpt-ui connects, so `Active Directory Default` is the better choice. Entra ID uses Microsoft.Data.SqlClient's built-in support. CI doesn't cover it, because there is no Azure SQL there.

#### Environment variable instead

You can also use an environment variable for one session, then add `--connection-env MY_DB` to the efcpt-ui commands:

| Shell      | Command                                      |
| ---------- | -------------------------------------------- |
| cmd        | `set "MY_DB=Server=...;Database=...;..."`    |
| PowerShell | `$env:MY_DB = 'Server=...;Database=...;...'` |
| bash, zsh  | `export MY_DB='Server=...;Database=...;...'` |
| fish       | `set -x MY_DB 'Server=...;Database=...;...'` |

More options are in [Connection strings](#connection-strings).

#### From WSL to SQL Server on your own Windows machine

`localhost` doesn't reach Windows by default. Add these two lines to `C:\Users\<you>\.wslconfig`, then run `wsl --shutdown`:

```ini
[wsl2]
networkingMode=mirrored
```

SQL Server must also accept TCP connections and SQL logins.

### 5. First run in your project

The commands are the same in every shell. Use `\` instead of `/` in paths on Windows. A project on the C: drive is under `/mnt/c/...` in WSL.

```bash
cd /path/to/YourProject
git checkout -b try-efcpt-ui
efcpt-ui --import-vs efpt.config.json     # only if you used the Visual Studio extension
efcpt-ui --list                           # read-only: the connection, the engine and what would be generated
efcpt-ui                                  # opens the UI in your browser: pick tables and options, then Save & Generate
```

**Several configs** (for example one per database, such as `BFF/efpt.Sales.config.json` and `BFF/efpt.Hr.config.json`): import each one, then name the config with `--config`:

```bash
efcpt-ui --import-vs BFF/efpt.Sales.config.json
efcpt-ui --import-vs BFF/efpt.Hr.config.json
efcpt-ui --config BFF/efcpt-config.Sales.json --list
efcpt-ui --config BFF/efcpt-config.Sales.json
```

Imported configs generate the same code as the Visual Studio extension, with the same line endings as your existing files. `git status` shows only what really changed.

### 6. Refresh without the UI

The UI is for choosing tables and options. To regenerate after the database changes, the same as **Refresh** in Visual Studio, use `--generate`. It uses the saved config, generates and exits:

```bash
efcpt-ui --config BFF/efcpt-config.Sales.json --generate
```

To refresh every config in a project or solution with one command, save an `efcpt-refresh` command once:

```fish
# fish
function efcpt-refresh --description 'Regenerate every efcpt config below this folder'
    for c in **/efcpt-config*.json
        echo "== $c"
        efcpt-ui --config $c --generate; or return 1
    end
end
funcsave efcpt-refresh
```

```bash
# zsh (for bash, use ~/.bashrc and exec bash)
cat >> ~/.zshrc <<'EOF'
efcpt-refresh() {
  find . -name 'efcpt-config*.json' -not -path '*/bin/*' -not -path '*/obj/*' -not -path '*/node_modules/*' | sort |
    while read -r c; do echo "== $c"; efcpt-ui --config "$c" --generate < /dev/null || return 1; done
}
EOF
exec zsh
```

```powershell
# PowerShell: adds efcpt-refresh to your profile
if (!(Test-Path $PROFILE)) { New-Item -ItemType File -Force $PROFILE | Out-Null }
Add-Content $PROFILE @'
function efcpt-refresh {
  foreach ($c in Get-ChildItem -Recurse -Filter 'efcpt-config*.json' | Where-Object FullName -notmatch '\\(bin|obj|node_modules)\\') {
    Write-Host "== $($c.FullName)"
    efcpt-ui --config $c.FullName --generate
    if ($LASTEXITCODE -ne 0) { return }
  }
}
'@
. $PROFILE
```

```cmd
:: cmd: no saved command, run this line from the project folder
for /r %c in (efcpt-config*.json) do call efcpt-ui --config "%c" --generate
```

Then run `efcpt-refresh` from your project or solution folder.

Good to know:

- **New tables:** imported configs only generate the tables you selected, as in Visual Studio. To add one, open the UI (`efcpt-ui --config ...`), click **Reload from database**, tick it and generate. To always pick up every new object, set `"refresh-object-lists": true` under `code-generation` in that config.
- **Project scripts:** if your project has a `package.json`, you can save these as scripts instead. See [Using it in a project](#using-it-in-a-project).
- **Exit codes** for scripts and CI: `0` success, `1` generation failed, `2` usage or setup problem.

### Updating efcpt-ui

Pull, rebuild the engines you use, then rebuild efcpt-ui. The `efcpt-ui` command picks up the new version automatically.

```bash
# WSL
cd ~/ef-core-power-tools-package
git pull
dotnet build src/Core/efcpt.8/efcpt.8.csproj -c Release
dotnet build src/Core/efcpt.9/efcpt.9.csproj -c Release
dotnet build src/Core/efcpt.10/efcpt.10.csproj -c Release
cd packages/efcpt-ui
npm ci
npm run build
```

```cmd
:: Windows (cmd; in PowerShell use cd ~\ef-core-power-tools-package)
cd /d %USERPROFILE%\ef-core-power-tools-package
git pull
dotnet build src\Core\efcpt.8\efcpt.8.csproj -c Release
dotnet build src\Core\efcpt.9\efcpt.9.csproj -c Release
dotnet build src\Core\efcpt.10\efcpt.10.csproj -c Release
cd packages\efcpt-ui
npm ci
npm run build
```

### Troubleshooting

| Message                                                                | Fix                                                                                                                                |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| _No executable efcpt-ui found for current version_ (asdf)              | The project pins another Node version. Add the shell function from [step 3](#3-add-the-efcpt-ui-command).                          |
| `efcpt-ui: command not found`                                          | WSL: add the shell function from step 3 and open a new shell. Windows: open a new window after `npm link`.                         |
| fish: _command substitutions not allowed here_                         | fish doesn't accept `(...)` as a command name. Use the step 3 function, which writes the path out.                                 |
| PowerShell: _running scripts is disabled on this system_               | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or type `efcpt-ui.cmd`.                                                     |
| _Login failed_ or _network-related error_ from WSL                     | Use a SQL login or Entra ID, not Windows authentication. Turn on mirrored networking for a server on your own machine (step 4).    |
| _Microsoft Entra ID sign-in failed_                                    | Run `az login` again, on the same side (Windows or WSL) you run efcpt-ui. Your account must be a user in the database.             |
| _The certificate chain was issued by an authority that is not trusted_ | Add `TrustServerCertificate=True` to the connection string.                                                                        |
| Every generated file shows as changed                                  | Update efcpt-ui (above). It keeps your files' line endings. Also check the project's EF Core version matches the engine you built. |
| _no engine found_                                                      | Build the engine for your project's EF Core version (step 2).                                                                      |

## Using it in a project

Run `efcpt-ui` from the project folder, or add one script per config to `package.json` if your project has one (a project can have several configs):

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
- Generated files keep the line endings of the code that is already there, so regenerating from WSL doesn't rewrite every file Visual Studio generated with Windows (CRLF) line endings. Only the files whose code changed show up in `git status`.
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
    // or { "user-secrets": "ConnectionStrings:Sales", "project": "../Sales.Api/Sales.Api.csproj" }  // of another project
    // or { "appsettings": "appsettings.Development.json", "key": "ConnectionStrings:Sales" }
    // or { "dacpac": "../Database/bin/Debug/Database.dacpac" }
  },
}
```

5. the project's user secrets, when nothing above is set: if they hold one `ConnectionStrings:*` entry, efcpt-ui uses it. If they hold several, the UI lets you pick one and records the choice in the config (the `--list` and `--generate` commands name the line to add).

Paths in this section are relative to the project folder. The engine keeps this section when it rewrites the config.

**User secrets** are read where `dotnet user-secrets` writes them: `~/.microsoft/usersecrets/<UserSecretsId>/secrets.json` on Linux, macOS and WSL (from `$HOME`), `%APPDATA%\Microsoft\UserSecrets\...` on Windows. In WSL, secrets set on the Windows side are found too. The UserSecretsId comes from the project or a `Directory.Build.props` above it. When the secrets belong to another project, such as the startup project of a solution whose models live in a class library, name it with `"project"` (or give its `"id"`).

The section can also name the renaming file, relative to the config: `"renaming": "efpt.Sales.renaming.json"` (default `efpt.renaming.json`), and the line endings of generated files: `"line-endings": "crlf"` or `"lf"`. The default, `"auto"`, matches the existing generated code, and leaves the engine's output alone when there is none yet.

### SQL Server

- **Local servers:** Microsoft.Data.SqlClient encrypts connections by default, so a local or Docker SQL Server with a self-signed certificate needs `TrustServerCertificate=True` in the connection string. efcpt-ui points this out when it's the problem, and explains other common connection errors too.
- **Windows authentication** works when efcpt-ui runs on Windows (PowerShell or cmd, not WSL), as the account running it (tested in CI against LocalDB). Step by step: [Signing in with a Microsoft account](#signing-in-with-a-microsoft-account). For example:

  ```text
  Server=sqlserver01;Database=Sales;Integrated Security=True;TrustServerCertificate=True
  Server=.\SQLEXPRESS;Database=Sales;Trusted_Connection=True;TrustServerCertificate=True
  Server=(localdb)\MSSQLLocalDB;Database=Sales;Trusted_Connection=True
  ```

  A Windows authentication connection string holds no password, so an `appsettings.Development.json` entry you already have is a fine place for it: `"efcpt-ui": { "connection": { "appsettings": "appsettings.Development.json", "key": "ConnectionStrings:Sales" } }`. If it fails, efcpt-ui says whether the account has no access, Kerberos couldn't get a ticket (VPN, server name, SPN), or your identity didn't reach the server. On macOS, Linux and WSL, use a SQL login or Microsoft Entra ID (`Authentication=Active Directory Default`, see [Signing in with a Microsoft account](#signing-in-with-a-microsoft-account)) instead.

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
