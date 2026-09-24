using System;
using System.Collections.Generic;
using System.IO.Abstractions;
using System.Text;
using System.Text.Json;
using ErikEJ.EFCorePowerTools.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using RevEng.Common;
using RevEng.Common.Cli.Configuration;
using RevEng.Core;

namespace ErikEJ.EFCorePowerTools.HostedServices;

internal static class RegisterDependentServices
{
    public static IHostBuilder RegisterServices(this IHostBuilder builder, IFileSystem fileSystem, ScaffoldOptions scaffoldOptions)
    {
        var databaseType = scaffoldOptions.Provider.ToDatabaseType(scaffoldOptions.IsDacpac);
        if (databaseType == DatabaseType.Undefined)
        {
            // Checked before registering services, as the services cannot be created for an unknown provider
            DisplayService.Error($"Unknown provider '{scaffoldOptions.Provider}' - valid values are: mssql, sqlserver, postgres, postgresql, sqlite, oracle, mysql, firebird");
            Environment.ExitCode = 1;
            return builder;
        }

        var reverseOptions = new ReverseEngineerCommandOptions
        {
            DatabaseType = databaseType,
            ConnectionString = scaffoldOptions.ConnectionString,
        };

        if (scaffoldOptions.ConfigFile != null && scaffoldOptions.ConfigFile.Exists)
        {
#pragma warning disable CA1031 // Do not catch general exception types
            try
            {
                var file = fileSystem.File.ReadAllText(scaffoldOptions.ConfigFile.FullName, Encoding.UTF8);
                var cliConfig = JsonSerializer.Deserialize<CliConfig>(file);
                reverseOptions.MergeDacpacs = cliConfig?.CodeGeneration?.MergeDacpacs ?? false;
            }
            catch (Exception ex)
            {
                DisplayService.Error($"Error reading {scaffoldOptions.ConfigFile.FullName}: {ex.Message}");
                Environment.ExitCode = 1;
                return builder;
            }
#pragma warning restore CA1031 // Do not catch general exception types
        }

        scaffoldOptions.ConnectionString = reverseOptions.ConnectionString;
        return builder.ConfigureServices(
            (context, serviceCollection) =>
            {
                serviceCollection.AddEfpt(reverseOptions, new List<string>(), new List<string>(), new List<string>())
                    .AddSingleton(fileSystem)
                    .AddSingleton(scaffoldOptions)
                    .AddSingleton(reverseOptions)
                    .AddSingleton<TableListBuilder>()
                    .AddSingleton(Array.Empty<SchemaInfo>());

                if (scaffoldOptions.ListObjects)
                {
                    serviceCollection.AddHostedService<ListObjectsHostedService>();
                }
                else
                {
                    serviceCollection.AddHostedService<ScaffoldHostedService>();
                }
            });
    }
}