# efcpt-cli: EF Core Power Tools without Visual Studio

Reverse engineer a database into EF Core `DbContext` and entity classes from any .NET project, driven by the Visual Studio extension's own `efpt.config.json` or an `efcpt-config.json`. No Visual Studio needed. The command is `efcpt`: it opens a browser UI to pick tables and options, or generates without it.

efcpt-cli used to be called efcpt-ui. If you installed it under that name, `efcpt-ui --update` moves you over: see [Coming from efcpt-ui](#coming-from-efcpt-ui).

This is a fork of [EF Core Power Tools](https://github.com/ErikEJ/EFCorePowerTools) by ErikEJ (MIT). It is not the official tool.

> **Status:** in use on the team. The web UI, `--generate` and `--list` work, with the Visual Studio extension's configs as they are, tested against SQL Server (including Windows authentication), PostgreSQL and SQLite. It isn't on the npm registry: you install it with npm straight from this repository's GitHub Releases (below), no account needed, and update it with `efcpt --update`.

## Getting started

Six steps, each with commands to copy and paste. Pick the block for your shell.

**Already installed?** To pick up new changes, see [Updating efcpt-cli](#updating-efcpt-cli). **Installed from a clone before?** See [Coming from a clone install](#coming-from-a-clone-install).

| Where you run it      | Shells          | SQL Server sign-in                                                    |
| --------------------- | --------------- | --------------------------------------------------------------------- |
| Windows               | cmd, PowerShell | SQL login, Windows authentication or Microsoft Entra ID               |
| WSL (or Linux, macOS) | bash, zsh, fish | SQL login or Microsoft Entra ID. Windows authentication needs Windows |

Install it separately on each side you use (Windows and WSL each have their own Node). Try it on a branch of your project first: generating overwrites the output folder and removes files it generated before that are no longer needed.

### 1. Prerequisites

You need the .NET 10 SDK, the .NET 8 runtime (only for EF Core 8 or 9 projects) and Node 22 or newer.

#### Windows

In cmd or PowerShell:

```cmd
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
sudo apt update && sudo apt install -y dotnet-sdk-10.0 dotnet-runtime-8.0
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

### 2. Install efcpt-cli

The same command in every shell (cmd, PowerShell, bash, zsh, fish):

```bash
npm install --global https://github.com/ReesMcD/ef-core-power-tools-package/releases/latest/download/efcpt-cli.tgz
```

That's all: npm downloads efcpt-cli from the latest release of this repository. No clone, no build, no npm account. The engine that generates the code (about 75 MB) downloads the first time you use it with a project, once per EF Core version, and again only when the engine itself changes.

### 3. Add the `efcpt` command

**Windows:** step 2 already added it. Open a new window and check with `efcpt --version`.

- **PowerShell says _running scripts is disabled on this system_:** run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or type `efcpt.cmd` instead of `efcpt`.
- **With nvm-windows**, global commands belong to one Node version. If you `nvm use` another version, run `nvm use 22` again before using efcpt.

**WSL:** add a shell function that runs efcpt with the Node you just installed it with. With asdf or nvm, a project can pin another Node version (`.tool-versions`, `.nvmrc`), and a plain global command then fails in that project with _No executable efcpt found for current version_; the function works in every folder. Run the line for your shell from any folder, with the same Node as step 2:

```bash
# zsh
echo "efcpt() { '$(asdf which node 2>/dev/null || command -v node)' '$(npm root -g)/efcpt-cli/dist/cli.js' \"\$@\"; }" >> ~/.zshrc
exec zsh
```

```bash
# bash
echo "efcpt() { '$(asdf which node 2>/dev/null || command -v node)' '$(npm root -g)/efcpt-cli/dist/cli.js' \"\$@\"; }" >> ~/.bashrc
exec bash
```

```fish
# fish
mkdir -p ~/.config/fish/functions
printf "function efcpt\n    '%s' '%s' \$argv\nend\n" (command -q asdf; and asdf which node; or command -v node) (npm root -g)/efcpt-cli/dist/cli.js > ~/.config/fish/functions/efcpt.fish
```

Check with `efcpt --version`. The function points at the installed copy, so [updates](#updating-efcpt-cli) need no change to it. If you later uninstall that Node version, install efcpt-cli again with another one and run these lines again.

- **Set up under the old name `efcpt-ui`?** See [Coming from efcpt-ui](#coming-from-efcpt-ui).
- **Name clash:** upstream EF Core Power Tools has its own command line tool that is also called `efcpt` (`dotnet tool install ErikEJ.EFCorePowerTools.Cli`). If you installed it, whichever comes first on your `PATH` wins on Windows; in WSL the shell function always wins. If you need upstream's tool too, run this one through its full path (`type efcpt` shows it), or remove the dotnet tool with `dotnet tool uninstall -g ErikEJ.EFCorePowerTools.Cli`.

### 4. Connection string

Using a Microsoft account (Windows authentication or Entra ID)? See [Signing in with a Microsoft account](#signing-in-with-a-microsoft-account) below.

**If your project keeps its connection string in user secrets** (`dotnet user-secrets`), there is nothing to do. efcpt-cli reads them like your app does. In WSL it reads `~/.microsoft/usersecrets` and also finds secrets you set on the Windows side. If there are several connection strings, the UI asks which one to use and remembers your choice.

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

3. Check it with `efcpt --list`. On a failure, efcpt-cli says what to change: no access for your account, a Kerberos or VPN problem, or the wrong server name.

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

3. Check it with `efcpt --list`.
   - If sign-in fails, run `az login` again: sign-ins expire.
   - Your account must be a user in the database. A DBA adds it with `CREATE USER [you@company.com] FROM EXTERNAL PROVIDER`.

`Active Directory Interactive` also works, but it opens a sign-in window each time efcpt-cli connects, so `Active Directory Default` is the better choice. Entra ID uses Microsoft.Data.SqlClient's built-in support. CI doesn't cover it, because there is no Azure SQL there.

#### Environment variable instead

You can also use an environment variable for one session, then add `--connection-env MY_DB` to the efcpt commands:

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
git checkout -b try-efcpt-cli
efcpt --list     # read-only: the connection, the engine and what would be generated
efcpt            # opens the UI in your browser: pick tables and options, then Save & Generate
```

If the project already has a Visual Studio extension config (`efpt.config.json`), efcpt uses that file as it is. Nothing to convert, and teammates on Visual Studio keep working on the same file. See [Sharing a config with the Visual Studio extension](#sharing-a-config-with-the-visual-studio-extension).

**Several configs** (for example one per database, such as `BFF/efpt.Sales.config.json` and `BFF/efpt.Hr.config.json`): name the config with `--config`:

```bash
efcpt --config BFF/efpt.Sales.config.json --list
efcpt --config BFF/efpt.Sales.config.json
```

An efpt config generates the same code as the Visual Studio extension, with the same line endings as your existing files. `git status` shows only what really changed.

### 6. Refresh without the UI

The UI is for choosing tables and options. To regenerate after the database changes, the same as **Refresh** in Visual Studio, use `--generate`. It uses the saved config, generates and exits:

```bash
efcpt --config BFF/efpt.Sales.config.json --generate
```

To refresh every config in a project or solution with one command, save an `efcpt-refresh` command once:

```fish
# fish
function efcpt-refresh --description 'Regenerate every efcpt config below this folder'
    for c in **/efpt*.config.json **/efcpt-config*.json
        echo "== $c"
        efcpt --config $c --generate; or return 1
    end
end
funcsave efcpt-refresh
```

```bash
# zsh (for bash, use ~/.bashrc and exec bash)
cat >> ~/.zshrc <<'EOF'
efcpt-refresh() {
  find . \( -name 'efpt*.config.json' -o -name 'efcpt-config*.json' \) -not -path '*/bin/*' -not -path '*/obj/*' -not -path '*/node_modules/*' | sort |
    while read -r c; do echo "== $c"; efcpt --config "$c" --generate < /dev/null || return 1; done
}
EOF
exec zsh
```

```powershell
# PowerShell: adds efcpt-refresh to your profile
if (!(Test-Path $PROFILE)) { New-Item -ItemType File -Force $PROFILE | Out-Null }
Add-Content $PROFILE @'
function efcpt-refresh {
  foreach ($c in Get-ChildItem -Recurse -Include 'efpt*.config.json', 'efcpt-config*.json' | Where-Object FullName -notmatch '\\(bin|obj|node_modules)\\') {
    Write-Host "== $($c.FullName)"
    efcpt --config $c.FullName --generate
    if ($LASTEXITCODE -ne 0) { return }
  }
}
'@
. $PROFILE
```

```cmd
:: cmd: no saved command, run this line from the project folder
for /r %c in (efpt*.config.json efcpt-config*.json) do call efcpt --config "%c" --generate
```

Then run `efcpt-refresh` from your project or solution folder.

Good to know:

- **New tables:** efpt configs only generate the tables you selected, as in Visual Studio. To add one, open the UI (`efcpt --config ...`), click **Reload from database**, tick it and generate. To always pick up every new object, set `"refresh-object-lists": true` under `code-generation` in an efcpt config. In an efpt config, that's the extension's `"UseNoObjectFilter": true`.
- **Project scripts:** if your project has a `package.json`, you can save these as scripts instead. See [Using it in a project](#using-it-in-a-project).
- **Exit codes** for scripts and CI: `0` success, `1` generation failed, `2` usage or setup problem.

### Updating efcpt-cli

**Do this after new changes are merged into this repository.** Every merge publishes a new release; your copy doesn't update itself. From any folder, in any shell:

```bash
efcpt --update
```

It installs the latest release over yours with npm, or says you're up to date. Running the install command from step 2 again does the same. You don't need to redo step 3. If the engine changed, the new one downloads the next time you generate; otherwise nothing more downloads.

- **Check what you're on:** `efcpt --version`. The [releases page](https://github.com/ReesMcD/ef-core-power-tools-package/releases) lists every version.
- **Where are the engines?** In a download cache: `%LOCALAPPDATA%\efcpt-cli\Cache` on Windows, `~/.cache/efcpt-cli` in WSL. Old engines are removed when new ones replace them. Deleting the folder is safe; the engine downloads again.

### Coming from a clone install

Before releases, efcpt-cli was installed from a clone of this repository, with the engines built by hand. To switch, run step 2's install command, then:

- **WSL:** run the line for your shell from [step 3](#3-add-the-efcpt-command) again. It replaces your function, which pointed at the clone: in fish the file is overwritten; in bash or zsh, delete the old `efcpt()` line from `~/.bashrc` or `~/.zshrc` first.
- **Windows:** nothing else. The install replaces the `npm link` to your clone.

Check with `efcpt --version`: a release prints a version like `0.2.12` (a clone prints `0.1.0`). Then you can delete the clone, unless you work on efcpt-cli itself. In a clone, `efcpt --update` still pulls and rebuilds, as before.

### Coming from efcpt-ui

efcpt-cli used to be called efcpt-ui, in `packages/efcpt-ui`, with the command `efcpt-ui`. To move over, run the update the way you have it set up:

```bash
efcpt-ui --update
```

The update builds efcpt-cli in your clone and moves your setup over:

- **Shell function:** your `efcpt-ui` function in fish, `.bashrc` or `.zshrc` becomes `efcpt` and points at `packages/efcpt-cli`.
- **Global link:** a global `efcpt-ui` npm link is replaced with `efcpt`.

Open a new shell afterwards. From then on the command is `efcpt`, and `efcpt-ui` no longer exists. Then switch to installing from releases: [Coming from a clone install](#coming-from-a-clone-install).

- **Configs need no changes.** An `"efcpt-ui": { ... }` section is still read, and becomes `"efcpt-cli"` the next time efcpt writes it. So does `EFCPT_UI_ENGINE`.
- **If your `efcpt-ui` has no `--update` yet:** in the clone, run `git pull`, then `node packages/efcpt-cli/scripts/update.mjs`. It does the same move.
- **`packages/efcpt-ui`:** after the update, that folder only holds a small stub that lets older updates finish the move, plus their leftover build output. It will be removed from the repository later.

### Troubleshooting

| Message                                                                                                                                     | Fix                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _No executable efcpt found for current version_ (asdf)                                                                                      | The project pins another Node version. Add the shell function from [step 3](#3-add-the-efcpt-command).                                                                                                                                   |
| `efcpt: command not found`                                                                                                                  | WSL: add the shell function from step 3 and open a new shell. Windows: open a new window after installing.                                                                                                                               |
| fish: _command substitutions not allowed here_                                                                                              | fish doesn't accept `(...)` as a command name. Use the step 3 function, which writes the path out.                                                                                                                                       |
| PowerShell: _running scripts is disabled on this system_                                                                                    | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or type `efcpt.cmd`.                                                                                                                                                              |
| _Login failed_ or _network-related error_ from WSL                                                                                          | Use a SQL login or Entra ID, not Windows authentication. Turn on mirrored networking for a server on your own machine (step 4).                                                                                                          |
| _Microsoft Entra ID sign-in failed_                                                                                                         | Run `az login` again, on the same side (Windows or WSL) you run efcpt-cli. Your account must be a user in the database.                                                                                                                  |
| _The certificate chain was issued by an authority that is not trusted_                                                                      | Add `TrustServerCertificate=True` to the connection string.                                                                                                                                                                              |
| Every generated file shows as changed                                                                                                       | Update efcpt-cli (above). It keeps your files' line endings.                                                                                                                                                                             |
| After updating, a few generated files change (for example `DbContextExtensions.cs`, `HasAnnotation("Relational:DefaultConstraintName", …)`) | efcpt-cli uses a newer version of the code generator than the EF Core Power Tools release in Visual Studio. Commit the changes once; teammates who still generate from Visual Studio should update the extension, or it flips them back. |
| Something fixed upstream still happens to you                                                                                               | [Update efcpt-cli](#updating-efcpt-cli).                                                                                                                                                                                                 |
| _Could not download the EF Core N engine_                                                                                                   | Check your network (a proxy or VPN may block github.com). The message names the file: download it in a browser, extract it and pass `--engine <folder>/efcpt.N.dll`.                                                                     |

## Using it in a project

Run `efcpt` from the project folder, or add one script per config to `package.json` if your project has one (a project can have several configs):

```json
"scripts": {
  "db:sales": "efcpt --config ./Data/Sales/efcpt-config.json",
  "db:sales:generate": "efcpt --config ./Data/Sales/efcpt-config.json --generate"
}
```

`npm run db:sales` opens the UI in your browser. Without `--config`, it uses the project's only config, or lets you pick one or create a new one.

### Sharing a config with the Visual Studio extension

efcpt reads and saves the extension's `efpt.config.json` (or `efpt.Sales.config.json`, and so on) directly, so a team where some people use Visual Studio and some use efcpt shares one file:

```bash
efcpt --config BFF/efpt.Sales.config.json             # the UI
efcpt --config BFF/efpt.Sales.config.json --generate  # refresh
```

- **The same code.** It generates exactly what the extension generates: a CI test compares the two file by file, and it was checked against the team's real SQL Server configs.
- **Small diffs.** Saving from efcpt writes the file the way the extension does (same order, indentation, BOM and line endings) and changes only what you changed. Adding one table adds one entry, in the place the extension would put it. Generating never touches the file.
- **Only the extension's options.** The UI shows only the options an efpt config can hold, and has no exclusion rules such as `*Log`. Options the extension doesn't have (such as the Mermaid diagram) need an efcpt config.
- **efcpt's own settings** (which connection to use, line endings) can't go in the efpt file, because the extension rewrites it and drops what it doesn't know. They go in `efcpt-cli.json` next to it, one entry per config:

  ```json
  {
    "configs": {
      "efpt.Sales.config.json": { "connection": { "user-secrets": "ConnectionStrings:Sales" } }
    }
  }
  ```

  The UI writes it when you pick a connection string from the user secrets. Commit it, or leave it out of git if the choice is personal.

- As in Visual Studio, only the selected objects are generated. New database objects show up unticked in the UI.
- `efpt.renaming.json`, or a config specific `efpt.Sales.renaming.json`, next to the config is used, as in the extension.
- The connection string is not in `efpt.config.json`; see [Connection strings](#connection-strings).
- Generated files keep the line endings of the code that is already there, so regenerating from WSL doesn't rewrite every file Visual Studio generated with Windows (CRLF) line endings.
- The engine's generic next steps readme (`efcpt-readme.md`: which NuGet packages to add, how to register the `DbContext`) is deleted after each run, so it never shows up in your changes. One left in the project by an older version can be deleted too.
- Handlebars templates and "no default constructor" are not supported outside Visual Studio. Stored procedure calls are always async. efcpt warns about these.

**Used `--import-vs` before?** It made a copy, such as `efcpt-config.Sales.json`, that drifts away from the efpt file as soon as someone edits either one. Switch to the efpt file: run `efcpt --config BFF/efpt.Sales.config.json --generate` once (it copies the copy's settings, such as the connection, into `efcpt-cli.json`), then delete the copy and update any saved commands or scripts. efcpt reminds you while the copy is there.

**Leaving Visual Studio for good?** `efcpt --import-vs efpt.config.json` still converts an efpt config to an `efcpt-config.json`, which has every option. Delete the efpt file afterwards, so there is only one.

### The UI

- **Objects**: tables, views, stored procedures and functions, grouped by schema. Tick what to generate, filter by name, select whole groups, expand a table or view to leave out single columns, and add or remove exclusion rules such as `*Log` (efcpt configs only).
- **Settings**: the config's options (names, file layout, code generation, type mappings, uncountable words). Options you don't change stay out of the file and keep the engine's defaults. Irregular words and plural/singular rules are edited in the file.
- **Generate**: saves and runs the engine, showing the generated files, warnings and errors.
- **Connection**: if the project's user secrets hold several connection strings, the UI lets you pick one and remembers the choice in the config. If none is found, it asks for one, keeps it in memory only and never writes it to disk.

The UI runs on `127.0.0.1` only, behind a one-time token in the URL it prints. It stops when you close the tab or press Ctrl+C. Use `--no-open` to not open a browser and `--port` to choose the port.

### Without the UI

```bash
efcpt --config ./Data/Sales/efcpt-config.json --generate
```

This is what [step 6](#6-refresh-without-the-ui) uses to refresh.

What happens:

1. The project is the nearest `.csproj` at or above the config (or `--project`).
2. The EF Core version (8, 9 or 10) comes from the project's `Microsoft.EntityFrameworkCore*` package reference, including central package management. Without one, it comes from the target framework.
3. The database provider comes from the project's EF Core provider package (for example `Npgsql.EntityFrameworkCore.PostgreSQL`), unless `--provider` or the config says otherwise.
4. If there is no config yet, efcpt-cli creates `efcpt-config.json` with the project's `RootNamespace`. An efcpt config without `names.root-namespace` or `names.dbcontext-name` gets them filled in, and says so. An efpt config is used as it is.
5. The matching engine generates code into the project folder, using the config's `file-layout` settings. With `refresh-object-lists` on (the default for new efcpt configs; efpt configs use the extension's `UseNoObjectFilter`), it also adds new database objects to the config.
6. Generated files get the line endings of the existing generated code, and the engine's generic `efcpt-readme.md` is deleted.

## Connection strings

Connection strings are never stored in `efcpt-config.json`. They are looked up in this order:

1. `--connection "<connection string or path to .dacpac>"`
2. `--connection-env MY_VAR`
3. the `EFCPT_CONNECTION` environment variable
4. an `efcpt-cli` section in the config file that says where to read it from (for an efpt config, the same settings go in [`efcpt-cli.json`](#sharing-a-config-with-the-visual-studio-extension)):

```jsonc
{
  "efcpt-cli": {
    "provider": "mssql", // optional, usually inferred
    "connection": { "env": "SALES_DB" }, // environment variable
    // or { "user-secrets": "ConnectionStrings:Sales" }         // dotnet user-secrets of the project
    // or { "user-secrets": "ConnectionStrings:Sales", "project": "../Sales.Api/Sales.Api.csproj" }  // of another project
    // or { "appsettings": "appsettings.Development.json", "key": "ConnectionStrings:Sales" }
    // or { "dacpac": "../Database/bin/Debug/Database.dacpac" }
  },
}
```

5. the project's user secrets, when nothing above is set: if they hold one `ConnectionStrings:*` entry, efcpt-cli uses it. If they hold several, the UI lets you pick one and records the choice in the config (the `--list` and `--generate` commands name the line to add).

Paths in this section are relative to the project folder. The engine keeps this section when it rewrites the config.

**User secrets** are read where `dotnet user-secrets` writes them: `~/.microsoft/usersecrets/<UserSecretsId>/secrets.json` on Linux, macOS and WSL (from `$HOME`), `%APPDATA%\Microsoft\UserSecrets\...` on Windows. In WSL, secrets set on the Windows side are found too. The UserSecretsId comes from the project or a `Directory.Build.props` above it. When the secrets belong to another project, such as the startup project of a solution whose models live in a class library, name it with `"project"` (or give its `"id"`).

The section can also name the renaming file, relative to the config: `"renaming": "efpt.Sales.renaming.json"` (default `efpt.renaming.json`), and the line endings of generated files: `"line-endings": "crlf"` or `"lf"`. The default, `"auto"`, matches the existing generated code, and leaves the engine's output alone when there is none yet. If the config sets the engine's own `"file-line-endings": "lf"` or `"crlf"` under `code-generation`, that wins and `"auto"` changes nothing.

### SQL Server

- **Local servers:** Microsoft.Data.SqlClient encrypts connections by default, so a local or Docker SQL Server with a self-signed certificate needs `TrustServerCertificate=True` in the connection string. efcpt-cli points this out when it's the problem, and explains other common connection errors too.
- **Windows authentication** works when efcpt-cli runs on Windows (PowerShell or cmd, not WSL), as the account running it (tested in CI against LocalDB). Step by step: [Signing in with a Microsoft account](#signing-in-with-a-microsoft-account). For example:

  ```text
  Server=sqlserver01;Database=Sales;Integrated Security=True;TrustServerCertificate=True
  Server=.\SQLEXPRESS;Database=Sales;Trusted_Connection=True;TrustServerCertificate=True
  Server=(localdb)\MSSQLLocalDB;Database=Sales;Trusted_Connection=True
  ```

  A Windows authentication connection string holds no password, so an `appsettings.Development.json` entry you already have is a fine place for it: `"efcpt-cli": { "connection": { "appsettings": "appsettings.Development.json", "key": "ConnectionStrings:Sales" } }`. If it fails, efcpt-cli says whether the account has no access, Kerberos couldn't get a ticket (VPN, server name, SPN), or your identity didn't reach the server. On macOS, Linux and WSL, use a SQL login or Microsoft Entra ID (`Authentication=Active Directory Default`, see [Signing in with a Microsoft account](#signing-in-with-a-microsoft-account)) instead.

- **Database projects:** point at the built `.dacpac` instead of a database, with `--connection path/to/Database.dacpac` or `"efcpt-cli": { "connection": { "dacpac": "../Database/bin/Debug/Database.dacpac" } }`.
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

efcpt-cli runs a .NET engine matching the project's EF Core version. The engine is this repository's build of upstream's `efcpt` dotnet tool, with a JSON interface added (`src/Core/efcpt.8`, shared by 9 and 10). It looks for it in this order:

1. `--engine <path>` (`efcpt.<N>.dll` or an executable)
2. the `EFCPT_CLI_ENGINE` environment variable
3. an engine built in this repository, when efcpt-cli runs from a checkout (`src/Core/efcpt.<N>/bin/Release` or `Debug`)
4. the download cache
5. an `efcpt-cli-engine` dotnet tool on `PATH` built for the same EF Core version
6. a download from this repository's releases, into the cache (installed copies only)

In practice that's 4 and 6: each copy of efcpt-cli knows which engine build it was released with, downloads it on first use and reuses it until an update brings a new one.

The engine needs the .NET 8 runtime (EF Core 8 and 9) or the .NET 10 runtime (EF Core 10), or newer.

## Options

Run `efcpt --help`. Exit codes: `0` success, `1` generation failed, `2` usage or setup problem.

## Development

Work in a clone, with the engines built from source. `efcpt` from the clone finds them by itself:

```bash
git clone https://github.com/ReesMcD/ef-core-power-tools-package.git
cd ef-core-power-tools-package
dotnet build src/Core/efcpt.10/efcpt.10.csproj -c Release   # and efcpt.8, efcpt.9 for those EF Core versions
cd packages/efcpt-cli
npm ci
npm run build
npm link            # efcpt now runs this clone; npm install --global <release> goes back to releases
npm test            # unit tests (fake engine)
npm run build && npm run test:ui   # browser tests of the web UI (Playwright)
npm run lint && npm run format:check && npm run typecheck
npm run sync-schema # after changing samples/efcpt-config.schema.json
npm run update      # what efcpt --update runs in a clone (scripts/update.mjs, tested in test/update.test.ts)

# end to end against the real engine, including dotnet build of the generated code, and parity with
# the Visual Studio extension's code generator (dotnet build src/Core/efreveng100/efreveng100.csproj -c Release)
EFCPT_CLI_E2E_ENGINE=<path to efcpt.10.dll> EFCPT_CLI_E2E_BUILD=1 \
  EFCPT_CLI_E2E_REVENG=<path to efreveng100.dll> npx vitest run test/e2e.test.ts
```

Requires Node 22 or newer.

### Releases

`.github/workflows/efcpt-cli-release.yml` publishes a release for every merge to `master` that touches efcpt-cli or the engine code: `v0.2.<run number>`, with `efcpt-cli.tgz`. The engines go in a separate release, `engines-<id>`, where the id is a hash of the engine's source folders; it's only built and published when that code changes, so most releases reuse the previous engines and nobody downloads them again. The version and both tags are written into the packed `package.json` (`efcptRelease`, `efcptEngines`); a clone has neither, which is how efcpt-cli tells the two apart. Pull requests run the same build, install the result from a local copy of the release files and list a SQLite database with it, without publishing.

### Keeping up with upstream EF Core Power Tools

The code generator comes from [ErikEJ/EFCorePowerTools](https://github.com/ErikEJ/EFCorePowerTools). This fork last merged its `master` on 14 Oct 2026 (`f190200`) and doesn't update itself. Our changes to upstream's code are small: the JSON and `--list-objects` interface in `src/Core/efcpt.8`, extension data in `CliConfig`, and a one-line fix in `ProcedureScaffolder.cs`. Everything else is new files. To bring in upstream changes:

```bash
git remote add upstream https://github.com/ErikEJ/EFCorePowerTools   # once
git fetch upstream master
git checkout -b sync-upstream origin/master
git merge upstream/master        # resolve conflicts, then push and open a PR
```

Merge through a PR, not GitHub's "Sync fork" button, so CI runs. That includes the test that compares an efpt config's output with the Visual Studio extension's generator. After it merges, a release is published and everyone runs `efcpt --update`.
