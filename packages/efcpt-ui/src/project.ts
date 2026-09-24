import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

export const supportedEfVersions = [8, 9, 10] as const;
export type EfVersion = (typeof supportedEfVersions)[number];

export interface ProjectInfo {
  projectPath: string;
  projectDir: string;
  rootNamespace: string;
  targetFrameworks: string[];
  /** Set when the project uses `dotnet user-secrets`. */
  userSecretsId?: string;
  efVersion: EfVersion;
  /** Where the EF Core version came from, for display, for example "Microsoft.EntityFrameworkCore.Sqlite 10.0.1". */
  efVersionSource: string;
  warnings: string[];
}

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

interface PackageItem {
  '@Include'?: string;
  '@Update'?: string;
  '@Version'?: string;
  '@VersionOverride'?: string;
  Version?: string;
  VersionOverride?: string;
}

interface MsBuildDocument {
  Project?: {
    PropertyGroup?: Record<string, unknown>[];
    ItemGroup?: { PackageReference?: PackageItem[]; PackageVersion?: PackageItem[] }[];
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  isArray: (name) => ['PropertyGroup', 'ItemGroup', 'PackageReference', 'PackageVersion'].includes(name),
});

// Provider packages whose major version follows the EF Core major version
const efPackagePattern =
  /^(Microsoft\.EntityFrameworkCore(\..+)?|Npgsql\.EntityFrameworkCore\..+|Pomelo\.EntityFrameworkCore\..+|Oracle\.EntityFrameworkCore|FirebirdSql\.EntityFrameworkCore\..+)$/i;

async function parseMsBuild(file: string): Promise<MsBuildDocument> {
  try {
    return parser.parse(await readFile(file, 'utf8')) as MsBuildDocument;
  } catch (error) {
    throw new ProjectError(`Cannot read ${file}: ${(error as Error).message}`);
  }
}

/**
 * Finds the project a config belongs to: the nearest folder at or above the config that contains
 * exactly one .csproj file.
 */
export async function findProjectFile(configPath: string): Promise<string> {
  let dir = path.dirname(path.resolve(configPath));
  for (;;) {
    const projects = (await readdir(dir).catch(() => [] as string[])).filter((f) =>
      f.toLowerCase().endsWith('.csproj'),
    );
    if (projects.length === 1) return path.join(dir, projects[0]!);
    if (projects.length > 1) {
      throw new ProjectError(
        `Found several projects in ${dir} (${projects.join(', ')}), choose one with --project`,
      );
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new ProjectError(
    `No .csproj found in or above ${path.dirname(path.resolve(configPath))}, use --project`,
  );
}

function collectProperties(doc: MsBuildDocument): Map<string, string> {
  const properties = new Map<string, string>();
  for (const group of doc.Project?.PropertyGroup ?? []) {
    for (const [key, value] of Object.entries(group)) {
      if (!key.startsWith('@') && typeof value === 'string') properties.set(key, value.trim());
    }
  }
  return properties;
}

function expand(value: string, properties: Map<string, string>): string {
  return value.replace(/\$\(([^)]+)\)/g, (_, name: string) => properties.get(name) ?? '');
}

/** First number of a NuGet version or range, for example 10.0.1, 10.*, [8.0,9.0) */
export function majorOf(version: string | undefined): number | undefined {
  const match = /(\d+)/.exec(version ?? '');
  return match ? Number(match[1]) : undefined;
}

/** Walks up from the project folder to find Directory.Packages.props (central package management). */
async function readCentralVersions(projectDir: string): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  let dir = projectDir;
  for (;;) {
    const file = path.join(dir, 'Directory.Packages.props');
    const exists = await readFile(file, 'utf8').then(
      () => true,
      () => false,
    );
    if (exists) {
      const doc = await parseMsBuild(file);
      const properties = collectProperties(doc);
      for (const group of doc.Project?.ItemGroup ?? []) {
        for (const item of group.PackageVersion ?? []) {
          const id = item['@Include'] ?? item['@Update'];
          const version = item['@Version'] ?? item.Version;
          if (id && version) versions.set(id.toLowerCase(), expand(version, properties));
        }
      }
      return versions;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return versions;
    dir = parent;
  }
}

function toSupported(major: number, source: string, warnings: string[]): EfVersion {
  if (major < 8) {
    throw new ProjectError(`${source} is EF Core ${major}; efcpt-ui supports EF Core 8, 9 and 10`);
  }
  if (major > 10) {
    warnings.push(`${source} is EF Core ${major}; using the EF Core 10 engine, which may not match`);
    return 10;
  }
  return major as EfVersion;
}

export async function readProject(projectPath: string): Promise<ProjectInfo> {
  const resolved = path.resolve(projectPath);
  const projectDir = path.dirname(resolved);
  const doc = await parseMsBuild(resolved);
  const properties = collectProperties(doc);
  const warnings: string[] = [];

  const frameworks = expand(
    properties.get('TargetFrameworks') ?? properties.get('TargetFramework') ?? '',
    properties,
  )
    .split(';')
    .map((f) => f.trim())
    .filter(Boolean);
  const rootNamespace =
    expand(properties.get('RootNamespace') ?? '', properties) ||
    path.basename(resolved, path.extname(resolved));

  const central = await readCentralVersions(projectDir);
  const references = (doc.Project?.ItemGroup ?? []).flatMap((g) => g.PackageReference ?? []);

  let efVersion: EfVersion | undefined;
  let efVersionSource = '';
  // Prefer Microsoft.EntityFrameworkCore* packages over third party providers
  const efReferences = references
    .filter((r) => efPackagePattern.test(r['@Include'] ?? ''))
    .sort(
      (a, b) =>
        Number(!a['@Include']!.startsWith('Microsoft.')) - Number(!b['@Include']!.startsWith('Microsoft.')),
    );
  for (const reference of efReferences) {
    const id = reference['@Include']!;
    const version = expand(
      reference['@VersionOverride'] ??
        reference.VersionOverride ??
        reference['@Version'] ??
        reference.Version ??
        central.get(id.toLowerCase()) ??
        '',
      properties,
    );
    const major = majorOf(version);
    if (major !== undefined) {
      efVersionSource = `${id} ${version}`;
      efVersion = toSupported(major, efVersionSource, warnings);
      break;
    }
  }

  if (efVersion === undefined) {
    // No EF Core package yet (a new project): fall back to the target framework, e.g. net9.0 -> EF Core 9
    const tfmMajor = frameworks.map((f) => /^net(\d+)\.\d+/.exec(f)?.[1]).find(Boolean);
    if (!tfmMajor) {
      throw new ProjectError(
        `Cannot tell which EF Core version ${path.basename(resolved)} uses: no EF Core package reference or .NET target framework found`,
      );
    }
    efVersionSource = `target framework ${frameworks.join(';')}`;
    efVersion = toSupported(Number(tfmMajor), efVersionSource, warnings);
    warnings.push(
      `No EF Core package reference found, using EF Core ${efVersion} based on the ${efVersionSource}`,
    );
  }

  const userSecretsId = expand(properties.get('UserSecretsId') ?? '', properties) || undefined;

  return {
    projectPath: resolved,
    projectDir,
    rootNamespace,
    targetFrameworks: frameworks,
    userSecretsId,
    efVersion,
    efVersionSource,
    warnings,
  };
}
