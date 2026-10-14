# Standalone EF Core Power Tools – Planning

Planning docs for turning this fork of [EF Core Power Tools](https://github.com/ErikEJ/EFCorePowerTools) into a **standalone tool**: launched from npm inside any .NET project, pointed at a specific `efcpt-config.json`, with a GUI for picking tables and settings. No Visual Studio needed.

| Doc                                          | What's in it                                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [STATE_OF_PROJECT.md](STATE_OF_PROJECT.md)   | Report on the current codebase: what's here, how it works, and where it depends on Visual Studio                                                          |
| [SCOPE.md](SCOPE.md)                         | Project scope: goals, non-goals, user workflow, requirements, target architecture, open questions                                                         |
| [PLAN.md](PLAN.md)                           | Phased delivery plan, architecture decisions, risks                                                                                                       |
| [TASKS.md](TASKS.md)                         | Task checklist grouped by phase                                                                                                                           |
| [ENGINE_INTERFACE.md](ENGINE_INTERFACE.md)   | The `efcpt --list-objects --json` contract, selection rules the UI must follow, measured engine sizes                                                     |
| [spikes/](spikes/)                           | Throwaway proofs of concept (`list-objects.mjs`: Node → efcpt → JSON, superseded by `efcpt --list`)                                                       |
| [../packages/efcpt-cli](../packages/efcpt-cli) | The tool itself, efcpt-cli (command `efcpt`; called efcpt-ui until 2026-10-14): web UI, headless `--generate` / `--list`, `--import-vs`, `--update`. Its README is the user guide |

## Status (2026-10-14)

Phases 0–3 are done and the tool is in use on the team, installed from a clone of this repository and updated with `efcpt --update` (no package registry). What's left is in [TASKS.md](TASKS.md): mainly a release workflow, renaming in the UI, and a strategy for syncing with upstream (U1). [STATE_OF_PROJECT.md](STATE_OF_PROJECT.md), [SCOPE.md](SCOPE.md) and [PLAN.md](PLAN.md) are the original planning documents, kept for the reasoning behind the design; decisions made since are noted in SCOPE.md.

## TL;DR (from the original plan)

- The **engine is already decoupled from VS.** Reverse engineering runs in a separate .NET process (`efreveng*`) and in the cross-platform `efcpt` dotnet tool. Both already build on Linux in upstream CI.
- **Only the GUI is tied to VS.** It's WPF on .NET Framework 4.8, built against the VS SDK (DTE projects, Server Explorer connections, VS theming, NuGet installs). Porting it as-is isn't realistic, and WPF only runs on Windows anyway.
- **Plan:** an npm package (`npx efcpt-ui --config ./efcpt-config.json`) starts a local web UI. The UI reads and writes `efcpt-config.json` and calls a slightly extended `efcpt` CLI to list database objects and generate code. The .NET changes are small and live in the CLI only.
