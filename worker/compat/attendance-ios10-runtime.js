/* This ES5 runtime is bundled only into the isolated iOS 10 attendance test. */
(function (global) {
  'use strict';

  var crypto = global.crypto || (global.crypto = {});
  if (typeof crypto.randomUUID !== 'function') {
    crypto.randomUUID = function () {
      if (typeof crypto.getRandomValues !== 'function') {
        throw new Error('Secure random numbers are unavailable. Open this HTTPS test site in Safari.');
      }
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var value = '';
      for (var index = 0; index < bytes.length; index++) {
        if (index === 4 || index === 6 || index === 8 || index === 10) value += '-';
        value += (bytes[index] < 16 ? '0' : '') + bytes[index].toString(16);
      }
      return value;
    };
  }

  function append() {
    var owner = this.ownerDocument || global.document;
    for (var index = 0; index < arguments.length; index++) {
      var value = arguments[index];
      this.appendChild(value && typeof value.nodeType === 'number' ? value : owner.createTextNode(String(value)));
    }
  }
  function replaceChildren() {
    while (this.firstChild) this.removeChild(this.firstChild);
    append.apply(this, arguments);
  }
  function remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  function addDOMFallbacks(constructor) {
    if (!constructor || !constructor.prototype) return;
    var prototype = constructor.prototype;
    if (!prototype.append) prototype.append = append;
    if (!prototype.replaceChildren) prototype.replaceChildren = replaceChildren;
  }
  addDOMFallbacks(global.Element);
  addDOMFallbacks(global.Document);
  addDOMFallbacks(global.DocumentFragment);
  if (global.Element && !global.Element.prototype.remove) global.Element.prototype.remove = remove;

  var stationKey = 'panelstock-attendance-station';
  var stationToken = '';
  var stationInvalidated = null;
  var stationVersion = 0;
  var stationControls = null;
  var installationPanel = null;
  var installationTimer = null;
  function validStation(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : '';
  }
  function readStation(storageName) {
    try {
      var storage = global[storageName];
      var value = storage.getItem(stationKey);
      if (value && !validStation(value)) storage.removeItem(stationKey);
      return validStation(value);
    } catch (error) {
      return '';
    }
  }
  function writeStation(storageName, value) {
    try {
      if (value) global[storageName].setItem(stationKey, value);
      else global[storageName].removeItem(stationKey);
    } catch (error) {
      // Private browsing and full storage must not stop the paired page.
    }
  }
  function stationFragment(value) {
    var path = global.location.pathname + (value ? '#' + value : '');
    try {
      global.history.replaceState(null, '', path);
    } catch (error) {
      // Changing a fragment stays on this page and never sends the credential
      // to the server, including when history access has been restricted.
      global.location.hash = value ? '#' + value : '';
    }
  }
  global.attendanceLegacyRestoreStation = function () {
    var fragment = validStation(global.location.hash.slice(1));
    var local = readStation('localStorage');
    var session = readStation('sessionStorage');
    // A Home Screen bookmark can retain its original fragment. Keep a newer
    // pairing already saved in that installed app instead of restoring it.
    stationToken = global.navigator.standalone === true ? local || session || fragment : fragment || session || local;
    if (stationToken) {
      writeStation('localStorage', stationToken);
      writeStation('sessionStorage', stationToken);
    }
    if (global.location.hash) stationFragment('');
    return stationToken;
  };
  global.attendanceLegacyClearStation = function () {
    stationToken = '';
    stationVersion++;
    writeStation('localStorage', '');
    writeStation('sessionStorage', '');
    stationFragment('');
    if (installationPanel) {
      installationPanel.remove();
      installationPanel = null;
    }
    global.clearTimeout(installationTimer);
    if (stationControls) stationControls();
    if (stationInvalidated) stationInvalidated();
  };
  function setupRequest(path, body) {
    return global.attendanceLegacyRequest(path, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body), timeout: 20000
    }).then(function (response) {
      return response.json().then(function (result) {
        if (!response.ok || !result || result.ok !== true) {
          var message = result && result.error || 'Unable to connect. Please try again.';
          if (path === '/attendance/install-pair' && response.status === 401) message = 'This setup code is invalid, expired or already used. Get a new code in Safari and try again.';
          if (response.status === 429) message = 'Too many attempts. Wait 10 minutes, then try again.';
          throw new Error(message);
        }
        return result;
      });
    });
  }
  global.attendanceLegacyInstallStation = function (token, invalidated, paired) {
    stationToken = validStation(token);
    stationInvalidated = invalidated;
    var document = global.document;
    var button = document.getElementById('attendance-install');
    var codeButton = document.getElementById('attendance-setup-code-button');
    var connect = document.getElementById('attendance-connect');
    if (!button || !codeButton || !connect) return;
    stationControls = function () {
      button.hidden = !stationToken || global.navigator.standalone === true;
      codeButton.hidden = !stationToken;
    };
    stationControls();
    function showCode(source, installing) {
      if (!stationToken || installationPanel) return;
      var panel = document.createElement('section');
      var title = document.createElement('h2');
      var introduction = document.createElement('p');
      var steps = document.createElement('ol');
      var code = document.createElement('p');
      var status = document.createElement('p');
      var retry = document.createElement('button');
      var note = document.createElement('p');
      var close = document.createElement('button');
      panel.id = 'attendance-install-panel';
      panel.className = 'attendance-test-install-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'attendance-install-title');
      title.id = 'attendance-install-title';
      title.textContent = installing ? 'Add to Home Screen' : 'Connect the Home Screen app';
      title.tabIndex = -1;
      introduction.textContent = installing ? 'In Safari, tap Share → Add to Home Screen → Add. If the app asks for setup, use the code below.' : 'Already added Lennox Test? Open its existing Home Screen icon. If it asks for setup, enter this code and tap Connect station.';
      steps.className = 'attendance-test-install-steps';
      var instructions = installing ? [
        'Tap Share in Safari — the square with an upward arrow.',
        'Choose Add to Home Screen.',
        'Keep the name Lennox Test, then tap Add.',
        'Open Lennox Test. If setup is shown, enter the 8-digit code below and tap Connect station.'
      ] : [
        'Read the 8-digit setup code below.',
        'Open Lennox Test from the Home Screen.',
        'Enter the code on its setup screen, then tap Connect station.'
      ];
      for (var index = 0; index < instructions.length; index++) {
        var step = document.createElement('li');
        step.textContent = instructions[index];
        steps.append(step);
      }
      code.id = 'attendance-install-code';
      code.className = 'attendance-install-code';
      code.setAttribute('aria-label', '8-digit setup code');
      code.hidden = true;
      status.id = 'attendance-install-code-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      retry.id = 'attendance-install-code-retry';
      retry.type = 'button';
      retry.className = 'secondary';
      retry.textContent = 'Get a new code';
      var loading = false;
      function generateCode() {
        if (loading || !stationToken || installationPanel !== panel) return;
        loading = true;
        retry.disabled = true;
        code.hidden = true;
        code.textContent = '';
        status.textContent = 'Getting a setup code…';
        global.clearTimeout(installationTimer);
        var version = stationVersion;
        return setupRequest('/attendance/install-code', {kioskToken: stationToken}).then(function (result) {
          if (installationPanel !== panel || version !== stationVersion) return;
          var expires = Date.parse(result.expiresAt);
          if (typeof result.code !== 'string' || !/^[0-9]{8}$/.test(result.code) || typeof result.expiresAt !== 'string' || !isFinite(expires) || expires <= Date.now()) {
            throw new Error('The setup code could not be created.');
          }
          code.textContent = result.code;
          code.hidden = false;
          status.textContent = 'Valid for 10 minutes and one use. Keep this code with authorised staff.';
          installationTimer = global.setTimeout(function () {
            if (installationPanel !== panel || version !== stationVersion) return;
            code.textContent = '';
            code.hidden = true;
            status.textContent = 'This setup code has expired. Tap Get a new code.';
          }, expires - Date.now());
        }).then(function () {
          loading = false;
          retry.disabled = false;
        }, function (error) {
          loading = false;
          retry.disabled = false;
          if (installationPanel !== panel || version !== stationVersion) return;
          status.textContent = error.message + ' Tap Get a new code to retry.';
        });
      }
      retry.addEventListener('click', generateCode);
      note.className = 'attendance-install-note';
      note.textContent = 'Safari and the Home Screen app may need to be connected separately. An internet connection is required. This app uses demo attendance only.';
      close.id = 'attendance-install-close';
      close.type = 'button';
      close.className = 'secondary';
      close.textContent = 'Close instructions';
      function dismiss() {
        panel.remove();
        installationPanel = null;
        global.clearTimeout(installationTimer);
        stationFragment('');
        source.focus();
      }
      close.addEventListener('click', dismiss);
      panel.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' || event.key === 'Esc') dismiss();
      });
      panel.append(title, introduction, steps, code, status, retry, note, close);
      installationPanel = panel;
      document.body.append(panel);
      title.focus();
      return generateCode();
    }
    button.addEventListener('click', function () {
      if (global.navigator.standalone === true) return;
      return showCode(button, true);
    });
    codeButton.addEventListener('click', function () {
      return showCode(codeButton, false);
    });
    var input = document.getElementById('attendance-setup-code');
    var connectButton = document.getElementById('attendance-connect-button');
    var connectStatus = document.getElementById('attendance-connect-status');
    var connecting = false;
    connect.addEventListener('submit', function (event) {
      event.preventDefault();
      if (connecting) return;
      var value = input.value.trim();
      if (!/^[0-9]{8}$/.test(value)) {
        connectStatus.textContent = 'Enter the 8-digit setup code from Safari.';
        input.focus();
        return;
      }
      connecting = true;
      connectButton.disabled = true;
      connectStatus.textContent = 'Connecting station…';
      var version = stationVersion;
      return setupRequest('/attendance/install-pair', {code: value}).then(function (result) {
        if (version !== stationVersion) return;
        var nextToken = validStation(result.kioskToken);
        if (!nextToken) throw new Error('The station could not be connected. Get a new code in Safari and try again.');
        stationToken = nextToken;
        stationVersion++;
        writeStation('localStorage', stationToken);
        writeStation('sessionStorage', stationToken);
        stationFragment('');
        input.value = '';
        connectStatus.textContent = '';
        stationControls();
        if (paired) paired(stationToken);
      }).then(function () {
        connecting = false;
        connectButton.disabled = false;
      }, function (error) {
        connecting = false;
        connectButton.disabled = false;
        if (version !== stationVersion) return;
        connectStatus.textContent = error.message;
      });
    });
  };

  // Safari on iOS 10 cannot reliably save an anchor's download attribute.
  // Preview the existing, formula-escaped CSV without a popup or navigation.
  global.attendanceLegacyPreviewCsv = function (blob, filename) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error('Unable to open the CSV preview. Please retry.'));
      };
      reader.onload = function () {
        var document = global.document;
        var previousFocus = document.activeElement;
        var panel = document.createElement('section');
        var title = document.createElement('h2');
        var instructions = document.createElement('p');
        var label = document.createElement('label');
        var text = document.createElement('textarea');
        var close = document.createElement('button');
        panel.className = 'attendance-test-csv-preview panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'attendance-test-csv-title');
        title.id = 'attendance-test-csv-title';
        title.textContent = 'CSV preview';
        instructions.textContent = 'Touch and hold the CSV text to select and copy it. You can also export from a newer device.';
        label.htmlFor = 'attendance-test-csv-text';
        label.textContent = filename || 'Attendance CSV';
        text.id = 'attendance-test-csv-text';
        text.readOnly = true;
        text.rows = 12;
        text.value = String(reader.result || '');
        close.type = 'button';
        close.className = 'secondary';
        close.textContent = 'Close preview';
        function dismiss() {
          panel.remove();
          if (previousFocus && previousFocus.focus) previousFocus.focus();
        }
        close.addEventListener('click', dismiss);
        panel.addEventListener('keydown', function (event) {
          if (event.key === 'Escape' || event.key === 'Esc') dismiss();
        });
        panel.append(title, instructions, label, text, close);
        document.body.append(panel);
        text.focus();
        text.select();
        resolve();
      };
      try {
        reader.readAsText(blob);
      } catch (error) {
        reject(error);
      }
    });
  };

  // The caller receives HTTP errors too, so its existing authentication and
  // idempotent retry behavior remains the same as the modern attendance UI.
  global.attendanceLegacyRequest = function (url, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      var request = new XMLHttpRequest();
      var settled = false;
      function finish(error, response) {
        if (settled) return;
        settled = true;
        request.onload = request.onerror = request.ontimeout = request.onabort = null;
        if (error) reject(error);
        else resolve(response);
      }
      request.onload = function () {
        var status = request.status === 1223 ? 204 : request.status;
        if (!status) {
          finish(new Error('The connection failed. Check the iPad connection and try again.'));
          return;
        }
        if (status === 401 && /^\/attendance\/(check-in|lookup|check-out|install-code)(\?|#|$)/.test(url)) {
          global.attendanceLegacyClearStation();
        }
        var body = request.responseText;
        finish(null, {
          status: status,
          ok: status >= 200 && status < 300,
          json: function () {
            return new Promise(function (resolveJSON, rejectJSON) {
              try {
                resolveJSON(JSON.parse(body));
              } catch (error) {
                rejectJSON(new Error('The server returned an unreadable response. Please retry.'));
              }
            });
          }
        });
      };
      request.onerror = function () {
        finish(new Error('The connection failed. Check the iPad connection and try again.'));
      };
      request.ontimeout = function () {
        var error = new Error('The connection timed out. Please retry.');
        error.name = 'TimeoutError';
        finish(error);
      };
      request.onabort = function () {
        var error = new Error('The request was cancelled. Please retry.');
        error.name = 'AbortError';
        finish(error);
      };
      try {
        request.open(options.method || 'GET', url, true);
        request.timeout = typeof options.timeout === 'number' && options.timeout > 0 ? options.timeout : 20000;
        var headers = options.headers || {};
        for (var key in headers) {
          if (Object.prototype.hasOwnProperty.call(headers, key)) request.setRequestHeader(key, headers[key]);
        }
        request.send(options.body == null ? null : options.body);
      } catch (error) {
        finish(error);
      }
    });
  };
}(window));
