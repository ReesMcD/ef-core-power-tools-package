using System;
using System.Collections.Generic;
using System.IO;
using RevEng.Common.Cli;
using Spectre.Console;

namespace ErikEJ.EFCorePowerTools.Services;

/// <summary>
/// Handles --json mode: all human readable output is moved to stderr,
/// and exactly one JSON document is written to stdout.
/// </summary>
internal static class JsonOutput
{
    private static readonly List<string> Errors = new();
    private static TextWriter? stdout;
    private static bool documentWritten;

    public static bool Enabled { get; private set; }

    public static string Command { get; set; } = CliJsonOutput.GenerateCommand;

    public static void Enable()
    {
        if (Enabled)
        {
            return;
        }

        Enabled = true;

        // Keep a private handle to stdout, and send everything else (including stray Console.WriteLine calls) to stderr
        stdout = Console.Out;
        Console.SetOut(Console.Error);
        AnsiConsole.Console = AnsiConsole.Create(new AnsiConsoleSettings
        {
            Out = new AnsiConsoleOutput(Console.Error),
        });
    }

    public static void RecordError(string message)
    {
        if (Enabled)
        {
            Errors.Add(message);
        }
    }

    public static void Write(CliJsonDocument document)
    {
        if (!Enabled || documentWritten || stdout is null)
        {
            return;
        }

        documentWritten = true;
        stdout.WriteLine(CliJsonOutput.Serialize(document));
        stdout.Flush();
    }

    /// <summary>
    /// Makes sure a document is always written: if the command did not produce one, write an error document.
    /// </summary>
    public static void Complete()
    {
        if (!Enabled || documentWritten)
        {
            return;
        }

        if (Errors.Count == 0)
        {
            Errors.Add("The command completed without producing a result");
        }

        Write(CliJsonOutput.BuildError(Command, Errors));

        if (Environment.ExitCode == 0)
        {
            Environment.ExitCode = 1;
        }
    }
}
