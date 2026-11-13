// Runs the bundled Nitro server inside a child process that cannot outlive
// the desktop app. It is forked with an IPC channel; when the parent goes
// away for ANY reason — normal quit, crash, Task Manager "End task", Windows
// shutdown — the channel closes and this process exits. Forking the server
// entry directly left it running after a hard kill, holding port 34817, so
// the next launch's server couldn't bind and the window was served by the
// stale (possibly pre-update) one.
import { pathToFileURL } from 'node:url';

process.on('disconnect', () => process.exit(0));
if (!process.connected) process.exit(0);

const entry = process.env.TILLIX_NITRO_ENTRY;
if (!entry) {
  console.error('[nitro-host] TILLIX_NITRO_ENTRY not set');
  process.exit(1);
}
await import(pathToFileURL(entry).href);
