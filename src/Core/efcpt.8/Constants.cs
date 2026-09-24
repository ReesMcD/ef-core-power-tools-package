using RevEng.Common;

namespace ErikEJ.EFCorePowerTools;

internal static class Constants
{
    public const string ConfigFileName = RevEng.Common.Constants.ConfigFileName;
    public const string RenamingFileName = RevEng.Common.Constants.RenamingFileName;

    // This fork's package identity, used by the update check (the upstream tool is ErikEJ.EFCorePowerTools.Cli)
    public const string PackageId = "ReesMcD.EFCorePowerTools.Engine";
    public const string ProjectUrl = "https://github.com/ReesMcD/ef-core-power-tools-package";

#if CORE80
    public const CodeGenerationMode CodeGeneration = CodeGenerationMode.EFCore8;
    public const int Version = 8;
#elif CORE90
    public const CodeGenerationMode CodeGeneration = CodeGenerationMode.EFCore9;
    public const int Version = 9;
#elif CORE100
    public const CodeGenerationMode CodeGeneration = CodeGenerationMode.EFCore10;
    public const int Version = 10;
#endif
}