using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevEng.Common.Cli
{
    /// <summary>
    /// Machine readable output of the CLI when invoked with --json.
    /// Every invocation writes exactly one document to stdout.
    /// </summary>
    public static class CliJsonOutput
    {
        public const int SchemaVersion = 1;

        public const string ListObjectsCommand = "list-objects";

        public const string GenerateCommand = "generate";

        private static readonly JsonSerializerOptions SerializerOptions = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };

        public static CliObjectListDocument BuildObjectList(IEnumerable<TableModel> objects, DatabaseType databaseType, int efCoreVersion)
        {
            if (objects is null)
            {
                throw new ArgumentNullException(nameof(objects));
            }

            return new CliObjectListDocument
            {
                EfCoreVersion = efCoreVersion,
                DatabaseType = databaseType.ToString(),
                Objects = objects.Select(ToJsonObject).ToList(),
            };
        }

        public static CliGenerateDocument BuildGenerateResult(
            ReverseEngineerResult result,
            IEnumerable<string> configWarnings,
            DatabaseType databaseType,
            int efCoreVersion)
        {
            if (result is null)
            {
                throw new ArgumentNullException(nameof(result));
            }

            var errors = result.EntityErrors ?? new List<string>();
            var warnings = (result.EntityWarnings ?? new List<string>())
                .Concat(configWarnings ?? Enumerable.Empty<string>())
                .Distinct()
                .ToList();

            return new CliGenerateDocument
            {
                Success = errors.Count == 0,
                EfCoreVersion = efCoreVersion,
                DatabaseType = databaseType.ToString(),
                ContextFilePath = result.ContextFilePath,
                ContextConfigurationFilePaths = result.ContextConfigurationFilePaths?.ToList() ?? new List<string>(),
                EntityTypeFilePaths = result.EntityTypeFilePaths?.ToList() ?? new List<string>(),
                Errors = errors.ToList(),
                Warnings = warnings,
            };
        }

        public static CliJsonDocument BuildError(string command, IEnumerable<string> errors)
        {
            var list = errors?.Where(e => !string.IsNullOrWhiteSpace(e)).ToList() ?? new List<string>();
            if (list.Count == 0)
            {
                list.Add("Unknown error");
            }

            return new CliJsonDocument
            {
                Command = command,
                Success = false,
                Errors = list,
            };
        }

        public static string Serialize(CliJsonDocument document)
        {
            if (document is null)
            {
                throw new ArgumentNullException(nameof(document));
            }

            // Serialize using the runtime type so derived document properties are included
            return JsonSerializer.Serialize(document, document.GetType(), SerializerOptions);
        }

        public static string ToJsonObjectType(ObjectType objectType)
        {
            return objectType switch
            {
                ObjectType.Table => "table",
                ObjectType.View => "view",
                ObjectType.Procedure => "storedProcedure",
                ObjectType.ScalarFunction => "function",
                _ => objectType.ToString(),
            };
        }

        private static CliJsonObject ToJsonObject(TableModel model)
        {
            return new CliJsonObject
            {
                DisplayName = model.DisplayName,
                Schema = model.Schema,
                Name = model.Name,
                Type = ToJsonObjectType(model.ObjectType),
                Columns = model.Columns?.Select(c => new CliJsonColumn
                {
                    Name = c.Name,
                    StoreType = c.StoreType,
                    IsPrimaryKey = c.IsPrimaryKey,
                    IsForeignKey = c.IsForeignKey,
                }).ToList(),
            };
        }
    }

#pragma warning disable CA2227 // Collection properties should be read only
#pragma warning disable SA1402 // File may only contain a single type
    public class CliJsonDocument
    {
        [JsonPropertyOrder(-3)]
        public int SchemaVersion { get; set; } = CliJsonOutput.SchemaVersion;

        [JsonPropertyOrder(-2)]
        public string Command { get; set; }

        [JsonPropertyOrder(-1)]
        public bool Success { get; set; } = true;

        [JsonPropertyOrder(100)]
        public List<string> Errors { get; set; } = new List<string>();

        [JsonPropertyOrder(101)]
        public List<string> Warnings { get; set; } = new List<string>();
    }

    public class CliObjectListDocument : CliJsonDocument
    {
        public CliObjectListDocument()
        {
            Command = CliJsonOutput.ListObjectsCommand;
        }

        public int EfCoreVersion { get; set; }

        public string DatabaseType { get; set; }

        public List<CliJsonObject> Objects { get; set; } = new List<CliJsonObject>();
    }

    public class CliGenerateDocument : CliJsonDocument
    {
        public CliGenerateDocument()
        {
            Command = CliJsonOutput.GenerateCommand;
        }

        public int EfCoreVersion { get; set; }

        public string DatabaseType { get; set; }

        public string ConfigPath { get; set; }

        public string ContextFilePath { get; set; }

        public List<string> ContextConfigurationFilePaths { get; set; } = new List<string>();

        public List<string> EntityTypeFilePaths { get; set; } = new List<string>();

        public List<string> OutputFolders { get; set; } = new List<string>();

        public string ReadmePath { get; set; }

        public string DiagramPath { get; set; }
    }

    public class CliJsonObject
    {
        /// <summary>
        /// Gets or sets the object name as used in the "name" property of efcpt-config.json entries.
        /// </summary>
        public string DisplayName { get; set; }

        public string Schema { get; set; }

        public string Name { get; set; }

        /// <summary>
        /// Gets or sets the object type: table, view, storedProcedure or function.
        /// </summary>
        public string Type { get; set; }

        public List<CliJsonColumn> Columns { get; set; }
    }

    public class CliJsonColumn
    {
        public string Name { get; set; }

        public string StoreType { get; set; }

        public bool IsPrimaryKey { get; set; }

        public bool IsForeignKey { get; set; }
    }
#pragma warning restore SA1402 // File may only contain a single type
#pragma warning restore CA2227 // Collection properties should be read only
}
