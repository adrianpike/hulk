// Unfortunately to do CORS we have to lean on a polyfill because the world is terrible

/**
 * eventsource.js
 * Available under MIT License (MIT)
 * https://github.com/Yaffle/EventSource/
 */

/*jslint indent: 2, vars: true */
/*global setTimeout, clearTimeout, navigator */

(function (global) {
  "use strict";

  function Map() {
    this.data = Object.create ? Object.create(null) : {};
  }

  var hasOwnProperty = Object.prototype.hasOwnProperty;

  function escapeKey(key) {
    return key !== "" && key.charAt(0) === "_" ? key + "~" : key;
  }

  Map.prototype = {
    data: null,
    get: function (key) {
      var k = escapeKey(key);
      var data = this.data;
      return hasOwnProperty.call(data, k) ? data[k] : undefined;
    },
    set: function (key, value) {
      this.data[escapeKey(key)] = value;
    },
    "delete": function (key) {
      delete this.data[escapeKey(key)];
    }
  };

  function Event(type) {
    this.type = type;
    this.eventPhase = 0;
    this.currentTarget = null;
    this.target = null;
  }

  Event.CAPTURING_PHASE = 1;
  Event.AT_TARGET = 2;
  Event.BUBBLING_PHASE = 3;

  Event.prototype = {
    type: "",
    eventPhase: 0,
    currentTarget: null,
    target: null
  };

  function EventTarget() {
    this.listeners = new Map();
    return this;
  }

  EventTarget.prototype = {
    listeners: null,
    hasListeners: function (type) {
      return this.listeners.get(String(type)) !== undefined;
    },
    throwError: function (e) {
      setTimeout(function () {
        throw e;
      }, 0);
    },
    invokeEvent: function (event) {
      var type = String(event.type);
      var phase = event.eventPhase;
      var listeners = this.listeners;
      var typeListeners = listeners.get(type);
      if (!typeListeners) {
        return;
      }
      var length = typeListeners.length;
      var i = phase === Event.BUBBLING_PHASE ? 1 : 0;
      var increment = phase === Event.CAPTURING_PHASE || phase === Event.BUBBLING_PHASE ? 2 : 1;
      while (i < length) {
        event.currentTarget = this;
        var listener = typeListeners[i];
        if (listener !== null) {
          try {
            listener.call(this, event);
          } catch (e) {
            this.throwError(e);
          }
        }
        event.currentTarget = null;
        i += increment;
      }
    },
    dispatchEvent: function (event) {
      event.eventPhase = Event.AT_TARGET;
      this.invokeEvent(event);
    },
    addEventListener: function (type, callback, capture) {
      type = String(type);
      capture = Boolean(capture);
      var listeners = this.listeners;
      var typeListeners = listeners.get(type);
      if (!typeListeners) {
        listeners.set(type, typeListeners = []); // CAPTURING BUBBLING
      }
      var i = typeListeners.length - (capture ? 2 : 1);
      while (i >= 0) {
        if (typeListeners[i] === callback) {
          return;
        }
        i -= 2;
      }
      typeListeners.push(capture ? callback : null);
      typeListeners.push(capture ? null : callback);
    },
    removeEventListener: function (type, callback, capture) {
      type = String(type);
      capture = Boolean(capture);
      var listeners = this.listeners;
      var typeListeners = listeners.get(type);
      if (!typeListeners) {
        return;
      }
      var length = typeListeners.length;
      var filtered = [];
      var i = 0;
      while (i < length) {
        if (typeListeners[i + (capture ? 0 : 1)] !== callback) {
          filtered.push(typeListeners[i]);
          filtered.push(typeListeners[i + 1]);
        }
        i += 2;
      }
      if (filtered.length === 0) {
        listeners["delete"](type);
      } else {
        listeners.set(type, filtered);
      }
    }
  };

  function Node() {
    this.next = null;
    this.callback = null;
    this.arg = null;
  }

  Node.prototype = {
    next: null,
    callback: null,
    arg: null
  };

  var tail = new Node();
  var head = tail;
  var channel = null;

  function onTimeout() {
    var callback = head.callback;
    var arg = head.arg;
    head = head.next;
    callback(arg);
  }

  // MessageChannel support: IE 10, Opera 11.6x?, Chrome ?, Safari ?
  if (global.MessageChannel) {
    channel = new global.MessageChannel();
    channel.port1.onmessage = onTimeout;
  }

  function queue(callback, arg) {
    tail.callback = callback;
    tail.arg = arg;
    tail = tail.next = new Node();
    if (channel !== null) {
      channel.port2.postMessage("");
    } else {
      setTimeout(onTimeout, 0);
    }
  }

  // http://blogs.msdn.com/b/ieinternals/archive/2010/04/06/comet-streaming-in-internet-explorer-with-xmlhttprequest-and-xdomainrequest.aspx?PageIndex=1#comments
  // XDomainRequest does not have a binary interface. To use with non-text, first base64 to string.
  // http://cometdaily.com/2008/page/3/

  var XHR = global.XMLHttpRequest;
  var xhr2 = Boolean(XHR && global.ProgressEvent && ((new XHR()).withCredentials !== undefined));
  var Transport = xhr2 ? XHR : global.XDomainRequest;
  var CONNECTING = 0;
  var OPEN = 1;
  var CLOSED = 2;

  function empty() {}

  function delay(value) {
    var n = Number(value);
    return n < 1 ? 1 : (n > 18000000 ? 18000000 : n);
  }

  function MessageEvent(type, options) {
    Event.call(this, type);
    this.data = options.data;
    this.lastEventId = options.lastEventId;
  }

  function E() {
    this.data = null;
    this.lastEventId = "";
  }
  E.prototype = Event.prototype;
  MessageEvent.prototype = new E();

  function EventSource(url, options) {
    url = String(url);

    var that = this;
    var initialRetry = 1000;
    var retry = initialRetry;
    var retryLimit = 300000;
    var heartbeatTimeout = 45000;
    var xhrTimeout = 0;
    var wasActivity = false;
    var lastEventId = "";
    var xhr = new Transport();
    var reconnectTimeout = 0;
    var withCredentials = Boolean(xhr2 && options && options.withCredentials);
    var charOffset = 0;
    var opened = false;
    var dataBuffer = [];
    var lastEventIdBuffer = "";
    var eventTypeBuffer = "";
    var wasCR = false;
    var responseBuffer = [];
    var isChunkedTextSupported = true;
    var readyState = CONNECTING;
    var onlineEventListener = null;

    options = null;

    function removeOnlineListeners() {
      if (onlineEventListener !== null) {
        if (global.addEventListener) {
          global.removeEventListener("online", onlineEventListener, false);
        }
        if (global.document && global.document.body && global.document.body.attachEvent) {
          global.document.body.detachEvent("ononline", onlineEventListener);
        }
        onlineEventListener = null;
      }
    }

    function close() {
      removeOnlineListeners();
      // http://dev.w3.org/html5/eventsource/ The close() method must close the connection, if any; must abort any instances of the fetch algorithm started for this EventSource object; and must set the readyState attribute to CLOSED.
      if (xhr !== null) {
        xhr.onload = xhr.onerror = xhr.onprogress = xhr.onreadystatechange = empty;
        xhr.abort();
        xhr = null;
      }
      if (reconnectTimeout !== 0) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = 0;
      }
      if (xhrTimeout !== 0) {
        clearTimeout(xhrTimeout);
        xhrTimeout = 0;
      }
      readyState = CLOSED;
      that.readyState = CLOSED;
    }

    function setConnectionState(event) {
      if (readyState !== CLOSED) {
        // setTimeout will wait before previous setTimeout(0) have completed
        if (retry > retryLimit) {
          retry = retryLimit;
        }
        reconnectTimeout = setTimeout(openConnection, retry);
        retry = retry * 2 + 1;

        readyState = CONNECTING;
        that.readyState = CONNECTING;
        event.target = that;
        that.dispatchEvent(event);
        if (typeof that.onerror === "function") {
          that.onerror(event);
        }
      }
    }

    function onError() {
      queue(setConnectionState, new Event("error"));
      if (xhrTimeout !== 0) {
        clearTimeout(xhrTimeout);
        xhrTimeout = 0;
      }
    }

    function onXHRTimeout() {
      xhrTimeout = 0;
      onProgress();
      if (wasActivity) {
        wasActivity = false;
        xhrTimeout = setTimeout(onXHRTimeout, heartbeatTimeout);
      } else {
        xhr.onload = xhr.onerror = xhr.onprogress = xhr.onreadystatechange = empty;
        xhr.abort();
        onError();
      }
    }

    function setOpenState(event) {
      if (readyState !== CLOSED) {
        readyState = OPEN;
        that.readyState = OPEN;
        event.target = that;
        that.dispatchEvent(event);
        if (typeof that.onopen === "function") {
          that.onopen(event);
        }
      }
    }

    function dispatchEvent(event) {
      if (readyState !== CLOSED) {
        var type = String(event.type);
        event.target = that;
        that.dispatchEvent(event);
        if (type === "message" && typeof that.onmessage === "function") {
          that.onmessage(event);
        }
      }
    }

    function onProgress() {
      if (!opened) {
        var contentType = "";
        try {
          contentType = xhr.getResponseHeader ? xhr.getResponseHeader("Content-Type") : xhr.contentType;
        } catch (error) {
          // invalid state error when xhr.getResponseHeader called after xhr.abort in Chrome 18
          setTimeout(function () {
            throw error;
          }, 0);
        }
        if (contentType && (/^text\/event\-stream/i).test(contentType)) {
          queue(setOpenState, new Event("open"));
          opened = true;
          wasActivity = true;
          retry = initialRetry;
        }
      }

      if (opened) {
        var responseText = xhr.responseText || "";
        var part = responseText.slice(charOffset);
        if (part.length > 0) {
          wasActivity = true;
        }
        if (wasCR && part.length > 0) {
          if (part.slice(0, 1) === "\n") {
            part = part.slice(1);
          }
          wasCR = false;
        }
        var i = 0;
        while ((i = part.search(/[\r\n]/)) !== -1) {
          var field = responseBuffer.join("") + part.slice(0, i);
          responseBuffer.length = 0;
          if (part.length > i + 1) {
            part = part.slice(i + (part.slice(i, i + 2) === "\r\n" ? 2 : 1));
          } else {
            if (part.slice(i, i + 1) === "\r") {
              wasCR = true;
            }
            part = "";
          }

          if (field) {
            var value = "";
            var j = field.indexOf(":");
            if (j !== -1) {
              value = field.slice(j + (field.slice(j + 1, j + 2) === " " ? 2 : 1));
              field = field.slice(0, j);
            }

            if (field === "event") {
              eventTypeBuffer = value;
            }

            if (field === "id") {
              lastEventIdBuffer = value; // see http://www.w3.org/Bugs/Public/show_bug.cgi?id=13761
            }

            if (field === "retry") {
              if (/^\d+$/.test(value)) {
                initialRetry = delay(value);
                retry = initialRetry;
                if (retryLimit < initialRetry) {
                  retryLimit = initialRetry;
                }
              }
            }

            if (field === "heartbeatTimeout") {//!
              if (/^\d+$/.test(value)) {
                heartbeatTimeout = delay(value);
                if (xhrTimeout !== 0) {
                  clearTimeout(xhrTimeout);
                  xhrTimeout = setTimeout(onXHRTimeout, heartbeatTimeout);
                }
              }
            }

            if (field === "retryLimit") {//!
              if (/^\d+$/.test(value)) {
                retryLimit = delay(value);
              }
            }

            if (field === "data") {
              dataBuffer.push(value);
            }
          } else {
            // dispatch the event
            if (dataBuffer.length !== 0) {
              lastEventId = lastEventIdBuffer;
              queue(dispatchEvent, new MessageEvent(eventTypeBuffer || "message", {
                data: dataBuffer.join("\n"),
                lastEventId: lastEventIdBuffer
              }));
            }
            // Set the data buffer and the event name buffer to the empty string.
            dataBuffer.length = 0;
            eventTypeBuffer = "";
          }
        }
        if (part !== "") {
          responseBuffer.push(part);
        }
        charOffset = isChunkedTextSupported ? 0 : responseText.length;
        if (!isChunkedTextSupported && (responseText.length > 1 * 1024 * 1024)) {
          xhr.onload = xhr.onerror = xhr.onprogress = xhr.onreadystatechange = empty;
          xhr.abort();
          onError();
        }
      }
    }

    function onLoad() {
      onProgress();
      onError();
    }

    function onReadyStateChange() {
      if (xhr.readyState === 3) {
        onProgress();
      }
    }

    function openConnection() {
      reconnectTimeout = 0;
      removeOnlineListeners();
      if (navigator.onLine === false) {
        onlineEventListener = openConnection;
        if (global.addEventListener && global.ononline !== undefined) {
          global.addEventListener("online", onlineEventListener, false);
          return;
        }
        //! document.body is null while page is loading
        if (global.document && global.document.body && global.document.body.attachEvent && global.document.body.ononline !== undefined) {
          global.document.body.attachEvent("ononline", onlineEventListener);
          return;
        }
        // Web Workers
        reconnectTimeout = setTimeout(openConnection, 500);
        return;
      }
      // XDomainRequest#abort removes onprogress, onerror, onload

      xhr.onload = xhr.onerror = onLoad;

      // onprogress fires multiple times while readyState === 3
      // onprogress should be setted before calling "open" for Firefox 3.6
      xhr.onprogress = onProgress;

      // Firefox 3.6
      // onreadystatechange fires more often, than "progress" in Chrome and Firefox
      xhr.onreadystatechange = onReadyStateChange;

      wasActivity = false;
      xhrTimeout = setTimeout(onXHRTimeout, heartbeatTimeout);

      charOffset = 0;
      opened = false;
      dataBuffer.length = 0;
      eventTypeBuffer = "";
      lastEventIdBuffer = lastEventId;//resets to last successful

      // with GET method in FF xhr.onreadystatechange with readyState === 3 does not work + POST = no-cache
      xhr.open("POST", url, true);

      // withCredentials should be setted after "open" for Safari and Chrome (< 19 ?)
      xhr.withCredentials = withCredentials;

      xhr.responseType = "text";

      wasCR = false;
      responseBuffer.length = 0;
      if (isChunkedTextSupported) {
        isChunkedTextSupported = false;
        var t = "moz-chunked-text";
        try {
          // setting xhr.responseType = t outputs annoying message in Chrome
          if (xhr.setRequestHeader && !!global.webkitPostMessage) {
            xhr.responseType = t;
          }
          isChunkedTextSupported = xhr.responseType === t;
        } catch (e) {
          //console.log(e);
        }
      }

      if (xhr.setRequestHeader) { // !XDomainRequest
        // http://dvcs.w3.org/hg/cors/raw-file/tip/Overview.html
        // Cache-Control is not a simple header
        // Request header field Cache-Control is not allowed by Access-Control-Allow-Headers.
        //xhr.setRequestHeader("Cache-Control", "no-cache");

        // Chrome bug:
        // http://code.google.com/p/chromium/issues/detail?id=71694
        // If you force Chrome to have a whitelisted content-type, either explicitly with setRequestHeader(), or implicitly by sending a FormData, then no preflight is done.
        xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
        xhr.setRequestHeader("Accept", "text/event-stream");

        // Request header field Last-Event-ID is not allowed by Access-Control-Allow-Headers.
        // +setRequestHeader should not be used to avoid preflight requests
        //if (lastEventId !== "") {
        //  xhr.setRequestHeader("Last-Event-ID", lastEventId);
        //}
      }
      xhr.send(lastEventId !== "" ? "Last-Event-ID=" + encodeURIComponent(lastEventId) : "");
    }

    openConnection();

    EventTarget.call(that);
    that.close = close;

    that.url = url;
    that.readyState = readyState;
    that.withCredentials = withCredentials;
    return that;
  }

  function F() {
    this.CONNECTING = CONNECTING;
    this.OPEN = OPEN;
    this.CLOSED = CLOSED;
  }
  F.prototype = EventTarget.prototype;

  EventSource.prototype = new F();
  EventSource.CONNECTING = CONNECTING;
  EventSource.OPEN = OPEN;
  EventSource.CLOSED = CLOSED;

  if (Transport) {
    global.EventSource = EventSource;
  }

}(this));


// https://github.com/Yaffle/EventSource

var JUGGERNAUT_COMPATIBLE = true;

var Hulk = function (opts) {
  this.opts = opts || {};
  this.opts.host = 'localhost:8080';
  this.opts.protocol = 'http://';

  this.subscriptions = {};
  this.event_callbacks = {};

  this.connected = false;

  this.on = function (event, callback) {
    if (JUGGERNAUT_COMPATIBLE) {
      switch (event) {
      case 'connect':
        event = 'open';
        break;
      case 'disconnect':
        event = 'error';
        break;
      }

    }

    this.event_callbacks[event] = callback;
  };

  this.connect = function () {
    this.connected = true;
    if (typeof(this.event_callbacks['open']) !== 'undefined') {
      this.event_callbacks['open']();
    }
  };

  this.subscribe = function (channel, callback) {
    var hulk = this;
    var source = new EventSource(this.opts.protocol + this.opts.host + '/stream.json?stream=' + channel);
    source.addEventListener('message', function (e, data) {
      if (!hulk.connected) {
        hulk.connect();
      }
      callback(e.data);
    }, false);

    source.addEventListener('error', function (e) {
      if (typeof(hulk.event_callbacks['error']) !== 'undefined') {
        hulk.event_callbacks['error']();
      }
    }, false);

  };

};

if (JUGGERNAUT_COMPATIBLE) {
  window.Juggernaut = Hulk;
}
