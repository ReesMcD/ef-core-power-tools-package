import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConnectionError,
  connectionStringKeys,
  lookupKey,
  SeveralConnectionsError,
  resolveConnection,
  stripJsonComments,
  type ConnectionOptions,
} from '../src/connection.js';
import { redact } from '../src/redact.js';

const base: ConnectionOptions = { env: {}, config: {}, projectDir: '/project' };

describe('resolveConnection', () => {
  it('uses the precedence flag > --connection-env > EFCPT_CONNECTION > config', async () => {
    const config = { 'efcpt-ui': { connection: { env: 'FROM_CONFIG' } } };
    const env = {
      MY_DB: 'Data Source=env.db',
      EFCPT_CONNECTION: 'Data Source=default.db',
      FROM_CONFIG: 'Data Source=config.db',
    };

    expect(
      await resolveConnection({
        ...base,
        env,
        config,
        connection: 'Data Source=flag.db',
        connectionEnv: 'MY_DB',
      }),
    ).toEqual({
      value: 'Data Source=flag.db',
      source: '--connection',
      isDacpac: false,
    });
    expect((await resolveConnection({ ...base, env, config, connectionEnv: 'MY_DB' }))?.value).toBe(
      'Data Source=env.db',
    );
    expect((await resolveConnection({ ...base, env, config }))?.value).toBe('Data Source=default.db');
    expect(
      (await resolveConnection({ ...base, env: { FROM_CONFIG: 'Data Source=config.db' }, config }))?.source,
    ).toBe('environment variable FROM_CONFIG');
  });

  it('returns undefined when nothing is configured', async () => {
    expect(await resolveConnection(base)).toBeUndefined();
  });

  it('fails clearly when a named environment variable is missing', async () => {
    await expect(resolveConnection({ ...base, connectionEnv: 'NOPE' })).rejects.toThrow(/NOPE/);
    await expect(
      resolveConnection({ ...base, config: { 'efcpt-ui': { connection: { env: 'GONE' } } } }),
    ).rejects.toBeInstanceOf(ConnectionError);
  });

  it('reads user secrets (flat keys, as written by dotnet user-secrets)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-secrets-'));
    await mkdir(path.join(root, 'abc-123'));
    await writeFile(
      path.join(root, 'abc-123/secrets.json'),
      '{ "ConnectionStrings:Sales": "Server=.;Password=hunter2" }',
    );
    const config = { 'efcpt-ui': { connection: { 'user-secrets': 'ConnectionStrings:Sales' } } };

    const resolved = await resolveConnection({
      ...base,
      config,
      userSecretsId: 'abc-123',
      userSecretsRoot: root,
    });
    expect(resolved).toEqual({
      value: 'Server=.;Password=hunter2',
      source: 'user secret ConnectionStrings:Sales',
      isDacpac: false,
    });
    await expect(resolveConnection({ ...base, config })).rejects.toThrow(/UserSecretsId/);
  });

  it('reads appsettings with comments and nested keys, relative to the project folder', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-appsettings-'));
    await writeFile(
      path.join(projectDir, 'appsettings.Development.json'),
      '{\n  // local database\n  "ConnectionStrings": { /* main */ "Sales": "Data Source=sales.db;// not a comment" }\n}',
    );
    const config = {
      'efcpt-ui': {
        connection: { appsettings: 'appsettings.Development.json', key: 'ConnectionStrings:Sales' },
      },
    };
    expect((await resolveConnection({ ...base, projectDir, config }))?.value).toBe(
      'Data Source=sales.db;// not a comment',
    );
  });

  it('resolves dacpac paths from the project folder', async () => {
    const config = { 'efcpt-ui': { connection: { dacpac: '../Db/bin/Db.dacpac' } } };
    const resolved = await resolveConnection({ ...base, projectDir: path.resolve('/work/Api'), config });
    expect(resolved).toEqual({
      value: path.resolve('/work/Db/bin/Db.dacpac'),
      source: `dacpac ${path.resolve('/work/Db/bin/Db.dacpac')}`,
      isDacpac: true,
    });
  });
});

describe('helpers', () => {
  it('looks up keys case-insensitively in flat and nested JSON', () => {
    expect(lookupKey({ connectionstrings: { sales: 'x' } }, 'ConnectionStrings:Sales')).toBe('x');
    expect(lookupKey({ 'ConnectionStrings:Sales': 'y' }, 'connectionstrings:sales')).toBe('y');
    expect(lookupKey({ a: 1 }, 'a')).toBeUndefined();
  });

  it('strips comments but not comment-like text in strings', () => {
    expect(JSON.parse(stripJsonComments('{ "a": "http://x" // c\n, /* b */ "b": 1 }'))).toEqual({
      a: 'http://x',
      b: 1,
    });
  });

  it('redacts connection strings and passwords', () => {
    const conn = 'Server=db;User Id=sa;Password=S3cret!;';
    expect(redact(`failed to open ${conn}`, [conn])).toBe('failed to open <connection string>');
    expect(redact('Server=db;Pwd=abc;Database=x')).toBe('Server=db;Pwd=***;Database=x');
    expect(redact('AccountKey="k==";')).toBe('AccountKey=***;');
  });

  it('in WSL, finds user secrets set on the Windows side', async () => {
    const usersRoot = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-winusers-'));
    const secrets = path.join(usersRoot, 'jdoe', 'AppData', 'Roaming', 'Microsoft', 'UserSecrets', 'abc-123');
    await mkdir(secrets, { recursive: true });
    await writeFile(
      path.join(secrets, 'secrets.json'),
      '{ "ConnectionStrings:Sales": "Server=sql01;User Id=app;Password=x" }',
    );
    const linuxRoot = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-secrets-'));

    const resolved = await resolveConnection({
      env: {},
      config: { 'efcpt-ui': { connection: { 'user-secrets': 'ConnectionStrings:Sales' } } },
      projectDir: linuxRoot,
      userSecretsId: 'abc-123',
      userSecretsRoot: linuxRoot, // nothing on the Linux side
      windowsUsersRoot: usersRoot,
    });
    expect(resolved?.value).toBe('Server=sql01;User Id=app;Password=x');
  });

  describe("the project's own user secrets", () => {
    async function secrets(content: object): Promise<string> {
      const root = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-secrets-'));
      await mkdir(path.join(root, 'app-1'), { recursive: true });
      await writeFile(path.join(root, 'app-1', 'secrets.json'), JSON.stringify(content));
      return root;
    }
    const options = (root: string): ConnectionOptions => ({
      ...base,
      userSecretsId: 'app-1',
      userSecretsRoot: root,
      windowsUsersRoot: false,
    });

    it('lists connection strings written flat (dotnet user-secrets) or nested', () => {
      expect(
        connectionStringKeys({
          'ConnectionStrings:Sales': 'a',
          ConnectionStrings: { Audit: 'b', Empty: '' },
          'Logging:Level': 'x',
        }),
      ).toEqual(['ConnectionStrings:Sales', 'ConnectionStrings:Audit']);
    });

    it('uses the only connection string when nothing is configured', async () => {
      const root = await secrets({ 'ConnectionStrings:Sales': 'Server=sql01;User Id=app;Password=x' });
      const resolved = await resolveConnection(options(root));
      expect(resolved?.value).toBe('Server=sql01;User Id=app;Password=x');
      expect(resolved?.source).toBe(
        "user secret ConnectionStrings:Sales (found in the project's user secrets)",
      );
    });

    it('asks to choose when there are several', async () => {
      const root = await secrets({ ConnectionStrings: { Sales: 'a', Audit: 'b' } });
      const error = await resolveConnection(options(root)).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SeveralConnectionsError);
      expect((error as SeveralConnectionsError).keys).toEqual([
        'ConnectionStrings:Sales',
        'ConnectionStrings:Audit',
      ]);
      expect((error as Error).message).toContain('"user-secrets": "ConnectionStrings:Sales"');
    });

    it("reads another project's user secrets, for example the startup project", async () => {
      const root = await secrets({ 'ConnectionStrings:Sales': 'from the api project' });
      const solution = await mkdtemp(path.join(tmpdir(), 'efcpt-ui-solution-'));
      await mkdir(path.join(solution, 'Api'));
      await writeFile(
        path.join(solution, 'Api', 'Api.csproj'),
        '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework><UserSecretsId>app-1</UserSecretsId></PropertyGroup></Project>',
      );
      const reference = { 'user-secrets': 'ConnectionStrings:Sales', project: '../Api/Api.csproj' };
      const resolved = await resolveConnection({
        ...options(root),
        userSecretsId: undefined, // the data project has none
        projectDir: path.join(solution, 'Data'),
        config: { 'efcpt-ui': { connection: reference } },
      });
      expect(resolved?.value).toBe('from the api project');

      // or by id
      const byId = await resolveConnection({
        ...options(root),
        userSecretsId: undefined,
        config: { 'efcpt-ui': { connection: { 'user-secrets': 'ConnectionStrings:Sales', id: 'app-1' } } },
      });
      expect(byId?.value).toBe('from the api project');
    });
  });
});
