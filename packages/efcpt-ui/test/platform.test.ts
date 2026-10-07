import { describe, expect, it } from 'vitest';
import { browserCommand } from '../src/commands/ui.js';
import { isWsl } from '../src/platform.js';

describe('platform', () => {
  it('recognises WSL from its environment or kernel', () => {
    if (process.platform !== 'linux') return; // only a Linux process can be in WSL
    expect(isWsl({ WSL_DISTRO_NAME: 'Ubuntu' }, '6.6.87.2-microsoft-standard-WSL2')).toBe(true);
    expect(isWsl({}, '6.6.87.2-microsoft-standard-WSL2')).toBe(true);
    expect(isWsl({ WSL_INTEROP: '/run/WSL/1_interop' }, '6.8.0')).toBe(true);
    expect(isWsl({}, '6.8.0-45-generic')).toBe(false);
  });

  it('opens the Windows browser from Windows and from WSL, without a shell', () => {
    const url = 'http://127.0.0.1:5123/?token=abc&x=1';
    expect(browserCommand(url, 'win32', false)).toEqual(['rundll32', ['url.dll,FileProtocolHandler', url]]);
    expect(browserCommand(url, 'linux', true)).toEqual([
      'rundll32.exe',
      ['url.dll,FileProtocolHandler', url],
    ]);
    expect(browserCommand(url, 'linux', false)).toEqual(['xdg-open', [url]]);
    expect(browserCommand(url, 'darwin', false)).toEqual(['open', [url]]);
  });
});
