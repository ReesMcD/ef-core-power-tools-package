using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Xunit;
using RevEng.Common;
using RevEng.Common.Cli;
using RevEng.Common.Cli.Configuration;

namespace UnitTests
{
    public class CliJsonOutputTest
    {
        private readonly string cliTestDirectory = Path.Combine(AppContext.BaseDirectory, "CliJsonOutputTests");

        public CliJsonOutputTest()
        {
            if (!Directory.Exists(cliTestDirectory))
            {
                Directory.CreateDirectory(cliTestDirectory);
            }
        }

        [Fact]
        public void ObjectListUsesConfigNamesAndStableTypes()
        {
            var objects = new List<TableModel>
            {
                new TableModel("Users", "dbo", DatabaseType.SQLServer, ObjectType.Table, new List<ColumnModel>
                {
                    new ColumnModel("Id", "int", isPrimaryKey: true, isForeignKey: false),
                    new ColumnModel("GroupId", "int", isPrimaryKey: false, isForeignKey: true),
                }),
                new TableModel("UsersView", "dbo", DatabaseType.SQLServer, ObjectType.View, null),
                new TableModel("GetUsers", "dbo", DatabaseType.SQLServer, ObjectType.Procedure, null),
                new TableModel("CountUsers", "dbo", DatabaseType.SQLServer, ObjectType.ScalarFunction, null),
            };

            var json = CliJsonOutput.Serialize(CliJsonOutput.BuildObjectList(objects, DatabaseType.SQLServer, 10));

            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            Assert.Equal(1, root.GetProperty("schemaVersion").GetInt32());
            Assert.Equal("list-objects", root.GetProperty("command").GetString());
            Assert.True(root.GetProperty("success").GetBoolean());
            Assert.Equal(10, root.GetProperty("efCoreVersion").GetInt32());
            Assert.Equal("SQLServer", root.GetProperty("databaseType").GetString());

            var items = root.GetProperty("objects").EnumerateArray().ToList();
            Assert.Equal(4, items.Count);

            // displayName must match the "name" used for entries in efcpt-config.json
            Assert.Equal("[dbo].[Users]", items[0].GetProperty("displayName").GetString());
            Assert.Equal("Users", items[0].GetProperty("name").GetString());
            Assert.Equal("dbo", items[0].GetProperty("schema").GetString());
            Assert.Equal(
                new[] { "table", "view", "storedProcedure", "function" },
                items.Select(i => i.GetProperty("type").GetString()).ToArray());

            var columns = items[0].GetProperty("columns").EnumerateArray().ToList();
            Assert.Equal("Id", columns[0].GetProperty("name").GetString());
            Assert.Equal("int", columns[0].GetProperty("storeType").GetString());
            Assert.True(columns[0].GetProperty("isPrimaryKey").GetBoolean());
            Assert.True(columns[1].GetProperty("isForeignKey").GetBoolean());
        }

        [Fact]
        public void ObjectListDisplayNameWithoutSchemaForNonSqlServer()
        {
            var objects = new List<TableModel>
            {
                new TableModel("Customers", null, DatabaseType.SQLite, ObjectType.Table, null),
                new TableModel("orders", "public", DatabaseType.Npgsql, ObjectType.Table, null),
            };

            var result = CliJsonOutput.BuildObjectList(objects, DatabaseType.SQLite, 8);

            Assert.Equal("Customers", result.Objects[0].DisplayName);
            Assert.Equal("public.orders", result.Objects[1].DisplayName);
        }

        [Fact]
        public void SerializedDocumentIsSingleLine()
        {
            var objects = new List<TableModel>
            {
                new TableModel("Users", "dbo", DatabaseType.SQLServer, ObjectType.Table, null),
            };

            var json = CliJsonOutput.Serialize(CliJsonOutput.BuildObjectList(objects, DatabaseType.SQLServer, 10));

            Assert.DoesNotContain('\n', json);
        }

        [Fact]
        public void GenerateResultIsNotSuccessfulWhenThereAreErrors()
        {
            var result = new ReverseEngineerResult
            {
                ContextFilePath = "/out/MyContext.cs",
                EntityTypeFilePaths = new List<string> { "/out/Models/User.cs" },
                ContextConfigurationFilePaths = new List<string>(),
                EntityErrors = new List<string> { "Unable to scaffold procedure" },
                EntityWarnings = new List<string> { "shared warning" },
            };

            var document = CliJsonOutput.BuildGenerateResult(result, new[] { "shared warning", "config warning" }, DatabaseType.SQLServer, 9);

            Assert.False(document.Success);
            Assert.Equal("generate", document.Command);
            Assert.Equal(9, document.EfCoreVersion);
            Assert.Equal("/out/MyContext.cs", document.ContextFilePath);
            Assert.Single(document.EntityTypeFilePaths);
            Assert.Single(document.Errors);
            Assert.Equal(new[] { "shared warning", "config warning" }, document.Warnings);
        }

        [Fact]
        public void GenerateResultHandlesMissingLists()
        {
            var document = CliJsonOutput.BuildGenerateResult(new ReverseEngineerResult(), null, DatabaseType.SQLite, 10);

            Assert.True(document.Success);
            Assert.Empty(document.EntityTypeFilePaths);
            Assert.Empty(document.ContextConfigurationFilePaths);
            Assert.Empty(document.Errors);
            Assert.Empty(document.Warnings);
        }

        [Fact]
        public void ErrorDocumentAlwaysHasAMessage()
        {
            var json = CliJsonOutput.Serialize(CliJsonOutput.BuildError(CliJsonOutput.ListObjectsCommand, new[] { " ", null }));

            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            Assert.False(root.GetProperty("success").GetBoolean());
            Assert.Equal("list-objects", root.GetProperty("command").GetString());
            Assert.Equal("Unknown error", root.GetProperty("errors")[0].GetString());
        }

        [Fact]
        public void CliConfigKeepsUnknownSectionsAndSchema()
        {
            const string json = """
                {
                  "$schema": "./local.schema.json",
                  "efcpt-ui": { "connection": { "env": "SHOP_DB" } },
                  "tables": [ { "name": "[dbo].[Users]" } ]
                }
                """;

            var config = JsonSerializer.Deserialize<CliConfig>(json);
            var written = JsonSerializer.Serialize(config);

            using var document = JsonDocument.Parse(written);
            var root = document.RootElement;
            Assert.Equal("./local.schema.json", root.GetProperty("$schema").GetString());
            Assert.Equal("SHOP_DB", root.GetProperty("efcpt-ui").GetProperty("connection").GetProperty("env").GetString());
            Assert.Equal("[dbo].[Users]", root.GetProperty("tables")[0].GetProperty("name").GetString());
        }

        [Fact]
        public void CliConfigUsesDefaultSchemaWhenMissing()
        {
            var config = JsonSerializer.Deserialize<CliConfig>("{}");

            Assert.Equal(CliConfig.DefaultJsonSchema, config.JsonSchema);
            Assert.Null(config.ExtensionData);
        }

        [Fact]
        public void RefreshingObjectListsKeepsUnknownSections()
        {
            var path = Path.Combine(cliTestDirectory, "refresh.efcpt-config.json");
            File.WriteAllText(
                path,
                """
                {
                  "$schema": "./local.schema.json",
                  "efcpt-ui": { "connection": { "env": "SHOP_DB" } },
                  "code-generation": { "refresh-object-lists": true },
                  "tables": [ { "name": "[dbo].[Users]", "exclude": true } ]
                }
                """,
                Encoding.UTF8);

            var objects = new List<TableModel>
            {
                new TableModel("Users", "dbo", DatabaseType.SQLServer, ObjectType.Table, null),
                new TableModel("Orders", "dbo", DatabaseType.SQLServer, ObjectType.Table, null),
            };

            var ok = CliConfigMapper.TryGetCliConfig(path, "Server=.;Database=Shop", DatabaseType.SQLServer, objects, CodeGenerationMode.EFCore10, out _, out _);

            Assert.True(ok);
            using var document = JsonDocument.Parse(File.ReadAllText(path, Encoding.UTF8));
            var root = document.RootElement;
            Assert.Equal("./local.schema.json", root.GetProperty("$schema").GetString());
            Assert.Equal("SHOP_DB", root.GetProperty("efcpt-ui").GetProperty("connection").GetProperty("env").GetString());

            var tables = root.GetProperty("tables").EnumerateArray().ToList();
            Assert.Equal(2, tables.Count);
            Assert.True(tables.Single(t => t.GetProperty("name").GetString() == "[dbo].[Users]").GetProperty("exclude").GetBoolean());
        }
    }
}
