// ESM resolver hook: the renderer source uses Vite-style extensionless relative
// imports (e.g. `import { e2eeManager } from './e2ee'`). Node's loader needs the
// `.js`. This appends it for relative specifiers so the source modules can be
// imported and unit-tested directly under plain Node, no bundler.
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?js$/.test(specifier)) {
    try { return await next(specifier + '.js', context); } catch (_e) { /* fall through */ }
  }
  return next(specifier, context);
}
