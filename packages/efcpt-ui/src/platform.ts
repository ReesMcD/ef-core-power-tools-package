import { release } from 'node:os';

/**
 * True inside the Windows Subsystem for Linux: a Linux process whose user sits at a Windows desktop and
 * whose browser, and Windows authentication, are on the Windows side.
 */
export function isWsl(env: NodeJS.ProcessEnv = process.env, kernelRelease = release()): boolean {
  if (process.platform !== 'linux') return false;
  return Boolean(env['WSL_DISTRO_NAME'] || env['WSL_INTEROP']) || /microsoft/i.test(kernelRelease);
}
