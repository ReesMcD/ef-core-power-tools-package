import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findProjectFile, majorOf, ProjectError, providerFromPackages, readProject } from '../src/project.js';

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'efcpt-ui-project-'));
}

function csproj(body: string): string {
  return `<Project Sdk="Microsoft.NET.Sdk">\n${body}\n</Project>\n`;
}

describe('findProjectFile', () => {
  it('finds the nearest project above the config', async () => {
    const root = await tempDir();
    await mkdir(path.join(root, 'Data/Sales'), { recursive: true });
    await writeFile(path.join(root, 'Shop.csproj'), csproj(''));
    const config = path.join(root, 'Data/Sales/efcpt-config.json');
    expect(await findProjectFile(config)).toBe(path.join(root, 'Shop.csproj'));
  });

  it('asks for --project when a folder has several projects', async () => {
    const root = await tempDir();
    await writeFile(path.join(root, 'A.csproj'), csproj(''));
    await writeFile(path.join(root, 'B.csproj'), csproj(''));
    await expect(findProjectFile(path.join(root, 'efcpt-config.json'))).rejects.toThrow(/--project/);
  });
});

describe('readProject', () => {
  it('reads EF Core version from a PackageReference', async () => {
    const root = await tempDir();
    const file = path.join(root, 'Shop.Api.csproj');
    await writeFile(
      file,
      csproj(`<PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup>
<ItemGroup>
  <PackageReference Include="Serilog" Version="4.0.0" />
  <PackageReference Include="Microsoft.EntityFrameworkCore.Sqlite" Version="10.0.1" />
</ItemGroup>`),
    );
    const info = await readProject(file);
    expect(info).toMatchObject({
      rootNamespace: 'Shop.Api',
      targetFrameworks: ['net10.0'],
      efVersion: 10,
      efVersionSource: 'Microsoft.EntityFrameworkCore.Sqlite 10.0.1',
      warnings: [],
    });
  });

  it('prefers Microsoft EF packages and expands properties and child Version elements', async () => {
    const root = await tempDir();
    const file = path.join(root, 'App.csproj');
    await writeFile(
      file,
      csproj(`<PropertyGroup><RootNamespace>My.App</RootNamespace><EfVersion>9.0.4</EfVersion><TargetFrameworks>net8.0;net9.0</TargetFrameworks></PropertyGroup>
<ItemGroup>
  <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="8.0.0" />
  <PackageReference Include="Microsoft.EntityFrameworkCore.Design"><Version>$(EfVersion)</Version></PackageReference>
</ItemGroup>`),
    );
    const info = await readProject(file);
    expect(info.rootNamespace).toBe('My.App');
    expect(info.targetFrameworks).toEqual(['net8.0', 'net9.0']);
    expect(info.efVersion).toBe(9);
  });

  it('uses Directory.Packages.props for central package management', async () => {
    const root = await tempDir();
    await mkdir(path.join(root, 'src/Api'), { recursive: true });
    await writeFile(
      path.join(root, 'Directory.Packages.props'),
      `<Project><ItemGroup><PackageVersion Include="Microsoft.EntityFrameworkCore.SqlServer" Version="8.0.12" /></ItemGroup></Project>`,
    );
    const file = path.join(root, 'src/Api/Api.csproj');
    await writeFile(
      file,
      csproj(`<ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" /></ItemGroup>`),
    );
    expect((await readProject(file)).efVersion).toBe(8);
  });

  it('falls back to the target framework for a project without EF Core yet', async () => {
    const root = await tempDir();
    const file = path.join(root, 'New.csproj');
    await writeFile(file, csproj(`<PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup>`));
    const info = await readProject(file);
    expect(info.efVersion).toBe(9);
    expect(info.warnings[0]).toMatch(/No EF Core package reference/);
  });

  it('rejects EF Core versions older than 8 and caps newer ones at 10', async () => {
    const root = await tempDir();
    const old = path.join(root, 'Old.csproj');
    await writeFile(
      old,
      csproj(
        `<ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore" Version="6.0.0" /></ItemGroup>`,
      ),
    );
    await expect(readProject(old)).rejects.toBeInstanceOf(ProjectError);

    const future = path.join(root, 'Future.csproj');
    await writeFile(
      future,
      csproj(
        `<ItemGroup><PackageReference Include="Microsoft.EntityFrameworkCore" Version="11.0.0" /></ItemGroup>`,
      ),
    );
    const info = await readProject(future);
    expect(info.efVersion).toBe(10);
    expect(info.warnings[0]).toMatch(/EF Core 11/);
  });

  it('parses version ranges and wildcards', () => {
    expect(majorOf('10.*')).toBe(10);
    expect(majorOf('[8.0,9.0)')).toBe(8);
    expect(majorOf('')).toBeUndefined();
  });
});

describe('providerFromPackages', () => {
  it('maps the EF Core provider package to the efcpt provider name', () => {
    expect(providerFromPackages(['Serilog', 'Npgsql.EntityFrameworkCore.PostgreSQL'])).toEqual({
      provider: 'postgres',
      source: 'Npgsql.EntityFrameworkCore.PostgreSQL',
    });
    expect(providerFromPackages(['Microsoft.EntityFrameworkCore.SqlServer'])?.provider).toBe('mssql');
    expect(providerFromPackages(['Microsoft.EntityFrameworkCore.Sqlite.Core'])?.provider).toBe('sqlite');
    expect(providerFromPackages(['Pomelo.EntityFrameworkCore.MySql'])?.provider).toBe('mysql');
  });

  it('gives up when there is no provider package, or several', () => {
    expect(providerFromPackages(['Microsoft.EntityFrameworkCore.Design'])).toBeUndefined();
    expect(
      providerFromPackages([
        'Microsoft.EntityFrameworkCore.SqlServer',
        'Microsoft.EntityFrameworkCore.Sqlite',
      ]),
    ).toBeUndefined();
  });
});
