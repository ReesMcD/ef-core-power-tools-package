import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EfcptConfig } from '../src/config/io.js';
import { compareVsNames, readVsConfig, writeVsConfig } from '../src/config/vs-config.js';

/** Like a team's efpt.SQLMIContext.config.json, as the extension (2.6.1763) writes it. */
function vsConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    CodeGenerationMode: 4,
    ContextClassName: 'SQLMIContext',
    ContextNamespace: null,
    FilterSchemas: true,
    IncludeConnectionString: false,
    IrregularWords: null,
    MinimumProductVersion: '2.6.1763',
    ModelNamespace: '',
    OutputContextPath: '',
    OutputPath: 'SQLMIModels',
    PluralRules: null,
    PreserveCasingWithRegex: true,
    ProjectRootNamespace: 'bff',
    Schemas: [{ Name: 'college' }, { Name: 'common' }],
    SelectedHandlebarsLanguage: 2,
    SelectedToBeGenerated: 0,
    SingularRules: null,
    T4TemplatePath: null,
    Tables: [
      { Name: '[college].[AdversityType]', ObjectType: 0 },
      { Name: '[college].[SchoolContact_Base]', ObjectType: 0 },
      { Name: '[common].[UserPermissions]', ObjectType: 0 },
      { Name: '[common].[UserRoles]', ObjectType: 0 },
      { Name: '[common].[USRegion]', ObjectType: 0 },
      { Name: '[common].[WASUser]', ObjectType: 0 },
      { Name: '[college].[vw_CollegePlayerPlays]', ObjectType: 3 },
      { Name: '[common].[vw_ActiveCoaches]', ObjectType: 3 },
      { Name: '[pro].[usp_Sync_GameAdvance]', ObjectType: 1 },
    ],
    UiHint: null,
    UncountableWords: null,
    UseAsyncStoredProcedureCalls: true,
    UseBoolPropertiesWithoutDefaultSql: false,
    UseDatabaseNames: false,
    UseDatabaseNamesForRoutines: true,
    UseDateOnlyTimeOnly: true,
    UseDbContextSplitting: false,
    UseDecimalDataAnnotationForSprocResult: true,
    UseFluentApiOnly: true,
    UseHandleBars: false,
    UseHierarchyId: false,
    UseInflector: true,
    UseInternalAccessModifiersForSprocsAndFunctions: false,
    UseLegacyPluralizer: false,
    UseManyToManyEntity: false,
    UseNoDefaultConstructor: false,
    UseNoNavigations: false,
    UseNoObjectFilter: false,
    UseNodaTime: false,
    UseNullableReferences: false,
    UsePrefixNavigationNaming: false,
    UseSchemaFolders: true,
    UseSchemaNamespaces: false,
    UseSpatial: false,
    UseT4: false,
    UseT4Split: false,
    UseTypedTvpParameters: true,
    ...overrides,
  };
}

/** The bytes the extension writes: BOM, CRLF, 3 space indent. */
function asExtensionWrites(vs: Record<string, unknown>): string {
  return '﻿' + JSON.stringify(vs, null, 3).replace(/\n/g, '\r\n');
}

async function project(vs = vsConfig(), name = 'efpt.SQLMIContext.config.json') {
  const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-cli-vs-'));
  const file = path.join(dir, name);
  await writeFile(file, asExtensionWrites(vs));
  return { dir, file };
}

function edit(config: EfcptConfig, change: (c: Record<string, unknown>) => void): EfcptConfig {
  const next = structuredClone(config) as Record<string, unknown>;
  change(next);
  return next as EfcptConfig;
}

describe('efpt.config.json used directly', () => {
  it('reads as an efcpt config that generates exactly the listed objects', async () => {
    const { file } = await project();
    const { config } = await readVsConfig(file);
    expect(config['code-generation']?.['refresh-object-lists']).toBe(false);
    expect(config['file-layout']?.['use-schema-folders-preview']).toBe(true);
    expect(config['code-generation']?.['use-data-annotations']).toBe(false);
    expect(config.names?.['dbcontext-name']).toBe('SQLMIContext');
    expect(config.tables?.map((t) => t.name)).toContain('[common].[USRegion]');
    expect(config.views).toEqual([
      { name: '[college].[vw_CollegePlayerPlays]' },
      { name: '[common].[vw_ActiveCoaches]' },
    ]);
    expect(config['stored-procedures']).toEqual([{ name: '[pro].[usp_Sync_GameAdvance]' }]);
  });

  it('saving without changes leaves the file byte for byte as it was', async () => {
    for (const write of [
      asExtensionWrites,
      (vs: Record<string, unknown>) => `${JSON.stringify(vs, null, 3)}\n`,
      // The extension writes / as \/
      (vs: Record<string, unknown>) => asExtensionWrites(vs).replace(/\//g, '\\/'),
    ]) {
      const dir = await mkdtemp(path.join(tmpdir(), 'efcpt-cli-vs-'));
      const file = path.join(dir, 'efpt.SQLMIContext.config.json');
      const text = write(vsConfig({ OutputPath: 'Data/SQLMIModels' }));
      await writeFile(file, text);
      const { config } = await readVsConfig(file);
      expect(await writeVsConfig(file, config)).toEqual([]);
      expect(await readFile(file, 'utf8')).toBe(text);
    }
  });

  it('adds a table where the extension would, and changes nothing else', async () => {
    const { file } = await project();
    const before = await readFile(file, 'utf8');
    const { config } = await readVsConfig(file);
    await writeVsConfig(
      file,
      edit(config, (c) => (c['tables'] as { name: string }[]).push({ name: '[common].[USCity]' })),
    );
    // Sorted like the extension: case-insensitive, so USCity comes before UserPermissions
    const entry =
      '      {\r\n         "Name": "[common].[USCity]",\r\n         "ObjectType": 0\r\n      },\r\n';
    const at = before.indexOf('      {\r\n         "Name": "[common].[UserPermissions]"');
    expect(await readFile(file, 'utf8')).toBe(before.slice(0, at) + entry + before.slice(at));
  });

  it("orders names like the extension's own files", () => {
    // Runs of entries exactly as they appear in teams' efpt.config.json files
    for (const run of [
      ['[dbo].[Player]', '[dbo].[Player_BirthdateBackup]', '[dbo].[PlayerAIQ]', '[dbo].[PlayerAlert]'],
      ['[dbo].[PlayerWorkout]', '[dbo].[PlayTime]', '[dbo].[POAPlayerList]', '[dbo].[Position]'],
      ['[dbo].[HighSchoolSport]', '[dbo].[HWSChart]', '[dbo].[InjuryBodyPart]'],
      ['[dbo].[SizeGradeCoefficients]', '[dbo].[SizeGradeCoefficients2]', '[dbo].[SizeGradeCutoffs]'],
      ['[common].[UserPermissions]', '[common].[UserRoles]', '[common].[USRegion]', '[common].[USState]'],
      ['[pro].[ProPlayerSocialMedia]', '[pro].[ProPlayerSPEAR]', '[pro].[ProPlayerSpeedsOverTime]'],
      ['[college].[SchoolContact_Base]', '[college].[SchoolContact_Curated]', '[college].[SchoolHistory]'],
      ['[college].[UDFAOffers]', '[common].[Environments]', '[fais].[CaseChangeLog]', '[pro].[Agent]'],
      ['[dbo].[DraftboardSnapshotPlayer]', '[dbo].[DraftDayTeamNeeds_Materialized]', '[dbo].[DraftPick]'],
    ]) {
      expect([...run].reverse().sort(compareVsNames)).toEqual(run);
    }
  });

  it('sorts "_" before letters, as the extension does', async () => {
    const { file } = await project();
    const { config } = await readVsConfig(file);
    await writeVsConfig(
      file,
      edit(config, (c) => (c['tables'] as { name: string }[]).push({ name: '[college].[SchoolContact]' })),
    );
    const names = (
      JSON.parse((await readFile(file, 'utf8')).slice(1)) as { Tables: { Name: string }[] }
    ).Tables.map((t) => t.Name);
    expect(names.slice(0, 3)).toEqual([
      '[college].[AdversityType]',
      '[college].[SchoolContact]',
      '[college].[SchoolContact_Base]',
    ]);
  });

  it('writes removed objects, excluded columns and new procedures in the extension format', async () => {
    const { file } = await project();
    const { config } = await readVsConfig(file);
    await writeVsConfig(
      file,
      edit(config, (c) => {
        c['views'] = [
          { name: '[college].[vw_CollegePlayerPlays]' },
          { name: '[common].[vw_ActiveCoaches]', exclude: true },
        ];
        (c['tables'] as Record<string, unknown>[])[0]!['excludedColumns'] = ['Description'];
        (c['stored-procedures'] as Record<string, unknown>[]).push({
          name: '[pro].[usp_Sync_GameAdvanceCoach]',
          'use-legacy-resultset-discovery': true,
        });
      }),
    );
    const written = JSON.parse((await readFile(file, 'utf8')).slice(1)) as {
      Tables: Record<string, unknown>[];
    };
    expect(written.Tables.map((t) => t['Name'])).not.toContain('[common].[vw_ActiveCoaches]');
    expect(JSON.stringify(written.Tables[0])).toBe(
      '{"ExcludedColumns":["Description"],"Name":"[college].[AdversityType]","ObjectType":0}',
    );
    expect(written.Tables.at(-1)).toEqual({
      Name: '[pro].[usp_Sync_GameAdvanceCoach]',
      ObjectType: 1,
      UseLegacyResultSetDiscovery: true,
    });
  });

  it('changes only the options that changed, and reports what efpt.config.json has no place for', async () => {
    const { file } = await project(vsConfig({ UseTypedTvpParameters: undefined }));
    const before = await readFile(file, 'utf8');
    const { config } = await readVsConfig(file);
    const notSaved = await writeVsConfig(
      file,
      edit(config, (c) => {
        const layout = c['file-layout'] as Record<string, unknown>;
        layout['use-schema-folders-preview'] = false;
        const generation = c['code-generation'] as Record<string, unknown>;
        generation['use-typed-tvp-parameters'] = true;
        generation['generate-mermaid-diagram'] = true;
      }),
    );
    expect(notSaved).toEqual(['code-generation.generate-mermaid-diagram']);
    const after = await readFile(file, 'utf8');
    expect(after).toBe(
      before
        .replace('"UseSchemaFolders": true', '"UseSchemaFolders": false')
        // A property the older extension didn't write goes in ordinal order, after UseT4Split
        .replace('"UseT4Split": false\r\n', '"UseT4Split": false,\r\n   "UseTypedTvpParameters": true\r\n'),
    );
  });

  it("keeps efcpt-cli's own settings in efcpt-cli.json, which the extension never touches", async () => {
    const { dir, file } = await project();
    const { config } = await readVsConfig(file);
    await writeVsConfig(
      file,
      edit(config, (c) => {
        c['efcpt-cli'] = { connection: { 'user-secrets': 'ConnectionStrings:SQLMIConnection' } };
      }),
    );
    expect(JSON.parse(await readFile(path.join(dir, 'efcpt-cli.json'), 'utf8'))).toEqual({
      configs: {
        'efpt.SQLMIContext.config.json': {
          connection: { 'user-secrets': 'ConnectionStrings:SQLMIConnection' },
        },
      },
    });
    expect(await readFile(file, 'utf8')).toBe(asExtensionWrites(vsConfig()));
    expect((await readVsConfig(file)).config['efcpt-cli']).toEqual({
      connection: { 'user-secrets': 'ConnectionStrings:SQLMIConnection' },
    });
  });

  it('uses the renaming file named after the config without storing it', async () => {
    const { dir, file } = await project();
    await writeFile(path.join(dir, 'efpt.SQLMIContext.renaming.json'), '[]');
    const { config } = await readVsConfig(file);
    expect(config['efcpt-cli']).toEqual({ renaming: 'efpt.SQLMIContext.renaming.json' });
    await writeVsConfig(file, config);
    await expect(readFile(path.join(dir, 'efcpt-cli.json'), 'utf8')).rejects.toThrow();
  });

  it('picks up the connection from an older --import-vs copy of the config', async () => {
    const { dir, file } = await project();
    await writeFile(
      path.join(dir, 'efcpt-config.SQLMIContext.json'),
      JSON.stringify({ 'efcpt-ui': { connection: { 'user-secrets': 'ConnectionStrings:SQLMIConnection' } } }),
    );
    expect((await readVsConfig(file)).config['efcpt-cli']).toEqual({
      connection: { 'user-secrets': 'ConnectionStrings:SQLMIConnection' },
    });
  });
});
