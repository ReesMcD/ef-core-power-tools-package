import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CliArgs } from '../args.js';
import { UiController } from '../server/controller.js';
import { startUiServer } from '../server/server.js';
import type { Output } from './common.js';

/** The page sends a heartbeat every 10 seconds; stop when it has been silent this long. */
const heartbeatTimeoutMs = 60_000;
/** After the page says goodbye, wait this long for a reload before stopping. */
const byeGraceMs = 15_000;

export const defaultWebRoot = fileURLToPath(new URL('../web/', import.meta.url));

/** Opens a URL in the default browser. Failures are ignored: the URL is printed anyway. */
export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // no browser available (for example over SSH)
  }
}

export interface UiOptions {
  args: CliArgs;
  env: NodeJS.ProcessEnv;
  io: Output;
  cwd: string;
  webRoot?: string;
  open?: (url: string) => void;
  /** Resolves when the UI should stop; defaults to Ctrl+C / SIGTERM. */
  stopSignal?: Promise<void>;
}

/** Runs the local web UI until Ctrl+C or until the browser tab has been closed. Returns the exit code. */
export async function runUi(options: UiOptions): Promise<number> {
  const { args, io } = options;
  const controller = new UiController({ args, env: options.env, cwd: options.cwd, io });
  await controller.init();

  let lastBeat: number | undefined;
  let stop!: () => void;
  const stopped = new Promise<void>((resolve) => (stop = resolve));

  const server = await startUiServer({
    controller,
    webRoot: options.webRoot ?? defaultWebRoot,
    port: args.port,
    onActivity: (kind) => {
      if (kind === 'heartbeat') {
        lastBeat = Date.now();
        return;
      }
      const byeAt = Date.now();
      setTimeout(() => {
        if (lastBeat === undefined || lastBeat < byeAt) stop();
      }, byeGraceMs).unref();
    },
  });

  const watchdog = setInterval(() => {
    if (lastBeat !== undefined && Date.now() - lastBeat > heartbeatTimeoutMs) stop();
  }, 5_000);
  watchdog.unref();

  const onSignal = () => stop();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  io.out(`efcpt-ui is running at ${server.launchUrl}`);
  io.out('Close the browser tab or press Ctrl+C to stop.');
  if (args.open) (options.open ?? openBrowser)(server.launchUrl);

  await Promise.race([stopped, options.stopSignal ?? new Promise<never>(() => {})]);

  clearInterval(watchdog);
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  await server.close();
  io.err('efcpt-ui stopped.');
  return 0;
}
