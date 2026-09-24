import type { EfVersion } from '../project.js';
import { runProcess } from './process.js';

export const dotnetDownloadUrl = 'https://dotnet.microsoft.com/download';

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeError';
  }
}

/**
 * The engine for EF Core 8 and 9 targets .NET 8, the one for EF Core 10 targets .NET 10.
 * Engines roll forward to newer major versions, so any runtime at or above this major works.
 */
export function requiredRuntimeMajor(efVersion: EfVersion): number {
  return efVersion === 10 ? 10 : 8;
}

/** Parses `dotnet --list-runtimes` into the installed Microsoft.NETCore.App versions. */
export function parseRuntimes(output: string): string[] {
  return [...output.matchAll(/^Microsoft\.NETCore\.App\s+(\d+\.\d+\.\d+\S*)/gm)].map((m) => m[1]!);
}

export async function checkDotnetRuntime(efVersion: EfVersion): Promise<string> {
  const required = requiredRuntimeMajor(efVersion);
  let output: string;
  try {
    output = (await runProcess('dotnet', ['--list-runtimes'], { timeoutMs: 30_000 })).stdout;
  } catch {
    throw new RuntimeError(
      `The dotnet command was not found. Install the .NET ${required} runtime or later: ${dotnetDownloadUrl}`,
    );
  }

  const runtimes = parseRuntimes(output);
  const suitable = runtimes.filter((v) => Number(v.split('.')[0]) >= required);
  if (suitable.length === 0) {
    const found = runtimes.length ? `found ${runtimes.join(', ')}` : 'no .NET runtimes found';
    throw new RuntimeError(
      `EF Core ${efVersion} needs the .NET ${required} runtime or later (${found}). Install it from ${dotnetDownloadUrl}`,
    );
  }
  return suitable.at(-1)!;
}
