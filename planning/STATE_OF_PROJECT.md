# State of the Project

_Snapshot as of 2026-09-24, fork head `b5312dc` ("Enable nullable on tools CLI (#3479)")._

## Summary

This fork is currently **identical to upstream** `ErikEJ/EFCorePowerTools`: the latest commits are all upstream (Aug 2026), and there are no fork-specific changes yet. The upstream project is active and well maintained. It supports EF Core 8, 9 and 10, and releases often.

The main takeaway for the standalone goal: **the repo is already split into a portable engine and a Windows/VS-only GUI.** The hard part (schema reading, scaffolding, naming, T4 templates, stored procedures) already runs cross-platform with no VS. What's tied to VS is the UI and the "glue" that talks to the IDE.

## Repository layout

```
src/
  Core/                      <- portable engine + CLI (.NET 8/9/10)
    RevEng.Core.80/.90/.100  <- reverse engineering engine, one per EF Core major
    RevEng.Core.Abstractions
    efreveng80/90/100        <- console "engine host" used by the VS extension (stdin args / stdout JSON)
    efcpt.8/.9/.10           <- `efcpt` dotnet global tool (ErikEJ.EFCorePowerTools.Cli)
    efpt80/90/100.core       <- model visualisation (DGML/debug view) host for the VS extension
    DacFxStrongTypedCore.161, SqlServer.Rules.Report  <- .dacpac support / reporting
    NUnitTestCore, NUnitTestCore100                   <- engine tests
  GUI/                       <- Visual Studio extension (Windows only)
    EFCorePowerTools/        <- VSIX project: WPF dialogs, wizard, package, .vsct menus (net48)
    Shared/                  <- shared project: handlers, view models, VS helpers (~12.5k LOC)
    RevEng.Shared/           <- RevEng.Common: options/DTOs + CLI config model (netstandard, portable)
    UnitTests/, WizardItemTemplate/, PowerToolsExtensionPack/
    lib/                     <- prebuilt zips of efreveng*/efpt* + T4 templates bundled into the VSIX
  Nupkg/                     <- side NuGet packages (Dacpac provider, DgmlBuilder)
samples/                     <- efcpt-config.json sample + JSON schema + option docs
test/                        <- ScaffoldingTester sample DBs/solutions (Northwind/Chinook, Postgres, Docker)
docs/                        <- GitHub Pages presentation site (HTML)
```

Around 400 C# files, 24 XAML files, and 4 GitHub workflows (`vsix.yml` on Windows; `cli-tool.yml`, `cli-release.yml` and `nupkg-release.yml` build on Ubuntu).

## How the pieces work today

### 1. The engine (`RevEng.Core.*`): portable

- Built separately for each EF Core major (8/9/10) because it references the provider packages for that version: SQL Server, PostgreSQL (Npgsql), SQLite, Oracle, MySQL (Microting in EF 10), Firebird, Snowflake, Dataverse. It also supports `.dacpac` files as a schema source.
- Main entry points:
  - `TableListBuilder`: connects to the DB and returns `List<TableModel>` (tables, views, procedures, functions, with columns).
  - `ReverseEngineerRunner.GenerateFiles(ReverseEngineerCommandOptions)`: writes the DbContext, entities, configurations and procedure/function code, and returns a `ReverseEngineerResult` (file paths, warnings, errors).
- No VS or Windows dependencies.

### 2. The engine host (`efreveng*`): portable, used by the VS extension

The VS extension **does not load EF Core in-process.** `EfRevEngLauncher` (`src/GUI/Shared/Handlers/ReverseEngineer/EfRevEngLauncher.cs`) unzips `efreveng{80,90,100}.exe.zip` into a temp folder and runs `dotnet efreveng100.dll ...`. It uses a simple text protocol:

| Invocation | Purpose | Output |
| --- | --- | --- |
| `efreveng <mergeDacpacs> <dbTypeInt> "<connStr>" ["schema1,schema2"]` | List DB objects | `Result:\n<JSON List<TableModel>>` |
| `efreveng <path-to-options.json>` | Generate code from `ReverseEngineerCommandOptions` JSON | `Result:\n<JSON ReverseEngineerResult>` |
| `efreveng dgml / erdiagram / dabbuilder / dacpacreport ...` | Diagrams, Data API Builder, reports | `Result:\n<file path>` |
| any failure | | `Error:\n<message>` |

**This is the seam the whole standalone plan relies on.** The GUI already talks to the engine only through JSON over a process boundary.

### 3. The `efcpt` CLI: portable, published on NuGet

- `dotnet tool install ErikEJ.EFCorePowerTools.Cli -g --version 10.*` installs it, and you run it as `efcpt "<connection string or .dacpac>" [provider] [-i efcpt-config.json] [-o outdir] [-r efpt.renaming.json]`.
- Headless and non-interactive. It uses Spectre.Console for output, but has no table picker or prompts.
- Config lives in **`efcpt-config.json`** (JSON schema at `samples/efcpt-config.schema.json`). It covers object lists with `exclude` flags and wildcard exclusions, `code-generation`, `names`, `file-layout`, `type-mappings` and `replacements`.
- On first run it **writes the config file with every discovered object**. With `refresh-object-lists: true` it keeps the lists in sync with the DB on every run (`CliConfigMapper.TryGetCliConfig`).
- **The connection string is not stored in the config file.** It's always passed as an argument.
- There is no mode to just list the objects as JSON. It always discovers and then generates.

### 4. The VS extension GUI: Windows and VS only

- `EFCorePowerTools.csproj` targets **.NET Framework 4.8** and uses `Microsoft.VisualStudio.SDK`, `Community.VisualStudio.Toolkit.17`, WPF, MvvmLight, VS data (DDEX) APIs, and VS-hosted NuGet APIs.
- Reverse-engineer flow (`ReverseEngineerHandler.cs`, ~830 LOC):
  1. **Pick project** (DTE `Project`), then **pick config**. It supports several `efpt.*config.json` files per project, found by searching the project folder.
  2. **Pick connection** from VS Server Explorer (DDEX) and the Windows Credential Manager, or a `.dacpac` / SQL project in the solution (which it builds with MSBuild via VS).
  3. **Pick schemas** (optional).
  4. **Pick tables**: a tree of schema → tables/views/procs/functions with checkboxes and search, plus **per-column exclude and rename**. Renames are saved to `efpt.renaming.json`.
  5. **Modeling options** dialog, then an **Advanced options** dialog.
  6. Run `efreveng`, **install the NuGet packages** it needs into the project, add the files to the project, and show a readme.
- Note: the VS extension saves its settings as **`efpt.config.json`** (serialized `ReverseEngineerOptions`), which is a different format from the CLI's `efcpt-config.json`. The extension also has a "run CLI" path (`CliHandler.cs`) that works with `efcpt-config.json`.

### VS coupling inventory (`src/GUI/Shared`)

30 files reference VS APIs. Grouped by what they're for:

| Area | Files | Standalone replacement |
| --- | --- | --- |
| Project model (DTE `Project`, add files, root namespace, target framework) | `ProjectExtensions.cs`, `ProjectModel.cs`, `VisualStudioAccess.cs` | Read the `.csproj` with MSBuild XML or `dotnet msbuild -getProperty` |
| DB connections (Server Explorer / DDEX, credential store) | `VsDataHelper.cs`, `CredentialStore.cs`, `DatabaseConnectionModel.cs`, `PickServerDatabaseViewModel.cs` | Connection string from CLI flag, env var, user-secrets or appsettings, or entered in the UI |
| SQL project (.sqlproj) builds | `SqlProjHelper.cs` | `dotnet build` of the .sqlproj, or point at a built `.dacpac` |
| NuGet install into project | `NuGetHelper.cs`, parts of `ReverseEngineerHandler.cs` | Print or run `dotnet add package` |
| UI plumbing (threading, dialogs, theming, status bar, telemetry, options pages) | `VSHelper.cs`, `VsThemes.cs`, `Telemetry.cs`, `AdvancedOptions.cs`, `OptionsProvider.cs` | Not needed; web UI plus config file |
| Orchestration | `ReverseEngineerHandler.cs`, `RevEngWizardHandler.cs`, `WizardDataViewModel.cs`, `CliHandler.cs` | New orchestrator in the npm package |

**Already portable and reusable as reference:** `RevEng.Shared` (options, `TableModel`, `CliConfig`, `CliConfigMapper`, `ExclusionFilter`, `T4Helper`, `Providers`), and the logic in `PickTablesViewModel`, `ObjectTreeViewModel`, `ModelingOptionsModel` and `TableInformationViewModel`. Those view models are plain C# over MvvmLight, so they spell out the behaviour a new UI needs to match.

## Build and test status

- **Engine and CLI:** upstream CI (`cli-tool.yml`) runs `NUnitTestCore` on Ubuntu and Windows, and builds and packs `efcpt.8/9/10` on Ubuntu. So the headless parts build cross-platform with the .NET 10 SDK (`global.json` pins `10.0.100`, rollForward `latestPatch`).
- **VSIX:** only builds on `windows-latest` with the VS SDK.
- **Not verified locally in this session:** this sandbox's network policy blocks the .NET SDK download, so nothing was compiled here. The build status above comes from the CI workflow definitions.

## Useful facts for the standalone effort

- The `efcpt-config.json` schema doesn't set `additionalProperties: false`, and `System.Text.Json` ignores unknown properties. So we can add our own section (for example, where to get the connection string) without breaking `efcpt`.
- EF Core version matters: the matching `RevEng.Core.{80,90,100}` / `efcpt.{8,9,10}` has to line up with the target project's EF Core major. The target `.csproj` package references tell us which one.
- T4 templates for each EF version are bundled as zips in `src/GUI/lib/T4_*.zip`, and `efcpt` drops them into the project when `use-t4` is on.
- License is MIT (Copyright ErikEJ). Forking and redistributing is fine as long as we keep attribution. We should pick a new package name so it isn't confused with the official "EF Core Power Tools" / `efcpt`.

## Risks spotted

- **Upstream drift.** Upstream changes weekly. Keep our changes additive (new files, new CLI verbs) so merging upstream stays cheap.
- **Three EF Core flavours.** Anything we add to `efcpt` has to be multi-targeted the same way (shared source linked into `efcpt.8/9/10`, which is already how it works).
- **Connection secrets.** The VS flow keeps credentials in Windows Credential Manager. A standalone tool needs a clear, safe story here (see SCOPE open questions).
- **Config rewrite drops unknown keys.** _(Resolved for top-level keys in Phase 1, task E4.)_ `CliConfigMapper.TryGetCliConfig` re-serializes the whole `CliConfig` on first run or when `refresh-object-lists` is on. Any section the engine doesn't know about is lost, and `$schema` is forced back to the upstream URL. Any extra metadata we store in the config needs `[JsonExtensionData]` added to `CliConfig`.
- **No "list objects only" mode.** _(Resolved in Phase 1: `efcpt --list-objects --json`, tasks E1–E2.)_ `efcpt` always discovers and then generates, and writes the config as a side effect. The UI needs a read-only discovery call (`efreveng` has one, but it isn't shipped as a package).
- **Feature parity creep.** The VS GUI also does DGML, ER diagrams, DAB, schema compare, and dacpac analysis. These are explicitly out of scope for v1.
