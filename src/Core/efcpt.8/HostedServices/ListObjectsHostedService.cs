using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ErikEJ.EFCorePowerTools.Services;
using Microsoft.Extensions.Hosting;
using RevEng.Common;
using RevEng.Common.Cli;
using RevEng.Core;
using Spectre.Console;

namespace ErikEJ.EFCorePowerTools.HostedServices;

#pragma warning disable CA1812 // Avoid uninstantiated internal classes
internal sealed class ListObjectsHostedService : HostedService
{
    private readonly IHostApplicationLifetime hostApplicationLifetime;
    private readonly ReverseEngineerCommandOptions reverseEngineerCommandOptions;
    private readonly TableListBuilder tableListBuilder;

    public ListObjectsHostedService(
        TableListBuilder tableListBuilder,
        IHostApplicationLifetime hostApplicationLifetime,
        ReverseEngineerCommandOptions reverseEngineerCommandOptions)
    {
        this.tableListBuilder = tableListBuilder;
        this.hostApplicationLifetime = hostApplicationLifetime;
        this.reverseEngineerCommandOptions = reverseEngineerCommandOptions;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            var objects = DisplayService.Wait("Getting database objects...", GetObjects) ?? new List<TableModel>();

            if (JsonOutput.Enabled)
            {
                JsonOutput.Write(CliJsonOutput.BuildObjectList(objects, reverseEngineerCommandOptions.DatabaseType, Constants.Version));
            }
            else
            {
                ShowObjects(objects);
            }

            Environment.ExitCode = 0;
        }
#pragma warning disable CA1031 // Do not catch general exception types
        catch (Exception ex)
        {
            DisplayService.Error(ex.Message);
            Environment.ExitCode = 1;
        }
#pragma warning restore CA1031 // Do not catch general exception types
        finally
        {
            hostApplicationLifetime.StopApplication();
        }

        return Task.CompletedTask;
    }

    private static void ShowObjects(List<TableModel> objects)
    {
        foreach (var group in objects.GroupBy(o => o.ObjectType).OrderBy(g => g.Key))
        {
            DisplayService.MarkupLine();
            DisplayService.MarkupLine($"{CliJsonOutput.ToJsonObjectType(group.Key)} ({group.Count()}):", Color.Green);
            foreach (var model in group.OrderBy(o => o.DisplayName, StringComparer.OrdinalIgnoreCase))
            {
                DisplayService.MarkupLine(Markup.Escape(model.DisplayName), Color.Default);
            }
        }

        DisplayService.MarkupLine();
        DisplayService.MarkupLine($"{objects.Count} database objects found", Color.Default);
    }

    private List<TableModel> GetObjects()
    {
        var objects = tableListBuilder.GetTableModels();
        objects.AddRange(tableListBuilder.GetProcedures());
        objects.AddRange(tableListBuilder.GetFunctions());
        return objects;
    }
}
#pragma warning restore CA1812 // Avoid uninstantiated internal classes
