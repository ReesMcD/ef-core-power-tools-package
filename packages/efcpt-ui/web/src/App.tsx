import { useCallback, useEffect, useState } from 'react';
import type { EfcptConfig, GenerateDocument, ObjectsResponse, SessionInfo } from '../../src/server/api';
import { api, ApiRequestError } from './api';
import { ObjectTree } from './components/ObjectTree';
import { ConfigPicker, ConnectionPanel, RunPanel } from './components/Panels';
import { SettingsForm } from './components/SettingsForm';

type Tab = 'objects' | 'settings' | 'run';

function describe(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return [error.message, ...error.details].join('\n');
  }
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [session, setSession] = useState<SessionInfo>();
  const [config, setConfig] = useState<EfcptConfig>({});
  const [saved, setSaved] = useState<string>('{}');
  const [objects, setObjects] = useState<ObjectsResponse>();
  const [objectsError, setObjectsError] = useState<string>();
  const [tab, setTab] = useState<Tab>('objects');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [editConnection, setEditConnection] = useState(false);
  const [picking, setPicking] = useState(false);
  const [run, setRun] = useState<{
    running: boolean;
    log: string[];
    result?: GenerateDocument;
    error?: { message: string; details?: string };
  }>({ running: false, log: [] });

  const dirty = JSON.stringify(config) !== saved;

  const loadConfig = useCallback(async () => {
    const response = await api.config();
    setConfig(response.config);
    setSaved(JSON.stringify(response.config));
  }, []);

  const loadObjects = useCallback(async (refresh = false) => {
    setObjectsError(undefined);
    try {
      setObjects(await api.objects(refresh));
    } catch (e) {
      setObjects(undefined);
      setObjectsError(describe(e));
    }
  }, []);

  const loadSession = useCallback(
    async (info: SessionInfo) => {
      setSession(info);
      setObjects(undefined);
      setRun({ running: false, log: [] });
      if (!info.configPath) return;
      await loadConfig();
      if (info.connection) await loadObjects();
    },
    [loadConfig, loadObjects],
  );

  useEffect(() => {
    api.session().then(loadSession, (e: unknown) => setError(describe(e)));
  }, [loadSession]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const selectConfig = async (path: string) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setBusy(true);
    setError(undefined);
    try {
      await loadSession(await api.selectConfig(path));
      setPicking(false);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  const importVs = async (path: string) => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setBusy(true);
    setError(undefined);
    try {
      await loadSession(await api.importVs(path));
      setPicking(false);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = async (connection: string, provider: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.connect({ connection, provider: provider || undefined });
      setSession(result.session);
      setObjects(result.objects);
      setObjectsError(undefined);
      setEditConnection(false);
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.saveConfig(config);
      setConfig(response.config);
      setSaved(JSON.stringify(response.config));
      setSession(await api.session());
      return true;
    } catch (e) {
      setError(describe(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveAndGenerate = async () => {
    if (dirty && !(await save())) return;
    setTab('run');
    setRun({ running: true, log: [] });
    try {
      await api.generate((event) => {
        if (event.type === 'log') setRun((r) => ({ ...r, log: [...r.log, event.line] }));
        if (event.type === 'result') {
          setRun((r) => ({ ...r, result: event.result }));
          // The engine may have updated the object lists in the config
          if (event.config) {
            setConfig(event.config);
            setSaved(JSON.stringify(event.config));
          }
        }
        if (event.type === 'error')
          setRun((r) => ({ ...r, error: { message: event.error, details: event.details } }));
      });
    } catch (e) {
      setRun((r) => ({ ...r, error: { message: describe(e) } }));
    } finally {
      setRun((r) => ({ ...r, running: false }));
      setSession(await api.session().catch(() => session));
    }
  };

  if (!session) {
    return <main className="loading">{error ? <p className="error">{error}</p> : 'Loading…'}</main>;
  }

  const project = session.project;
  const needsConfig = !session.configPath || picking;
  const needsConnection = !needsConfig && (!session.connection || editConnection);

  return (
    <>
      <header>
        <div className="title">
          <strong>EF Core Power Tools</strong>
          {project && (
            <span className="muted">
              {project.name} · EF Core {project.efVersion}
            </span>
          )}
        </div>
        {session.configPath && (
          <select
            aria-label="Config file"
            value={
              session.configs.find((c) =>
                session.configPath!.replace(/\\/g, '/').endsWith(c.replace(/\\/g, '/')),
              ) ?? ''
            }
            onChange={(e) =>
              e.target.value === '__new' ? setPicking(true) : void selectConfig(e.target.value)
            }
            disabled={busy || run.running}
          >
            {session.configs.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="__new">New config…</option>
          </select>
        )}
        {session.connection && (
          <button className="link" onClick={() => setEditConnection(true)} title="Use a different connection">
            {session.connection.source}
            {session.provider ? ` · ${session.provider}` : ''}
          </button>
        )}
        <div className="spacer" />
        {!needsConfig && (
          <>
            {dirty && <span className="dirty">Unsaved changes</span>}
            <button onClick={() => void save()} disabled={!dirty || busy || run.running}>
              Save
            </button>
            <button
              className="primary"
              onClick={() => void saveAndGenerate()}
              disabled={busy || run.running || !session.connection}
            >
              {dirty ? 'Save & Generate' : 'Generate'}
            </button>
          </>
        )}
      </header>

      <main>
        {session.warnings.length > 0 && (
          <ul className="warnings">
            {session.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {needsConfig ? (
          <ConfigPicker
            session={session}
            busy={busy}
            error={error}
            onSelect={(p) => void selectConfig(p)}
            onImport={(p) => void importVs(p)}
            onCancel={picking ? () => setPicking(false) : undefined}
          />
        ) : needsConnection ? (
          <ConnectionPanel
            session={session}
            busy={busy}
            error={error}
            onConnect={(c, p) => void connect(c, p)}
            onCancel={session.connection ? () => setEditConnection(false) : undefined}
          />
        ) : (
          <>
            {error && <p className="error">{error}</p>}
            <nav className="tabs" role="tablist">
              {(['objects', 'settings', 'run'] as Tab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className={tab === t ? 'active' : ''}
                  onClick={() => setTab(t)}
                >
                  {t === 'objects' ? 'Objects' : t === 'settings' ? 'Settings' : 'Generate'}
                </button>
              ))}
            </nav>
            {tab === 'objects' &&
              (objects ? (
                <>
                  <div className="toolbar-right">
                    <button className="link" onClick={() => void loadObjects(true)}>
                      Reload from database
                    </button>
                  </div>
                  <ObjectTree objects={objects.objects} config={config} onChange={setConfig} />
                </>
              ) : objectsError ? (
                <div className="error">
                  <p>Could not read the database objects.</p>
                  <pre>{objectsError}</pre>
                  <button onClick={() => void loadObjects(true)}>Try again</button>{' '}
                  <button onClick={() => setEditConnection(true)}>Change connection</button>
                </div>
              ) : (
                <p className="status">Reading database objects…</p>
              ))}
            {tab === 'settings' && (
              <SettingsForm
                config={config}
                isDacpac={session.connection?.isDacpac ?? false}
                onChange={setConfig}
              />
            )}
            {tab === 'run' && <RunPanel {...run} projectPath={project?.path} />}
          </>
        )}
      </main>
    </>
  );
}
