// efcpt-cli is installed from GitHub Releases of this fork (no npm registry). Each efcpt-cli release (vX.Y.Z)
// has the package, efcpt-cli.tgz. The engines, one per EF Core version, are in a release of their own
// (engines-<id of their source code>), shared by every efcpt-cli release built from the same engine code, so
// an update that doesn't touch the engines doesn't download them again. The release workflow stamps both tags
// into package.json; a copy without them runs from a checkout.
import { readFileSync } from 'node:fs';

export const releaseRepo = 'ReesMcD/ef-core-power-tools-package';
export const packageAsset = 'efcpt-cli.tgz';
export const engineAsset = (efVersion: number) => `efcpt-engine-ef${efVersion}.tar.gz`;

export interface PackageInfo {
  version: string;
  /** The release this copy was installed from, e.g. "v0.2.14". Undefined in a checkout. */
  efcptRelease?: string;
  /** The release with this copy's engines, e.g. "engines-3f9c2a1b7d4e". */
  efcptEngines?: string;
}

export function packageInfo(): PackageInfo {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as PackageInfo;
}

/** The releases page. EFCPT_CLI_RELEASES_URL replaces it (tests, or a mirror). */
export function releasesUrl(env: NodeJS.ProcessEnv): string {
  return (env['EFCPT_CLI_RELEASES_URL'] ?? `https://github.com/${releaseRepo}/releases`).replace(/\/+$/, '');
}

export function assetUrl(env: NodeJS.ProcessEnv, tag: string, asset: string): string {
  return `${releasesUrl(env)}/download/${tag}/${asset}`;
}

/** Describes a failed request without the noise ("fetch failed"). */
export function describeFetchError(error: unknown): string {
  const cause = (error as { cause?: { message?: string; code?: string } }).cause;
  return cause?.message ?? cause?.code ?? (error as Error).message;
}

/** The tag of the latest release: .../releases/latest redirects to .../releases/tag/<tag>. */
export async function latestReleaseTag(env: NodeJS.ProcessEnv): Promise<string> {
  const url = `${releasesUrl(env)}/latest`;
  let response: Response;
  try {
    response = await fetch(url, { redirect: 'manual' });
  } catch (error) {
    throw new Error(`Could not reach ${url}: ${describeFetchError(error)}`, { cause: error });
  }
  const location = response.headers.get('location') ?? '';
  const tag = /\/releases\/tag\/([^/?#]+)/.exec(location)?.[1];
  if (!tag) throw new Error(`Could not find the latest release at ${url} (HTTP ${response.status})`);
  return decodeURIComponent(tag);
}
