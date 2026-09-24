# Standalone EF Core Power Tools – Planning

Planning docs for turning this fork of [EF Core Power Tools](https://github.com/ErikEJ/EFCorePowerTools) into a **standalone tool**: launched from npm inside any .NET project, pointed at a specific `efcpt-config.json`, with a GUI for picking tables and settings. No Visual Studio needed.

| Doc | What's in it |
| --- | --- |
| [STATE_OF_PROJECT.md](STATE_OF_PROJECT.md) | Report on the current codebase: what's here, how it works, and where it depends on Visual Studio |
| [SCOPE.md](SCOPE.md) | Project scope: goals, non-goals, user workflow, requirements, target architecture, open questions |
| [PLAN.md](PLAN.md) | Phased delivery plan, architecture decisions, risks |
| [TASKS.md](TASKS.md) | Task checklist grouped by phase |
| [ENGINE_INTERFACE.md](ENGINE_INTERFACE.md) | The `efcpt --list-objects --json` contract, selection rules the UI must follow, measured engine sizes |
| [spikes/](spikes/) | Throwaway proofs of concept (`list-objects.mjs`: Node → efcpt → JSON, superseded by `efcpt-ui --list`) |
| [../packages/efcpt-ui](../packages/efcpt-ui) | The npm package: launcher, headless `--generate` / `--list`, and (next) the web UI |

## TL;DR

- The **engine is already decoupled from VS.** Reverse engineering runs in a separate .NET process (`efreveng*`) and in the cross-platform `efcpt` dotnet tool. Both already build on Linux in upstream CI.
- **Only the GUI is tied to VS.** It's WPF on .NET Framework 4.8, built against the VS SDK (DTE projects, Server Explorer connections, VS theming, NuGet installs). Porting it as-is isn't realistic, and WPF only runs on Windows anyway.
- **Plan:** an npm package (`npx efcpt-ui --config ./efcpt-config.json`) starts a local web UI. The UI reads and writes `efcpt-config.json` and calls a slightly extended `efcpt` CLI to list database objects and generate code. The .NET changes are small and live in the CLI only.
