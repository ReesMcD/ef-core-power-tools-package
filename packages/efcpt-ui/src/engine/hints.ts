// Plain-language next steps for the SQL Server connection errors people hit first. The engine reports
// Microsoft.Data.SqlClient's messages, which say what failed but not what to change.

interface Rule {
  test: (errors: string, connection: string, platform: NodeJS.Platform) => boolean;
  hint: (errors: string) => string;
}

const trustsCertificate = (connection: string) =>
  /(^|;)\s*Trust\s*Server\s*Certificate\s*=\s*(true|yes)\s*(;|$)/i.test(connection);

const rules: Rule[] = [
  {
    test: (errors, connection) =>
      /certificate chain|not trusted|pre-login handshake|SSL Provider/i.test(errors) &&
      !trustsCertificate(connection),
    hint: () =>
      "SQL Server's certificate is not trusted: connections are encrypted by default since Microsoft.Data.SqlClient 4. " +
      'For a local or development server, add TrustServerCertificate=True to the connection string. ' +
      'For a production server, give it a certificate your machine trusts.',
  },
  {
    // Windows authentication reached the server without the user's identity (Kerberos delegation, "double hop")
    test: (errors) => /Login failed for user 'NT AUTHORITY\\ANONYMOUS LOGON'/i.test(errors),
    hint: () =>
      "Windows authentication reached SQL Server as ANONYMOUS LOGON, so your identity wasn't passed on. This is a " +
      'Kerberos problem: usually the server has no SPN registered, or you are connecting through another server. ' +
      'Try the server by its fully qualified name, or ask your DBA to check the SPN.',
  },
  {
    test: (errors, _connection, platform) =>
      platform === 'win32' && /SSPI|target principal name is incorrect/i.test(errors),
    hint: () =>
      'Windows authentication could not get a Kerberos ticket for this server. Check that you are on the domain ' +
      'network or VPN, try the fully qualified server name (sqlserver01.corp.example.com), and if it still fails, ' +
      "ask your DBA to check the server's SPN.",
  },
  {
    test: (errors) => /SSPI|target principal name is incorrect/i.test(errors),
    hint: () =>
      'Windows authentication (Trusted_Connection / Integrated Security) failed. It needs Windows, or Kerberos set ' +
      'up on macOS and Linux. Otherwise use a SQL login (User Id=...;Password=...) or ' +
      'Authentication=Active Directory Default for Azure SQL.',
  },
  {
    test: (errors) => /Cannot open database "/i.test(errors),
    hint: (errors) => {
      const name = /Cannot open database "([^"]+)"/i.exec(errors)?.[1] ?? '';
      return (
        `The database "${name}" does not exist on this server, or this login has no access to it. ` +
        'Check Database= (or Initial Catalog=) in the connection string.'
      );
    },
  },
  {
    test: (errors) => /Login failed for user '[^']+\\[^']+'/i.test(errors),
    hint: (errors) => {
      const account = /Login failed for user '([^']+\\[^']+)'/i.exec(errors)?.[1] ?? '';
      return (
        `Windows authentication worked, but ${account} has no login on this server or no access to the ` +
        'database. Ask your DBA to grant it access, or run efcpt-ui as an account that has it.'
      );
    },
  },
  {
    test: (errors) => /Login failed for user/i.test(errors),
    hint: () =>
      'Check the user name and password. SQL logins also need the server to allow SQL Server authentication ' +
      '(mixed mode).',
  },
  {
    test: (errors) => /network-related or instance-specific|server was not found/i.test(errors),
    hint: () =>
      'Check the server name and that SQL Server accepts TCP connections. Named instance: Server=host\\INSTANCE ' +
      '(needs the SQL Server Browser service) or Server=host,port. Docker: Server=localhost,1433. ' +
      'LocalDB, Server=(localdb)\\MSSQLLocalDB, only works on Windows.',
  },
];

/** A hint for the first SQL Server connection error that has one, or undefined. */
export function connectionHint(
  errors: string[],
  connection: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const text = errors.join('\n');
  return rules.find((rule) => rule.test(text, connection, platform))?.hint(text);
}
