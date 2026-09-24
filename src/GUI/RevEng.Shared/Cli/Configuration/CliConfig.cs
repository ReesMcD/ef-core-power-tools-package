using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace RevEng.Common.Cli.Configuration
{
#pragma warning disable CA2227
    public class CliConfig
    {
        public const string DefaultJsonSchema =
            "https://raw.githubusercontent.com/ErikEJ/EFCorePowerTools/master/samples/efcpt-config.schema.json";

        [JsonPropertyOrder(-1)]
        [JsonPropertyName("$schema")]
        public string JsonSchema { get; set; } = DefaultJsonSchema;

        [JsonPropertyOrder(10)]
        [JsonPropertyName("code-generation")]
        public CodeGeneration CodeGeneration { get; set; } = new CodeGeneration();

        [JsonPropertyOrder(20)]
        [JsonPropertyName("file-layout")]
        public FileLayout FileLayout { get; set; } = new FileLayout();

        [JsonPropertyOrder(30)]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
        [JsonPropertyName("functions")]
        public List<Function> Functions { get; set; }

        [JsonPropertyOrder(40)]
        [JsonPropertyName("names")]
        public Names Names { get; set; } = new Names();

        [JsonPropertyOrder(50)]
        [JsonPropertyName("replacements")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
        public Replacements Replacements { get; set; }

        [JsonPropertyOrder(60)]
        [JsonPropertyName("stored-procedures")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
        public List<StoredProcedure> StoredProcedures { get; set; }

        [JsonPropertyOrder(70)]
        [JsonPropertyName("tables")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
        public List<Table> Tables { get; set; }

        [JsonPropertyOrder(80)]
        [JsonPropertyName("type-mappings")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
        public TypeMappings TypeMappings { get; set; }

        [JsonPropertyOrder(90)]
        [JsonPropertyName("views")]
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
        public List<View> Views { get; set; }

        /// <summary>
        /// Gets or sets top level properties not known by the tool, so they survive when the file is rewritten.
        /// </summary>
        [JsonExtensionData]
        public Dictionary<string, JsonElement> ExtensionData { get; set; }
    }
#pragma warning restore CA2227
}