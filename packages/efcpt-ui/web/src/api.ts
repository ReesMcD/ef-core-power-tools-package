import type {
  ApiError,
  ConfigResponse,
  ConnectionRequest,
  EfcptConfig,
  GenerateEvent,
  ObjectsResponse,
  SessionInfo,
} from '../../src/server/api';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'x-efcpt-ui': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ error: response.statusText }))) as ApiError;
    throw new ApiRequestError(error.error, response.status, error.details);
  }
  return (await response.json()) as T;
}

export const api = {
  session: () => call<SessionInfo>('GET', '/api/session'),
  selectConfig: (configPath: string) => call<SessionInfo>('POST', '/api/session', { configPath }),
  importVs: (vsConfigPath: string) => call<SessionInfo>('POST', '/api/import-vs', { vsConfigPath }),
  config: () => call<ConfigResponse>('GET', '/api/config'),
  saveConfig: (config: EfcptConfig) => call<ConfigResponse>('PUT', '/api/config', { config }),
  objects: (refresh = false) => call<ObjectsResponse>('GET', `/api/objects${refresh ? '?refresh=1' : ''}`),
  connect: (request: ConnectionRequest) =>
    call<{ session: SessionInfo; objects: ObjectsResponse }>('POST', '/api/connection', request),

  /** Runs generation, calling onEvent for each progress line and for the final result or error. */
  async generate(onEvent: (event: GenerateEvent) => void): Promise<void> {
    const response = await fetch('/api/generate', { method: 'POST', headers: { 'x-efcpt-ui': '1' } });
    if (!response.ok || !response.body) {
      const error = (await response.json().catch(() => ({ error: response.statusText }))) as ApiError;
      throw new ApiRequestError(error.error, response.status, error.details);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += value;
      const lines = buffer.split('\n');
      buffer = done ? '' : (lines.pop() ?? '');
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as GenerateEvent);
      if (done) break;
    }
  },
};

/** Keeps the local server alive while the page is open, and tells it when the page closes. */
export function startHeartbeat(): () => void {
  const beat = () => void fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
  beat();
  const timer = setInterval(beat, 10_000);
  const bye = () => navigator.sendBeacon('/api/bye');
  window.addEventListener('pagehide', bye);
  return () => {
    clearInterval(timer);
    window.removeEventListener('pagehide', bye);
  };
}
