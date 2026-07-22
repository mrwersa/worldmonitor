// Dev-in-Docker override: adds polling-based file watching on top of the
// real vite.config.ts, unchanged otherwise.
//
// Why this exists: Docker Desktop bind mounts (gRPC-FUSE/VirtioFS on macOS,
// similar on Windows) don't reliably forward host filesystem change events
// into the container's inotify — the file inside the container is correctly
// up to date (verified: `docker exec ... cat` sees host edits immediately),
// but chokidar's default native-events watcher never fires, so Vite never
// invalidates the module graph or pushes HMR updates. Polling sidesteps
// this entirely by reading mtimes on an interval instead of waiting for
// events that may never arrive. Only used by Dockerfile.dev — the
// non-Docker `npm run dev` workflow is completely unaffected.
//
// Uses Vite's own mergeConfig (not manual spreading) so this survives the
// base config's own future changes without needing to know its exact
// shape here.

import { defineConfig, mergeConfig, type UserConfigFnObject, type UserConfig } from 'vite';
import baseConfig from './vite.config';

export default defineConfig((configEnv) => {
  const resolvedBase = typeof baseConfig === 'function'
    ? (baseConfig as UserConfigFnObject)(configEnv)
    : (baseConfig as UserConfig);

  return mergeConfig(resolvedBase, {
    server: {
      watch: {
        usePolling: true,
        interval: 300,
      },
    },
  });
});
