import {transformSync} from '@babel/core';
import presetEnv from '@babel/preset-env';
import {createHash} from 'node:crypto';
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildAttendancePage as buildRawAttendancePage} from '../src/attendance-page.js';

const workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_OUTPUT_DIRECTORY = join(workerDirectory, 'dist-attendance');

// Compile the attendance UI before deployment so old Safari never parses
// modern syntax. The Worker imports only generated HTML and CSP strings.
function attendanceCompatibility({types: t, template}) {
  return {visitor: {
    FunctionDeclaration(path) {
      if (!t.isIdentifier(path.node.id, {name: 'selectRole'})) return;
      // The legacy kiosk has a smaller form and retains employee contact and
      // host details. Keep role state and keyboard handling in the app IIFE.
      path.node.body = template.statement.ast(`function selectRole(value) {
        type = value;
        roles.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.role === value)));
        const employee = value === 'employee';
        $('company-field').hidden = employee;
        $('company').disabled = employee;
        $('company').required = !employee;
        if (employee) $('company').value = '';
        ['contact', 'host'].forEach(id => {
          $(id + '-field').hidden = false;
          $(id).disabled = false;
        });
        $('host').required = true;
        const inputs = [...form.querySelectorAll('input')].filter(input => !input.disabled);
        inputs.forEach((input, index) => {
          input.enterKeyHint = index === inputs.length - 1 ? 'done' : 'next';
        });
        requestId = crypto.randomUUID();
      }`).body;
    },
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
      const inKioskPayload = path.findParent(parent => t.isVariableDeclarator(parent.node) && t.isIdentifier(parent.node.id, {name: 'data'}));
      if (inKioskPayload && t.isIdentifier(node.key, {name: 'purpose'})) {
        path.remove();
        return;
      }
      if (inKioskPayload && (t.isIdentifier(node.key, {name: 'contact'}) || t.isIdentifier(node.key, {name: 'host'})) && t.isConditionalExpression(node.value)) {
        node.value = node.value.alternate;
        return;
      }
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

export const DEFAULT_WORKER_MODULE = join(workerDirectory, 'generated', 'attendance-pages.js');

export function compatibleAttendancePage(manage = false, apiOrigin = '') {
  if (apiOrigin) {
    const parsed = new URL(apiOrigin);
    if (parsed.protocol !== 'https:' || parsed.origin !== apiOrigin) throw new Error('Attendance API must be an HTTPS origin.');
  }
  const nonce = 'attendance-build';
  let html = buildRawAttendancePage(nonce, manage, apiOrigin).replaceAll(' nonce="' + nonce + '"', '');
  const modernScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const runtime = readFileSync(join(workerDirectory, 'compat', 'attendance-runtime.js'), 'utf8');
  const css = readFileSync(join(workerDirectory, 'compat', 'attendance.css'), 'utf8');
  const adapted = transformSync(modernScript, {
    babelrc: false, configFile: false, sourceType: 'script', comments: false,
    compact: true, plugins: [attendanceCompatibility]
  }).code;
  const transformed = transformSync(adapted, {
    babelrc: false, configFile: false, sourceType: 'script', comments: false,
    compact: true, presets: [[presetEnv, {targets: {ie: '11'}, modules: false, useBuiltIns: false}]]
  }).code;
  // Keep Babel's lowered app variables away from native globals such as status.
  const script = 'window.attendanceApiOrigin=' + JSON.stringify(apiOrigin) + ';\n' + runtime + '\n(function(){\n' + transformed + '\ndocument.getElementById("attendance-startup").hidden=true;\n}());';
  html = html.replace(/<script>[\s\S]*?<\/script>/, () => '<script>' + script + '</script>');
  html = html.replace('</style>', () => '\n' + css + '</style>');
  html = html.replace('<body>', '<body><p id="attendance-startup" class="attendance-startup" role="status">Loading sign-in station… If this message stays visible, please reopen the page or contact your administrator.</p>');
  if (!manage) {
    const marker = '<span class="attendance-required" aria-hidden="true">*</span>';
    html = html.replace('<span>* Required</span>', '<span>' + marker + ' Required</span>');
    html = html.replace('Full name *<input', 'Full name ' + marker + '<input');
    html = html.replace('Company <span id="company-required" hidden>*</span> <small id="company-optional">(optional)</small>', 'Company <span id="company-required" class="attendance-required" aria-hidden="true">*</span>');
    html = html.replace('id="company" name="company"', 'id="company" name="company" required');
    html = html.replace('Person you’re visiting *<input', 'Person you’re visiting ' + marker + '<input');
    html = html.replace(/<label class="field full" id="purpose-field">[\s\S]*?<\/label>/, '');
    const homeScreen = '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Lennox Sign In"><meta name="apple-mobile-web-app-status-bar-style" content="default"><link rel="apple-touch-icon" href="/sign-in/apple-touch-icon.png">';
    html = html.replace('<head>', '<head>' + homeScreen);
    const setup = '<section id="setup" class="panel setup" hidden><h2>Connect this iPad</h2><p class="subtle">An administrator can connect this iPad to the sign-in station here.</p><form id="attendance-admin-connect" autocomplete="off"><label class="field" for="attendance-admin-username">Administrator username<input id="attendance-admin-username" required maxlength="80" autocomplete="off" autocapitalize="none" autocorrect="off"></label><label class="field" for="attendance-admin-pin">PIN<input id="attendance-admin-pin" type="password" inputmode="numeric" pattern="[0-9]*" required maxlength="12" autocomplete="off"></label><p id="attendance-admin-connect-notice" class="attendance-admin-connect-notice">Connecting replaces the current station link. Other paired screens will need a new link.</p><button id="attendance-admin-connect-button" type="submit" class="primary wide" aria-describedby="attendance-admin-connect-notice">Connect this iPad</button><p id="attendance-admin-connect-status" class="notice" role="alert" aria-live="polite"></p></form></section>';
    html = html.replace(/<section id="setup"[\s\S]*?<\/section>/, setup);
    html = html.replace('</main>', '<div class="attendance-install-controls"><button id="attendance-install" type="button" class="secondary attendance-install" hidden>Install on iPad</button></div></main>');
  }
  if (manage) html = html.replace('id="export" type="button" class="secondary">Export CSV', 'id="export" type="button" class="secondary">View CSV');
  const hash = source => "'sha256-" + createHash('sha256').update(source).digest('base64') + "'";
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const policy = "default-src 'none'; script-src " + hash(script) + '; style-src ' + hash(style) + "; img-src 'self' data:; connect-src " + (apiOrigin || "'self'") + "; base-uri 'none'; form-action 'none'";
  return {html: html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="' + policy + '">'), policy};
}

export function writeCompatibleAttendancePages(directory = DEFAULT_OUTPUT_DIRECTORY, apiOrigin = '') {
  mkdirSync(join(directory, 'manage'), {recursive: true});
  writeFileSync(join(directory, 'index.html'), compatibleAttendancePage(false, apiOrigin).html);
  writeFileSync(join(directory, 'manage', 'index.html'), compatibleAttendancePage(true, apiOrigin).html);
  copyFileSync(join(workerDirectory, '..', 'icon-adaptive-v4-192.png'), join(directory, 'apple-touch-icon.png'));
}

export function writeWorkerAttendanceModule(file = DEFAULT_WORKER_MODULE) {
  mkdirSync(dirname(file), {recursive: true});
  const pages = [compatibleAttendancePage(false), compatibleAttendancePage(true)];
  writeFileSync(file, '// Generated by scripts/build-attendance-compatible.mjs.\nconst pages=' + JSON.stringify(pages) + ';\nexport function buildAttendancePage(manage=false){return pages[manage?1:0];}\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) throw new Error('Usage: node scripts/build-attendance-compatible.mjs');
  writeWorkerAttendanceModule();
  writeCompatibleAttendancePages();
}
