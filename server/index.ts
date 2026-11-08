import { createApp } from './app.js';
import { errorMiddleware } from './Middleware/ErrorMiddleware.js';
import { configureFrontend } from './Middleware/FrontendMiddleware.js';
import { initializeRepository } from './Services/StartupService.js';
import { readServerSettings } from './Settings/ServerSettings.js';
import { db } from './store.js';
const settings = readServerSettings();
const app = createApp(settings);
await initializeRepository();
await configureFrontend(app);
app.use(errorMiddleware);
const parentPort = (
  process as typeof process & {
    parentPort?: {
      postMessage: (message: unknown) => void;
      on: (event: string, listener: (event: { data: { type?: string } }) => void) => void;
    };
  }
).parentPort;
const server = app.listen(settings.port, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') settings.boundPort = address.port;
  console.log(`DemoTech Knowledge Brain: http://127.0.0.1:${settings.boundPort}`);
  parentPort?.postMessage({ type: 'ready', port: settings.boundPort });
});
server.on('error', (error) => {
  parentPort?.postMessage({ type: 'error', message: error.message });
  console.error(error.message);
  process.exit(1);
});
function shutdown() {
  server.close(() => {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
    process.exit(0);
  });
  server.closeIdleConnections();
}
parentPort?.on('message', (event) => {
  if (event.data?.type === 'shutdown') shutdown();
});
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
