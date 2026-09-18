/**
 * Zero-dependency module loader for `node --test`.
 *
 * Node 24 strips TypeScript types natively, but the source uses two import
 * forms plain Node cannot resolve:
 *   1. `@/...` path aliases (tsconfig `paths`) -> mapped to `./src/...`
 *   2. `next/server` (bare specifier; the file is `next/server.js`)
 *
 * Registered via `node --import ./test/alias-loader.mjs`.
 */
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const rel = specifier.slice(2);
      const resolved = path.join(srcDir, rel);
      const withExt = resolved.endsWith('.ts') ? resolved : resolved + '.ts';
      return nextResolve(pathToFileURL(withExt).href, context);
    }
    if (specifier === 'next/server') {
      return nextResolve('next/server.js', context);
    }
    return nextResolve(specifier, context);
  },
});