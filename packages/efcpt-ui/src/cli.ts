#!/usr/bin/env node
import { main } from './main.js';

// Output piped into a command that stops reading early (`efcpt-ui --list | head`) is not an error
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw error;
  });
}

process.exitCode = await main(process.argv.slice(2));
