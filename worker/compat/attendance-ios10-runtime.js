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
