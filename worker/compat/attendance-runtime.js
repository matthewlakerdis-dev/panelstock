/* Safari-compatible site attendance runtime. */
(function (global) {
  'use strict';

  var crypto = global.crypto || (global.crypto = {});
  if (typeof crypto.randomUUID !== 'function') {
    crypto.randomUUID = function () {
      if (typeof crypto.getRandomValues !== 'function') {
        throw new Error('Secure random numbers are unavailable. Open this HTTPS site in Safari.');
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

  var apiOrigin = global.attendanceApiOrigin || '';
  var stationKey = 'panelstock-attendance-station';
  var stationToken = '';
  var stationInvalidated = null;
  var stationVersion = 0;
  var stationControls = null;
  var installationPanel = null;
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
    if (stationControls) stationControls();
    if (stationInvalidated) stationInvalidated();
  };
  function publicKioskPath(url) {
    var value = String(url);
    var pageOrigin = global.location.origin;
    if (apiOrigin && value.indexOf(apiOrigin + '/') === 0) value = value.slice(apiOrigin.length);
    else if (pageOrigin && value.indexOf(pageOrigin + '/') === 0) value = value.slice(pageOrigin.length);
    return /^\/attendance\/(check-in|lookup|check-out)(\?|#|$)/.test(value);
  }
  function setupRequest(path, body, adminToken) {
    var headers = {'Content-Type': 'application/json'};
    if (adminToken) headers.Authorization = 'Bearer ' + adminToken;
    return global.attendanceLegacyRequest(apiOrigin + path, {
      method: 'POST', headers: headers,
      body: JSON.stringify(body), timeout: 20000
    }).then(function (response) {
      return response.json().then(function (result) {
        if (!response.ok || !result || result.ok !== true) {
          throw new Error(result && result.error || 'Unable to connect. Please try again.');
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
    var adminConnect = document.getElementById('attendance-admin-connect');
    if (!button || !adminConnect) return;
    stationControls = function () {
      button.hidden = !stationToken || global.navigator.standalone === true;
    };
    stationControls();
    button.addEventListener('click', function () {
      if (!stationToken || installationPanel || global.navigator.standalone === true) return;
      var panel = document.createElement('section');
      var title = document.createElement('h2');
      var introduction = document.createElement('p');
      var steps = document.createElement('ol');
      var note = document.createElement('p');
      var close = document.createElement('button');
      panel.id = 'attendance-install-panel';
      panel.className = 'attendance-install-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'attendance-install-title');
      title.id = 'attendance-install-title';
      title.textContent = 'Add to Home Screen';
      title.tabIndex = -1;
      introduction.textContent = 'In Safari, tap Share → Add to Home Screen → Add. Connect the app on this iPad with an administrator username and PIN.';
      steps.className = 'attendance-install-steps';
      var instructions = [
        'Tap Share in Safari — the square with an upward arrow.',
        'Choose Add to Home Screen.',
        'Keep the name Lennox Sign In, then tap Add.',
        'Open Lennox Sign In. Enter an administrator username and PIN, then tap Connect this iPad.'
      ];
      for (var index = 0; index < instructions.length; index++) {
        var step = document.createElement('li');
        step.textContent = instructions[index];
        steps.append(step);
      }
      note.className = 'attendance-install-note';
      note.textContent = 'Setup happens inside the Home Screen app. An internet connection is required.';
      close.id = 'attendance-install-close';
      close.type = 'button';
      close.className = 'secondary';
      close.textContent = 'Close instructions';
      function dismiss() {
        panel.remove();
        installationPanel = null;
        stationFragment('');
        button.focus();
      }
      close.addEventListener('click', dismiss);
      panel.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' || event.key === 'Esc') dismiss();
      });
      panel.append(title, introduction, steps, note, close);
      installationPanel = panel;
      document.body.append(panel);
      title.focus();
    });
    var adminUsername = document.getElementById('attendance-admin-username');
    var adminPin = document.getElementById('attendance-admin-pin');
    var adminButton = document.getElementById('attendance-admin-connect-button');
    var adminStatus = document.getElementById('attendance-admin-connect-status');
    var connecting = false;
    function setConnecting(value) {
      connecting = value;
      adminButton.disabled = value;
    }
    function connectStation(nextToken) {
      stationToken = nextToken;
      stationVersion++;
      writeStation('localStorage', stationToken);
      writeStation('sessionStorage', stationToken);
      stationFragment('');
      stationControls();
      if (paired) paired(stationToken);
    }
    adminConnect.addEventListener('submit', function (event) {
      event.preventDefault();
      if (connecting) return;
      var username = adminUsername.value.trim();
      var pin = adminPin.value;
      adminPin.value = '';
      if (!username || !pin) {
        adminStatus.textContent = 'Enter an administrator username and PIN.';
        adminPin.focus();
        return;
      }
      setConnecting(true);
      adminStatus.textContent = 'Connecting this iPad…';
      var version = stationVersion;
      var session = '';
      var connectedToken = '';
      var setupError = null;
      var login = setupRequest('/login', {username: username, pin: pin});
      pin = '';
      username = '';
      return login.then(function (result) {
        session = typeof result.token === 'string' ? result.token : '';
        if (result.mustChangePin) throw new Error('Set your PIN in the PanelStock app before connecting this iPad.');
        if (!session) throw new Error('Sign-in did not return a session. Please retry.');
        if (result.isAdmin !== true) throw new Error('An administrator account is required.');
        if (version !== stationVersion) throw new Error('Setup changed. Please try again.');
        return setupRequest('/attendance/kiosk', {}, session);
      }).then(function (result) {
        connectedToken = validStation(result.kioskToken);
        if (!connectedToken) throw new Error('The station could not be connected. Please try again.');
      }).then(function () {}, function (error) {
        setupError = error;
      }).then(function () {
        // The administrator session is used only for setup and never saved.
        // Always attempt to revoke it, including non-admin and pairing errors.
        var logoutToken = session;
        session = '';
        if (!logoutToken) return;
        return setupRequest('/logout', {}, logoutToken).then(function () {
          logoutToken = '';
        }, function () {
          logoutToken = '';
        });
      }).then(function () {
        adminUsername.value = '';
        adminPin.value = '';
        setConnecting(false);
        if (version !== stationVersion) return;
        if (setupError) {
          adminStatus.textContent = setupError.message;
          return;
        }
        adminStatus.textContent = '';
        connectStation(connectedToken);
        connectedToken = '';
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
        panel.className = 'attendance-csv-preview panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'attendance-csv-title');
        title.id = 'attendance-csv-title';
        title.textContent = 'CSV preview';
        instructions.textContent = 'Touch and hold the CSV text to select and copy it. You can also export from a newer device.';
        label.htmlFor = 'attendance-csv-text';
        label.textContent = filename || 'Attendance CSV';
        text.id = 'attendance-csv-text';
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
        if (status === 401 && publicKioskPath(url)) {
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
