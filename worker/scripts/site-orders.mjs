import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const defaultOutput = fileURLToPath(new URL('../dist-site-orders/', import.meta.url));
const siteFiles = ['index.html', 'styles.css', 'factory-match.css', 'cnc-tracker.css',
  'order-controls.css', 'app-loader.js', 'app.js', 'app.legacy.js', 'sw.js', 'manifest.webmanifest'];
const icons = ['icon-512.png', 'icon-mobile-v3-192.png', 'icon-mobile-v3-512.png',
  'icon-adaptive-v4-192.png', 'icon-adaptive-v4-512.png'];

function replaceOnce(source, pattern, replacement, label) {
  const matches = source.match(new RegExp(pattern.source, 'g')) || [];
  if (matches.length !== 1) throw new Error(`Expected one ${label}; found ${matches.length}. Review the Site Orders build.`);
  return source.replace(pattern, () => replacement);
}

// Package only public, allowlisted assets. Retired GitHub Pages entry points
// must never become the standalone app's HTML or service worker.
export async function buildSiteOrders(output = defaultOutput) {
  const files = new Map();
  for (const file of siteFiles) {
    const directory = ['index.html', 'sw.js'].includes(file) ? 'worker/templates/site-orders' : 'site';
    files.set(file, await fs.readFile(path.join(root, directory, file)));
  }
  for (const file of icons) files.set(file, await fs.readFile(path.join(root, file)));
  const brandModule = await fs.readFile(path.join(root, 'worker/src/brand-logo.js'), 'utf8');
  const brandMatch = brandModule.match(/^export const brandLogo\s*=\s*("[^"\r\n]+")\s*;\s*$/m);
  if (!brandMatch) throw new Error('The public brand logo format changed; review the Site Orders build.');
  const logo = JSON.stringify(JSON.parse(brandMatch[1]));

  let modern = files.get('app.js').toString();
  modern = replaceOnce(modern, /import\s*\{\s*brandLogo\s*\}\s*from\s*['"]\.\.\/worker\/src\/brand-logo\.js['"];?/,
    `const brandLogo = ${logo};`, 'modern brand import');
  let legacy = files.get('app.legacy.js').toString();
  legacy = replaceOnce(legacy, /require\(['"]\.\.\/worker\/src\/brand-logo\.js['"]\)/,
    `{brandLogo: ${logo}}`, 'legacy brand import');
  // Only relocate the service worker. /site/cnc is an API endpoint, not an asset.
  modern = replaceOnce(modern, /['"]\/site\/sw\.js['"]/, "'/sw.js'", 'modern service worker URL');
  legacy = replaceOnce(legacy, /['"]\/site\/sw\.js['"]/, "'/sw.js'", 'legacy service worker URL');
  files.set('app.js', modern);
  files.set('app.legacy.js', legacy);

  const manifest = JSON.parse(files.get('manifest.webmanifest'));
  Object.assign(manifest, {id: '/', start_url: '/', scope: '/'});
  files.set('manifest.webmanifest', JSON.stringify(manifest, null, 2) + '\n');

  // All assets can be revalidated online while the service worker provides offline access.
  files.set('_headers', '/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n');
  files.set('_redirects', '/site / 302\n/site/ / 302\n/site-orders / 302\n/site-orders/ / 302\n');

  const hash = createHash('sha256');
  hash.update(await fs.readFile(fileURLToPath(import.meta.url)));
  for (const [name, contents] of files) hash.update(name).update(contents);
  const revision = hash.digest('hex').slice(0, 16);
  let sw = files.get('sw.js').toString().replaceAll('/site/', '/');
  sw = replaceOnce(sw, /const CACHE=['"][^'"]+['"];/, `const CACHE='panelstock-site-${revision}';`, 'cache name');
  // The logo is embedded into both clients; no server source files need to be published.
  sw = replaceOnce(sw, /['"]\/worker\/src\/brand-logo\.js['"],/, '', 'cached brand module');
  const missingIcons = icons.filter(icon => !sw.includes(`'/${icon}'`) && !sw.includes(`"/${icon}"`));
  sw = replaceOnce(sw, /const ASSETS=\[/,
    `const ASSETS=${JSON.stringify(missingIcons.map(icon => '/' + icon)).slice(0, -1)}${missingIcons.length ? ',' : ''}`, 'asset list');
  files.set('sw.js', sw);

  await fs.mkdir(output, {recursive: true});
  // Refuse stale/unexpected files rather than accidentally publishing them or deleting user data.
  for (const entry of await fs.readdir(output, {withFileTypes: true})) {
    if (!entry.isFile() || !files.has(entry.name)) throw new Error(`Unexpected build output: ${entry.name}. Use a clean output directory.`);
  }
  for (const [name, contents] of files) await fs.writeFile(path.join(output, name), contents);
  return {output, revision, files: [...files.keys()]};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await buildSiteOrders();
  console.log(`Built ${result.files.length} public Site Orders assets (${result.revision}).`);
}
