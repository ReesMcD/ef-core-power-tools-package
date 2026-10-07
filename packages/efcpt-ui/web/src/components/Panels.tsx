import { useState } from 'react';
import type { GenerateDocument, SessionInfo } from '../../../src/server/api';

const providers: [string, string][] = [
  ['', 'Detect from connection string'],
  ['mssql', 'SQL Server'],
  ['postgres', 'PostgreSQL'],
  ['sqlite', 'SQLite'],
  ['mysql', 'MySQL'],
  ['oracle', 'Oracle'],
  ['firebird', 'Firebird'],
  ['snowflake', 'Snowflake'],
];

export function ConnectionPanel(props: {
  session: SessionInfo;
  busy: boolean;
  error?: string;
  onConnect(connection: string, provider: string): void;
  onCancel?: () => void;
}) {
  const [connection, setConnection] = useState('');
  const [provider, setProvider] = useState(props.session.provider ?? '');
  const [show, setShow] = useState(false);

  return (
    <section className="panel">
      <h2>Database connection</h2>
      <p>
        {props.session.connection
          ? `Currently from ${props.session.connection.source}.`
          : 'No connection string was found for this config.'}{' '}
        A connection entered here is kept in memory only and never written to disk.
      </p>
      <div className="field">
        <label htmlFor="connection">Connection string, or path to a .dacpac</label>
        <div className="inline">
          <input
            id="connection"
            type={show ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            value={connection}
            placeholder="Server=.;Database=Sales;Trusted_Connection=True;Encrypt=false"
            onChange={(e) => setConnection(e.target.value)}
          />
          <button className="link" onClick={() => setShow(!show)}>
            {show ? 'hide' : 'show'}
          </button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="provider">Provider</label>
        <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {providers.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {props.error && <p className="error">{props.error}</p>}
      <div className="actions">
        <button
          className="primary"
          disabled={props.busy || !connection.trim()}
          onClick={() => props.onConnect(connection, provider)}
        >
          {props.busy ? 'Connecting…' : 'Connect'}
        </button>
        {props.onCancel && <button onClick={props.onCancel}>Cancel</button>}
      </div>
      <details>
        <summary>Don&apos;t want to type it every time?</summary>
        <p>
          Add an <code>efcpt-ui</code> section to the config that says where to read the connection string.
          The secret itself stays out of the file:
        </p>
        <pre>{`"efcpt-ui": {
  "connection": { "env": "MY_DB_CONNECTION" }
  // or { "user-secrets": "ConnectionStrings:MyDb" }
  // or { "appsettings": "appsettings.Development.json", "key": "ConnectionStrings:MyDb" }
}`}</pre>
      </details>
    </section>
  );
}

export function ConfigPicker(props: {
  session: SessionInfo;
  busy: boolean;
  error?: string;
  onSelect(path: string): void;
  onImport(vsConfigPath: string): void;
  onCancel?: () => void;
}) {
  const [newPath, setNewPath] = useState(
    props.session.configs.length || props.session.vsConfigs.length ? '' : 'efcpt-config.json',
  );
  return (
    <section className="panel">
      <h2>Choose a config</h2>
      {props.session.configs.length > 0 ? (
        <>
          <p>Pick the efcpt config to work on:</p>
          <ul className="config-list">
            {props.session.configs.map((config) => (
              <li key={config}>
                <button disabled={props.busy} onClick={() => props.onSelect(config)}>
                  {config}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>No efcpt config was found in this project yet.</p>
      )}
      {props.session.vsConfigs.length > 0 && (
        <div className="field">
          <p>
            Import from the Visual Studio extension. The selected objects and options are converted; the
            original file is left as it is:
          </p>
          <ul className="config-list">
            {props.session.vsConfigs.map((vsConfig) => (
              <li key={vsConfig}>
                <button disabled={props.busy} onClick={() => props.onImport(vsConfig)}>
                  Import {vsConfig}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="field">
        <label htmlFor="new-config">Create a new config (path relative to the project)</label>
        <div className="inline">
          <input
            id="new-config"
            value={newPath}
            placeholder="Data/Sales/efcpt-config.json"
            onChange={(e) => setNewPath(e.target.value)}
          />
          <button
            disabled={props.busy || !newPath.trim().endsWith('.json')}
            onClick={() => props.onSelect(newPath.trim())}
          >
            Create
          </button>
        </div>
      </div>
      {props.error && <p className="error">{props.error}</p>}
      {props.onCancel && <button onClick={props.onCancel}>Cancel</button>}
    </section>
  );
}

function relative(file: string, base?: string): string {
  if (!base) return file;
  const normalized = file.replace(/\\/g, '/');
  const root = base.replace(/\\/g, '/').replace(/\/[^/]*$/, '/');
  return normalized.startsWith(root) ? normalized.slice(root.length) : file;
}

export function RunPanel(props: {
  running: boolean;
  log: string[];
  result?: GenerateDocument;
  error?: { message: string; details?: string };
  projectPath?: string;
}) {
  const { result } = props;
  const files = result
    ? [
        result.contextFilePath,
        ...(result.contextConfigurationFilePaths ?? []),
        ...(result.entityTypeFilePaths ?? []),
      ].filter((f): f is string => Boolean(f))
    : [];
  const byFolder = new Map<string, string[]>();
  for (const file of files) {
    const rel = relative(file, props.projectPath);
    const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '.';
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), rel.slice(rel.lastIndexOf('/') + 1)]);
  }

  return (
    <div className="run">
      {props.running && <p className="status">Generating…</p>}
      {props.error && (
        <div className="error">
          <p>{props.error.message}</p>
          {props.error.details && <pre>{props.error.details}</pre>}
        </div>
      )}
      {result && (
        <div className={result.success ? 'result ok' : 'result failed'}>
          <h2>{result.success ? `Generated ${files.length} files` : 'Generation finished with errors'}</h2>
          {result.errors.map((e) => (
            <p key={e} className="error">
              {e}
            </p>
          ))}
          {result.warnings.map((w) => (
            <p key={w} className="warning">
              {w}
            </p>
          ))}
          {[...byFolder].map(([folder, names]) => (
            <details key={folder} open={byFolder.size < 4}>
              <summary>
                {folder} <span className="muted">({names.length})</span>
              </summary>
              <ul className="files">
                {names.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          ))}
          {result.readmePath && (
            <p className="muted">
              Next steps are in <code>{relative(result.readmePath, props.projectPath)}</code>
            </p>
          )}
        </div>
      )}
      {props.log.length > 0 && (
        <details open={props.running || !result?.success}>
          <summary>Engine output</summary>
          <pre className="log">{props.log.join('\n')}</pre>
        </details>
      )}
      {!props.running && !result && !props.error && (
        <p className="muted">Save &amp; Generate to run the engine.</p>
      )}
    </div>
  );
}
