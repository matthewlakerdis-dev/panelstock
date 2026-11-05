import {transformSync} from '@babel/core';
import presetEnv from '@babel/preset-env';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildAttendancePage} from '../src/attendance-page.js';

const workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUTPUT_DIRECTORY = join(workerDirectory, 'dist-attendance-ios10');

// Adapt only the isolated test bundle. The source shared with production stays
// modern, and the transport retains real XHR timeouts on Safari 10.
function attendanceCompatibility({types: t, template}) {
  return {visitor: {
    TryStatement(path) {
      const first = path.node.block.body[0];
      if (!t.isExpressionStatement(first) || !t.isAssignmentExpression(first.expression) || !t.isIdentifier(first.expression.left, {name: 'kioskToken'})) return;
      path.replaceWithMultiple(template.statements.ast(`
        kioskToken = attendanceLegacyRestoreStation();
        attendanceLegacyInstallStation(kioskToken, function () {
          kioskToken = '';
          rosterVersion++;
          rosterLoading = false;
          clearTimeout(successTimer);
          $('matches').replaceChildren();
          $('roster-status').textContent = '';
          $('setup').hidden = false;
          $('station').hidden = true;
        }, function (token) {
          kioskToken = token;
          locked = false;
          rosterVersion++;
          rosterLoading = false;
          $('setup').hidden = true;
          $('station').hidden = false;
          setBusy(false);
          reset();
        });
      `));
    },
    ObjectProperty(path) {
      const node = path.node;
      if (!t.isIdentifier(node.key, {name: 'signal'}) || !t.isCallExpression(node.value)) return;
      const callee = node.value.callee;
      if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.object, {name: 'AbortSignal'}) || !t.isIdentifier(callee.property, {name: 'timeout'})) return;
      node.key = t.identifier('timeout');
      node.value = node.value.arguments[0];
    },
    ArrayExpression(path) {
      // iOS 10 has touch events but no Pointer Events. Taps still reset idle time.
      const values = path.node.elements;
      if (values.length === 3 && ['pointerdown', 'keydown', 'input'].every((value, index) => t.isStringLiteral(values[index], {value}))) {
        values.push(t.stringLiteral('touchstart'));
      }
    },
    CallExpression: {exit(path) {
      const node = path.node;
      if (t.isIdentifier(node.callee, {name: 'fetch'})) {
        node.callee = t.identifier('attendanceLegacyRequest');
        return;
      }
      if (!t.isMemberExpression(node.callee)) return;
      if (t.isIdentifier(node.callee.object, {name: 'link'}) && t.isIdentifier(node.callee.property, {name: 'click'})) {
        path.replaceWith(t.awaitExpression(t.callExpression(t.identifier('attendanceLegacyPreviewCsv'), [t.identifier('blob'), t.memberExpression(t.identifier('link'), t.identifier('download'))])));
        path.skip();
      } else if (t.isIdentifier(node.callee.property, {name: 'replaceAll'})) {
        // The attendance CSV escapes literal quotation marks. split/join has
        // the same behavior here and needs no global String polyfill.
        if (node.arguments.length !== 2 || !t.isStringLiteral(node.arguments[0]) || !t.isStringLiteral(node.arguments[1])) {
          throw path.buildCodeFrameError('Legacy CSV replacement must use two literal strings.');
        }
        path.replaceWith(t.callExpression(t.memberExpression(t.callExpression(t.memberExpression(node.callee.object, t.identifier('split')), [node.arguments[0]]), t.identifier('join')), [node.arguments[1]]));
        path.skip();
      } else if (t.isIdentifier(node.callee.property, {name: 'querySelectorAll'})) {
        // Safari 10 NodeLists have neither forEach nor a reliable iterator.
        path.replaceWith(t.callExpression(t.memberExpression(t.memberExpression(t.memberExpression(t.identifier('Array'), t.identifier('prototype')), t.identifier('slice')), t.identifier('call')), [node]));
        path.skip();
      }
    }}
  }};
}

export function legacyAttendancePage(manage = false) {
  const nonce = 'attendance-ios10-build';
  let html = buildAttendancePage(nonce, manage, '').replaceAll(' nonce="' + nonce + '"', '');
  const modernScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const runtime = readFileSync(join(workerDirectory, 'compat', 'attendance-ios10-runtime.js'), 'utf8');
  const css = readFileSync(join(workerDirectory, 'compat', 'attendance-ios10.css'), 'utf8');
  const adapted = transformSync(modernScript, {
    babelrc: false,
    configFile: false,
    sourceType: 'script',
    comments: false,
    compact: true,
    plugins: [attendanceCompatibility]
  }).code;
  // Lower async only after the compatibility pass has added the CSV preview's
  // await, so no newly inserted modern syntax can escape the ES5 transform.
  const transformed = transformSync(adapted, {
    babelrc: false,
    configFile: false,
    sourceType: 'script',
    comments: false,
    compact: true,
    presets: [[presetEnv, {targets: {ie: '11'}, modules: false, useBuiltIns: false}]]
  }).code;
  // Babel lowers top-level const/let to var. Keep the application local so its
  // status element cannot collide with the browser's native window.status.
  const script = runtime + '\n(function(){\n' + transformed + '\ndocument.getElementById("attendance-test-startup").hidden=true;\n}());';
  html = html.replace(/<script>[\s\S]*?<\/script>/, () => '<script>' + script + '</script>');
  html = html.replace('</style>', () => '\n' + css + '</style>');
  const notice = '<aside class="attendance-test-banner" aria-label="Testing environment"><strong>iOS 10 compatibility test · Demo data only</strong><span>Use made-up names. This register is separate from live attendance.</span>' + (manage ? '<span class="attendance-test-login">Demo administrator: <strong>ipadtest</strong> · PIN <strong>103434</strong></span>' : '') + '</aside><p id="attendance-test-startup" class="attendance-test-startup" role="status">Loading compatibility test… If this message stays visible, this iPad could not start the test. Please tell your administrator.</p>';
  html = html.replace('<body>', '<body>' + notice).replace('</title>', ' · iOS 10 test</title>');
  if (!manage) {
    const homeScreen = '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Lennox Test"><meta name="apple-mobile-web-app-status-bar-style" content="default"><link rel="apple-touch-icon" href="/sign-in/apple-touch-icon.png">';
    html = html.replace('<head>', '<head>' + homeScreen);
    const setup = '<section id="setup" class="panel setup" hidden><h2>Connect this sign-in station</h2><p class="subtle">Open the paired test station in Safari and tap <strong>Get setup code</strong>. Enter its 8-digit code here.</p><div id="attendance-setup-code-controls"><form id="attendance-connect" autocomplete="off"><label class="field" for="attendance-setup-code">8-digit setup code<input id="attendance-setup-code" type="tel" inputmode="numeric" pattern="[0-9]{8}" maxlength="8" placeholder="8-digit code" autocomplete="off" required></label><button id="attendance-connect-button" type="submit" class="primary wide">Connect station</button><p id="attendance-connect-status" class="notice" role="alert" aria-live="polite"></p></form></div><a class="secondary" href="/sign-in/manage">Administrator setup</a></section>';
    html = html.replace(/<section id="setup"[\s\S]*?<\/section>/, setup);
    html = html.replace('</main>', '<div class="attendance-install-controls"><button id="attendance-setup-code-button" type="button" class="secondary attendance-test-install" hidden>Get setup code</button><button id="attendance-install" type="button" class="secondary attendance-test-install" hidden>Install on iPad</button></div></main>');
  }
  if (manage) html = html.replace('id="export" type="button" class="secondary">Export CSV', 'id="export" type="button" class="secondary">View CSV');
  const hash = source => "'sha256-" + createHash('sha256').update(source).digest('base64') + "'";
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const policy = "default-src 'none'; script-src " + hash(script) + '; style-src ' + hash(style) + "; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";
  return html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="' + policy + '">');
}

export function writeAssets(directory = DEFAULT_OUTPUT_DIRECTORY) {
  mkdirSync(join(directory, 'manage'), {recursive: true});
  writeFileSync(join(directory, 'index.html'), legacyAttendancePage());
  writeFileSync(join(directory, 'manage', 'index.html'), legacyAttendancePage(true));
  copyFileSync(join(workerDirectory, '..', 'icon-adaptive-v4-192.png'), join(directory, 'apple-touch-icon.png'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output-directory')) {
    throw new Error('Usage: node scripts/build-attendance-ios10.mjs [--output-directory <test-assets>]');
  }
  writeAssets(args.length ? resolve(args[1]) : DEFAULT_OUTPUT_DIRECTORY);
}
