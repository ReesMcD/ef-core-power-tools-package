import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { EngineError } from '../engine/run.js';
import { redact, redactDeep } from '../redact.js';
import { apiHeader, type ApiError, type GenerateEvent } from './api.js';
import { RequestError, type UiController } from './controller.js';

export interface UiServerOptions {
  controller: UiController;
  /** Folder with the built web app (index.html and assets). */
  webRoot: string;
  /** 0 picks a free port. */
  port?: number;
  token?: string;
  /** Called on every heartbeat, and with 'bye' when the page is closed. */
  onActivity?: (kind: 'heartbeat' | 'bye') => void;
}

export interface UiServer {
  url: string;
  /** URL including the one-time token, to open in the browser. */
  launchUrl: string;
  port: number;
  close(): Promise<void>;
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const maxBodyBytes = 5 * 1024 * 1024;

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readCookie(request: IncomingMessage, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

function sendJson(response: ServerResponse, status: number, body: unknown, secrets: string[] = []): void {
  // Last line of defence: no response ever contains the connection string
  const text = JSON.stringify(redactDeep(body, secrets));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(text);
}

function sendText(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(text);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxBodyBytes) throw new RequestError('Request body too large', 413);
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestError('Request body is not valid JSON');
  }
}

export async function startUiServer(options: UiServerOptions): Promise<UiServer> {
  const token = options.token ?? randomBytes(24).toString('base64url');
  const webRoot = path.resolve(options.webRoot);
  const { controller } = options;
  let port = 0;
  // Cookies are shared between ports on the same host, so the name includes the port
  const cookieName = () => `efcpt_ui_${port}`;
  const allowedHosts = () => [`127.0.0.1:${port}`, `localhost:${port}`];

  const json = (response: ServerResponse, status: number, value: unknown) =>
    sendJson(response, status, value, controller.secrets());

  function authorized(request: IncomingMessage): boolean {
    const cookie = readCookie(request, cookieName());
    return cookie !== undefined && sameSecret(cookie, token);
  }

  function fail(response: ServerResponse, error: unknown): void {
    const secrets = controller.secrets();
    if (error instanceof RequestError) {
      const body: ApiError = { error: redact(error.message, secrets) };
      if (error.details.length) body.details = error.details.map((d) => redact(d, secrets));
      json(response, error.status, body);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const body: ApiError = { error: redact(message, secrets) };
    // Engine errors carry the engine's output
    const details = (error as { details?: unknown }).details;
    if (typeof details === 'string' && details.trim()) {
      body.details = redact(details, secrets).split(/\r?\n/).filter(Boolean);
    }
    json(response, error instanceof EngineError ? 502 : 500, body);
  }

  async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
    const requested = path.resolve(webRoot, `.${decodeURIComponent(pathname)}`);
    let file = requested;
    const inside = requested === webRoot || requested.startsWith(webRoot + path.sep);
    if (
      !inside ||
      !(await stat(requested).then(
        (s) => s.isFile(),
        () => false,
      ))
    ) {
      // Single page app: unknown paths get index.html
      file = path.join(webRoot, 'index.html');
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        'content-type': contentTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': file.endsWith('index.html') ? 'no-store' : 'max-age=3600',
        'x-content-type-options': 'nosniff',
        'content-security-policy':
          "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      });
      response.end(body);
    } catch {
      sendText(response, 500, 'The web UI files are missing. Reinstall efcpt-ui or run npm run build.');
    }
  }

  async function handleApi(
    method: string,
    pathname: string,
    url: URL,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const route = `${method} ${pathname}`;
    switch (route) {
      case 'POST /api/heartbeat':
        options.onActivity?.('heartbeat');
        response.writeHead(204).end();
        return;
      case 'POST /api/bye':
        options.onActivity?.('bye');
        response.writeHead(204).end();
        return;
      case 'GET /api/session':
        json(response, 200, await controller.info());
        return;
      case 'POST /api/session': {
        const body = (await readJsonBody(request)) as { configPath?: unknown };
        await controller.selectConfig(typeof body.configPath === 'string' ? body.configPath : '');
        json(response, 200, await controller.info());
        return;
      }
      case 'POST /api/import-vs': {
        const body = (await readJsonBody(request)) as { vsConfigPath?: unknown };
        await controller.importVs(typeof body.vsConfigPath === 'string' ? body.vsConfigPath : '');
        json(response, 200, await controller.info());
        return;
      }
      case 'GET /api/config':
        json(response, 200, await controller.getConfig());
        return;
      case 'PUT /api/config': {
        const body = (await readJsonBody(request)) as { config?: unknown };
        await controller.saveConfig(body.config);
        json(response, 200, await controller.getConfig());
        return;
      }
      case 'GET /api/objects':
        json(response, 200, await controller.listObjects(url.searchParams.get('refresh') === '1'));
        return;
      case 'POST /api/connection': {
        const body = (await readJsonBody(request)) as { connection?: unknown; provider?: unknown };
        const objects = await controller.setConnection({
          connection: typeof body.connection === 'string' ? body.connection : '',
          provider: typeof body.provider === 'string' ? body.provider : undefined,
        });
        json(response, 200, { session: await controller.info(), objects });
        return;
      }
      case 'POST /api/generate':
        await streamGenerate(response);
        return;
      default:
        throw new RequestError(`Unknown API ${route}`, 404);
    }
  }

  /** Streams newline-delimited JSON events: log lines, then the result or an error. */
  async function streamGenerate(response: ServerResponse): Promise<void> {
    response.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    });
    const send = (event: GenerateEvent) =>
      response.write(`${JSON.stringify(redactDeep(event, controller.secrets()))}\n`);
    try {
      const { result, config } = await controller.generate((line) => send({ type: 'log', line }));
      send({ type: 'result', result, config });
    } catch (error) {
      const secrets = controller.secrets();
      const message = error instanceof Error ? error.message : String(error);
      const details = (error as { details?: unknown }).details;
      send({
        type: 'error',
        error: redact(message, secrets),
        details: typeof details === 'string' && details ? redact(details, secrets) : undefined,
      });
    }
    response.end();
  }

  const server: Server = createServer((request, response) => {
    void (async () => {
      try {
        // DNS rebinding protection: only accept requests addressed to this machine
        if (!allowedHosts().includes((request.headers.host ?? '').toLowerCase())) {
          sendText(response, 403, 'Forbidden host');
          return;
        }
        const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
        const method = request.method ?? 'GET';

        const offered = url.searchParams.get('token');
        if (offered !== null) {
          if (!sameSecret(offered, token)) {
            sendText(response, 403, 'Invalid token. Open the URL printed by efcpt-ui.');
            return;
          }
          // Swap the token in the URL for a cookie, and drop it from the address bar
          response.writeHead(302, {
            'set-cookie': `${cookieName()}=${token}; HttpOnly; SameSite=Strict; Path=/`,
            location: '/',
          });
          response.end();
          return;
        }

        if (!authorized(request)) {
          sendText(
            response,
            403,
            'Open the URL printed by efcpt-ui in your terminal (it includes an access token).',
          );
          return;
        }

        if (url.pathname.startsWith('/api/')) {
          const origin = request.headers.origin;
          const originOk = origin === undefined || allowedHosts().some((h) => origin === `http://${h}`);
          // navigator.sendBeacon can't set headers; heartbeat and bye change nothing but the shutdown timer
          const lifecycle = url.pathname === '/api/heartbeat' || url.pathname === '/api/bye';
          if (!originOk || (!lifecycle && request.headers[apiHeader] !== '1')) {
            sendText(response, 403, 'Forbidden');
            return;
          }
          await handleApi(method, url.pathname, url, request, response);
          return;
        }

        if (method !== 'GET' && method !== 'HEAD') {
          sendText(response, 405, 'Method not allowed');
          return;
        }
        await serveStatic(url.pathname, response);
      } catch (error) {
        if (!response.headersSent) fail(response, error);
        else response.end();
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/`;

  return {
    url,
    launchUrl: `${url}?token=${token}`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
