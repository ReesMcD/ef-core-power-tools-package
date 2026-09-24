/* Generated from samples/efcpt-config.schema.json by scripts/sync-schema.mjs. Do not edit. */

export type AddOnConfiguringMethodToTheDbContext = boolean;
export type TypeOfFilesToGenerate = 'all' | 'dbcontext' | 'entities';
export type UseTableAndColumnNamesFromTheDatabase = boolean;
export type UseDataAnnotationAttributesRatherThanTheFluentAPIAsMuchAsPossible = boolean;
export type UseNullableReferenceTypes = boolean;
export type PluralizeOrSingularizeGeneratedNamesEntityClassNamesSingularAndDbSetNamesPlural = boolean;
export type UseEF6PluralizerInsteadOfHumanizer = boolean;
export type PreserveAManyToManyEntityInsteadOfSkippingIt = boolean;
export type CustomizeCodeUsingT4Templates = boolean;
export type CustomizeCodeUsingT4TemplatesIncludingEntityTypeConfigurationT4ThisCannotBeUsedInCombinationWithUseT4OrSplitDbcontextPreview =
  boolean;
export type RemoveSQLDefaultFromBoolColumnsToAvoidThemBeingBool = boolean;
export type RunCleanupOfObsoleteFilesOnLinuxAndMacOSFilesArePermanentlyDeleted = boolean;
export type DiscoverMultipleResultSetsFromSQLStoredProceduresPreview = boolean;
export type UseAlternateResultSetDiscoveryUseSpDescribeFirstResultSetToRetrieveStoredProcedureResultSets =
  boolean;
export type UseFallbackResultSetDiscoveryByReadingTheStoredProcedureDefinitionFromSQLServerSystemTablesWhenMetadataDiscoveryFails =
  boolean;
export type GlobalPathToT4Templates = string | null;
export type RemoveAllNavigationPropertiesFromTheGeneratedCodePreview = boolean;
export type MergeDacpacFilesWhenUsingDacpacReferences = boolean;
export type RefreshTheListsOfObjectsTablesViewsStoredProceduresFunctionsFromTheDatabaseInTheConfigFileDuringScaffolding =
  boolean;
export type CreateAMarkdownFileWithAMermaidERDiagramDuringScaffolding = boolean;
export type UseExplicitDecimalAnnotationForStoreProcedureResults = boolean;
export type UsePrefixBasedNamingOfNavigationsWithEFCore8OrLater = boolean;
export type UseStoredProcedureStoredProcedureResultAndFunctionNamesFromTheDatabase = boolean;
export type WhenGeneratingTheStoredProcedureAndFunctionClassesAndHelpersSetThemToInternalInsteadOfPublic =
  boolean;
export type FullTableName = string;
export type SetToTrueToExcludeThisTableFromCodeGeneration = boolean;
export type ExclusionPatternWithSymbolUseToExcludeAllByDefault = string;
export type Column = string;
export type ColumnsToExcludeFromCodeGeneration = Column[];
export type Index = string;
export type IndexesToExcludeFromCodeGeneration = Index[];
export type ListOfTablesDiscoveredInTheSourceDatabase = Table[];
export type ExclusionPatternWithSymbolUseToExcludeAllByDefault1 = string;
export type Column1 = string;
export type ColumnsToExcludeFromCodeGeneration1 = Column1[];
export type TheStoredProcedureName = string;
export type SetToTrueToExcludeThisStoredProcedureFromCodeGeneration = boolean;
export type UseSpDescribeFirstResultSetInsteadOfSETFMTONLYForResultSetDiscovery = boolean;
export type GenerateEmptyResultClassForThisStoredProcedureWhenResultSetCannotBeDiscoveredWhenFalseDefaultUsesSqlQueryRawDirectly =
  boolean;
export type NameOfAnEntityClassDbSetInYourDbContextThatMapsTheResultOfTheStoredProcedure = string;
export type ExclusionPatternWithSymbolUseToExcludeAllByDefault2 = string;
export type ListOfStoredProceduresDiscoveredInTheSourceDatabase = StoredProcedure[];
export type NameOfFunction = string;
export type SetToTrueToExcludeThisFunctionFromCodeGeneration = boolean;
export type ExclusionPatternWithSymbolUseToExcludeAllByDefault3 = string;
export type ListOfScalarAndTVFFunctionsDiscoveredInTheSourceDatabase = Function[];
export type RootNamespace = string;
export type NameOfDbContextClass = string;
export type NamespaceOfDbContextClass = string | null;
export type NamespaceOfEntities = string | null;
export type OutputPath = string;
export type DbContextOutputPath = string | null;
export type SplitDbContextPreview = boolean;
export type UseSchemaFoldersPreview = boolean;
export type UseSchemaNamespacesPreview = boolean;
export type PreserveCasingWithRegexWhenCustomNaming = boolean;
export type SingularForm = string;
export type PluralForm = string;
export type MatchTheseWordsOnTheirOwnAsWellAsAtTheEndOfLongerWordsTrueByDefault = boolean;
export type IrregularWordsWordsWhichCannotEasilyBePluralizedSingularizedForHumanizerSAddIrregularMethod =
  IrregularWordRule[];
export type WordList = string;
export type UncountableIgnoredWordsForHumanizerSAddUncountableMethod = WordList[];
export type RegExToBeMatchedCaseInsensitive = string;
export type RegExReplacement = string;
export type PluralWordRulesForHumanizerSAddPluralMethod = HumanizerRegExBasedRuleAndReplacement[];
export type SingularWordRulesForHumanizerSAddSingularMethod = HumanizerRegExBasedRuleAndReplacement[];
export type MapDateAndTimeToDateOnlyTimeOnlyMssql = boolean;
export type MapHierarchyIdMssql = boolean;
export type MapSpatialColumns = boolean;
export type UseNodaTime = boolean;

export interface EfcptConfig {
  $schema?: string;
  'code-generation'?: OptionsForCodeGeneration;
  tables?: ListOfTablesDiscoveredInTheSourceDatabase;
  views?: View[];
  'stored-procedures'?: ListOfStoredProceduresDiscoveredInTheSourceDatabase;
  functions?: ListOfScalarAndTVFFunctionsDiscoveredInTheSourceDatabase;
  names?: CustomClassAndNamespaceNames;
  'file-layout'?: CustomFileLayoutOptions;
  replacements?: CustomNamingOptions;
  'type-mappings'?: OptionalTypeMappings;
  [k: string]: unknown;
}
export interface OptionsForCodeGeneration {
  'enable-on-configuring': AddOnConfiguringMethodToTheDbContext;
  type: TypeOfFilesToGenerate;
  'use-database-names': UseTableAndColumnNamesFromTheDatabase;
  'use-data-annotations': UseDataAnnotationAttributesRatherThanTheFluentAPIAsMuchAsPossible;
  'use-nullable-reference-types': UseNullableReferenceTypes;
  'use-inflector': PluralizeOrSingularizeGeneratedNamesEntityClassNamesSingularAndDbSetNamesPlural;
  'use-legacy-inflector': UseEF6PluralizerInsteadOfHumanizer;
  'use-many-to-many-entity': PreserveAManyToManyEntityInsteadOfSkippingIt;
  'use-t4': CustomizeCodeUsingT4Templates;
  'use-t4-split'?: CustomizeCodeUsingT4TemplatesIncludingEntityTypeConfigurationT4ThisCannotBeUsedInCombinationWithUseT4OrSplitDbcontextPreview;
  'remove-defaultsql-from-bool-properties': RemoveSQLDefaultFromBoolColumnsToAvoidThemBeingBool;
  'soft-delete-obsolete-files': RunCleanupOfObsoleteFilesOnLinuxAndMacOSFilesArePermanentlyDeleted;
  'discover-multiple-stored-procedure-resultsets-preview'?: DiscoverMultipleResultSetsFromSQLStoredProceduresPreview;
  'use-alternate-stored-procedure-resultset-discovery': UseAlternateResultSetDiscoveryUseSpDescribeFirstResultSetToRetrieveStoredProcedureResultSets;
  'use-stored-procedure-resultset-fallback': UseFallbackResultSetDiscoveryByReadingTheStoredProcedureDefinitionFromSQLServerSystemTablesWhenMetadataDiscoveryFails;
  't4-template-path'?: GlobalPathToT4Templates;
  'use-no-navigations-preview'?: RemoveAllNavigationPropertiesFromTheGeneratedCodePreview;
  'merge-dacpacs'?: MergeDacpacFilesWhenUsingDacpacReferences;
  'refresh-object-lists'?: RefreshTheListsOfObjectsTablesViewsStoredProceduresFunctionsFromTheDatabaseInTheConfigFileDuringScaffolding;
  'generate-mermaid-diagram'?: CreateAMarkdownFileWithAMermaidERDiagramDuringScaffolding;
  'use-decimal-data-annotation-for-sproc-results'?: UseExplicitDecimalAnnotationForStoreProcedureResults;
  'use-prefix-navigation-naming'?: UsePrefixBasedNamingOfNavigationsWithEFCore8OrLater;
  'use-database-names-for-routines'?: UseStoredProcedureStoredProcedureResultAndFunctionNamesFromTheDatabase;
  'use-internal-access-modifiers-for-sprocs-and-functions'?: WhenGeneratingTheStoredProcedureAndFunctionClassesAndHelpersSetThemToInternalInsteadOfPublic;
  [k: string]: unknown;
}
export interface Table {
  name?: FullTableName;
  exclude?: SetToTrueToExcludeThisTableFromCodeGeneration;
  exclusionWildcard?: ExclusionPatternWithSymbolUseToExcludeAllByDefault;
  excludedColumns?: ColumnsToExcludeFromCodeGeneration;
  excludedIndexes?: IndexesToExcludeFromCodeGeneration;
  [k: string]: unknown;
}
export interface View {
  name?: string;
  exclusionWildcard?: ExclusionPatternWithSymbolUseToExcludeAllByDefault1;
  excludedColumns?: ColumnsToExcludeFromCodeGeneration1;
  [k: string]: unknown;
}
export interface StoredProcedure {
  name?: TheStoredProcedureName;
  exclude?: SetToTrueToExcludeThisStoredProcedureFromCodeGeneration;
  'use-legacy-resultset-discovery'?: UseSpDescribeFirstResultSetInsteadOfSETFMTONLYForResultSetDiscovery;
  'generate-empty-result-type'?: GenerateEmptyResultClassForThisStoredProcedureWhenResultSetCannotBeDiscoveredWhenFalseDefaultUsesSqlQueryRawDirectly;
  'mapped-type'?: NameOfAnEntityClassDbSetInYourDbContextThatMapsTheResultOfTheStoredProcedure;
  exclusionWildcard?: ExclusionPatternWithSymbolUseToExcludeAllByDefault2;
  [k: string]: unknown;
}
export interface Function {
  name?: NameOfFunction;
  exclude?: SetToTrueToExcludeThisFunctionFromCodeGeneration;
  exclusionWildcard?: ExclusionPatternWithSymbolUseToExcludeAllByDefault3;
  [k: string]: unknown;
}
export interface CustomClassAndNamespaceNames {
  'root-namespace': RootNamespace;
  'dbcontext-name': NameOfDbContextClass;
  'dbcontext-namespace'?: NamespaceOfDbContextClass;
  'model-namespace'?: NamespaceOfEntities;
  [k: string]: unknown;
}
export interface CustomFileLayoutOptions {
  'output-path': OutputPath;
  'output-dbcontext-path'?: DbContextOutputPath;
  'split-dbcontext-preview'?: SplitDbContextPreview;
  'use-schema-folders-preview'?: UseSchemaFoldersPreview;
  'use-schema-namespaces-preview'?: UseSchemaNamespacesPreview;
  [k: string]: unknown;
}
export interface CustomNamingOptions {
  'preserve-casing-with-regex'?: PreserveCasingWithRegexWhenCustomNaming;
  'irregular-words'?: IrregularWordsWordsWhichCannotEasilyBePluralizedSingularizedForHumanizerSAddIrregularMethod;
  'uncountable-words'?: UncountableIgnoredWordsForHumanizerSAddUncountableMethod;
  'plural-rules'?: PluralWordRulesForHumanizerSAddPluralMethod;
  'singular-rules'?: SingularWordRulesForHumanizerSAddSingularMethod;
  [k: string]: unknown;
}
export interface IrregularWordRule {
  singular?: SingularForm;
  plural?: PluralForm;
  'match-case'?: MatchTheseWordsOnTheirOwnAsWellAsAtTheEndOfLongerWordsTrueByDefault;
  [k: string]: unknown;
}
export interface HumanizerRegExBasedRuleAndReplacement {
  rule?: RegExToBeMatchedCaseInsensitive;
  replacement?: RegExReplacement;
  [k: string]: unknown;
}
export interface OptionalTypeMappings {
  'use-DateOnly-TimeOnly'?: MapDateAndTimeToDateOnlyTimeOnlyMssql;
  'use-HierarchyId'?: MapHierarchyIdMssql;
  'use-spatial'?: MapSpatialColumns;
  'use-NodaTime'?: UseNodaTime;
  [k: string]: unknown;
}
