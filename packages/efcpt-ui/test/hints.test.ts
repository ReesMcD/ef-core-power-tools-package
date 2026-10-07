import { describe, expect, it } from 'vitest';
import { connectionHint } from '../src/engine/hints.js';

// Messages as Microsoft.Data.SqlClient reports them through the engine
const handshake =
  'A connection was successfully established with the server, but then an error occurred during the pre-login handshake. (provider: TCP Provider, error: 35 - An internal exception was caught)';
const untrusted =
  'A connection was successfully established with the server, but then an error occurred during the login process. (provider: SSL Provider, error: 0 - The certificate chain was issued by an authority that is not trusted.)';

describe('SQL Server connection hints', () => {
  it('suggests TrustServerCertificate for certificate errors, unless it is already set', () => {
    expect(connectionHint([handshake], 'Server=.;Database=Sales')).toMatch(/TrustServerCertificate=True/);
    expect(connectionHint([untrusted], 'Server=.;Database=Sales;Encrypt=true')).toMatch(
      /TrustServerCertificate/,
    );
    expect(connectionHint([untrusted], 'Server=.;Trust Server Certificate=yes;')).toBeUndefined();
  });

  it('explains Windows authentication, login, database and server errors', () => {
    expect(
      connectionHint(['The target principal name is incorrect.  Cannot generate SSPI context.'], ''),
    ).toMatch(/Windows authentication/);
    expect(connectionHint(["Login failed for user 'sa'."], '')).toMatch(/user name and password/);
    expect(
      connectionHint(
        [
          'Cannot open database "Nope" requested by the login. The login failed.\nLogin failed for user \'sa\'.',
        ],
        '',
      ),
    ).toMatch(/database "Nope" does not exist/);
    expect(
      connectionHint(
        [
          'A network-related or instance-specific error occurred while establishing a connection to SQL Server.',
        ],
        '',
      ),
    ).toMatch(/Server=localhost,1433/);
  });

  it('explains Windows authentication failures on Windows', () => {
    const sspi = ['The target principal name is incorrect.  Cannot generate SSPI context.'];
    expect(
      connectionHint(sspi, 'Server=sql01;Trusted_Connection=True', { platform: 'win32', wsl: false }),
    ).toMatch(/Kerberos ticket/);
    expect(
      connectionHint(sspi, 'Server=sql01;Trusted_Connection=True', { platform: 'linux', wsl: false }),
    ).toMatch(/It needs Windows/);
    expect(
      connectionHint(["Login failed for user 'CORP\\jdoe'."], '', { platform: 'win32', wsl: false }),
    ).toMatch(/CORP\\jdoe has no login on this server/);
    expect(
      connectionHint(["Login failed for user 'NT AUTHORITY\\ANONYMOUS LOGON'."], '', {
        platform: 'win32',
        wsl: false,
      }),
    ).toMatch(/ANONYMOUS LOGON/);
    expect(
      connectionHint(
        [
          'Cannot open database "Sales" requested by the login. The login failed.\nLogin failed for user \'CORP\\jdoe\'.',
        ],
        '',
        { platform: 'win32', wsl: false },
      ),
    ).toMatch(/database "Sales" does not exist/);
    // a SQL login is not a Windows account
    expect(connectionHint(["Login failed for user 'sa'."], '', { platform: 'win32', wsl: false })).toMatch(
      /user name and password/,
    );
  });

  it('points WSL users at PowerShell for Windows authentication', () => {
    const kerberos = [
      "Cannot authenticate using Kerberos. Ensure Kerberos has been initialized on the client with 'kinit'.",
    ];
    expect(
      connectionHint(kerberos, 'Server=sql01;Trusted_Connection=True', { platform: 'linux', wsl: true }),
    ).toMatch(/Run efcpt-ui from PowerShell or cmd/);
  });

  it('stays quiet for other errors', () => {
    expect(connectionHint(['Invalid object name dbo.Foo'], '')).toBeUndefined();
  });
});
