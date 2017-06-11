/**
 * SVGInjector v1.1.3 - Fast, caching, dynamic inline SVG DOM injection library
 * https://github.com/iconic/SVGInjector
 *
 * Copyright (c) 2014-2015 Waybury <hello@waybury.com>
 * @license MIT
 */

(function (window, document) {

  'use strict';

  // Environment

  var isLocal = window.location.protocol === 'file:';
  var hasSvgSupport = document.implementation.hasFeature('http://www.w3.org/TR/SVG11/feature#BasicStructure', '1.1');

  function uniqueClasses(list) {
    list = list.split(' ');

    var hash = {};
    var i = list.length;
    var out = [];

    while (i--) {
      if (!hash.hasOwnProperty(list[i])) {
        hash[list[i]] = 1;
        out.unshift(list[i]);
      }
    }

    return out.join(' ');
  }

  /**
   * cache (or polyfill for <= IE8) Array.forEach()
   * source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/forEach
   */
  var forEach = Array.prototype.forEach || function (fn, scope) {
    if (this === void 0 || this === null || typeof fn !== 'function') {
      throw new TypeError();
    }

    /* jshint bitwise: false */
    var i,
        len = this.length >>> 0;
    /* jshint bitwise: true */

    for (i = 0; i < len; ++i) {
      if (i in this) {
        fn.call(scope, this[i], i, this);
      }
    }
  };

  // SVG Cache
  var svgCache = {};

  var injectCount = 0;
  var injectedElements = [];

  // Request Queue
  var requestQueue = [];

  // Script running status
  var ranScripts = {};

  var cloneSvg = function (sourceSvg) {
    return sourceSvg.cloneNode(true);
  };

  var queueRequest = function (url, callback) {
    requestQueue[url] = requestQueue[url] || [];
    requestQueue[url].push(callback);
  };

  var processRequestQueue = function (url) {
    for (var i = 0, len = requestQueue[url].length; i < len; i++) {
      // Make these calls async so we avoid blocking the page/renderer
      /* jshint loopfunc: true */
      (function (index) {
        setTimeout(function () {
          requestQueue[url][index](cloneSvg(svgCache[url]));
        }, 0);
      })(i);
      /* jshint loopfunc: false */
    }
  };

  var loadSvg = function (url, callback) {
    if (svgCache[url] !== undefined) {
      if (svgCache[url] instanceof SVGSVGElement) {
        // We already have it in cache, so use it
        callback(cloneSvg(svgCache[url]));
      } else {
        // We don't have it in cache yet, but we are loading it, so queue this request
        queueRequest(url, callback);
      }
    } else {

      if (!window.XMLHttpRequest) {
        callback('Browser does not support XMLHttpRequest');
        return false;
      }

      // Seed the cache to indicate we are loading this URL already
      svgCache[url] = {};
      queueRequest(url, callback);

      var httpRequest = new XMLHttpRequest();

      httpRequest.onreadystatechange = function () {
        // readyState 4 = complete
        if (httpRequest.readyState === 4) {

          // Handle status
          if (httpRequest.status === 404 || httpRequest.responseXML === null) {
            callback('Unable to load SVG file: ' + url);

            if (isLocal) callback('Note: SVG injection ajax calls do not work locally without adjusting security setting in your browser. Or consider using a local webserver.');

            callback();
            return false;
          }

          // 200 success from server, or 0 when using file:// protocol locally
          if (httpRequest.status === 200 || isLocal && httpRequest.status === 0) {

            /* globals Document */
            if (httpRequest.responseXML instanceof Document) {
              // Cache it
              svgCache[url] = httpRequest.responseXML.documentElement;
            }
            /* globals -Document */

            // IE9 doesn't create a responseXML Document object from loaded SVG,
            // and throws a "DOM Exception: HIERARCHY_REQUEST_ERR (3)" error when injected.
            //
            // So, we'll just create our own manually via the DOMParser using
            // the the raw XML responseText.
            //
            // :NOTE: IE8 and older doesn't have DOMParser, but they can't do SVG either, so...
            else if (DOMParser && DOMParser instanceof Function) {
                var xmlDoc;
                try {
                  var parser = new DOMParser();
                  xmlDoc = parser.parseFromString(httpRequest.responseText, 'text/xml');
                } catch (e) {
                  xmlDoc = undefined;
                }

                if (!xmlDoc || xmlDoc.getElementsByTagName('parsererror').length) {
                  callback('Unable to parse SVG file: ' + url);
                  return false;
                } else {
                  // Cache it
                  svgCache[url] = xmlDoc.documentElement;
                }
              }

            // We've loaded a new asset, so process any requests waiting for it
            processRequestQueue(url);
          } else {
            callback('There was a problem injecting the SVG: ' + httpRequest.status + ' ' + httpRequest.statusText);
            return false;
          }
        }
      };

      httpRequest.open('GET', url);

      // Treat and parse the response as XML, even if the
      // server sends us a different mimetype
      if (httpRequest.overrideMimeType) httpRequest.overrideMimeType('text/xml');

      httpRequest.send();
    }
  };

  // Inject a single element
  var injectElement = function (el, evalScripts, pngFallback, callback) {

    // Grab the src or data-src attribute
    var imgUrl = el.getAttribute('data-src') || el.getAttribute('src');

    // We can only inject SVG
    if (!/\.svg/i.test(imgUrl)) {
      callback('Attempted to inject a file with a non-svg extension: ' + imgUrl);
      return;
    }

    // If we don't have SVG support try to fall back to a png,
    // either defined per-element via data-fallback or data-png,
    // or globally via the pngFallback directory setting
    if (!hasSvgSupport) {
      var perElementFallback = el.getAttribute('data-fallback') || el.getAttribute('data-png');

      // Per-element specific PNG fallback defined, so use that
      if (perElementFallback) {
        el.setAttribute('src', perElementFallback);
        callback(null);
      }
      // Global PNG fallback directoriy defined, use the same-named PNG
      else if (pngFallback) {
          el.setAttribute('src', pngFallback + '/' + imgUrl.split('/').pop().replace('.svg', '.png'));
          callback(null);
        }
        // um...
        else {
            callback('This browser does not support SVG and no PNG fallback was defined.');
          }

      return;
    }

    // Make sure we aren't already in the process of injecting this element to
    // avoid a race condition if multiple injections for the same element are run.
    // :NOTE: Using indexOf() only _after_ we check for SVG support and bail,
    // so no need for IE8 indexOf() polyfill
    if (injectedElements.indexOf(el) !== -1) {
      return;
    }

    // Remember the request to inject this element, in case other injection
    // calls are also trying to replace this element before we finish
    injectedElements.push(el);

    // Try to avoid loading the orginal image src if possible.
    el.setAttribute('src', '');

    // Load it up
    loadSvg(imgUrl, function (svg) {

      if (typeof svg === 'undefined' || typeof svg === 'string') {
        callback(svg);
        return false;
      }

      var imgId = el.getAttribute('id');
      if (imgId) {
        svg.setAttribute('id', imgId);
      }

      var imgTitle = el.getAttribute('title');
      if (imgTitle) {
        svg.setAttribute('title', imgTitle);
      }

      // Concat the SVG classes + 'injected-svg' + the img classes
      var classMerge = [].concat(svg.getAttribute('class') || [], 'injected-svg', el.getAttribute('class') || []).join(' ');
      svg.setAttribute('class', uniqueClasses(classMerge));

      var imgStyle = el.getAttribute('style');
      if (imgStyle) {
        svg.setAttribute('style', imgStyle);
      }

      // Copy all the data elements to the svg
      var imgData = [].filter.call(el.attributes, function (at) {
        return (/^data-\w[\w\-]*$/.test(at.name)
        );
      });
      forEach.call(imgData, function (dataAttr) {
        if (dataAttr.name && dataAttr.value) {
          svg.setAttribute(dataAttr.name, dataAttr.value);
        }
      });

      // Make sure any internally referenced clipPath ids and their
      // clip-path references are unique.
      //
      // This addresses the issue of having multiple instances of the
      // same SVG on a page and only the first clipPath id is referenced.
      //
      // Browsers often shortcut the SVG Spec and don't use clipPaths
      // contained in parent elements that are hidden, so if you hide the first
      // SVG instance on the page, then all other instances lose their clipping.
      // Reference: https://bugzilla.mozilla.org/show_bug.cgi?id=376027

      // Handle all defs elements that have iri capable attributes as defined by w3c: http://www.w3.org/TR/SVG/linking.html#processingIRI
      // Mapping IRI addressable elements to the properties that can reference them:
      var iriElementsAndProperties = {
        'clipPath': ['clip-path'],
        'color-profile': ['color-profile'],
        'cursor': ['cursor'],
        'filter': ['filter'],
        'linearGradient': ['fill', 'stroke'],
        'marker': ['marker', 'marker-start', 'marker-mid', 'marker-end'],
        'mask': ['mask'],
        'pattern': ['fill', 'stroke'],
        'radialGradient': ['fill', 'stroke']
      };

      var element, elementDefs, properties, currentId, newId;
      Object.keys(iriElementsAndProperties).forEach(function (key) {
        element = key;
        properties = iriElementsAndProperties[key];

        elementDefs = svg.querySelectorAll('defs ' + element + '[id]');
        for (var i = 0, elementsLen = elementDefs.length; i < elementsLen; i++) {
          currentId = elementDefs[i].id;
          newId = currentId + '-' + injectCount;

          // All of the properties that can reference this element type
          var referencingElements;
          forEach.call(properties, function (property) {
            // :NOTE: using a substring match attr selector here to deal with IE "adding extra quotes in url() attrs"
            referencingElements = svg.querySelectorAll('[' + property + '*="' + currentId + '"]');
            for (var j = 0, referencingElementLen = referencingElements.length; j < referencingElementLen; j++) {
              referencingElements[j].setAttribute(property, 'url(#' + newId + ')');
            }
          });

          elementDefs[i].id = newId;
        }
      });

      // Remove any unwanted/invalid namespaces that might have been added by SVG editing tools
      svg.removeAttribute('xmlns:a');

      // Post page load injected SVGs don't automatically have their script
      // elements run, so we'll need to make that happen, if requested

      // Find then prune the scripts
      var scripts = svg.querySelectorAll('script');
      var scriptsToEval = [];
      var script, scriptType;

      for (var k = 0, scriptsLen = scripts.length; k < scriptsLen; k++) {
        scriptType = scripts[k].getAttribute('type');

        // Only process javascript types.
        // SVG defaults to 'application/ecmascript' for unset types
        if (!scriptType || scriptType === 'application/ecmascript' || scriptType === 'application/javascript') {

          // innerText for IE, textContent for other browsers
          script = scripts[k].innerText || scripts[k].textContent;

          // Stash
          scriptsToEval.push(script);

          // Tidy up and remove the script element since we don't need it anymore
          svg.removeChild(scripts[k]);
        }
      }

      // Run/Eval the scripts if needed
      if (scriptsToEval.length > 0 && (evalScripts === 'always' || evalScripts === 'once' && !ranScripts[imgUrl])) {
        for (var l = 0, scriptsToEvalLen = scriptsToEval.length; l < scriptsToEvalLen; l++) {

          // :NOTE: Yup, this is a form of eval, but it is being used to eval code
          // the caller has explictely asked to be loaded, and the code is in a caller
          // defined SVG file... not raw user input.
          //
          // Also, the code is evaluated in a closure and not in the global scope.
          // If you need to put something in global scope, use 'window'
          new Function(scriptsToEval[l])(window); // jshint ignore:line
        }

        // Remember we already ran scripts for this svg
        ranScripts[imgUrl] = true;
      }

      // :WORKAROUND:
      // IE doesn't evaluate <style> tags in SVGs that are dynamically added to the page.
      // This trick will trigger IE to read and use any existing SVG <style> tags.
      //
      // Reference: https://github.com/iconic/SVGInjector/issues/23
      var styleTags = svg.querySelectorAll('style');
      forEach.call(styleTags, function (styleTag) {
        styleTag.textContent += '';
      });

      // Replace the image with the svg
      el.parentNode.replaceChild(svg, el);

      // Now that we no longer need it, drop references
      // to the original element so it can be GC'd
      delete injectedElements[injectedElements.indexOf(el)];
      el = null;

      // Increment the injected count
      injectCount++;

      callback(svg);
    });
  };

  /**
   * SVGInjector
   *
   * Replace the given elements with their full inline SVG DOM elements.
   *
   * :NOTE: We are using get/setAttribute with SVG because the SVG DOM spec differs from HTML DOM and
   * can return other unexpected object types when trying to directly access svg properties.
   * ex: "className" returns a SVGAnimatedString with the class value found in the "baseVal" property,
   * instead of simple string like with HTML Elements.
   *
   * @param {mixes} Array of or single DOM element
   * @param {object} options
   * @param {function} callback
   * @return {object} Instance of SVGInjector
   */
  var SVGInjector = function (elements, options, done) {

    // Options & defaults
    options = options || {};

    // Should we run the scripts blocks found in the SVG
    // 'always' - Run them every time
    // 'once' - Only run scripts once for each SVG
    // [false|'never'] - Ignore scripts
    var evalScripts = options.evalScripts || 'always';

    // Location of fallback pngs, if desired
    var pngFallback = options.pngFallback || false;

    // Callback to run during each SVG injection, returning the SVG injected
    var eachCallback = options.each;

    // Do the injection...
    if (elements.length !== undefined) {
      var elementsLoaded = 0;
      forEach.call(elements, function (element) {
        injectElement(element, evalScripts, pngFallback, function (svg) {
          if (eachCallback && typeof eachCallback === 'function') eachCallback(svg);
          if (done && elements.length === ++elementsLoaded) done(elementsLoaded);
        });
      });
    } else {
      if (elements) {
        injectElement(elements, evalScripts, pngFallback, function (svg) {
          if (eachCallback && typeof eachCallback === 'function') eachCallback(svg);
          if (done) done(1);
          elements = null;
        });
      } else {
        if (done) done(0);
      }
    }
  };

  /* global module, exports: true, define */
  // Node.js or CommonJS
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = exports = SVGInjector;
  }
  // AMD support
  else if (typeof define === 'function' && define.amd) {
      define(function () {
        return SVGInjector;
      });
    }
    // Otherwise, attach to window as global
    else if (typeof window === 'object') {
        window.SVGInjector = SVGInjector;
      }
  /* global -module, -exports, -define */
})(window, document);
var autoScroll = function () {
    'use strict';

    function getDef(f, d) {
        if (typeof f === 'undefined') {
            return typeof d === 'undefined' ? f : d;
        }

        return f;
    }
    function boolean(func, def) {

        func = getDef(func, def);

        if (typeof func === 'function') {
            return function f() {
                var arguments$1 = arguments;

                for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
                    args[_key] = arguments$1[_key];
                }

                return !!func.apply(this, args);
            };
        }

        return !!func ? function () {
            return true;
        } : function () {
            return false;
        };
    }

    var prefix = ['webkit', 'moz', 'ms', 'o'];

    var requestAnimationFrame = function () {

        for (var i = 0, limit = prefix.length; i < limit && !window.requestAnimationFrame; ++i) {
            window.requestAnimationFrame = window[prefix[i] + 'RequestAnimationFrame'];
        }

        if (!window.requestAnimationFrame) {
            (function () {
                var lastTime = 0;

                window.requestAnimationFrame = function (callback) {
                    var now = new Date().getTime();
                    var ttc = Math.max(0, 16 - now - lastTime);
                    var timer = window.setTimeout(function () {
                        return callback(now + ttc);
                    }, ttc);

                    lastTime = now + ttc;

                    return timer;
                };
            })();
        }

        return window.requestAnimationFrame.bind(window);
    }();

    var cancelAnimationFrame = function () {

        for (var i = 0, limit = prefix.length; i < limit && !window.cancelAnimationFrame; ++i) {
            window.cancelAnimationFrame = window[prefix[i] + 'CancelAnimationFrame'] || window[prefix[i] + 'CancelRequestAnimationFrame'];
        }

        if (!window.cancelAnimationFrame) {
            window.cancelAnimationFrame = function (timer) {
                window.clearTimeout(timer);
            };
        }

        return window.cancelAnimationFrame.bind(window);
    }();

    var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) {
        return typeof obj;
    } : function (obj) {
        return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj;
    };

    /**
     * Returns `true` if provided input is Element.
     * @name isElement
     * @param {*} [input]
     * @returns {boolean}
     */
    var isElement = function (input) {
        return input != null && (typeof input === 'undefined' ? 'undefined' : _typeof(input)) === 'object' && input.nodeType === 1 && _typeof(input.style) === 'object' && _typeof(input.ownerDocument) === 'object';
    };

    // Production steps of ECMA-262, Edition 6, 22.1.2.1
    // Reference: http://www.ecma-international.org/ecma-262/6.0/#sec-array.from

    /**
     * isArray
     */

    function indexOfElement(elements, element) {
        element = resolveElement(element, true);
        if (!isElement(element)) {
            return -1;
        }
        for (var i = 0; i < elements.length; i++) {
            if (elements[i] === element) {
                return i;
            }
        }
        return -1;
    }

    function hasElement(elements, element) {
        return -1 !== indexOfElement(elements, element);
    }

    function pushElements(elements, toAdd) {

        for (var i = 0; i < toAdd.length; i++) {
            if (!hasElement(elements, toAdd[i])) {
                elements.push(toAdd[i]);
            }
        }

        return toAdd;
    }

    function addElements(elements) {
        var arguments$1 = arguments;

        for (var _len2 = arguments.length, toAdd = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
            toAdd[_key2 - 1] = arguments$1[_key2];
        }

        toAdd = toAdd.map(resolveElement);
        return pushElements(elements, toAdd);
    }

    function removeElements(elements) {
        var arguments$1 = arguments;

        for (var _len3 = arguments.length, toRemove = Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
            toRemove[_key3 - 1] = arguments$1[_key3];
        }

        return toRemove.map(resolveElement).reduce(function (last, e) {

            var index$$1 = indexOfElement(elements, e);

            if (index$$1 !== -1) {
                return last.concat(elements.splice(index$$1, 1));
            }
            return last;
        }, []);
    }

    function resolveElement(element, noThrow) {
        if (typeof element === 'string') {
            try {
                return document.querySelector(element);
            } catch (e) {
                throw e;
            }
        }

        if (!isElement(element) && !noThrow) {
            throw new TypeError(element + ' is not a DOM element.');
        }
        return element;
    }

    var index$2 = function createPointCB(object, options) {

        // A persistent object (as opposed to returned object) is used to save memory
        // This is good to prevent layout thrashing, or for games, and such

        // NOTE
        // This uses IE fixes which should be OK to remove some day. :)
        // Some speed will be gained by removal of these.

        // pointCB should be saved in a variable on return
        // This allows the usage of element.removeEventListener

        options = options || {};

        var allowUpdate;

        if (typeof options.allowUpdate === 'function') {
            allowUpdate = options.allowUpdate;
        } else {
            allowUpdate = function () {
                return true;
            };
        }

        return function pointCB(event) {

            event = event || window.event; // IE-ism
            object.target = event.target || event.srcElement || event.originalTarget;
            object.element = this;
            object.type = event.type;

            if (!allowUpdate(event)) {
                return;
            }

            // Support touch
            // http://www.creativebloq.com/javascript/make-your-site-work-touch-devices-51411644

            if (event.targetTouches) {
                object.x = event.targetTouches[0].clientX;
                object.y = event.targetTouches[0].clientY;
                object.pageX = event.pageX;
                object.pageY = event.pageY;
            } else {

                // If pageX/Y aren't available and clientX/Y are,
                // calculate pageX/Y - logic taken from jQuery.
                // (This is to support old IE)
                // NOTE Hopefully this can be removed soon.

                if (event.pageX === null && event.clientX !== null) {
                    var eventDoc = event.target && event.target.ownerDocument || document;
                    var doc = eventDoc.documentElement;
                    var body = eventDoc.body;

                    object.pageX = event.clientX + (doc && doc.scrollLeft || body && body.scrollLeft || 0) - (doc && doc.clientLeft || body && body.clientLeft || 0);
                    object.pageY = event.clientY + (doc && doc.scrollTop || body && body.scrollTop || 0) - (doc && doc.clientTop || body && body.clientTop || 0);
                } else {
                    object.pageX = event.pageX;
                    object.pageY = event.pageY;
                }

                // pageX, and pageY change with page scroll
                // so we're not going to use those for x, and y.
                // NOTE Most browsers also alias clientX/Y with x/y
                // so that's something to consider down the road.

                object.x = event.clientX;
                object.y = event.clientY;
            }
        };

        //NOTE Remember accessibility, Aria roles, and labels.
    };

    function createWindowRect() {
        var props = {
            top: { value: 0, enumerable: true },
            left: { value: 0, enumerable: true },
            right: { value: window.innerWidth, enumerable: true },
            bottom: { value: window.innerHeight, enumerable: true },
            width: { value: window.innerWidth, enumerable: true },
            height: { value: window.innerHeight, enumerable: true },
            x: { value: 0, enumerable: true },
            y: { value: 0, enumerable: true }
        };

        if (Object.create) {
            return Object.create({}, props);
        } else {
            var rect = {};
            Object.defineProperties(rect, props);
            return rect;
        }
    }

    function getClientRect(el) {
        if (el === window) {
            return createWindowRect();
        } else {
            try {
                var rect = el.getBoundingClientRect();
                if (rect.x === undefined) {
                    rect.x = rect.left;
                    rect.y = rect.top;
                }
                return rect;
            } catch (e) {
                throw new TypeError("Can't call getBoundingClientRect on " + el);
            }
        }
    }

    function pointInside(point, el) {
        var rect = getClientRect(el);
        return point.y > rect.top && point.y < rect.bottom && point.x > rect.left && point.x < rect.right;
    }

    var objectCreate = void 0;
    if (typeof Object.create != 'function') {
        objectCreate = function (undefined) {
            var Temp = function Temp() {};
            return function (prototype, propertiesObject) {
                if (prototype !== Object(prototype) && prototype !== null) {
                    throw TypeError('Argument must be an object, or null');
                }
                Temp.prototype = prototype || {};
                var result = new Temp();
                Temp.prototype = null;
                if (propertiesObject !== undefined) {
                    Object.defineProperties(result, propertiesObject);
                }

                // to imitate the case of Object.create(null)
                if (prototype === null) {
                    result.__proto__ = null;
                }
                return result;
            };
        }();
    } else {
        objectCreate = Object.create;
    }

    var objectCreate$1 = objectCreate;

    var mouseEventProps = ['altKey', 'button', 'buttons', 'clientX', 'clientY', 'ctrlKey', 'metaKey', 'movementX', 'movementY', 'offsetX', 'offsetY', 'pageX', 'pageY', 'region', 'relatedTarget', 'screenX', 'screenY', 'shiftKey', 'which', 'x', 'y'];

    function createDispatcher(element) {

        var defaultSettings = {
            screenX: 0,
            screenY: 0,
            clientX: 0,
            clientY: 0,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
            metaKey: false,
            button: 0,
            buttons: 1,
            relatedTarget: null,
            region: null
        };

        if (element !== undefined) {
            element.addEventListener('mousemove', onMove);
        }

        function onMove(e) {
            for (var i = 0; i < mouseEventProps.length; i++) {
                defaultSettings[mouseEventProps[i]] = e[mouseEventProps[i]];
            }
        }

        var dispatch = function () {
            if (MouseEvent) {
                return function m1(element, initMove, data) {
                    var evt = new MouseEvent('mousemove', createMoveInit(defaultSettings, initMove));

                    //evt.dispatched = 'mousemove';
                    setSpecial(evt, data);

                    return element.dispatchEvent(evt);
                };
            } else if (typeof document.createEvent === 'function') {
                return function m2(element, initMove, data) {
                    var settings = createMoveInit(defaultSettings, initMove);
                    var evt = document.createEvent('MouseEvents');

                    evt.initMouseEvent("mousemove", true, //can bubble
                    true, //cancelable
                    window, //view
                    0, //detail
                    settings.screenX, //0, //screenX
                    settings.screenY, //0, //screenY
                    settings.clientX, //80, //clientX
                    settings.clientY, //20, //clientY
                    settings.ctrlKey, //false, //ctrlKey
                    settings.altKey, //false, //altKey
                    settings.shiftKey, //false, //shiftKey
                    settings.metaKey, //false, //metaKey
                    settings.button, //0, //button
                    settings.relatedTarget //null //relatedTarget
                    );

                    //evt.dispatched = 'mousemove';
                    setSpecial(evt, data);

                    return element.dispatchEvent(evt);
                };
            } else if (typeof document.createEventObject === 'function') {
                return function m3(element, initMove, data) {
                    var evt = document.createEventObject();
                    var settings = createMoveInit(defaultSettings, initMove);
                    for (var name in settings) {
                        evt[name] = settings[name];
                    }

                    //evt.dispatched = 'mousemove';
                    setSpecial(evt, data);

                    return element.dispatchEvent(evt);
                };
            }
        }();

        function destroy() {
            if (element) {
                element.removeEventListener('mousemove', onMove, false);
            }
            defaultSettings = null;
        }

        return {
            destroy: destroy,
            dispatch: dispatch
        };
    }

    function createMoveInit(defaultSettings, initMove) {
        initMove = initMove || {};
        var settings = objectCreate$1(defaultSettings);
        for (var i = 0; i < mouseEventProps.length; i++) {
            if (initMove[mouseEventProps[i]] !== undefined) {
                settings[mouseEventProps[i]] = initMove[mouseEventProps[i]];
            }
        }

        return settings;
    }

    function setSpecial(e, data) {
        console.log('data ', data);
        e.data = data || {};
        e.dispatched = 'mousemove';
    }

    function AutoScroller(elements, options) {
        if (options === void 0) options = {};

        var self = this;
        var maxSpeed = 4,
            scrolling = false;

        this.margin = options.margin || -1;
        //this.scrolling = false;
        this.scrollWhenOutside = options.scrollWhenOutside || false;

        var point = {},
            pointCB = index$2(point),
            dispatcher = createDispatcher(),
            down = false;

        window.addEventListener('mousemove', pointCB, false);
        window.addEventListener('touchmove', pointCB, false);

        if (!isNaN(options.maxSpeed)) {
            maxSpeed = options.maxSpeed;
        }

        this.autoScroll = boolean(options.autoScroll);
        this.syncMove = boolean(options.syncMove, false);

        this.destroy = function () {
            window.removeEventListener('mousemove', pointCB, false);
            window.removeEventListener('touchmove', pointCB, false);
            window.removeEventListener('mousedown', onDown, false);
            window.removeEventListener('touchstart', onDown, false);
            window.removeEventListener('mouseup', onUp, false);
            window.removeEventListener('touchend', onUp, false);

            window.removeEventListener('mousemove', onMove, false);
            window.removeEventListener('touchmove', onMove, false);

            window.removeEventListener('scroll', setScroll, true);
            elements = [];
        };

        this.add = function () {
            var element = [],
                len = arguments.length;
            while (len--) element[len] = arguments[len];

            addElements.apply(void 0, [elements].concat(element));
            return this;
        };

        this.remove = function () {
            var element = [],
                len = arguments.length;
            while (len--) element[len] = arguments[len];

            return removeElements.apply(void 0, [elements].concat(element));
        };

        var hasWindow = null,
            windowAnimationFrame;

        if (Object.prototype.toString.call(elements) !== '[object Array]') {
            elements = [elements];
        }

        (function (temp) {
            elements = [];
            temp.forEach(function (element) {
                if (element === window) {
                    hasWindow = window;
                } else {
                    self.add(element);
                }
            });
        })(elements);

        Object.defineProperties(this, {
            down: {
                get: function () {
                    return down;
                }
            },
            maxSpeed: {
                get: function () {
                    return maxSpeed;
                }
            },
            point: {
                get: function () {
                    return point;
                }
            },
            scrolling: {
                get: function () {
                    return scrolling;
                }
            }
        });

        var n = 0,
            current = null,
            animationFrame;

        window.addEventListener('mousedown', onDown, false);
        window.addEventListener('touchstart', onDown, false);
        window.addEventListener('mouseup', onUp, false);
        window.addEventListener('touchend', onUp, false);

        window.addEventListener('mousemove', onMove, false);
        window.addEventListener('touchmove', onMove, false);

        window.addEventListener('mouseleave', onMouseOut, false);

        window.addEventListener('scroll', setScroll, true);

        function setScroll(e) {

            for (var i = 0; i < elements.length; i++) {
                if (elements[i] === e.target) {
                    scrolling = true;
                    break;
                }
            }

            if (scrolling) {
                requestAnimationFrame(function () {
                    return scrolling = false;
                });
            }
        }

        function onDown() {
            down = true;
        }

        function onUp() {
            down = false;
            cancelAnimationFrame(animationFrame);
            cancelAnimationFrame(windowAnimationFrame);
        }

        function onMouseOut() {
            down = false;
        }

        function getTarget(target) {
            if (!target) {
                return null;
            }

            if (current === target) {
                return target;
            }

            if (hasElement(elements, target)) {
                return target;
            }

            while (target = target.parentNode) {
                if (hasElement(elements, target)) {
                    return target;
                }
            }

            return null;
        }

        function getElementUnderPoint() {
            var underPoint = null;

            for (var i = 0; i < elements.length; i++) {
                if (inside(point, elements[i])) {
                    underPoint = elements[i];
                }
            }

            return underPoint;
        }

        function onMove(event) {

            if (!self.autoScroll()) {
                return;
            }

            if (event['dispatched']) {
                return;
            }

            var target = event.target,
                body = document.body;

            if (current && !inside(point, current)) {
                if (!self.scrollWhenOutside) {
                    current = null;
                }
            }

            if (target && target.parentNode === body) {
                //The special condition to improve speed.
                target = getElementUnderPoint();
            } else {
                target = getTarget(target);

                if (!target) {
                    target = getElementUnderPoint();
                }
            }

            if (target && target !== current) {
                current = target;
            }

            if (hasWindow) {
                cancelAnimationFrame(windowAnimationFrame);
                windowAnimationFrame = requestAnimationFrame(scrollWindow);
            }

            if (!current) {
                return;
            }

            cancelAnimationFrame(animationFrame);
            animationFrame = requestAnimationFrame(scrollTick);
        }

        function scrollWindow() {
            autoScroll(hasWindow);

            cancelAnimationFrame(windowAnimationFrame);
            windowAnimationFrame = requestAnimationFrame(scrollWindow);
        }

        function scrollTick() {

            if (!current) {
                return;
            }

            autoScroll(current);

            cancelAnimationFrame(animationFrame);
            animationFrame = requestAnimationFrame(scrollTick);
        }

        function autoScroll(el) {
            var rect = getClientRect(el),
                scrollx,
                scrolly;

            if (point.x < rect.left + self.margin) {
                scrollx = Math.floor(Math.max(-1, (point.x - rect.left) / self.margin - 1) * self.maxSpeed);
            } else if (point.x > rect.right - self.margin) {
                scrollx = Math.ceil(Math.min(1, (point.x - rect.right) / self.margin + 1) * self.maxSpeed);
            } else {
                scrollx = 0;
            }

            if (point.y < rect.top + self.margin) {
                scrolly = Math.floor(Math.max(-1, (point.y - rect.top) / self.margin - 1) * self.maxSpeed);
            } else if (point.y > rect.bottom - self.margin) {
                scrolly = Math.ceil(Math.min(1, (point.y - rect.bottom) / self.margin + 1) * self.maxSpeed);
            } else {
                scrolly = 0;
            }

            if (self.syncMove()) {
                /*
                Notes about mousemove event dispatch.
                screen(X/Y) should need to be updated.
                Some other properties might need to be set.
                Keep the syncMove option default false until all inconsistencies are taken care of.
                */
                dispatcher.dispatch(el, {
                    pageX: point.pageX + scrollx,
                    pageY: point.pageY + scrolly,
                    clientX: point.x + scrollx,
                    clientY: point.y + scrolly
                });
            }

            setTimeout(function () {

                if (scrolly) {
                    scrollY(el, scrolly);
                }

                if (scrollx) {
                    scrollX(el, scrollx);
                }
            });
        }

        function scrollY(el, amount) {
            if (el === window) {
                window.scrollTo(el.pageXOffset, el.pageYOffset + amount);
            } else {
                el.scrollTop += amount;
            }
        }

        function scrollX(el, amount) {
            if (el === window) {
                window.scrollTo(el.pageXOffset + amount, el.pageYOffset);
            } else {
                el.scrollLeft += amount;
            }
        }
    }

    function AutoScrollerFactory(element, options) {
        return new AutoScroller(element, options);
    }

    function inside(point, el, rect) {
        if (!rect) {
            return pointInside(point, el);
        } else {
            return point.y > rect.top && point.y < rect.bottom && point.x > rect.left && point.x < rect.right;
        }
    }

    /*
    git remote add origin https://github.com/hollowdoor/dom_autoscroller.git
    git push -u origin master
    */

    return AutoScrollerFactory;
}();
//# sourceMappingURL=dom-autoscroller.js.map
(function (f) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    module.exports = f();
  } else if (typeof define === "function" && define.amd) {
    define([], f);
  } else {
    var g;if (typeof window !== "undefined") {
      g = window;
    } else if (typeof global !== "undefined") {
      g = global;
    } else if (typeof self !== "undefined") {
      g = self;
    } else {
      g = this;
    }g.dragula = f();
  }
})(function () {
  var define, module, exports;return function e(t, n, r) {
    function s(o, u) {
      if (!n[o]) {
        if (!t[o]) {
          var a = typeof require == "function" && require;if (!u && a) return a(o, !0);if (i) return i(o, !0);var f = new Error("Cannot find module '" + o + "'");throw f.code = "MODULE_NOT_FOUND", f;
        }var l = n[o] = { exports: {} };t[o][0].call(l.exports, function (e) {
          var n = t[o][1][e];return s(n ? n : e);
        }, l, l.exports, e, t, n, r);
      }return n[o].exports;
    }var i = typeof require == "function" && require;for (var o = 0; o < r.length; o++) s(r[o]);return s;
  }({ 1: [function (require, module, exports) {
      'use strict';

      var cache = {};
      var start = '(?:^|\\s)';
      var end = '(?:\\s|$)';

      function lookupClass(className) {
        var cached = cache[className];
        if (cached) {
          cached.lastIndex = 0;
        } else {
          cache[className] = cached = new RegExp(start + className + end, 'g');
        }
        return cached;
      }

      function addClass(el, className) {
        var current = el.className;
        if (!current.length) {
          el.className = className;
        } else if (!lookupClass(className).test(current)) {
          el.className += ' ' + className;
        }
      }

      function rmClass(el, className) {
        el.className = el.className.replace(lookupClass(className), ' ').trim();
      }

      module.exports = {
        add: addClass,
        rm: rmClass
      };
    }, {}], 2: [function (require, module, exports) {
      (function (global) {
        'use strict';

        var emitter = require('contra/emitter');
        var crossvent = require('crossvent');
        var classes = require('./classes');
        var doc = document;
        var documentElement = doc.documentElement;

        function dragula(initialContainers, options) {
          var len = arguments.length;
          if (len === 1 && Array.isArray(initialContainers) === false) {
            options = initialContainers;
            initialContainers = [];
          }
          var _mirror; // mirror image
          var _source; // source container
          var _item; // item being dragged
          var _offsetX; // reference x
          var _offsetY; // reference y
          var _moveX; // reference move x
          var _moveY; // reference move y
          var _initialSibling; // reference sibling when grabbed
          var _currentSibling; // reference sibling now
          var _copy; // item used for copying
          var _renderTimer; // timer for setTimeout renderMirrorImage
          var _lastDropTarget = null; // last container item was over
          var _grabbed; // holds mousedown context until first mousemove

          var o = options || {};
          if (o.moves === void 0) {
            o.moves = always;
          }
          if (o.accepts === void 0) {
            o.accepts = always;
          }
          if (o.invalid === void 0) {
            o.invalid = invalidTarget;
          }
          if (o.containers === void 0) {
            o.containers = initialContainers || [];
          }
          if (o.isContainer === void 0) {
            o.isContainer = never;
          }
          if (o.copy === void 0) {
            o.copy = false;
          }
          if (o.copySortSource === void 0) {
            o.copySortSource = false;
          }
          if (o.revertOnSpill === void 0) {
            o.revertOnSpill = false;
          }
          if (o.removeOnSpill === void 0) {
            o.removeOnSpill = false;
          }
          if (o.direction === void 0) {
            o.direction = 'vertical';
          }
          if (o.ignoreInputTextSelection === void 0) {
            o.ignoreInputTextSelection = true;
          }
          if (o.mirrorContainer === void 0) {
            o.mirrorContainer = doc.body;
          }

          var drake = emitter({
            containers: o.containers,
            start: manualStart,
            end: end,
            cancel: cancel,
            remove: remove,
            destroy: destroy,
            canMove: canMove,
            dragging: false
          });

          if (o.removeOnSpill === true) {
            drake.on('over', spillOver).on('out', spillOut);
          }

          events();

          return drake;

          function isContainer(el) {
            return drake.containers.indexOf(el) !== -1 || o.isContainer(el);
          }

          function events(remove) {
            var op = remove ? 'remove' : 'add';
            touchy(documentElement, op, 'mousedown', grab);
            touchy(documentElement, op, 'mouseup', release);
          }

          function eventualMovements(remove) {
            var op = remove ? 'remove' : 'add';
            touchy(documentElement, op, 'mousemove', startBecauseMouseMoved);
          }

          function movements(remove) {
            var op = remove ? 'remove' : 'add';
            crossvent[op](documentElement, 'selectstart', preventGrabbed); // IE8
            crossvent[op](documentElement, 'click', preventGrabbed);
          }

          function destroy() {
            events(true);
            release({});
          }

          function preventGrabbed(e) {
            if (_grabbed) {
              e.preventDefault();
            }
          }

          function grab(e) {
            _moveX = e.clientX;
            _moveY = e.clientY;

            var ignore = whichMouseButton(e) !== 1 || e.metaKey || e.ctrlKey;
            if (ignore) {
              return; // we only care about honest-to-god left clicks and touch events
            }
            var item = e.target;
            var context = canStart(item);
            if (!context) {
              return;
            }
            _grabbed = context;
            eventualMovements();
            if (e.type === 'mousedown') {
              if (isInput(item)) {
                // see also: https://github.com/bevacqua/dragula/issues/208
                item.focus(); // fixes https://github.com/bevacqua/dragula/issues/176
              } else {
                e.preventDefault(); // fixes https://github.com/bevacqua/dragula/issues/155
              }
            }
          }

          function startBecauseMouseMoved(e) {
            if (!_grabbed) {
              return;
            }
            if (whichMouseButton(e) === 0) {
              release({});
              return; // when text is selected on an input and then dragged, mouseup doesn't fire. this is our only hope
            }
            // truthy check fixes #239, equality fixes #207
            if (e.clientX !== void 0 && e.clientX === _moveX && e.clientY !== void 0 && e.clientY === _moveY) {
              return;
            }
            if (o.ignoreInputTextSelection) {
              var clientX = getCoord('clientX', e);
              var clientY = getCoord('clientY', e);
              var elementBehindCursor = doc.elementFromPoint(clientX, clientY);
              if (isInput(elementBehindCursor)) {
                return;
              }
            }

            var grabbed = _grabbed; // call to end() unsets _grabbed
            eventualMovements(true);
            movements();
            end();
            start(grabbed);

            var offset = getOffset(_item);
            _offsetX = getCoord('pageX', e) - offset.left;
            _offsetY = getCoord('pageY', e) - offset.top;

            classes.add(_copy || _item, 'gu-transit');
            renderMirrorImage();
            drag(e);
          }

          function canStart(item) {
            if (drake.dragging && _mirror) {
              return;
            }
            if (isContainer(item)) {
              return; // don't drag container itself
            }
            var handle = item;
            while (getParent(item) && isContainer(getParent(item)) === false) {
              if (o.invalid(item, handle)) {
                return;
              }
              item = getParent(item); // drag target should be a top element
              if (!item) {
                return;
              }
            }
            var source = getParent(item);
            if (!source) {
              return;
            }
            if (o.invalid(item, handle)) {
              return;
            }

            var movable = o.moves(item, source, handle, nextEl(item));
            if (!movable) {
              return;
            }

            return {
              item: item,
              source: source
            };
          }

          function canMove(item) {
            return !!canStart(item);
          }

          function manualStart(item) {
            var context = canStart(item);
            if (context) {
              start(context);
            }
          }

          function start(context) {
            if (isCopy(context.item, context.source)) {
              _copy = context.item.cloneNode(true);
              drake.emit('cloned', _copy, context.item, 'copy');
            }

            _source = context.source;
            _item = context.item;
            _initialSibling = _currentSibling = nextEl(context.item);

            drake.dragging = true;
            drake.emit('drag', _item, _source);
          }

          function invalidTarget() {
            return false;
          }

          function end() {
            if (!drake.dragging) {
              return;
            }
            var item = _copy || _item;
            drop(item, getParent(item));
          }

          function ungrab() {
            _grabbed = false;
            eventualMovements(true);
            movements(true);
          }

          function release(e) {
            ungrab();

            if (!drake.dragging) {
              return;
            }
            var item = _copy || _item;
            var clientX = getCoord('clientX', e);
            var clientY = getCoord('clientY', e);
            var elementBehindCursor = getElementBehindPoint(_mirror, clientX, clientY);
            var dropTarget = findDropTarget(elementBehindCursor, clientX, clientY);
            if (dropTarget && (_copy && o.copySortSource || !_copy || dropTarget !== _source)) {
              drop(item, dropTarget);
            } else if (o.removeOnSpill) {
              remove();
            } else {
              cancel();
            }
          }

          function drop(item, target) {
            var parent = getParent(item);
            if (_copy && o.copySortSource && target === _source) {
              parent.removeChild(_item);
            }
            if (isInitialPlacement(target)) {
              drake.emit('cancel', item, _source, _source);
            } else {
              drake.emit('drop', item, target, _source, _currentSibling);
            }
            cleanup();
          }

          function remove() {
            if (!drake.dragging) {
              return;
            }
            var item = _copy || _item;
            var parent = getParent(item);
            if (parent) {
              parent.removeChild(item);
            }
            drake.emit(_copy ? 'cancel' : 'remove', item, parent, _source);
            cleanup();
          }

          function cancel(revert) {
            if (!drake.dragging) {
              return;
            }
            var reverts = arguments.length > 0 ? revert : o.revertOnSpill;
            var item = _copy || _item;
            var parent = getParent(item);
            var initial = isInitialPlacement(parent);
            if (initial === false && reverts) {
              if (_copy) {
                if (parent) {
                  parent.removeChild(_copy);
                }
              } else {
                _source.insertBefore(item, _initialSibling);
              }
            }
            if (initial || reverts) {
              drake.emit('cancel', item, _source, _source);
            } else {
              drake.emit('drop', item, parent, _source, _currentSibling);
            }
            cleanup();
          }

          function cleanup() {
            var item = _copy || _item;
            ungrab();
            removeMirrorImage();
            if (item) {
              classes.rm(item, 'gu-transit');
            }
            if (_renderTimer) {
              clearTimeout(_renderTimer);
            }
            drake.dragging = false;
            if (_lastDropTarget) {
              drake.emit('out', item, _lastDropTarget, _source);
            }
            drake.emit('dragend', item);
            _source = _item = _copy = _initialSibling = _currentSibling = _renderTimer = _lastDropTarget = null;
          }

          function isInitialPlacement(target, s) {
            var sibling;
            if (s !== void 0) {
              sibling = s;
            } else if (_mirror) {
              sibling = _currentSibling;
            } else {
              sibling = nextEl(_copy || _item);
            }
            return target === _source && sibling === _initialSibling;
          }

          function findDropTarget(elementBehindCursor, clientX, clientY) {
            var target = elementBehindCursor;
            while (target && !accepted()) {
              target = getParent(target);
            }
            return target;

            function accepted() {
              var droppable = isContainer(target);
              if (droppable === false) {
                return false;
              }

              var immediate = getImmediateChild(target, elementBehindCursor);
              var reference = getReference(target, immediate, clientX, clientY);
              var initial = isInitialPlacement(target, reference);
              if (initial) {
                return true; // should always be able to drop it right back where it was
              }
              return o.accepts(_item, target, _source, reference);
            }
          }

          function drag(e) {
            if (!_mirror) {
              return;
            }
            e.preventDefault();

            var clientX = getCoord('clientX', e);
            var clientY = getCoord('clientY', e);
            var x = clientX - _offsetX;
            var y = clientY - _offsetY;

            _mirror.style.left = x + 'px';
            _mirror.style.top = y + 'px';

            var item = _copy || _item;
            var elementBehindCursor = getElementBehindPoint(_mirror, clientX, clientY);
            var dropTarget = findDropTarget(elementBehindCursor, clientX, clientY);
            var changed = dropTarget !== null && dropTarget !== _lastDropTarget;
            if (changed || dropTarget === null) {
              out();
              _lastDropTarget = dropTarget;
              over();
            }
            var parent = getParent(item);
            if (dropTarget === _source && _copy && !o.copySortSource) {
              if (parent) {
                parent.removeChild(item);
              }
              return;
            }
            var reference;
            var immediate = getImmediateChild(dropTarget, elementBehindCursor);
            if (immediate !== null) {
              reference = getReference(dropTarget, immediate, clientX, clientY);
            } else if (o.revertOnSpill === true && !_copy) {
              reference = _initialSibling;
              dropTarget = _source;
            } else {
              if (_copy && parent) {
                parent.removeChild(item);
              }
              return;
            }
            if (reference === null && changed || reference !== item && reference !== nextEl(item)) {
              _currentSibling = reference;
              dropTarget.insertBefore(item, reference);
              drake.emit('shadow', item, dropTarget, _source);
            }
            function moved(type) {
              drake.emit(type, item, _lastDropTarget, _source);
            }
            function over() {
              if (changed) {
                moved('over');
              }
            }
            function out() {
              if (_lastDropTarget) {
                moved('out');
              }
            }
          }

          function spillOver(el) {
            classes.rm(el, 'gu-hide');
          }

          function spillOut(el) {
            if (drake.dragging) {
              classes.add(el, 'gu-hide');
            }
          }

          function renderMirrorImage() {
            if (_mirror) {
              return;
            }
            var rect = _item.getBoundingClientRect();
            _mirror = _item.cloneNode(true);
            _mirror.style.width = getRectWidth(rect) + 'px';
            _mirror.style.height = getRectHeight(rect) + 'px';
            classes.rm(_mirror, 'gu-transit');
            classes.add(_mirror, 'gu-mirror');
            o.mirrorContainer.appendChild(_mirror);
            touchy(documentElement, 'add', 'mousemove', drag);
            classes.add(o.mirrorContainer, 'gu-unselectable');
            drake.emit('cloned', _mirror, _item, 'mirror');
          }

          function removeMirrorImage() {
            if (_mirror) {
              classes.rm(o.mirrorContainer, 'gu-unselectable');
              touchy(documentElement, 'remove', 'mousemove', drag);
              getParent(_mirror).removeChild(_mirror);
              _mirror = null;
            }
          }

          function getImmediateChild(dropTarget, target) {
            var immediate = target;
            while (immediate !== dropTarget && getParent(immediate) !== dropTarget) {
              immediate = getParent(immediate);
            }
            if (immediate === documentElement) {
              return null;
            }
            return immediate;
          }

          function getReference(dropTarget, target, x, y) {
            var horizontal = o.direction === 'horizontal';
            var reference = target !== dropTarget ? inside() : outside();
            return reference;

            function outside() {
              // slower, but able to figure out any position
              var len = dropTarget.children.length;
              var i;
              var el;
              var rect;
              for (i = 0; i < len; i++) {
                el = dropTarget.children[i];
                rect = el.getBoundingClientRect();
                if (horizontal && rect.left + rect.width / 2 > x) {
                  return el;
                }
                if (!horizontal && rect.top + rect.height / 2 > y) {
                  return el;
                }
              }
              return null;
            }

            function inside() {
              // faster, but only available if dropped inside a child element
              var rect = target.getBoundingClientRect();
              if (horizontal) {
                return resolve(x > rect.left + getRectWidth(rect) / 2);
              }
              return resolve(y > rect.top + getRectHeight(rect) / 2);
            }

            function resolve(after) {
              return after ? nextEl(target) : target;
            }
          }

          function isCopy(item, container) {
            return typeof o.copy === 'boolean' ? o.copy : o.copy(item, container);
          }
        }

        function touchy(el, op, type, fn) {
          var touch = {
            mouseup: 'touchend',
            mousedown: 'touchstart',
            mousemove: 'touchmove'
          };
          var pointers = {
            mouseup: 'pointerup',
            mousedown: 'pointerdown',
            mousemove: 'pointermove'
          };
          var microsoft = {
            mouseup: 'MSPointerUp',
            mousedown: 'MSPointerDown',
            mousemove: 'MSPointerMove'
          };
          if (global.navigator.pointerEnabled) {
            crossvent[op](el, pointers[type], fn);
          } else if (global.navigator.msPointerEnabled) {
            crossvent[op](el, microsoft[type], fn);
          } else {
            crossvent[op](el, touch[type], fn);
            crossvent[op](el, type, fn);
          }
        }

        function whichMouseButton(e) {
          if (e.touches !== void 0) {
            return e.touches.length;
          }
          if (e.which !== void 0 && e.which !== 0) {
            return e.which;
          } // see https://github.com/bevacqua/dragula/issues/261
          if (e.buttons !== void 0) {
            return e.buttons;
          }
          var button = e.button;
          if (button !== void 0) {
            // see https://github.com/jquery/jquery/blob/99e8ff1baa7ae341e94bb89c3e84570c7c3ad9ea/src/event.js#L573-L575
            return button & 1 ? 1 : button & 2 ? 3 : button & 4 ? 2 : 0;
          }
        }

        function getOffset(el) {
          var rect = el.getBoundingClientRect();
          return {
            left: rect.left + getScroll('scrollLeft', 'pageXOffset'),
            top: rect.top + getScroll('scrollTop', 'pageYOffset')
          };
        }

        function getScroll(scrollProp, offsetProp) {
          if (typeof global[offsetProp] !== 'undefined') {
            return global[offsetProp];
          }
          if (documentElement.clientHeight) {
            return documentElement[scrollProp];
          }
          return doc.body[scrollProp];
        }

        function getElementBehindPoint(point, x, y) {
          var p = point || {};
          var state = p.className;
          var el;
          p.className += ' gu-hide';
          el = doc.elementFromPoint(x, y);
          p.className = state;
          return el;
        }

        function never() {
          return false;
        }
        function always() {
          return true;
        }
        function getRectWidth(rect) {
          return rect.width || rect.right - rect.left;
        }
        function getRectHeight(rect) {
          return rect.height || rect.bottom - rect.top;
        }
        function getParent(el) {
          return el.parentNode === doc ? null : el.parentNode;
        }
        function isInput(el) {
          return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || isEditable(el);
        }
        function isEditable(el) {
          if (!el) {
            return false;
          } // no parents were editable
          if (el.contentEditable === 'false') {
            return false;
          } // stop the lookup
          if (el.contentEditable === 'true') {
            return true;
          } // found a contentEditable element in the chain
          return isEditable(getParent(el)); // contentEditable is set to 'inherit'
        }

        function nextEl(el) {
          return el.nextElementSibling || manually();
          function manually() {
            var sibling = el;
            do {
              sibling = sibling.nextSibling;
            } while (sibling && sibling.nodeType !== 1);
            return sibling;
          }
        }

        function getEventHost(e) {
          // on touchend event, we have to use `e.changedTouches`
          // see http://stackoverflow.com/questions/7192563/touchend-event-properties
          // see https://github.com/bevacqua/dragula/issues/34
          if (e.targetTouches && e.targetTouches.length) {
            return e.targetTouches[0];
          }
          if (e.changedTouches && e.changedTouches.length) {
            return e.changedTouches[0];
          }
          return e;
        }

        function getCoord(coord, e) {
          var host = getEventHost(e);
          var missMap = {
            pageX: 'clientX', // IE8
            pageY: 'clientY' // IE8
          };
          if (coord in missMap && !(coord in host) && missMap[coord] in host) {
            coord = missMap[coord];
          }
          return host[coord];
        }

        module.exports = dragula;
      }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
    }, { "./classes": 1, "contra/emitter": 5, "crossvent": 6 }], 3: [function (require, module, exports) {
      module.exports = function atoa(a, n) {
        return Array.prototype.slice.call(a, n);
      };
    }, {}], 4: [function (require, module, exports) {
      'use strict';

      var ticky = require('ticky');

      module.exports = function debounce(fn, args, ctx) {
        if (!fn) {
          return;
        }
        ticky(function run() {
          fn.apply(ctx || null, args || []);
        });
      };
    }, { "ticky": 9 }], 5: [function (require, module, exports) {
      'use strict';

      var atoa = require('atoa');
      var debounce = require('./debounce');

      module.exports = function emitter(thing, options) {
        var opts = options || {};
        var evt = {};
        if (thing === undefined) {
          thing = {};
        }
        thing.on = function (type, fn) {
          if (!evt[type]) {
            evt[type] = [fn];
          } else {
            evt[type].push(fn);
          }
          return thing;
        };
        thing.once = function (type, fn) {
          fn._once = true; // thing.off(fn) still works!
          thing.on(type, fn);
          return thing;
        };
        thing.off = function (type, fn) {
          var c = arguments.length;
          if (c === 1) {
            delete evt[type];
          } else if (c === 0) {
            evt = {};
          } else {
            var et = evt[type];
            if (!et) {
              return thing;
            }
            et.splice(et.indexOf(fn), 1);
          }
          return thing;
        };
        thing.emit = function () {
          var args = atoa(arguments);
          return thing.emitterSnapshot(args.shift()).apply(this, args);
        };
        thing.emitterSnapshot = function (type) {
          var et = (evt[type] || []).slice(0);
          return function () {
            var args = atoa(arguments);
            var ctx = this || thing;
            if (type === 'error' && opts.throws !== false && !et.length) {
              throw args.length === 1 ? args[0] : args;
            }
            et.forEach(function emitter(listen) {
              if (opts.async) {
                debounce(listen, args, ctx);
              } else {
                listen.apply(ctx, args);
              }
              if (listen._once) {
                thing.off(type, listen);
              }
            });
            return thing;
          };
        };
        return thing;
      };
    }, { "./debounce": 4, "atoa": 3 }], 6: [function (require, module, exports) {
      (function (global) {
        'use strict';

        var customEvent = require('custom-event');
        var eventmap = require('./eventmap');
        var doc = global.document;
        var addEvent = addEventEasy;
        var removeEvent = removeEventEasy;
        var hardCache = [];

        if (!global.addEventListener) {
          addEvent = addEventHard;
          removeEvent = removeEventHard;
        }

        module.exports = {
          add: addEvent,
          remove: removeEvent,
          fabricate: fabricateEvent
        };

        function addEventEasy(el, type, fn, capturing) {
          return el.addEventListener(type, fn, capturing);
        }

        function addEventHard(el, type, fn) {
          return el.attachEvent('on' + type, wrap(el, type, fn));
        }

        function removeEventEasy(el, type, fn, capturing) {
          return el.removeEventListener(type, fn, capturing);
        }

        function removeEventHard(el, type, fn) {
          var listener = unwrap(el, type, fn);
          if (listener) {
            return el.detachEvent('on' + type, listener);
          }
        }

        function fabricateEvent(el, type, model) {
          var e = eventmap.indexOf(type) === -1 ? makeCustomEvent() : makeClassicEvent();
          if (el.dispatchEvent) {
            el.dispatchEvent(e);
          } else {
            el.fireEvent('on' + type, e);
          }
          function makeClassicEvent() {
            var e;
            if (doc.createEvent) {
              e = doc.createEvent('Event');
              e.initEvent(type, true, true);
            } else if (doc.createEventObject) {
              e = doc.createEventObject();
            }
            return e;
          }
          function makeCustomEvent() {
            return new customEvent(type, { detail: model });
          }
        }

        function wrapperFactory(el, type, fn) {
          return function wrapper(originalEvent) {
            var e = originalEvent || global.event;
            e.target = e.target || e.srcElement;
            e.preventDefault = e.preventDefault || function preventDefault() {
              e.returnValue = false;
            };
            e.stopPropagation = e.stopPropagation || function stopPropagation() {
              e.cancelBubble = true;
            };
            e.which = e.which || e.keyCode;
            fn.call(el, e);
          };
        }

        function wrap(el, type, fn) {
          var wrapper = unwrap(el, type, fn) || wrapperFactory(el, type, fn);
          hardCache.push({
            wrapper: wrapper,
            element: el,
            type: type,
            fn: fn
          });
          return wrapper;
        }

        function unwrap(el, type, fn) {
          var i = find(el, type, fn);
          if (i) {
            var wrapper = hardCache[i].wrapper;
            hardCache.splice(i, 1); // free up a tad of memory
            return wrapper;
          }
        }

        function find(el, type, fn) {
          var i, item;
          for (i = 0; i < hardCache.length; i++) {
            item = hardCache[i];
            if (item.element === el && item.type === type && item.fn === fn) {
              return i;
            }
          }
        }
      }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
    }, { "./eventmap": 7, "custom-event": 8 }], 7: [function (require, module, exports) {
      (function (global) {
        'use strict';

        var eventmap = [];
        var eventname = '';
        var ron = /^on/;

        for (eventname in global) {
          if (ron.test(eventname)) {
            eventmap.push(eventname.slice(2));
          }
        }

        module.exports = eventmap;
      }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
    }, {}], 8: [function (require, module, exports) {
      (function (global) {

        var NativeCustomEvent = global.CustomEvent;

        function useNative() {
          try {
            var p = new NativeCustomEvent('cat', { detail: { foo: 'bar' } });
            return 'cat' === p.type && 'bar' === p.detail.foo;
          } catch (e) {}
          return false;
        }

        /**
         * Cross-browser `CustomEvent` constructor.
         *
         * https://developer.mozilla.org/en-US/docs/Web/API/CustomEvent.CustomEvent
         *
         * @public
         */

        module.exports = useNative() ? NativeCustomEvent :

        // IE >= 9
        'function' === typeof document.createEvent ? function CustomEvent(type, params) {
          var e = document.createEvent('CustomEvent');
          if (params) {
            e.initCustomEvent(type, params.bubbles, params.cancelable, params.detail);
          } else {
            e.initCustomEvent(type, false, false, void 0);
          }
          return e;
        } :

        // IE <= 8
        function CustomEvent(type, params) {
          var e = document.createEventObject();
          e.type = type;
          if (params) {
            e.bubbles = Boolean(params.bubbles);
            e.cancelable = Boolean(params.cancelable);
            e.detail = params.detail;
          } else {
            e.bubbles = false;
            e.cancelable = false;
            e.detail = void 0;
          }
          return e;
        };
      }).call(this, typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {});
    }, {}], 9: [function (require, module, exports) {
      var si = typeof setImmediate === 'function',
          tick;
      if (si) {
        tick = function (fn) {
          setImmediate(fn);
        };
      } else {
        tick = function (fn) {
          setTimeout(fn, 0);
        };
      }

      module.exports = tick;
    }, {}] }, {}, [2])(2);
});
(function ($, Drupal, drupalSettings, CKEDITOR) {

  Drupal.behaviors.draggableItems = {
    attach: function (context, settings) {

      $('.draggable-items-container').each(function (e) {
        if (!$(this).hasClass('dragula-processed')) {
          initDraggableItems($(this));
          $(this).addClass('dragula-processed');
        }
      });
    }
  };

  // Make sure this WAS a wysiwyg initially, not any textarea, maybe selectors or something
  function initCkeditorFromSavedStatus(el, draggedItems) {
    $.each(draggedItems, function (i, value) {
      if ($(el).find('#' + value.id).length && value.config) {
        var newEditor = CKEDITOR.replace(value.id, value.config);
        newEditor.on('instanceReady', function () {
          newEditor.setData(value.content);
        });
      }
    });
  }

  function initDraggableItems($draggableItemContainers) {
    // Declare variables for the currently dragged item so they can be accessed in any even handler
    var draggedItems = [];

    // Initialize dragula on draggable containers
    var drake = dragula([$draggableItemContainers[0]], {
      // Only handle drags items
      moves: function (el, container, handle) {
        return $(el).children('.dragula-handle')[0] === $(handle)[0];
      },
      // Drop can only happen in source element
      accepts: function (el, target, source, sibling) {
        return target === source;
      }
    });

    // On drop we need to recreate the editor from saved config
    drake.on('drop', function (el, target, source, sibling) {
      adjustOrder(drake);
      initCkeditorFromSavedStatus(el, draggedItems);
    });

    // On cancel we need to recreate the editor from saved config
    drake.on('cancel', function (el, container, source) {
      initCkeditorFromSavedStatus(el, draggedItems);
    });

    // On drag start we need to save the config from the ckeditor instance and destroy it
    drake.on('drag', function (el, source) {
      // On drag start, reset the array to empty so you don't try to initialize the same element multiple times
      draggedItems = [];
      // Get id from textarea
      var $wysiwygs = $(el).find('.cke').siblings('textarea');
      $wysiwygs.each(function (i, el) {
        var draggedItemId = $(this).attr('id');
        if (CKEDITOR.instances[draggedItemId]) {
          var draggedItemInstance = CKEDITOR.instances[draggedItemId];
          var draggedItemConfig = draggedItemInstance.config;
          var draggedItemContent = draggedItemInstance.getData();
          draggedItems.push({
            id: draggedItemId,
            instance: draggedItemInstance,
            config: draggedItemConfig,
            content: draggedItemContent
          });
          if (draggedItemInstance) {
            draggedItemInstance.destroy(true);
          }
        }
      });
    });

    // Init dom-autoscroller for each drake instance
    var scroll = autoScroll([window], {
      margin: 70,
      maxSpeed: 14,
      autoScroll: function () {
        return this.down && drake.dragging;
      }
    });
  }

  function adjustOrder(dragulaObject) {
    var $draggableItems = $(dragulaObject.containers[0]).children();
    $draggableItems.each(function (i, el) {
      // Because drupal has no useful selectors on the admin side and adds wrappers for newly created paragraphs,
      // we need to do this hanky panky to make sure we are only adjusting the weights of the currently adjusted items
      var $weightSelect = $(this).children('div').children('div').children('.form-type-select').children('select'),
          $weightSelectAjax = $(this).children('.ajax-new-content').children('div').children('div').children('.form-type-select').children('select');
      if ($weightSelect.length > 0) {
        $weightSelect.val(i);
      } else if ($weightSelectAjax.length > 0) {
        $weightSelectAjax.val(i);
      } else {
        console.log('Error: Cannot find valid paragraph weight to adjust!');
      }
    });
  }
})(jQuery, Drupal, drupalSettings, CKEDITOR);
/**
 * @file entity-browser-improvements.js
 *
 * Adds extra UI improvements to all entity browsers in the admin theme.
 */

!function ($) {
  "use strict";

  Drupal.behaviors.entityBrowserImprover = {
    attach: function (context, settings) {
      let $browserCol = $('.entity-browser-form .views-col', context);

      $browserCol.click(function () {
        let $checkbox = $(this).find('input[type="checkbox"]');

        $checkbox.prop("checked", !$checkbox.prop("checked"));
        $(this).toggleClass('column-selected');
      });
    }
  };
}(jQuery);
/**
 * paragraphs-improvements.js
 * Improve the paragraphs admin ui
 */

!function ($) {
  "use strict";

  Drupal.behaviors.paragraphsPreviewerImprover = {
    attach: function (context, settings) {
      var $previewerButtons = $('.link.paragraphs-previewer', context);

      $previewerButtons.each((i, el) => {
        var $previewerButton = $(el);
        replaceParagraphName($previewerButton);
      });

      // Get paragraphs previews by only targeting ones with the .paragraph-type-top as a sibling
      // so nested paragraphs previews don't break
      var $paragraphsTopElements = $('.paragraph-type-top', context);
      var $paragraphsPreviews = $paragraphsTopElements.siblings('.paragraph--view-mode--preview');

      formatParagraphsPreviews($paragraphsPreviews);

      // Necessary for paragraphs previews behind tabs
      $('.vertical-tabs__menu a').on("click", () => {
        formatParagraphsPreviews($paragraphsPreviews);
      });
    }
  };

  // Because drupal behaviors are so annoying, add delegated click handler here, couldn't get it to work properly
  // inside the behavior
  $(document).ready(function () {
    $('body').on('click', '.paragraph--view-mode--preview', function () {
      $(this).toggleClass('expanded');
    });
  });

  /**
   * Add the type to the previewer button if you want
   * @param previewerButton
   */
  function replaceParagraphName(previewerButton) {
    var paragraphName = previewerButton.siblings('.paragraph-type-title').text();
    previewerButton.val(`Preview: ${paragraphName}`);
  }

  /**
   * Format the previews to be expandable
   * @param paragraphsPreviews
   */
  function formatParagraphsPreviews(paragraphsPreviews) {
    paragraphsPreviews.each((i, el) => {
      var $this = $(el);
      if ($this.outerHeight() >= 100) {
        $this.addClass('expandable');
      }
    });
  }
}(jQuery);
/**
 * @file inject-svg.js
 *
 * Use svg-injector.js to replace an svg <img> tag with the inline svg.
 */

!function ($) {
  "use strict";

  $(function () {
    // Elements to inject
    let mySVGsToInject = document.querySelectorAll('img.inject-me');

    // Do the injection
    SVGInjector(mySVGsToInject);
  });
}(jQuery);
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInN2Zy1pbmplY3Rvci5qcyIsImRvbS1hdXRvc2Nyb2xsZXIuanMiLCJub2RlX21vZHVsZXMvYnJvd3Nlci1wYWNrL19wcmVsdWRlLmpzIiwiY2xhc3Nlcy5qcyIsImRyYWd1bGEuanMiLCJub2RlX21vZHVsZXMvYXRvYS9hdG9hLmpzIiwibm9kZV9tb2R1bGVzL2NvbnRyYS9kZWJvdW5jZS5qcyIsIm5vZGVfbW9kdWxlcy9jb250cmEvZW1pdHRlci5qcyIsIm5vZGVfbW9kdWxlcy9jcm9zc3ZlbnQvc3JjL2Nyb3NzdmVudC5qcyIsIm5vZGVfbW9kdWxlcy9jcm9zc3ZlbnQvc3JjL2V2ZW50bWFwLmpzIiwibm9kZV9tb2R1bGVzL2N1c3RvbS1ldmVudC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy90aWNreS90aWNreS1icm93c2VyLmpzIiwiZHJhZ2dhYmxlLWl0ZW1zLmpzIiwiZW50aXR5LWJyb3dzZXItaW1wcm92bWVudHMuanMiLCJleHBhbmRhYmxlLXBhcmFncmFwaHMuanMiLCJpbmplY3Qtc3ZnLmpzIl0sIm5hbWVzIjpbIndpbmRvdyIsImRvY3VtZW50IiwiaXNMb2NhbCIsImxvY2F0aW9uIiwicHJvdG9jb2wiLCJoYXNTdmdTdXBwb3J0IiwiaW1wbGVtZW50YXRpb24iLCJoYXNGZWF0dXJlIiwidW5pcXVlQ2xhc3NlcyIsImxpc3QiLCJzcGxpdCIsImhhc2giLCJpIiwibGVuZ3RoIiwib3V0IiwiaGFzT3duUHJvcGVydHkiLCJ1bnNoaWZ0Iiwiam9pbiIsImZvckVhY2giLCJBcnJheSIsInByb3RvdHlwZSIsImZuIiwic2NvcGUiLCJUeXBlRXJyb3IiLCJsZW4iLCJjYWxsIiwic3ZnQ2FjaGUiLCJpbmplY3RDb3VudCIsImluamVjdGVkRWxlbWVudHMiLCJyZXF1ZXN0UXVldWUiLCJyYW5TY3JpcHRzIiwiY2xvbmVTdmciLCJzb3VyY2VTdmciLCJjbG9uZU5vZGUiLCJxdWV1ZVJlcXVlc3QiLCJ1cmwiLCJjYWxsYmFjayIsInB1c2giLCJwcm9jZXNzUmVxdWVzdFF1ZXVlIiwiaW5kZXgiLCJzZXRUaW1lb3V0IiwibG9hZFN2ZyIsInVuZGVmaW5lZCIsIlNWR1NWR0VsZW1lbnQiLCJYTUxIdHRwUmVxdWVzdCIsImh0dHBSZXF1ZXN0Iiwib25yZWFkeXN0YXRlY2hhbmdlIiwicmVhZHlTdGF0ZSIsInN0YXR1cyIsInJlc3BvbnNlWE1MIiwiRG9jdW1lbnQiLCJkb2N1bWVudEVsZW1lbnQiLCJET01QYXJzZXIiLCJGdW5jdGlvbiIsInhtbERvYyIsInBhcnNlciIsInBhcnNlRnJvbVN0cmluZyIsInJlc3BvbnNlVGV4dCIsImUiLCJnZXRFbGVtZW50c0J5VGFnTmFtZSIsInN0YXR1c1RleHQiLCJvcGVuIiwib3ZlcnJpZGVNaW1lVHlwZSIsInNlbmQiLCJpbmplY3RFbGVtZW50IiwiZWwiLCJldmFsU2NyaXB0cyIsInBuZ0ZhbGxiYWNrIiwiaW1nVXJsIiwiZ2V0QXR0cmlidXRlIiwidGVzdCIsInBlckVsZW1lbnRGYWxsYmFjayIsInNldEF0dHJpYnV0ZSIsInBvcCIsInJlcGxhY2UiLCJpbmRleE9mIiwic3ZnIiwiaW1nSWQiLCJpbWdUaXRsZSIsImNsYXNzTWVyZ2UiLCJjb25jYXQiLCJpbWdTdHlsZSIsImltZ0RhdGEiLCJmaWx0ZXIiLCJhdHRyaWJ1dGVzIiwiYXQiLCJuYW1lIiwiZGF0YUF0dHIiLCJ2YWx1ZSIsImlyaUVsZW1lbnRzQW5kUHJvcGVydGllcyIsImVsZW1lbnQiLCJlbGVtZW50RGVmcyIsInByb3BlcnRpZXMiLCJjdXJyZW50SWQiLCJuZXdJZCIsIk9iamVjdCIsImtleXMiLCJrZXkiLCJxdWVyeVNlbGVjdG9yQWxsIiwiZWxlbWVudHNMZW4iLCJpZCIsInJlZmVyZW5jaW5nRWxlbWVudHMiLCJwcm9wZXJ0eSIsImoiLCJyZWZlcmVuY2luZ0VsZW1lbnRMZW4iLCJyZW1vdmVBdHRyaWJ1dGUiLCJzY3JpcHRzIiwic2NyaXB0c1RvRXZhbCIsInNjcmlwdCIsInNjcmlwdFR5cGUiLCJrIiwic2NyaXB0c0xlbiIsImlubmVyVGV4dCIsInRleHRDb250ZW50IiwicmVtb3ZlQ2hpbGQiLCJsIiwic2NyaXB0c1RvRXZhbExlbiIsInN0eWxlVGFncyIsInN0eWxlVGFnIiwicGFyZW50Tm9kZSIsInJlcGxhY2VDaGlsZCIsIlNWR0luamVjdG9yIiwiZWxlbWVudHMiLCJvcHRpb25zIiwiZG9uZSIsImVhY2hDYWxsYmFjayIsImVhY2giLCJlbGVtZW50c0xvYWRlZCIsIm1vZHVsZSIsImV4cG9ydHMiLCJkZWZpbmUiLCJhbWQiLCJhdXRvU2Nyb2xsIiwiZ2V0RGVmIiwiZiIsImQiLCJib29sZWFuIiwiZnVuYyIsImRlZiIsImFyZ3VtZW50cyQxIiwiYXJndW1lbnRzIiwiX2xlbiIsImFyZ3MiLCJfa2V5IiwiYXBwbHkiLCJwcmVmaXgiLCJyZXF1ZXN0QW5pbWF0aW9uRnJhbWUiLCJsaW1pdCIsImxhc3RUaW1lIiwibm93IiwiRGF0ZSIsImdldFRpbWUiLCJ0dGMiLCJNYXRoIiwibWF4IiwidGltZXIiLCJiaW5kIiwiY2FuY2VsQW5pbWF0aW9uRnJhbWUiLCJjbGVhclRpbWVvdXQiLCJfdHlwZW9mIiwiU3ltYm9sIiwiaXRlcmF0b3IiLCJvYmoiLCJjb25zdHJ1Y3RvciIsImlzRWxlbWVudCIsImlucHV0Iiwibm9kZVR5cGUiLCJzdHlsZSIsIm93bmVyRG9jdW1lbnQiLCJpbmRleE9mRWxlbWVudCIsInJlc29sdmVFbGVtZW50IiwiaGFzRWxlbWVudCIsInB1c2hFbGVtZW50cyIsInRvQWRkIiwiYWRkRWxlbWVudHMiLCJfbGVuMiIsIl9rZXkyIiwibWFwIiwicmVtb3ZlRWxlbWVudHMiLCJfbGVuMyIsInRvUmVtb3ZlIiwiX2tleTMiLCJyZWR1Y2UiLCJsYXN0IiwiaW5kZXgkJDEiLCJzcGxpY2UiLCJub1Rocm93IiwicXVlcnlTZWxlY3RvciIsImluZGV4JDIiLCJjcmVhdGVQb2ludENCIiwib2JqZWN0IiwiYWxsb3dVcGRhdGUiLCJwb2ludENCIiwiZXZlbnQiLCJ0YXJnZXQiLCJzcmNFbGVtZW50Iiwib3JpZ2luYWxUYXJnZXQiLCJ0eXBlIiwidGFyZ2V0VG91Y2hlcyIsIngiLCJjbGllbnRYIiwieSIsImNsaWVudFkiLCJwYWdlWCIsInBhZ2VZIiwiZXZlbnREb2MiLCJkb2MiLCJib2R5Iiwic2Nyb2xsTGVmdCIsImNsaWVudExlZnQiLCJzY3JvbGxUb3AiLCJjbGllbnRUb3AiLCJjcmVhdGVXaW5kb3dSZWN0IiwicHJvcHMiLCJ0b3AiLCJlbnVtZXJhYmxlIiwibGVmdCIsInJpZ2h0IiwiaW5uZXJXaWR0aCIsImJvdHRvbSIsImlubmVySGVpZ2h0Iiwid2lkdGgiLCJoZWlnaHQiLCJjcmVhdGUiLCJyZWN0IiwiZGVmaW5lUHJvcGVydGllcyIsImdldENsaWVudFJlY3QiLCJnZXRCb3VuZGluZ0NsaWVudFJlY3QiLCJwb2ludEluc2lkZSIsInBvaW50Iiwib2JqZWN0Q3JlYXRlIiwiVGVtcCIsInByb3BlcnRpZXNPYmplY3QiLCJyZXN1bHQiLCJfX3Byb3RvX18iLCJvYmplY3RDcmVhdGUkMSIsIm1vdXNlRXZlbnRQcm9wcyIsImNyZWF0ZURpc3BhdGNoZXIiLCJkZWZhdWx0U2V0dGluZ3MiLCJzY3JlZW5YIiwic2NyZWVuWSIsImN0cmxLZXkiLCJzaGlmdEtleSIsImFsdEtleSIsIm1ldGFLZXkiLCJidXR0b24iLCJidXR0b25zIiwicmVsYXRlZFRhcmdldCIsInJlZ2lvbiIsImFkZEV2ZW50TGlzdGVuZXIiLCJvbk1vdmUiLCJkaXNwYXRjaCIsIk1vdXNlRXZlbnQiLCJtMSIsImluaXRNb3ZlIiwiZGF0YSIsImV2dCIsImNyZWF0ZU1vdmVJbml0Iiwic2V0U3BlY2lhbCIsImRpc3BhdGNoRXZlbnQiLCJjcmVhdGVFdmVudCIsIm0yIiwic2V0dGluZ3MiLCJpbml0TW91c2VFdmVudCIsImNyZWF0ZUV2ZW50T2JqZWN0IiwibTMiLCJkZXN0cm95IiwicmVtb3ZlRXZlbnRMaXN0ZW5lciIsImNvbnNvbGUiLCJsb2ciLCJkaXNwYXRjaGVkIiwiQXV0b1Njcm9sbGVyIiwic2VsZiIsIm1heFNwZWVkIiwic2Nyb2xsaW5nIiwibWFyZ2luIiwic2Nyb2xsV2hlbk91dHNpZGUiLCJkaXNwYXRjaGVyIiwiZG93biIsImlzTmFOIiwic3luY01vdmUiLCJvbkRvd24iLCJvblVwIiwic2V0U2Nyb2xsIiwiYWRkIiwicmVtb3ZlIiwiaGFzV2luZG93Iiwid2luZG93QW5pbWF0aW9uRnJhbWUiLCJ0b1N0cmluZyIsInRlbXAiLCJnZXQiLCJuIiwiY3VycmVudCIsImFuaW1hdGlvbkZyYW1lIiwib25Nb3VzZU91dCIsImdldFRhcmdldCIsImdldEVsZW1lbnRVbmRlclBvaW50IiwidW5kZXJQb2ludCIsImluc2lkZSIsInNjcm9sbFdpbmRvdyIsInNjcm9sbFRpY2siLCJzY3JvbGx4Iiwic2Nyb2xseSIsImZsb29yIiwiY2VpbCIsIm1pbiIsInNjcm9sbFkiLCJzY3JvbGxYIiwiYW1vdW50Iiwic2Nyb2xsVG8iLCJwYWdlWE9mZnNldCIsInBhZ2VZT2Zmc2V0IiwiQXV0b1Njcm9sbGVyRmFjdG9yeSIsIiQiLCJEcnVwYWwiLCJkcnVwYWxTZXR0aW5ncyIsIkNLRURJVE9SIiwiYmVoYXZpb3JzIiwiZHJhZ2dhYmxlSXRlbXMiLCJhdHRhY2giLCJjb250ZXh0IiwiaGFzQ2xhc3MiLCJpbml0RHJhZ2dhYmxlSXRlbXMiLCJhZGRDbGFzcyIsImluaXRDa2VkaXRvckZyb21TYXZlZFN0YXR1cyIsImRyYWdnZWRJdGVtcyIsImZpbmQiLCJjb25maWciLCJuZXdFZGl0b3IiLCJvbiIsInNldERhdGEiLCJjb250ZW50IiwiJGRyYWdnYWJsZUl0ZW1Db250YWluZXJzIiwiZHJha2UiLCJkcmFndWxhIiwibW92ZXMiLCJjb250YWluZXIiLCJoYW5kbGUiLCJjaGlsZHJlbiIsImFjY2VwdHMiLCJzb3VyY2UiLCJzaWJsaW5nIiwiYWRqdXN0T3JkZXIiLCIkd3lzaXd5Z3MiLCJzaWJsaW5ncyIsImRyYWdnZWRJdGVtSWQiLCJhdHRyIiwiaW5zdGFuY2VzIiwiZHJhZ2dlZEl0ZW1JbnN0YW5jZSIsImRyYWdnZWRJdGVtQ29uZmlnIiwiZHJhZ2dlZEl0ZW1Db250ZW50IiwiZ2V0RGF0YSIsImluc3RhbmNlIiwic2Nyb2xsIiwiZHJhZ2dpbmciLCJkcmFndWxhT2JqZWN0IiwiJGRyYWdnYWJsZUl0ZW1zIiwiY29udGFpbmVycyIsIiR3ZWlnaHRTZWxlY3QiLCIkd2VpZ2h0U2VsZWN0QWpheCIsInZhbCIsImpRdWVyeSIsImVudGl0eUJyb3dzZXJJbXByb3ZlciIsIiRicm93c2VyQ29sIiwiY2xpY2siLCIkY2hlY2tib3giLCJwcm9wIiwidG9nZ2xlQ2xhc3MiLCJwYXJhZ3JhcGhzUHJldmlld2VySW1wcm92ZXIiLCIkcHJldmlld2VyQnV0dG9ucyIsIiRwcmV2aWV3ZXJCdXR0b24iLCJyZXBsYWNlUGFyYWdyYXBoTmFtZSIsIiRwYXJhZ3JhcGhzVG9wRWxlbWVudHMiLCIkcGFyYWdyYXBoc1ByZXZpZXdzIiwiZm9ybWF0UGFyYWdyYXBoc1ByZXZpZXdzIiwicmVhZHkiLCJwcmV2aWV3ZXJCdXR0b24iLCJwYXJhZ3JhcGhOYW1lIiwidGV4dCIsInBhcmFncmFwaHNQcmV2aWV3cyIsIiR0aGlzIiwib3V0ZXJIZWlnaHQiLCJteVNWR3NUb0luamVjdCJdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7O0FBUUMsV0FBVUEsTUFBVixFQUFrQkMsUUFBbEIsRUFBNEI7O0FBRTNCOztBQUVBOztBQUNBLE1BQUlDLFVBQVVGLE9BQU9HLFFBQVAsQ0FBZ0JDLFFBQWhCLEtBQTZCLE9BQTNDO0FBQ0EsTUFBSUMsZ0JBQWdCSixTQUFTSyxjQUFULENBQXdCQyxVQUF4QixDQUFtQyxtREFBbkMsRUFBd0YsS0FBeEYsQ0FBcEI7O0FBRUEsV0FBU0MsYUFBVCxDQUF1QkMsSUFBdkIsRUFBNkI7QUFDM0JBLFdBQU9BLEtBQUtDLEtBQUwsQ0FBVyxHQUFYLENBQVA7O0FBRUEsUUFBSUMsT0FBTyxFQUFYO0FBQ0EsUUFBSUMsSUFBSUgsS0FBS0ksTUFBYjtBQUNBLFFBQUlDLE1BQU0sRUFBVjs7QUFFQSxXQUFPRixHQUFQLEVBQVk7QUFDVixVQUFJLENBQUNELEtBQUtJLGNBQUwsQ0FBb0JOLEtBQUtH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LFlBQVdpQixhQUFjLEVBQTlDO0FBQ0Q7O0FBRUQ7Ozs7QUFJQSxXQUFTSCx3QkFBVCxDQUFrQ0ssa0JBQWxDLEVBQXNEO0FBQ3BEQSx1QkFBbUI3UCxJQUFuQixDQUF3QixDQUFDbEgsQ0FBRCxFQUFJcUQsRUFBSixLQUFXO0FBQ2pDLFVBQUkyVCxRQUFRbkUsRUFBRXhQLEVBQUYsQ0FBWjtBQUNBLFVBQUkyVCxNQUFNQyxXQUFOLE1BQXVCLEdBQTNCLEVBQWdDO0FBQzlCRCxjQUFNekQsUUFBTixDQUFlLFlBQWY7QUFDRDtBQUNGLEtBTEQ7QUFNRDtBQUVGLENBeERBLENBd0RDc0MsTUF4REQsQ0FBRDtBQ0xBOzs7Ozs7QUFNQSxDQUFDLFVBQVNoRCxDQUFULEVBQVc7QUFDVjs7QUFFQUEsSUFBRSxZQUFXO0FBQ1g7QUFDQSxRQUFJcUUsaUJBQWlCN1gsU0FBU2lHLGdCQUFULENBQTBCLGVBQTFCLENBQXJCOztBQUVBO0FBQ0F1QixnQkFBWXFRLGNBQVo7QUFDRCxHQU5EO0FBUUQsQ0FYQSxDQVdDckIsTUFYRCxDQUFEIiwiZmlsZSI6ImFkbWlua2l0LmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyoqXG4gKiBTVkdJbmplY3RvciB2MS4xLjMgLSBGYXN0LCBjYWNoaW5nLCBkeW5hbWljIGlubGluZSBTVkcgRE9NIGluamVjdGlvbiBsaWJyYXJ5XG4gKiBodHRwczovL2dpdGh1Yi5jb20vaWNvbmljL1NWR0luamVjdG9yXG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDE0LTIwMTUgV2F5YnVyeSA8aGVsbG9Ad2F5YnVyeS5jb20+XG4gKiBAbGljZW5zZSBNSVRcbiAqL1xuXG4oZnVuY3Rpb24gKHdpbmRvdywgZG9jdW1lbnQpIHtcblxuICAndXNlIHN0cmljdCc7XG5cbiAgLy8gRW52aXJvbm1lbnRcbiAgdmFyIGlzTG9jYWwgPSB3aW5kb3cubG9jYXRpb24ucHJvdG9jb2wgPT09ICdmaWxlOic7XG4gIHZhciBoYXNTdmdTdXBwb3J0ID0gZG9jdW1lbnQuaW1wbGVtZW50YXRpb24uaGFzRmVhdHVyZSgnaHR0cDovL3d3dy53My5vcmcvVFIvU1ZHMTEvZmVhdHVyZSNCYXNpY1N0cnVjdHVyZScsICcxLjEnKTtcblxuICBmdW5jdGlvbiB1bmlxdWVDbGFzc2VzKGxpc3QpIHtcbiAgICBsaXN0ID0gbGlzdC5zcGxpdCgnICcpO1xuXG4gICAgdmFyIGhhc2ggPSB7fTtcbiAgICB2YXIgaSA9IGxpc3QubGVuZ3RoO1xuICAgIHZhciBvdXQgPSBbXTtcblxuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgIGlmICghaGFzaC5oYXNPd25Qcm9wZXJ0eShsaXN0W2ldKSkge1xuICAgICAgICBoYXNoW2xpc3RbaV1dID0gMTtcbiAgICAgICAgb3V0LnVuc2hpZnQobGlzdFtpXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG91dC5qb2luKCcgJyk7XG4gIH1cblxuICAvKipcbiAgICogY2FjaGUgKG9yIHBvbHlmaWxsIGZvciA8PSBJRTgpIEFycmF5LmZvckVhY2goKVxuICAgKiBzb3VyY2U6IGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0phdmFTY3JpcHQvUmVmZXJlbmNlL0dsb2JhbF9PYmplY3RzL0FycmF5L2ZvckVhY2hcbiAgICovXG4gIHZhciBmb3JFYWNoID0gQXJyYXkucHJvdG90eXBlLmZvckVhY2ggfHwgZnVuY3Rpb24gKGZuLCBzY29wZSkge1xuICAgIGlmICh0aGlzID09PSB2b2lkIDAgfHwgdGhpcyA9PT0gbnVsbCB8fCB0eXBlb2YgZm4gIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoKTtcbiAgICB9XG5cbiAgICAvKiBqc2hpbnQgYml0d2lzZTogZmFsc2UgKi9cbiAgICB2YXIgaSwgbGVuID0gdGhpcy5sZW5ndGggPj4+IDA7XG4gICAgLyoganNoaW50IGJpdHdpc2U6IHRydWUgKi9cblxuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47ICsraSkge1xuICAgICAgaWYgKGkgaW4gdGhpcykge1xuICAgICAgICBmbi5jYWxsKHNjb3BlLCB0aGlzW2ldLCBpLCB0aGlzKTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgLy8gU1ZHIENhY2hlXG4gIHZhciBzdmdDYWNoZSA9IHt9O1xuXG4gIHZhciBpbmplY3RDb3VudCA9IDA7XG4gIHZhciBpbmplY3RlZEVsZW1lbnRzID0gW107XG5cbiAgLy8gUmVxdWVzdCBRdWV1ZVxuICB2YXIgcmVxdWVzdFF1ZXVlID0gW107XG5cbiAgLy8gU2NyaXB0IHJ1bm5pbmcgc3RhdHVzXG4gIHZhciByYW5TY3JpcHRzID0ge307XG5cbiAgdmFyIGNsb25lU3ZnID0gZnVuY3Rpb24gKHNvdXJjZVN2Zykge1xuICAgIHJldHVybiBzb3VyY2VTdmcuY2xvbmVOb2RlKHRydWUpO1xuICB9O1xuXG4gIHZhciBxdWV1ZVJlcXVlc3QgPSBmdW5jdGlvbiAodXJsLCBjYWxsYmFjaykge1xuICAgIHJlcXVlc3RRdWV1ZVt1cmxdID0gcmVxdWVzdFF1ZXVlW3VybF0gfHwgW107XG4gICAgcmVxdWVzdFF1ZXVlW3VybF0ucHVzaChjYWxsYmFjayk7XG4gIH07XG5cbiAgdmFyIHByb2Nlc3NSZXF1ZXN0UXVldWUgPSBmdW5jdGlvbiAodXJsKSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IHJlcXVlc3RRdWV1ZVt1cmxdLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAvLyBNYWtlIHRoZXNlIGNhbGxzIGFzeW5jIHNvIHdlIGF2b2lkIGJsb2NraW5nIHRoZSBwYWdlL3JlbmRlcmVyXG4gICAgICAvKiBqc2hpbnQgbG9vcGZ1bmM6IHRydWUgKi9cbiAgICAgIChmdW5jdGlvbiAoaW5kZXgpIHtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgcmVxdWVzdFF1ZXVlW3VybF1baW5kZXhdKGNsb25lU3ZnKHN2Z0NhY2hlW3VybF0pKTtcbiAgICAgICAgfSwgMCk7XG4gICAgICB9KShpKTtcbiAgICAgIC8qIGpzaGludCBsb29wZnVuYzogZmFsc2UgKi9cbiAgICB9XG4gIH07XG5cbiAgdmFyIGxvYWRTdmcgPSBmdW5jdGlvbiAodXJsLCBjYWxsYmFjaykge1xuICAgIGlmIChzdmdDYWNoZVt1cmxdICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChzdmdDYWNoZVt1cmxdIGluc3RhbmNlb2YgU1ZHU1ZHRWxlbWVudCkge1xuICAgICAgICAvLyBXZSBhbHJlYWR5IGhhdmUgaXQgaW4gY2FjaGUsIHNvIHVzZSBpdFxuICAgICAgICBjYWxsYmFjayhjbG9uZVN2ZyhzdmdDYWNoZVt1cmxdKSk7XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgLy8gV2UgZG9uJ3QgaGF2ZSBpdCBpbiBjYWNoZSB5ZXQsIGJ1dCB3ZSBhcmUgbG9hZGluZyBpdCwgc28gcXVldWUgdGhpcyByZXF1ZXN0XG4gICAgICAgIHF1ZXVlUmVxdWVzdCh1cmwsIGNhbGxiYWNrKTtcbiAgICAgIH1cbiAgICB9XG4gICAgZWxzZSB7XG5cbiAgICAgIGlmICghd2luZG93LlhNTEh0dHBSZXF1ZXN0KSB7XG4gICAgICAgIGNhbGxiYWNrKCdCcm93c2VyIGRvZXMgbm90IHN1cHBvcnQgWE1MSHR0cFJlcXVlc3QnKTtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICAvLyBTZWVkIHRoZSBjYWNoZSB0byBpbmRpY2F0ZSB3ZSBhcmUgbG9hZGluZyB0aGlzIFVSTCBhbHJlYWR5XG4gICAgICBzdmdDYWNoZVt1cmxdID0ge307XG4gICAgICBxdWV1ZVJlcXVlc3QodXJsLCBjYWxsYmFjayk7XG5cbiAgICAgIHZhciBodHRwUmVxdWVzdCA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuXG4gICAgICBodHRwUmVxdWVzdC5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIHJlYWR5U3RhdGUgNCA9IGNvbXBsZXRlXG4gICAgICAgIGlmIChodHRwUmVxdWVzdC5yZWFkeVN0YXRlID09PSA0KSB7XG5cbiAgICAgICAgICAvLyBIYW5kbGUgc3RhdHVzXG4gICAgICAgICAgaWYgKGh0dHBSZXF1ZXN0LnN0YXR1cyA9PT0gNDA0IHx8IGh0dHBSZXF1ZXN0LnJlc3BvbnNlWE1MID09PSBudWxsKSB7XG4gICAgICAgICAgICBjYWxsYmFjaygnVW5hYmxlIHRvIGxvYWQgU1ZHIGZpbGU6ICcgKyB1cmwpO1xuXG4gICAgICAgICAgICBpZiAoaXNMb2NhbCkgY2FsbGJhY2soJ05vdGU6IFNWRyBpbmplY3Rpb24gYWpheCBjYWxscyBkbyBub3Qgd29yayBsb2NhbGx5IHdpdGhvdXQgYWRqdXN0aW5nIHNlY3VyaXR5IHNldHRpbmcgaW4geW91ciBicm93c2VyLiBPciBjb25zaWRlciB1c2luZyBhIGxvY2FsIHdlYnNlcnZlci4nKTtcblxuICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyAyMDAgc3VjY2VzcyBmcm9tIHNlcnZlciwgb3IgMCB3aGVuIHVzaW5nIGZpbGU6Ly8gcHJvdG9jb2wgbG9jYWxseVxuICAgICAgICAgIGlmIChodHRwUmVxdWVzdC5zdGF0dXMgPT09IDIwMCB8fCAoaXNMb2NhbCAmJiBodHRwUmVxdWVzdC5zdGF0dXMgPT09IDApKSB7XG5cbiAgICAgICAgICAgIC8qIGdsb2JhbHMgRG9jdW1lbnQgKi9cbiAgICAgICAgICAgIGlmIChodHRwUmVxdWVzdC5yZXNwb25zZVhNTCBpbnN0YW5jZW9mIERvY3VtZW50KSB7XG4gICAgICAgICAgICAgIC8vIENhY2hlIGl0XG4gICAgICAgICAgICAgIHN2Z0NhY2hlW3VybF0gPSBodHRwUmVxdWVzdC5yZXNwb25zZVhNTC5kb2N1bWVudEVsZW1lbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvKiBnbG9iYWxzIC1Eb2N1bWVudCAqL1xuXG4gICAgICAgICAgICAvLyBJRTkgZG9lc24ndCBjcmVhdGUgYSByZXNwb25zZVhNTCBEb2N1bWVudCBvYmplY3QgZnJvbSBsb2FkZWQgU1ZHLFxuICAgICAgICAgICAgLy8gYW5kIHRocm93cyBhIFwiRE9NIEV4Y2VwdGlvbjogSElFUkFSQ0hZX1JFUVVFU1RfRVJSICgzKVwiIGVycm9yIHdoZW4gaW5qZWN0ZWQuXG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gU28sIHdlJ2xsIGp1c3QgY3JlYXRlIG91ciBvd24gbWFudWFsbHkgdmlhIHRoZSBET01QYXJzZXIgdXNpbmdcbiAgICAgICAgICAgIC8vIHRoZSB0aGUgcmF3IFhNTCByZXNwb25zZVRleHQuXG4gICAgICAgICAgICAvL1xuICAgICAgICAgICAgLy8gOk5PVEU6IElFOCBhbmQgb2xkZXIgZG9lc24ndCBoYXZlIERPTVBhcnNlciwgYnV0IHRoZXkgY2FuJ3QgZG8gU1ZHIGVpdGhlciwgc28uLi5cbiAgICAgICAgICAgIGVsc2UgaWYgKERPTVBhcnNlciAmJiAoRE9NUGFyc2VyIGluc3RhbmNlb2YgRnVuY3Rpb24pKSB7XG4gICAgICAgICAgICAgIHZhciB4bWxEb2M7XG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdmFyIHBhcnNlciA9IG5ldyBET01QYXJzZXIoKTtcbiAgICAgICAgICAgICAgICB4bWxEb2MgPSBwYXJzZXIucGFyc2VGcm9tU3RyaW5nKGh0dHBSZXF1ZXN0LnJlc3BvbnNlVGV4dCwgJ3RleHQveG1sJyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICB4bWxEb2MgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICBpZiAoIXhtbERvYyB8fCB4bWxEb2MuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ3BhcnNlcmVycm9yJykubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soJ1VuYWJsZSB0byBwYXJzZSBTVkcgZmlsZTogJyArIHVybCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIENhY2hlIGl0XG4gICAgICAgICAgICAgICAgc3ZnQ2FjaGVbdXJsXSA9IHhtbERvYy5kb2N1bWVudEVsZW1lbnQ7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gV2UndmUgbG9hZGVkIGEgbmV3IGFzc2V0LCBzbyBwcm9jZXNzIGFueSByZXF1ZXN0cyB3YWl0aW5nIGZvciBpdFxuICAgICAgICAgICAgcHJvY2Vzc1JlcXVlc3RRdWV1ZSh1cmwpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKCdUaGVyZSB3YXMgYSBwcm9ibGVtIGluamVjdGluZyB0aGUgU1ZHOiAnICsgaHR0cFJlcXVlc3Quc3RhdHVzICsgJyAnICsgaHR0cFJlcXVlc3Quc3RhdHVzVGV4dCk7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBodHRwUmVxdWVzdC5vcGVuKCdHRVQnLCB1cmwpO1xuXG4gICAgICAvLyBUcmVhdCBhbmQgcGFyc2UgdGhlIHJlc3BvbnNlIGFzIFhNTCwgZXZlbiBpZiB0aGVcbiAgICAgIC8vIHNlcnZlciBzZW5kcyB1cyBhIGRpZmZlcmVudCBtaW1ldHlwZVxuICAgICAgaWYgKGh0dHBSZXF1ZXN0Lm92ZXJyaWRlTWltZVR5cGUpIGh0dHBSZXF1ZXN0Lm92ZXJyaWRlTWltZVR5cGUoJ3RleHQveG1sJyk7XG5cbiAgICAgIGh0dHBSZXF1ZXN0LnNlbmQoKTtcbiAgICB9XG4gIH07XG5cbiAgLy8gSW5qZWN0IGEgc2luZ2xlIGVsZW1lbnRcbiAgdmFyIGluamVjdEVsZW1lbnQgPSBmdW5jdGlvbiAoZWwsIGV2YWxTY3JpcHRzLCBwbmdGYWxsYmFjaywgY2FsbGJhY2spIHtcblxuICAgIC8vIEdyYWIgdGhlIHNyYyBvciBkYXRhLXNyYyBhdHRyaWJ1dGVcbiAgICB2YXIgaW1nVXJsID0gZWwuZ2V0QXR0cmlidXRlKCdkYXRhLXNyYycpIHx8IGVsLmdldEF0dHJpYnV0ZSgnc3JjJyk7XG5cbiAgICAvLyBXZSBjYW4gb25seSBpbmplY3QgU1ZHXG4gICAgaWYgKCEoL1xcLnN2Zy9pKS50ZXN0KGltZ1VybCkpIHtcbiAgICAgIGNhbGxiYWNrKCdBdHRlbXB0ZWQgdG8gaW5qZWN0IGEgZmlsZSB3aXRoIGEgbm9uLXN2ZyBleHRlbnNpb246ICcgKyBpbWdVcmwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIElmIHdlIGRvbid0IGhhdmUgU1ZHIHN1cHBvcnQgdHJ5IHRvIGZhbGwgYmFjayB0byBhIHBuZyxcbiAgICAvLyBlaXRoZXIgZGVmaW5lZCBwZXItZWxlbWVudCB2aWEgZGF0YS1mYWxsYmFjayBvciBkYXRhLXBuZyxcbiAgICAvLyBvciBnbG9iYWxseSB2aWEgdGhlIHBuZ0ZhbGxiYWNrIGRpcmVjdG9yeSBzZXR0aW5nXG4gICAgaWYgKCFoYXNTdmdTdXBwb3J0KSB7XG4gICAgICB2YXIgcGVyRWxlbWVudEZhbGxiYWNrID0gZWwuZ2V0QXR0cmlidXRlKCdkYXRhLWZhbGxiYWNrJykgfHwgZWwuZ2V0QXR0cmlidXRlKCdkYXRhLXBuZycpO1xuXG4gICAgICAvLyBQZXItZWxlbWVudCBzcGVjaWZpYyBQTkcgZmFsbGJhY2sgZGVmaW5lZCwgc28gdXNlIHRoYXRcbiAgICAgIGlmIChwZXJFbGVtZW50RmFsbGJhY2spIHtcbiAgICAgICAgZWwuc2V0QXR0cmlidXRlKCdzcmMnLCBwZXJFbGVtZW50RmFsbGJhY2spO1xuICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgIH1cbiAgICAgIC8vIEdsb2JhbCBQTkcgZmFsbGJhY2sgZGlyZWN0b3JpeSBkZWZpbmVkLCB1c2UgdGhlIHNhbWUtbmFtZWQgUE5HXG4gICAgICBlbHNlIGlmIChwbmdGYWxsYmFjaykge1xuICAgICAgICBlbC5zZXRBdHRyaWJ1dGUoJ3NyYycsIHBuZ0ZhbGxiYWNrICsgJy8nICsgaW1nVXJsLnNwbGl0KCcvJykucG9wKCkucmVwbGFjZSgnLnN2ZycsICcucG5nJykpO1xuICAgICAgICBjYWxsYmFjayhudWxsKTtcbiAgICAgIH1cbiAgICAgIC8vIHVtLi4uXG4gICAgICBlbHNlIHtcbiAgICAgICAgY2FsbGJhY2soJ1RoaXMgYnJvd3NlciBkb2VzIG5vdCBzdXBwb3J0IFNWRyBhbmQgbm8gUE5HIGZhbGxiYWNrIHdhcyBkZWZpbmVkLicpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gTWFrZSBzdXJlIHdlIGFyZW4ndCBhbHJlYWR5IGluIHRoZSBwcm9jZXNzIG9mIGluamVjdGluZyB0aGlzIGVsZW1lbnQgdG9cbiAgICAvLyBhdm9pZCBhIHJhY2UgY29uZGl0aW9uIGlmIG11bHRpcGxlIGluamVjdGlvbnMgZm9yIHRoZSBzYW1lIGVsZW1lbnQgYXJlIHJ1bi5cbiAgICAvLyA6Tk9URTogVXNpbmcgaW5kZXhPZigpIG9ubHkgX2FmdGVyXyB3ZSBjaGVjayBmb3IgU1ZHIHN1cHBvcnQgYW5kIGJhaWwsXG4gICAgLy8gc28gbm8gbmVlZCBmb3IgSUU4IGluZGV4T2YoKSBwb2x5ZmlsbFxuICAgIGlmIChpbmplY3RlZEVsZW1lbnRzLmluZGV4T2YoZWwpICE9PSAtMSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFJlbWVtYmVyIHRoZSByZXF1ZXN0IHRvIGluamVjdCB0aGlzIGVsZW1lbnQsIGluIGNhc2Ugb3RoZXIgaW5qZWN0aW9uXG4gICAgLy8gY2FsbHMgYXJlIGFsc28gdHJ5aW5nIHRvIHJlcGxhY2UgdGhpcyBlbGVtZW50IGJlZm9yZSB3ZSBmaW5pc2hcbiAgICBpbmplY3RlZEVsZW1lbnRzLnB1c2goZWwpO1xuXG4gICAgLy8gVHJ5IHRvIGF2b2lkIGxvYWRpbmcgdGhlIG9yZ2luYWwgaW1hZ2Ugc3JjIGlmIHBvc3NpYmxlLlxuICAgIGVsLnNldEF0dHJpYnV0ZSgnc3JjJywgJycpO1xuXG4gICAgLy8gTG9hZCBpdCB1cFxuICAgIGxvYWRTdmcoaW1nVXJsLCBmdW5jdGlvbiAoc3ZnKSB7XG5cbiAgICAgIGlmICh0eXBlb2Ygc3ZnID09PSAndW5kZWZpbmVkJyB8fCB0eXBlb2Ygc3ZnID09PSAnc3RyaW5nJykge1xuICAgICAgICBjYWxsYmFjayhzdmcpO1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG5cbiAgICAgIHZhciBpbWdJZCA9IGVsLmdldEF0dHJpYnV0ZSgnaWQnKTtcbiAgICAgIGlmIChpbWdJZCkge1xuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKCdpZCcsIGltZ0lkKTtcbiAgICAgIH1cblxuICAgICAgdmFyIGltZ1RpdGxlID0gZWwuZ2V0QXR0cmlidXRlKCd0aXRsZScpO1xuICAgICAgaWYgKGltZ1RpdGxlKSB7XG4gICAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoJ3RpdGxlJywgaW1nVGl0bGUpO1xuICAgICAgfVxuXG4gICAgICAvLyBDb25jYXQgdGhlIFNWRyBjbGFzc2VzICsgJ2luamVjdGVkLXN2ZycgKyB0aGUgaW1nIGNsYXNzZXNcbiAgICAgIHZhciBjbGFzc01lcmdlID0gW10uY29uY2F0KHN2Zy5nZXRBdHRyaWJ1dGUoJ2NsYXNzJykgfHwgW10sICdpbmplY3RlZC1zdmcnLCBlbC5nZXRBdHRyaWJ1dGUoJ2NsYXNzJykgfHwgW10pLmpvaW4oJyAnKTtcbiAgICAgIHN2Zy5zZXRBdHRyaWJ1dGUoJ2NsYXNzJywgdW5pcXVlQ2xhc3NlcyhjbGFzc01lcmdlKSk7XG5cbiAgICAgIHZhciBpbWdTdHlsZSA9IGVsLmdldEF0dHJpYnV0ZSgnc3R5bGUnKTtcbiAgICAgIGlmIChpbWdTdHlsZSkge1xuICAgICAgICBzdmcuc2V0QXR0cmlidXRlKCdzdHlsZScsIGltZ1N0eWxlKTtcbiAgICAgIH1cblxuICAgICAgLy8gQ29weSBhbGwgdGhlIGRhdGEgZWxlbWVudHMgdG8gdGhlIHN2Z1xuICAgICAgdmFyIGltZ0RhdGEgPSBbXS5maWx0ZXIuY2FsbChlbC5hdHRyaWJ1dGVzLCBmdW5jdGlvbiAoYXQpIHtcbiAgICAgICAgcmV0dXJuICgvXmRhdGEtXFx3W1xcd1xcLV0qJC8pLnRlc3QoYXQubmFtZSk7XG4gICAgICB9KTtcbiAgICAgIGZvckVhY2guY2FsbChpbWdEYXRhLCBmdW5jdGlvbiAoZGF0YUF0dHIpIHtcbiAgICAgICAgaWYgKGRhdGFBdHRyLm5hbWUgJiYgZGF0YUF0dHIudmFsdWUpIHtcbiAgICAgICAgICBzdmcuc2V0QXR0cmlidXRlKGRhdGFBdHRyLm5hbWUsIGRhdGFBdHRyLnZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIE1ha2Ugc3VyZSBhbnkgaW50ZXJuYWxseSByZWZlcmVuY2VkIGNsaXBQYXRoIGlkcyBhbmQgdGhlaXJcbiAgICAgIC8vIGNsaXAtcGF0aCByZWZlcmVuY2VzIGFyZSB1bmlxdWUuXG4gICAgICAvL1xuICAgICAgLy8gVGhpcyBhZGRyZXNzZXMgdGhlIGlzc3VlIG9mIGhhdmluZyBtdWx0aXBsZSBpbnN0YW5jZXMgb2YgdGhlXG4gICAgICAvLyBzYW1lIFNWRyBvbiBhIHBhZ2UgYW5kIG9ubHkgdGhlIGZpcnN0IGNsaXBQYXRoIGlkIGlzIHJlZmVyZW5jZWQuXG4gICAgICAvL1xuICAgICAgLy8gQnJvd3NlcnMgb2Z0ZW4gc2hvcnRjdXQgdGhlIFNWRyBTcGVjIGFuZCBkb24ndCB1c2UgY2xpcFBhdGhzXG4gICAgICAvLyBjb250YWluZWQgaW4gcGFyZW50IGVsZW1lbnRzIHRoYXQgYXJlIGhpZGRlbiwgc28gaWYgeW91IGhpZGUgdGhlIGZpcnN0XG4gICAgICAvLyBTVkcgaW5zdGFuY2Ugb24gdGhlIHBhZ2UsIHRoZW4gYWxsIG90aGVyIGluc3RhbmNlcyBsb3NlIHRoZWlyIGNsaXBwaW5nLlxuICAgICAgLy8gUmVmZXJlbmNlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD0zNzYwMjdcblxuICAgICAgLy8gSGFuZGxlIGFsbCBkZWZzIGVsZW1lbnRzIHRoYXQgaGF2ZSBpcmkgY2FwYWJsZSBhdHRyaWJ1dGVzIGFzIGRlZmluZWQgYnkgdzNjOiBodHRwOi8vd3d3LnczLm9yZy9UUi9TVkcvbGlua2luZy5odG1sI3Byb2Nlc3NpbmdJUklcbiAgICAgIC8vIE1hcHBpbmcgSVJJIGFkZHJlc3NhYmxlIGVsZW1lbnRzIHRvIHRoZSBwcm9wZXJ0aWVzIHRoYXQgY2FuIHJlZmVyZW5jZSB0aGVtOlxuICAgICAgdmFyIGlyaUVsZW1lbnRzQW5kUHJvcGVydGllcyA9IHtcbiAgICAgICAgJ2NsaXBQYXRoJzogWydjbGlwLXBhdGgnXSxcbiAgICAgICAgJ2NvbG9yLXByb2ZpbGUnOiBbJ2NvbG9yLXByb2ZpbGUnXSxcbiAgICAgICAgJ2N1cnNvcic6IFsnY3Vyc29yJ10sXG4gICAgICAgICdmaWx0ZXInOiBbJ2ZpbHRlciddLFxuICAgICAgICAnbGluZWFyR3JhZGllbnQnOiBbJ2ZpbGwnLCAnc3Ryb2tlJ10sXG4gICAgICAgICdtYXJrZXInOiBbJ21hcmtlcicsICdtYXJrZXItc3RhcnQnLCAnbWFya2VyLW1pZCcsICdtYXJrZXItZW5kJ10sXG4gICAgICAgICdtYXNrJzogWydtYXNrJ10sXG4gICAgICAgICdwYXR0ZXJuJzogWydmaWxsJywgJ3N0cm9rZSddLFxuICAgICAgICAncmFkaWFsR3JhZGllbnQnOiBbJ2ZpbGwnLCAnc3Ryb2tlJ11cbiAgICAgIH07XG5cbiAgICAgIHZhciBlbGVtZW50LCBlbGVtZW50RGVmcywgcHJvcGVydGllcywgY3VycmVudElkLCBuZXdJZDtcbiAgICAgIE9iamVjdC5rZXlzKGlyaUVsZW1lbnRzQW5kUHJvcGVydGllcykuZm9yRWFjaChmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgIGVsZW1lbnQgPSBrZXk7XG4gICAgICAgIHByb3BlcnRpZXMgPSBpcmlFbGVtZW50c0FuZFByb3BlcnRpZXNba2V5XTtcblxuICAgICAgICBlbGVtZW50RGVmcyA9IHN2Zy5xdWVyeVNlbGVjdG9yQWxsKCdkZWZzICcgKyBlbGVtZW50ICsgJ1tpZF0nKTtcbiAgICAgICAgZm9yICh2YXIgaSA9IDAsIGVsZW1lbnRzTGVuID0gZWxlbWVudERlZnMubGVuZ3RoOyBpIDwgZWxlbWVudHNMZW47IGkrKykge1xuICAgICAgICAgIGN1cnJlbnRJZCA9IGVsZW1lbnREZWZzW2ldLmlkO1xuICAgICAgICAgIG5ld0lkID0gY3VycmVudElkICsgJy0nICsgaW5qZWN0Q291bnQ7XG5cbiAgICAgICAgICAvLyBBbGwgb2YgdGhlIHByb3BlcnRpZXMgdGhhdCBjYW4gcmVmZXJlbmNlIHRoaXMgZWxlbWVudCB0eXBlXG4gICAgICAgICAgdmFyIHJlZmVyZW5jaW5nRWxlbWVudHM7XG4gICAgICAgICAgZm9yRWFjaC5jYWxsKHByb3BlcnRpZXMsIGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgLy8gOk5PVEU6IHVzaW5nIGEgc3Vic3RyaW5nIG1hdGNoIGF0dHIgc2VsZWN0b3IgaGVyZSB0byBkZWFsIHdpdGggSUUgXCJhZGRpbmcgZXh0cmEgcXVvdGVzIGluIHVybCgpIGF0dHJzXCJcbiAgICAgICAgICAgIHJlZmVyZW5jaW5nRWxlbWVudHMgPSBzdmcucXVlcnlTZWxlY3RvckFsbCgnWycgKyBwcm9wZXJ0eSArICcqPVwiJyArIGN1cnJlbnRJZCArICdcIl0nKTtcbiAgICAgICAgICAgIGZvciAodmFyIGogPSAwLCByZWZlcmVuY2luZ0VsZW1lbnRMZW4gPSByZWZlcmVuY2luZ0VsZW1lbnRzLmxlbmd0aDsgaiA8IHJlZmVyZW5jaW5nRWxlbWVudExlbjsgaisrKSB7XG4gICAgICAgICAgICAgIHJlZmVyZW5jaW5nRWxlbWVudHNbal0uc2V0QXR0cmlidXRlKHByb3BlcnR5LCAndXJsKCMnICsgbmV3SWQgKyAnKScpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgZWxlbWVudERlZnNbaV0uaWQgPSBuZXdJZDtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIC8vIFJlbW92ZSBhbnkgdW53YW50ZWQvaW52YWxpZCBuYW1lc3BhY2VzIHRoYXQgbWlnaHQgaGF2ZSBiZWVuIGFkZGVkIGJ5IFNWRyBlZGl0aW5nIHRvb2xzXG4gICAgICBzdmcucmVtb3ZlQXR0cmlidXRlKCd4bWxuczphJyk7XG5cbiAgICAgIC8vIFBvc3QgcGFnZSBsb2FkIGluamVjdGVkIFNWR3MgZG9uJ3QgYXV0b21hdGljYWxseSBoYXZlIHRoZWlyIHNjcmlwdFxuICAgICAgLy8gZWxlbWVudHMgcnVuLCBzbyB3ZSdsbCBuZWVkIHRvIG1ha2UgdGhhdCBoYXBwZW4sIGlmIHJlcXVlc3RlZFxuXG4gICAgICAvLyBGaW5kIHRoZW4gcHJ1bmUgdGhlIHNjcmlwdHNcbiAgICAgIHZhciBzY3JpcHRzID0gc3ZnLnF1ZXJ5U2VsZWN0b3JBbGwoJ3NjcmlwdCcpO1xuICAgICAgdmFyIHNjcmlwdHNUb0V2YWwgPSBbXTtcbiAgICAgIHZhciBzY3JpcHQsIHNjcmlwdFR5cGU7XG5cbiAgICAgIGZvciAodmFyIGsgPSAwLCBzY3JpcHRzTGVuID0gc2NyaXB0cy5sZW5ndGg7IGsgPCBzY3JpcHRzTGVuOyBrKyspIHtcbiAgICAgICAgc2NyaXB0VHlwZSA9IHNjcmlwdHNba10uZ2V0QXR0cmlidXRlKCd0eXBlJyk7XG5cbiAgICAgICAgLy8gT25seSBwcm9jZXNzIGphdmFzY3JpcHQgdHlwZXMuXG4gICAgICAgIC8vIFNWRyBkZWZhdWx0cyB0byAnYXBwbGljYXRpb24vZWNtYXNjcmlwdCcgZm9yIHVuc2V0IHR5cGVzXG4gICAgICAgIGlmICghc2NyaXB0VHlwZSB8fCBzY3JpcHRUeXBlID09PSAnYXBwbGljYXRpb24vZWNtYXNjcmlwdCcgfHwgc2NyaXB0VHlwZSA9PT0gJ2FwcGxpY2F0aW9uL2phdmFzY3JpcHQnKSB7XG5cbiAgICAgICAgICAvLyBpbm5lclRleHQgZm9yIElFLCB0ZXh0Q29udGVudCBmb3Igb3RoZXIgYnJvd3NlcnNcbiAgICAgICAgICBzY3JpcHQgPSBzY3JpcHRzW2tdLmlubmVyVGV4dCB8fCBzY3JpcHRzW2tdLnRleHRDb250ZW50O1xuXG4gICAgICAgICAgLy8gU3Rhc2hcbiAgICAgICAgICBzY3JpcHRzVG9FdmFsLnB1c2goc2NyaXB0KTtcblxuICAgICAgICAgIC8vIFRpZHkgdXAgYW5kIHJlbW92ZSB0aGUgc2NyaXB0IGVsZW1lbnQgc2luY2Ugd2UgZG9uJ3QgbmVlZCBpdCBhbnltb3JlXG4gICAgICAgICAgc3ZnLnJlbW92ZUNoaWxkKHNjcmlwdHNba10pO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFJ1bi9FdmFsIHRoZSBzY3JpcHRzIGlmIG5lZWRlZFxuICAgICAgaWYgKHNjcmlwdHNUb0V2YWwubGVuZ3RoID4gMCAmJiAoZXZhbFNjcmlwdHMgPT09ICdhbHdheXMnIHx8IChldmFsU2NyaXB0cyA9PT0gJ29uY2UnICYmICFyYW5TY3JpcHRzW2ltZ1VybF0pKSkge1xuICAgICAgICBmb3IgKHZhciBsID0gMCwgc2NyaXB0c1RvRXZhbExlbiA9IHNjcmlwdHNUb0V2YWwubGVuZ3RoOyBsIDwgc2NyaXB0c1RvRXZhbExlbjsgbCsrKSB7XG5cbiAgICAgICAgICAvLyA6Tk9URTogWXVwLCB0aGlzIGlzIGEgZm9ybSBvZiBldmFsLCBidXQgaXQgaXMgYmVpbmcgdXNlZCB0byBldmFsIGNvZGVcbiAgICAgICAgICAvLyB0aGUgY2FsbGVyIGhhcyBleHBsaWN0ZWx5IGFza2VkIHRvIGJlIGxvYWRlZCwgYW5kIHRoZSBjb2RlIGlzIGluIGEgY2FsbGVyXG4gICAgICAgICAgLy8gZGVmaW5lZCBTVkcgZmlsZS4uLiBub3QgcmF3IHVzZXIgaW5wdXQuXG4gICAgICAgICAgLy9cbiAgICAgICAgICAvLyBBbHNvLCB0aGUgY29kZSBpcyBldmFsdWF0ZWQgaW4gYSBjbG9zdXJlIGFuZCBub3QgaW4gdGhlIGdsb2JhbCBzY29wZS5cbiAgICAgICAgICAvLyBJZiB5b3UgbmVlZCB0byBwdXQgc29tZXRoaW5nIGluIGdsb2JhbCBzY29wZSwgdXNlICd3aW5kb3cnXG4gICAgICAgICAgbmV3IEZ1bmN0aW9uKHNjcmlwdHNUb0V2YWxbbF0pKHdpbmRvdyk7IC8vIGpzaGludCBpZ25vcmU6bGluZVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gUmVtZW1iZXIgd2UgYWxyZWFkeSByYW4gc2NyaXB0cyBmb3IgdGhpcyBzdmdcbiAgICAgICAgcmFuU2NyaXB0c1tpbWdVcmxdID0gdHJ1ZTtcbiAgICAgIH1cblxuICAgICAgLy8gOldPUktBUk9VTkQ6XG4gICAgICAvLyBJRSBkb2Vzbid0IGV2YWx1YXRlIDxzdHlsZT4gdGFncyBpbiBTVkdzIHRoYXQgYXJlIGR5bmFtaWNhbGx5IGFkZGVkIHRvIHRoZSBwYWdlLlxuICAgICAgLy8gVGhpcyB0cmljayB3aWxsIHRyaWdnZXIgSUUgdG8gcmVhZCBhbmQgdXNlIGFueSBleGlzdGluZyBTVkcgPHN0eWxlPiB0YWdzLlxuICAgICAgLy9cbiAgICAgIC8vIFJlZmVyZW5jZTogaHR0cHM6Ly9naXRodWIuY29tL2ljb25pYy9TVkdJbmplY3Rvci9pc3N1ZXMvMjNcbiAgICAgIHZhciBzdHlsZVRhZ3MgPSBzdmcucXVlcnlTZWxlY3RvckFsbCgnc3R5bGUnKTtcbiAgICAgIGZvckVhY2guY2FsbChzdHlsZVRhZ3MsIGZ1bmN0aW9uIChzdHlsZVRhZykge1xuICAgICAgICBzdHlsZVRhZy50ZXh0Q29udGVudCArPSAnJztcbiAgICAgIH0pO1xuXG4gICAgICAvLyBSZXBsYWNlIHRoZSBpbWFnZSB3aXRoIHRoZSBzdmdcbiAgICAgIGVsLnBhcmVudE5vZGUucmVwbGFjZUNoaWxkKHN2ZywgZWwpO1xuXG4gICAgICAvLyBOb3cgdGhhdCB3ZSBubyBsb25nZXIgbmVlZCBpdCwgZHJvcCByZWZlcmVuY2VzXG4gICAgICAvLyB0byB0aGUgb3JpZ2luYWwgZWxlbWVudCBzbyBpdCBjYW4gYmUgR0MnZFxuICAgICAgZGVsZXRlIGluamVjdGVkRWxlbWVudHNbaW5qZWN0ZWRFbGVtZW50cy5pbmRleE9mKGVsKV07XG4gICAgICBlbCA9IG51bGw7XG5cbiAgICAgIC8vIEluY3JlbWVudCB0aGUgaW5qZWN0ZWQgY291bnRcbiAgICAgIGluamVjdENvdW50Kys7XG5cbiAgICAgIGNhbGxiYWNrKHN2Zyk7XG4gICAgfSk7XG4gIH07XG5cbiAgLyoqXG4gICAqIFNWR0luamVjdG9yXG4gICAqXG4gICAqIFJlcGxhY2UgdGhlIGdpdmVuIGVsZW1lbnRzIHdpdGggdGhlaXIgZnVsbCBpbmxpbmUgU1ZHIERPTSBlbGVtZW50cy5cbiAgICpcbiAgICogOk5PVEU6IFdlIGFyZSB1c2luZyBnZXQvc2V0QXR0cmlidXRlIHdpdGggU1ZHIGJlY2F1c2UgdGhlIFNWRyBET00gc3BlYyBkaWZmZXJzIGZyb20gSFRNTCBET00gYW5kXG4gICAqIGNhbiByZXR1cm4gb3RoZXIgdW5leHBlY3RlZCBvYmplY3QgdHlwZXMgd2hlbiB0cnlpbmcgdG8gZGlyZWN0bHkgYWNjZXNzIHN2ZyBwcm9wZXJ0aWVzLlxuICAgKiBleDogXCJjbGFzc05hbWVcIiByZXR1cm5zIGEgU1ZHQW5pbWF0ZWRTdHJpbmcgd2l0aCB0aGUgY2xhc3MgdmFsdWUgZm91bmQgaW4gdGhlIFwiYmFzZVZhbFwiIHByb3BlcnR5LFxuICAgKiBpbnN0ZWFkIG9mIHNpbXBsZSBzdHJpbmcgbGlrZSB3aXRoIEhUTUwgRWxlbWVudHMuXG4gICAqXG4gICAqIEBwYXJhbSB7bWl4ZXN9IEFycmF5IG9mIG9yIHNpbmdsZSBET00gZWxlbWVudFxuICAgKiBAcGFyYW0ge29iamVjdH0gb3B0aW9uc1xuICAgKiBAcGFyYW0ge2Z1bmN0aW9ufSBjYWxsYmFja1xuICAgKiBAcmV0dXJuIHtvYmplY3R9IEluc3RhbmNlIG9mIFNWR0luamVjdG9yXG4gICAqL1xuICB2YXIgU1ZHSW5qZWN0b3IgPSBmdW5jdGlvbiAoZWxlbWVudHMsIG9wdGlvbnMsIGRvbmUpIHtcblxuICAgIC8vIE9wdGlvbnMgJiBkZWZhdWx0c1xuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgLy8gU2hvdWxkIHdlIHJ1biB0aGUgc2NyaXB0cyBibG9ja3MgZm91bmQgaW4gdGhlIFNWR1xuICAgIC8vICdhbHdheXMnIC0gUnVuIHRoZW0gZXZlcnkgdGltZVxuICAgIC8vICdvbmNlJyAtIE9ubHkgcnVuIHNjcmlwdHMgb25jZSBmb3IgZWFjaCBTVkdcbiAgICAvLyBbZmFsc2V8J25ldmVyJ10gLSBJZ25vcmUgc2NyaXB0c1xuICAgIHZhciBldmFsU2NyaXB0cyA9IG9wdGlvbnMuZXZhbFNjcmlwdHMgfHwgJ2Fsd2F5cyc7XG5cbiAgICAvLyBMb2NhdGlvbiBvZiBmYWxsYmFjayBwbmdzLCBpZiBkZXNpcmVkXG4gICAgdmFyIHBuZ0ZhbGxiYWNrID0gb3B0aW9ucy5wbmdGYWxsYmFjayB8fCBmYWxzZTtcblxuICAgIC8vIENhbGxiYWNrIHRvIHJ1biBkdXJpbmcgZWFjaCBTVkcgaW5qZWN0aW9uLCByZXR1cm5pbmcgdGhlIFNWRyBpbmplY3RlZFxuICAgIHZhciBlYWNoQ2FsbGJhY2sgPSBvcHRpb25zLmVhY2g7XG5cbiAgICAvLyBEbyB0aGUgaW5qZWN0aW9uLi4uXG4gICAgaWYgKGVsZW1lbnRzLmxlbmd0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB2YXIgZWxlbWVudHNMb2FkZWQgPSAwO1xuICAgICAgZm9yRWFjaC5jYWxsKGVsZW1lbnRzLCBmdW5jdGlvbiAoZWxlbWVudCkge1xuICAgICAgICBpbmplY3RFbGVtZW50KGVsZW1lbnQsIGV2YWxTY3JpcHRzLCBwbmdGYWxsYmFjaywgZnVuY3Rpb24gKHN2Zykge1xuICAgICAgICAgIGlmIChlYWNoQ2FsbGJhY2sgJiYgdHlwZW9mIGVhY2hDYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykgZWFjaENhbGxiYWNrKHN2Zyk7XG4gICAgICAgICAgaWYgKGRvbmUgJiYgZWxlbWVudHMubGVuZ3RoID09PSArK2VsZW1lbnRzTG9hZGVkKSBkb25lKGVsZW1lbnRzTG9hZGVkKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICBpZiAoZWxlbWVudHMpIHtcbiAgICAgICAgaW5qZWN0RWxlbWVudChlbGVtZW50cywgZXZhbFNjcmlwdHMsIHBuZ0ZhbGxiYWNrLCBmdW5jdGlvbiAoc3ZnKSB7XG4gICAgICAgICAgaWYgKGVhY2hDYWxsYmFjayAmJiB0eXBlb2YgZWFjaENhbGxiYWNrID09PSAnZnVuY3Rpb24nKSBlYWNoQ2FsbGJhY2soc3ZnKTtcbiAgICAgICAgICBpZiAoZG9uZSkgZG9uZSgxKTtcbiAgICAgICAgICBlbGVtZW50cyA9IG51bGw7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgZWxzZSB7XG4gICAgICAgIGlmIChkb25lKSBkb25lKDApO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICAvKiBnbG9iYWwgbW9kdWxlLCBleHBvcnRzOiB0cnVlLCBkZWZpbmUgKi9cbiAgLy8gTm9kZS5qcyBvciBDb21tb25KU1xuICBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG1vZHVsZS5leHBvcnRzID09PSAnb2JqZWN0Jykge1xuICAgIG1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IFNWR0luamVjdG9yO1xuICB9XG4gIC8vIEFNRCBzdXBwb3J0XG4gIGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkge1xuICAgIGRlZmluZShmdW5jdGlvbiAoKSB7XG4gICAgICByZXR1cm4gU1ZHSW5qZWN0b3I7XG4gICAgfSk7XG4gIH1cbiAgLy8gT3RoZXJ3aXNlLCBhdHRhY2ggdG8gd2luZG93IGFzIGdsb2JhbFxuICBlbHNlIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0Jykge1xuICAgIHdpbmRvdy5TVkdJbmplY3RvciA9IFNWR0luamVjdG9yO1xuICB9XG4gIC8qIGdsb2JhbCAtbW9kdWxlLCAtZXhwb3J0cywgLWRlZmluZSAqL1xuXG59KHdpbmRvdywgZG9jdW1lbnQpKTtcbiIsInZhciBhdXRvU2Nyb2xsID0gKGZ1bmN0aW9uICgpIHtcbid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gZ2V0RGVmKGYsIGQpIHtcbiAgICBpZiAodHlwZW9mIGYgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2YgZCA9PT0gJ3VuZGVmaW5lZCcgPyBmIDogZDtcbiAgICB9XG5cbiAgICByZXR1cm4gZjtcbn1cbmZ1bmN0aW9uIGJvb2xlYW4oZnVuYywgZGVmKSB7XG5cbiAgICBmdW5jID0gZ2V0RGVmKGZ1bmMsIGRlZik7XG5cbiAgICBpZiAodHlwZW9mIGZ1bmMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIGYoKSB7XG4gICAgICAgICAgICB2YXIgYXJndW1lbnRzJDEgPSBhcmd1bWVudHM7XG5cbiAgICAgICAgICAgIGZvciAodmFyIF9sZW4gPSBhcmd1bWVudHMubGVuZ3RoLCBhcmdzID0gQXJyYXkoX2xlbiksIF9rZXkgPSAwOyBfa2V5IDwgX2xlbjsgX2tleSsrKSB7XG4gICAgICAgICAgICAgICAgYXJnc1tfa2V5XSA9IGFyZ3VtZW50cyQxW19rZXldO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gISFmdW5jLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIHJldHVybiAhIWZ1bmMgPyBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH0gOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9O1xufVxuXG52YXIgcHJlZml4ID0gWyd3ZWJraXQnLCAnbW96JywgJ21zJywgJ28nXTtcblxudmFyIHJlcXVlc3RBbmltYXRpb25GcmFtZSA9IGZ1bmN0aW9uICgpIHtcblxuICBmb3IgKHZhciBpID0gMCwgbGltaXQgPSBwcmVmaXgubGVuZ3RoOyBpIDwgbGltaXQgJiYgIXdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWU7ICsraSkge1xuICAgIHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUgPSB3aW5kb3dbcHJlZml4W2ldICsgJ1JlcXVlc3RBbmltYXRpb25GcmFtZSddO1xuICB9XG5cbiAgaWYgKCF3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKSB7XG4gICAgKGZ1bmN0aW9uICgpIHtcbiAgICAgIHZhciBsYXN0VGltZSA9IDA7XG5cbiAgICAgIHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUgPSBmdW5jdGlvbiAoY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIG5vdyA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICAgICAgICB2YXIgdHRjID0gTWF0aC5tYXgoMCwgMTYgLSBub3cgLSBsYXN0VGltZSk7XG4gICAgICAgIHZhciB0aW1lciA9IHdpbmRvdy5zZXRUaW1lb3V0KGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICByZXR1cm4gY2FsbGJhY2sobm93ICsgdHRjKTtcbiAgICAgICAgfSwgdHRjKTtcblxuICAgICAgICBsYXN0VGltZSA9IG5vdyArIHR0YztcblxuICAgICAgICByZXR1cm4gdGltZXI7XG4gICAgICB9O1xuICAgIH0pKCk7XG4gIH1cblxuICByZXR1cm4gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZS5iaW5kKHdpbmRvdyk7XG59KCk7XG5cbnZhciBjYW5jZWxBbmltYXRpb25GcmFtZSA9IGZ1bmN0aW9uICgpIHtcblxuICBmb3IgKHZhciBpID0gMCwgbGltaXQgPSBwcmVmaXgubGVuZ3RoOyBpIDwgbGltaXQgJiYgIXdpbmRvdy5jYW5jZWxBbmltYXRpb25GcmFtZTsgKytpKSB7XG4gICAgd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lID0gd2luZG93W3ByZWZpeFtpXSArICdDYW5jZWxBbmltYXRpb25GcmFtZSddIHx8IHdpbmRvd1twcmVmaXhbaV0gKyAnQ2FuY2VsUmVxdWVzdEFuaW1hdGlvbkZyYW1lJ107XG4gIH1cblxuICBpZiAoIXdpbmRvdy5jYW5jZWxBbmltYXRpb25GcmFtZSkge1xuICAgIHdpbmRvdy5jYW5jZWxBbmltYXRpb25GcmFtZSA9IGZ1bmN0aW9uICh0aW1lcikge1xuICAgICAgd2luZG93LmNsZWFyVGltZW91dCh0aW1lcik7XG4gICAgfTtcbiAgfVxuXG4gIHJldHVybiB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUuYmluZCh3aW5kb3cpO1xufSgpO1xuXG52YXIgX3R5cGVvZiA9IHR5cGVvZiBTeW1ib2wgPT09IFwiZnVuY3Rpb25cIiAmJiB0eXBlb2YgU3ltYm9sLml0ZXJhdG9yID09PSBcInN5bWJvbFwiID8gZnVuY3Rpb24gKG9iaikgeyByZXR1cm4gdHlwZW9mIG9iajsgfSA6IGZ1bmN0aW9uIChvYmopIHsgcmV0dXJuIG9iaiAmJiB0eXBlb2YgU3ltYm9sID09PSBcImZ1bmN0aW9uXCIgJiYgb2JqLmNvbnN0cnVjdG9yID09PSBTeW1ib2wgPyBcInN5bWJvbFwiIDogdHlwZW9mIG9iajsgfTtcblxuLyoqXG4gKiBSZXR1cm5zIGB0cnVlYCBpZiBwcm92aWRlZCBpbnB1dCBpcyBFbGVtZW50LlxuICogQG5hbWUgaXNFbGVtZW50XG4gKiBAcGFyYW0geyp9IFtpbnB1dF1cbiAqIEByZXR1cm5zIHtib29sZWFufVxuICovXG52YXIgaXNFbGVtZW50ID0gZnVuY3Rpb24gKGlucHV0KSB7XG4gIHJldHVybiBpbnB1dCAhPSBudWxsICYmICh0eXBlb2YgaW5wdXQgPT09ICd1bmRlZmluZWQnID8gJ3VuZGVmaW5lZCcgOiBfdHlwZW9mKGlucHV0KSkgPT09ICdvYmplY3QnICYmIGlucHV0Lm5vZGVUeXBlID09PSAxICYmIF90eXBlb2YoaW5wdXQuc3R5bGUpID09PSAnb2JqZWN0JyAmJiBfdHlwZW9mKGlucHV0Lm93bmVyRG9jdW1lbnQpID09PSAnb2JqZWN0Jztcbn07XG5cbi8vIFByb2R1Y3Rpb24gc3RlcHMgb2YgRUNNQS0yNjIsIEVkaXRpb24gNiwgMjIuMS4yLjFcbi8vIFJlZmVyZW5jZTogaHR0cDovL3d3dy5lY21hLWludGVybmF0aW9uYWwub3JnL2VjbWEtMjYyLzYuMC8jc2VjLWFycmF5LmZyb21cblxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxuZnVuY3Rpb24gaW5kZXhPZkVsZW1lbnQoZWxlbWVudHMsIGVsZW1lbnQpIHtcbiAgICBlbGVtZW50ID0gcmVzb2x2ZUVsZW1lbnQoZWxlbWVudCwgdHJ1ZSk7XG4gICAgaWYgKCFpc0VsZW1lbnQoZWxlbWVudCkpIHsgcmV0dXJuIC0xOyB9XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBlbGVtZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoZWxlbWVudHNbaV0gPT09IGVsZW1lbnQpIHtcbiAgICAgICAgICAgIHJldHVybiBpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiAtMTtcbn1cblxuZnVuY3Rpb24gaGFzRWxlbWVudChlbGVtZW50cywgZWxlbWVudCkge1xuICAgIHJldHVybiAtMSAhPT0gaW5kZXhPZkVsZW1lbnQoZWxlbWVudHMsIGVsZW1lbnQpO1xufVxuXG5mdW5jdGlvbiBwdXNoRWxlbWVudHMoZWxlbWVudHMsIHRvQWRkKSB7XG5cbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRvQWRkLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGlmICghaGFzRWxlbWVudChlbGVtZW50cywgdG9BZGRbaV0pKSB7IGVsZW1lbnRzLnB1c2godG9BZGRbaV0pOyB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRvQWRkO1xufVxuXG5mdW5jdGlvbiBhZGRFbGVtZW50cyhlbGVtZW50cykge1xuICAgIHZhciBhcmd1bWVudHMkMSA9IGFyZ3VtZW50cztcblxuICAgIGZvciAodmFyIF9sZW4yID0gYXJndW1lbnRzLmxlbmd0aCwgdG9BZGQgPSBBcnJheShfbGVuMiA+IDEgPyBfbGVuMiAtIDEgOiAwKSwgX2tleTIgPSAxOyBfa2V5MiA8IF9sZW4yOyBfa2V5MisrKSB7XG4gICAgICAgIHRvQWRkW19rZXkyIC0gMV0gPSBhcmd1bWVudHMkMVtfa2V5Ml07XG4gICAgfVxuXG4gICAgdG9BZGQgPSB0b0FkZC5tYXAocmVzb2x2ZUVsZW1lbnQpO1xuICAgIHJldHVybiBwdXNoRWxlbWVudHMoZWxlbWVudHMsIHRvQWRkKTtcbn1cblxuZnVuY3Rpb24gcmVtb3ZlRWxlbWVudHMoZWxlbWVudHMpIHtcbiAgICB2YXIgYXJndW1lbnRzJDEgPSBhcmd1bWVudHM7XG5cbiAgICBmb3IgKHZhciBfbGVuMyA9IGFyZ3VtZW50cy5sZW5ndGgsIHRvUmVtb3ZlID0gQXJyYXkoX2xlbjMgPiAxID8gX2xlbjMgLSAxIDogMCksIF9rZXkzID0gMTsgX2tleTMgPCBfbGVuMzsgX2tleTMrKykge1xuICAgICAgICB0b1JlbW92ZVtfa2V5MyAtIDFdID0gYXJndW1lbnRzJDFbX2tleTNdO1xuICAgIH1cblxuICAgIHJldHVybiB0b1JlbW92ZS5tYXAocmVzb2x2ZUVsZW1lbnQpLnJlZHVjZShmdW5jdGlvbiAobGFzdCwgZSkge1xuXG4gICAgICAgIHZhciBpbmRleCQkMSA9IGluZGV4T2ZFbGVtZW50KGVsZW1lbnRzLCBlKTtcblxuICAgICAgICBpZiAoaW5kZXgkJDEgIT09IC0xKSB7IHJldHVybiBsYXN0LmNvbmNhdChlbGVtZW50cy5zcGxpY2UoaW5kZXgkJDEsIDEpKTsgfVxuICAgICAgICByZXR1cm4gbGFzdDtcbiAgICB9LCBbXSk7XG59XG5cbmZ1bmN0aW9uIHJlc29sdmVFbGVtZW50KGVsZW1lbnQsIG5vVGhyb3cpIHtcbiAgICBpZiAodHlwZW9mIGVsZW1lbnQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICByZXR1cm4gZG9jdW1lbnQucXVlcnlTZWxlY3RvcihlbGVtZW50KTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGlmICghaXNFbGVtZW50KGVsZW1lbnQpICYmICFub1Rocm93KSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoZWxlbWVudCArICcgaXMgbm90IGEgRE9NIGVsZW1lbnQuJyk7XG4gICAgfVxuICAgIHJldHVybiBlbGVtZW50O1xufVxuXG52YXIgaW5kZXgkMiA9IGZ1bmN0aW9uIGNyZWF0ZVBvaW50Q0Iob2JqZWN0LCBvcHRpb25zKXtcblxuICAgIC8vIEEgcGVyc2lzdGVudCBvYmplY3QgKGFzIG9wcG9zZWQgdG8gcmV0dXJuZWQgb2JqZWN0KSBpcyB1c2VkIHRvIHNhdmUgbWVtb3J5XG4gICAgLy8gVGhpcyBpcyBnb29kIHRvIHByZXZlbnQgbGF5b3V0IHRocmFzaGluZywgb3IgZm9yIGdhbWVzLCBhbmQgc3VjaFxuXG4gICAgLy8gTk9URVxuICAgIC8vIFRoaXMgdXNlcyBJRSBmaXhlcyB3aGljaCBzaG91bGQgYmUgT0sgdG8gcmVtb3ZlIHNvbWUgZGF5LiA6KVxuICAgIC8vIFNvbWUgc3BlZWQgd2lsbCBiZSBnYWluZWQgYnkgcmVtb3ZhbCBvZiB0aGVzZS5cblxuICAgIC8vIHBvaW50Q0Igc2hvdWxkIGJlIHNhdmVkIGluIGEgdmFyaWFibGUgb24gcmV0dXJuXG4gICAgLy8gVGhpcyBhbGxvd3MgdGhlIHVzYWdlIG9mIGVsZW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lclxuXG4gICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgICB2YXIgYWxsb3dVcGRhdGU7XG5cbiAgICBpZih0eXBlb2Ygb3B0aW9ucy5hbGxvd1VwZGF0ZSA9PT0gJ2Z1bmN0aW9uJyl7XG4gICAgICAgIGFsbG93VXBkYXRlID0gb3B0aW9ucy5hbGxvd1VwZGF0ZTtcbiAgICB9ZWxzZXtcbiAgICAgICAgYWxsb3dVcGRhdGUgPSBmdW5jdGlvbigpe3JldHVybiB0cnVlO307XG4gICAgfVxuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIHBvaW50Q0IoZXZlbnQpe1xuXG4gICAgICAgIGV2ZW50ID0gZXZlbnQgfHwgd2luZG93LmV2ZW50OyAvLyBJRS1pc21cbiAgICAgICAgb2JqZWN0LnRhcmdldCA9IGV2ZW50LnRhcmdldCB8fCBldmVudC5zcmNFbGVtZW50IHx8IGV2ZW50Lm9yaWdpbmFsVGFyZ2V0O1xuICAgICAgICBvYmplY3QuZWxlbWVudCA9IHRoaXM7XG4gICAgICAgIG9iamVjdC50eXBlID0gZXZlbnQudHlwZTtcblxuICAgICAgICBpZighYWxsb3dVcGRhdGUoZXZlbnQpKXtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFN1cHBvcnQgdG91Y2hcbiAgICAgICAgLy8gaHR0cDovL3d3dy5jcmVhdGl2ZWJsb3EuY29tL2phdmFzY3JpcHQvbWFrZS15b3VyLXNpdGUtd29yay10b3VjaC1kZXZpY2VzLTUxNDExNjQ0XG5cbiAgICAgICAgaWYoZXZlbnQudGFyZ2V0VG91Y2hlcyl7XG4gICAgICAgICAgICBvYmplY3QueCA9IGV2ZW50LnRhcmdldFRvdWNoZXNbMF0uY2xpZW50WDtcbiAgICAgICAgICAgIG9iamVjdC55ID0gZXZlbnQudGFyZ2V0VG91Y2hlc1swXS5jbGllbnRZO1xuICAgICAgICAgICAgb2JqZWN0LnBhZ2VYID0gZXZlbnQucGFnZVg7XG4gICAgICAgICAgICBvYmplY3QucGFnZVkgPSBldmVudC5wYWdlWTtcbiAgICAgICAgfWVsc2V7XG5cbiAgICAgICAgICAgIC8vIElmIHBhZ2VYL1kgYXJlbid0IGF2YWlsYWJsZSBhbmQgY2xpZW50WC9ZIGFyZSxcbiAgICAgICAgICAgIC8vIGNhbGN1bGF0ZSBwYWdlWC9ZIC0gbG9naWMgdGFrZW4gZnJvbSBqUXVlcnkuXG4gICAgICAgICAgICAvLyAoVGhpcyBpcyB0byBzdXBwb3J0IG9sZCBJRSlcbiAgICAgICAgICAgIC8vIE5PVEUgSG9wZWZ1bGx5IHRoaXMgY2FuIGJlIHJlbW92ZWQgc29vbi5cblxuICAgICAgICAgICAgaWYgKGV2ZW50LnBhZ2VYID09PSBudWxsICYmIGV2ZW50LmNsaWVudFggIT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICB2YXIgZXZlbnREb2MgPSAoZXZlbnQudGFyZ2V0ICYmIGV2ZW50LnRhcmdldC5vd25lckRvY3VtZW50KSB8fCBkb2N1bWVudDtcbiAgICAgICAgICAgICAgICB2YXIgZG9jID0gZXZlbnREb2MuZG9jdW1lbnRFbGVtZW50O1xuICAgICAgICAgICAgICAgIHZhciBib2R5ID0gZXZlbnREb2MuYm9keTtcblxuICAgICAgICAgICAgICAgIG9iamVjdC5wYWdlWCA9IGV2ZW50LmNsaWVudFggK1xuICAgICAgICAgICAgICAgICAgKGRvYyAmJiBkb2Muc2Nyb2xsTGVmdCB8fCBib2R5ICYmIGJvZHkuc2Nyb2xsTGVmdCB8fCAwKSAtXG4gICAgICAgICAgICAgICAgICAoZG9jICYmIGRvYy5jbGllbnRMZWZ0IHx8IGJvZHkgJiYgYm9keS5jbGllbnRMZWZ0IHx8IDApO1xuICAgICAgICAgICAgICAgIG9iamVjdC5wYWdlWSA9IGV2ZW50LmNsaWVudFkgK1xuICAgICAgICAgICAgICAgICAgKGRvYyAmJiBkb2Muc2Nyb2xsVG9wICB8fCBib2R5ICYmIGJvZHkuc2Nyb2xsVG9wICB8fCAwKSAtXG4gICAgICAgICAgICAgICAgICAoZG9jICYmIGRvYy5jbGllbnRUb3AgIHx8IGJvZHkgJiYgYm9keS5jbGllbnRUb3AgIHx8IDAgKTtcbiAgICAgICAgICAgIH1lbHNle1xuICAgICAgICAgICAgICAgIG9iamVjdC5wYWdlWCA9IGV2ZW50LnBhZ2VYO1xuICAgICAgICAgICAgICAgIG9iamVjdC5wYWdlWSA9IGV2ZW50LnBhZ2VZO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBwYWdlWCwgYW5kIHBhZ2VZIGNoYW5nZSB3aXRoIHBhZ2Ugc2Nyb2xsXG4gICAgICAgICAgICAvLyBzbyB3ZSdyZSBub3QgZ29pbmcgdG8gdXNlIHRob3NlIGZvciB4LCBhbmQgeS5cbiAgICAgICAgICAgIC8vIE5PVEUgTW9zdCBicm93c2VycyBhbHNvIGFsaWFzIGNsaWVudFgvWSB3aXRoIHgveVxuICAgICAgICAgICAgLy8gc28gdGhhdCdzIHNvbWV0aGluZyB0byBjb25zaWRlciBkb3duIHRoZSByb2FkLlxuXG4gICAgICAgICAgICBvYmplY3QueCA9IGV2ZW50LmNsaWVudFg7XG4gICAgICAgICAgICBvYmplY3QueSA9IGV2ZW50LmNsaWVudFk7XG4gICAgICAgIH1cblxuICAgIH07XG5cbiAgICAvL05PVEUgUmVtZW1iZXIgYWNjZXNzaWJpbGl0eSwgQXJpYSByb2xlcywgYW5kIGxhYmVscy5cbn07XG5cbmZ1bmN0aW9uIGNyZWF0ZVdpbmRvd1JlY3QoKSB7XG4gICAgdmFyIHByb3BzID0ge1xuICAgICAgICB0b3A6IHsgdmFsdWU6IDAsIGVudW1lcmFibGU6IHRydWUgfSxcbiAgICAgICAgbGVmdDogeyB2YWx1ZTogMCwgZW51bWVyYWJsZTogdHJ1ZSB9LFxuICAgICAgICByaWdodDogeyB2YWx1ZTogd2luZG93LmlubmVyV2lkdGgsIGVudW1lcmFibGU6IHRydWUgfSxcbiAgICAgICAgYm90dG9tOiB7IHZhbHVlOiB3aW5kb3cuaW5uZXJIZWlnaHQsIGVudW1lcmFibGU6IHRydWUgfSxcbiAgICAgICAgd2lkdGg6IHsgdmFsdWU6IHdpbmRvdy5pbm5lcldpZHRoLCBlbnVtZXJhYmxlOiB0cnVlIH0sXG4gICAgICAgIGhlaWdodDogeyB2YWx1ZTogd2luZG93LmlubmVySGVpZ2h0LCBlbnVtZXJhYmxlOiB0cnVlIH0sXG4gICAgICAgIHg6IHsgdmFsdWU6IDAsIGVudW1lcmFibGU6IHRydWUgfSxcbiAgICAgICAgeTogeyB2YWx1ZTogMCwgZW51bWVyYWJsZTogdHJ1ZSB9XG4gICAgfTtcblxuICAgIGlmIChPYmplY3QuY3JlYXRlKSB7XG4gICAgICAgIHJldHVybiBPYmplY3QuY3JlYXRlKHt9LCBwcm9wcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIHJlY3QgPSB7fTtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMocmVjdCwgcHJvcHMpO1xuICAgICAgICByZXR1cm4gcmVjdDtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGdldENsaWVudFJlY3QoZWwpIHtcbiAgICBpZiAoZWwgPT09IHdpbmRvdykge1xuICAgICAgICByZXR1cm4gY3JlYXRlV2luZG93UmVjdCgpO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB2YXIgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICAgICAgaWYgKHJlY3QueCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgcmVjdC54ID0gcmVjdC5sZWZ0O1xuICAgICAgICAgICAgICAgIHJlY3QueSA9IHJlY3QudG9wO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHJlY3Q7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXCJDYW4ndCBjYWxsIGdldEJvdW5kaW5nQ2xpZW50UmVjdCBvbiBcIiArIGVsKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuZnVuY3Rpb24gcG9pbnRJbnNpZGUocG9pbnQsIGVsKSB7XG4gICAgdmFyIHJlY3QgPSBnZXRDbGllbnRSZWN0KGVsKTtcbiAgICByZXR1cm4gcG9pbnQueSA+IHJlY3QudG9wICYmIHBvaW50LnkgPCByZWN0LmJvdHRvbSAmJiBwb2ludC54ID4gcmVjdC5sZWZ0ICYmIHBvaW50LnggPCByZWN0LnJpZ2h0O1xufVxuXG52YXIgb2JqZWN0Q3JlYXRlID0gdm9pZCAwO1xuaWYgKHR5cGVvZiBPYmplY3QuY3JlYXRlICE9ICdmdW5jdGlvbicpIHtcbiAgb2JqZWN0Q3JlYXRlID0gZnVuY3Rpb24gKHVuZGVmaW5lZCkge1xuICAgIHZhciBUZW1wID0gZnVuY3Rpb24gVGVtcCgpIHt9O1xuICAgIHJldHVybiBmdW5jdGlvbiAocHJvdG90eXBlLCBwcm9wZXJ0aWVzT2JqZWN0KSB7XG4gICAgICBpZiAocHJvdG90eXBlICE9PSBPYmplY3QocHJvdG90eXBlKSAmJiBwcm90b3R5cGUgIT09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGFuIG9iamVjdCwgb3IgbnVsbCcpO1xuICAgICAgfVxuICAgICAgVGVtcC5wcm90b3R5cGUgPSBwcm90b3R5cGUgfHwge307XG4gICAgICB2YXIgcmVzdWx0ID0gbmV3IFRlbXAoKTtcbiAgICAgIFRlbXAucHJvdG90eXBlID0gbnVsbDtcbiAgICAgIGlmIChwcm9wZXJ0aWVzT2JqZWN0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXMocmVzdWx0LCBwcm9wZXJ0aWVzT2JqZWN0KTtcbiAgICAgIH1cblxuICAgICAgLy8gdG8gaW1pdGF0ZSB0aGUgY2FzZSBvZiBPYmplY3QuY3JlYXRlKG51bGwpXG4gICAgICBpZiAocHJvdG90eXBlID09PSBudWxsKSB7XG4gICAgICAgIHJlc3VsdC5fX3Byb3RvX18gPSBudWxsO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuICB9KCk7XG59IGVsc2Uge1xuICBvYmplY3RDcmVhdGUgPSBPYmplY3QuY3JlYXRlO1xufVxuXG52YXIgb2JqZWN0Q3JlYXRlJDEgPSBvYmplY3RDcmVhdGU7XG5cbnZhciBtb3VzZUV2ZW50UHJvcHMgPSBbJ2FsdEtleScsICdidXR0b24nLCAnYnV0dG9ucycsICdjbGllbnRYJywgJ2NsaWVudFknLCAnY3RybEtleScsICdtZXRhS2V5JywgJ21vdmVtZW50WCcsICdtb3ZlbWVudFknLCAnb2Zmc2V0WCcsICdvZmZzZXRZJywgJ3BhZ2VYJywgJ3BhZ2VZJywgJ3JlZ2lvbicsICdyZWxhdGVkVGFyZ2V0JywgJ3NjcmVlblgnLCAnc2NyZWVuWScsICdzaGlmdEtleScsICd3aGljaCcsICd4JywgJ3knXTtcblxuZnVuY3Rpb24gY3JlYXRlRGlzcGF0Y2hlcihlbGVtZW50KSB7XG5cbiAgICB2YXIgZGVmYXVsdFNldHRpbmdzID0ge1xuICAgICAgICBzY3JlZW5YOiAwLFxuICAgICAgICBzY3JlZW5ZOiAwLFxuICAgICAgICBjbGllbnRYOiAwLFxuICAgICAgICBjbGllbnRZOiAwLFxuICAgICAgICBjdHJsS2V5OiBmYWxzZSxcbiAgICAgICAgc2hpZnRLZXk6IGZhbHNlLFxuICAgICAgICBhbHRLZXk6IGZhbHNlLFxuICAgICAgICBtZXRhS2V5OiBmYWxzZSxcbiAgICAgICAgYnV0dG9uOiAwLFxuICAgICAgICBidXR0b25zOiAxLFxuICAgICAgICByZWxhdGVkVGFyZ2V0OiBudWxsLFxuICAgICAgICByZWdpb246IG51bGxcbiAgICB9O1xuXG4gICAgaWYgKGVsZW1lbnQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIG9uTW92ZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gb25Nb3ZlKGUpIHtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtb3VzZUV2ZW50UHJvcHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGRlZmF1bHRTZXR0aW5nc1ttb3VzZUV2ZW50UHJvcHNbaV1dID0gZVttb3VzZUV2ZW50UHJvcHNbaV1dO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgdmFyIGRpc3BhdGNoID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBpZiAoTW91c2VFdmVudCkge1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIG0xKGVsZW1lbnQsIGluaXRNb3ZlLCBkYXRhKSB7XG4gICAgICAgICAgICAgICAgdmFyIGV2dCA9IG5ldyBNb3VzZUV2ZW50KCdtb3VzZW1vdmUnLCBjcmVhdGVNb3ZlSW5pdChkZWZhdWx0U2V0dGluZ3MsIGluaXRNb3ZlKSk7XG5cbiAgICAgICAgICAgICAgICAvL2V2dC5kaXNwYXRjaGVkID0gJ21vdXNlbW92ZSc7XG4gICAgICAgICAgICAgICAgc2V0U3BlY2lhbChldnQsIGRhdGEpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQuZGlzcGF0Y2hFdmVudChldnQpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZG9jdW1lbnQuY3JlYXRlRXZlbnQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiBtMihlbGVtZW50LCBpbml0TW92ZSwgZGF0YSkge1xuICAgICAgICAgICAgICAgIHZhciBzZXR0aW5ncyA9IGNyZWF0ZU1vdmVJbml0KGRlZmF1bHRTZXR0aW5ncywgaW5pdE1vdmUpO1xuICAgICAgICAgICAgICAgIHZhciBldnQgPSBkb2N1bWVudC5jcmVhdGVFdmVudCgnTW91c2VFdmVudHMnKTtcblxuICAgICAgICAgICAgICAgIGV2dC5pbml0TW91c2VFdmVudChcIm1vdXNlbW92ZVwiLCB0cnVlLCAvL2NhbiBidWJibGVcbiAgICAgICAgICAgICAgICB0cnVlLCAvL2NhbmNlbGFibGVcbiAgICAgICAgICAgICAgICB3aW5kb3csIC8vdmlld1xuICAgICAgICAgICAgICAgIDAsIC8vZGV0YWlsXG4gICAgICAgICAgICAgICAgc2V0dGluZ3Muc2NyZWVuWCwgLy8wLCAvL3NjcmVlblhcbiAgICAgICAgICAgICAgICBzZXR0aW5ncy5zY3JlZW5ZLCAvLzAsIC8vc2NyZWVuWVxuICAgICAgICAgICAgICAgIHNldHRpbmdzLmNsaWVudFgsIC8vODAsIC8vY2xpZW50WFxuICAgICAgICAgICAgICAgIHNldHRpbmdzLmNsaWVudFksIC8vMjAsIC8vY2xpZW50WVxuICAgICAgICAgICAgICAgIHNldHRpbmdzLmN0cmxLZXksIC8vZmFsc2UsIC8vY3RybEtleVxuICAgICAgICAgICAgICAgIHNldHRpbmdzLmFsdEtleSwgLy9mYWxzZSwgLy9hbHRLZXlcbiAgICAgICAgICAgICAgICBzZXR0aW5ncy5zaGlmdEtleSwgLy9mYWxzZSwgLy9zaGlmdEtleVxuICAgICAgICAgICAgICAgIHNldHRpbmdzLm1ldGFLZXksIC8vZmFsc2UsIC8vbWV0YUtleVxuICAgICAgICAgICAgICAgIHNldHRpbmdzLmJ1dHRvbiwgLy8wLCAvL2J1dHRvblxuICAgICAgICAgICAgICAgIHNldHRpbmdzLnJlbGF0ZWRUYXJnZXQgLy9udWxsIC8vcmVsYXRlZFRhcmdldFxuICAgICAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgICAgICAvL2V2dC5kaXNwYXRjaGVkID0gJ21vdXNlbW92ZSc7XG4gICAgICAgICAgICAgICAgc2V0U3BlY2lhbChldnQsIGRhdGEpO1xuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQuZGlzcGF0Y2hFdmVudChldnQpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZG9jdW1lbnQuY3JlYXRlRXZlbnRPYmplY3QgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiBtMyhlbGVtZW50LCBpbml0TW92ZSwgZGF0YSkge1xuICAgICAgICAgICAgICAgIHZhciBldnQgPSBkb2N1bWVudC5jcmVhdGVFdmVudE9iamVjdCgpO1xuICAgICAgICAgICAgICAgIHZhciBzZXR0aW5ncyA9IGNyZWF0ZU1vdmVJbml0KGRlZmF1bHRTZXR0aW5ncywgaW5pdE1vdmUpO1xuICAgICAgICAgICAgICAgIGZvciAodmFyIG5hbWUgaW4gc2V0dGluZ3MpIHtcbiAgICAgICAgICAgICAgICAgICAgZXZ0W25hbWVdID0gc2V0dGluZ3NbbmFtZV07XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgLy9ldnQuZGlzcGF0Y2hlZCA9ICdtb3VzZW1vdmUnO1xuICAgICAgICAgICAgICAgIHNldFNwZWNpYWwoZXZ0LCBkYXRhKTtcblxuICAgICAgICAgICAgICAgIHJldHVybiBlbGVtZW50LmRpc3BhdGNoRXZlbnQoZXZ0KTtcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICB9KCk7XG5cbiAgICBmdW5jdGlvbiBkZXN0cm95KCkge1xuICAgICAgICBpZiAoZWxlbWVudCkgeyBlbGVtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIG9uTW92ZSwgZmFsc2UpOyB9XG4gICAgICAgIGRlZmF1bHRTZXR0aW5ncyA9IG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgZGVzdHJveTogZGVzdHJveSxcbiAgICAgICAgZGlzcGF0Y2g6IGRpc3BhdGNoXG4gICAgfTtcbn1cblxuZnVuY3Rpb24gY3JlYXRlTW92ZUluaXQoZGVmYXVsdFNldHRpbmdzLCBpbml0TW92ZSkge1xuICAgIGluaXRNb3ZlID0gaW5pdE1vdmUgfHwge307XG4gICAgdmFyIHNldHRpbmdzID0gb2JqZWN0Q3JlYXRlJDEoZGVmYXVsdFNldHRpbmdzKTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IG1vdXNlRXZlbnRQcm9wcy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoaW5pdE1vdmVbbW91c2VFdmVudFByb3BzW2ldXSAhPT0gdW5kZWZpbmVkKSB7IHNldHRpbmdzW21vdXNlRXZlbnRQcm9wc1tpXV0gPSBpbml0TW92ZVttb3VzZUV2ZW50UHJvcHNbaV1dOyB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHNldHRpbmdzO1xufVxuXG5mdW5jdGlvbiBzZXRTcGVjaWFsKGUsIGRhdGEpIHtcbiAgICBjb25zb2xlLmxvZygnZGF0YSAnLCBkYXRhKTtcbiAgICBlLmRhdGEgPSBkYXRhIHx8IHt9O1xuICAgIGUuZGlzcGF0Y2hlZCA9ICdtb3VzZW1vdmUnO1xufVxuXG5mdW5jdGlvbiBBdXRvU2Nyb2xsZXIoZWxlbWVudHMsIG9wdGlvbnMpe1xuICAgIGlmICggb3B0aW9ucyA9PT0gdm9pZCAwICkgb3B0aW9ucyA9IHt9O1xuXG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBtYXhTcGVlZCA9IDQsIHNjcm9sbGluZyA9IGZhbHNlO1xuXG4gICAgdGhpcy5tYXJnaW4gPSBvcHRpb25zLm1hcmdpbiB8fCAtMTtcbiAgICAvL3RoaXMuc2Nyb2xsaW5nID0gZmFsc2U7XG4gICAgdGhpcy5zY3JvbGxXaGVuT3V0c2lkZSA9IG9wdGlvbnMuc2Nyb2xsV2hlbk91dHNpZGUgfHwgZmFsc2U7XG5cbiAgICB2YXIgcG9pbnQgPSB7fSxcbiAgICAgICAgcG9pbnRDQiA9IGluZGV4JDIocG9pbnQpLFxuICAgICAgICBkaXNwYXRjaGVyID0gY3JlYXRlRGlzcGF0Y2hlcigpLFxuICAgICAgICBkb3duID0gZmFsc2U7XG5cbiAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgcG9pbnRDQiwgZmFsc2UpO1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCd0b3VjaG1vdmUnLCBwb2ludENCLCBmYWxzZSk7XG5cbiAgICBpZighaXNOYU4ob3B0aW9ucy5tYXhTcGVlZCkpe1xuICAgICAgICBtYXhTcGVlZCA9IG9wdGlvbnMubWF4U3BlZWQ7XG4gICAgfVxuXG4gICAgdGhpcy5hdXRvU2Nyb2xsID0gYm9vbGVhbihvcHRpb25zLmF1dG9TY3JvbGwpO1xuICAgIHRoaXMuc3luY01vdmUgPSBib29sZWFuKG9wdGlvbnMuc3luY01vdmUsIGZhbHNlKTtcblxuICAgIHRoaXMuZGVzdHJveSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgcG9pbnRDQiwgZmFsc2UpO1xuICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcigndG91Y2htb3ZlJywgcG9pbnRDQiwgZmFsc2UpO1xuICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgb25Eb3duLCBmYWxzZSk7XG4gICAgICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCd0b3VjaHN0YXJ0Jywgb25Eb3duLCBmYWxzZSk7XG4gICAgICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgb25VcCwgZmFsc2UpO1xuICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcigndG91Y2hlbmQnLCBvblVwLCBmYWxzZSk7XG5cbiAgICAgICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIG9uTW92ZSwgZmFsc2UpO1xuICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcigndG91Y2htb3ZlJywgb25Nb3ZlLCBmYWxzZSk7XG5cbiAgICAgICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIHNldFNjcm9sbCwgdHJ1ZSk7XG4gICAgICAgIGVsZW1lbnRzID0gW107XG4gICAgfTtcblxuICAgIHRoaXMuYWRkID0gZnVuY3Rpb24oKXtcbiAgICAgICAgdmFyIGVsZW1lbnQgPSBbXSwgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICAgICAgd2hpbGUgKCBsZW4tLSApIGVsZW1lbnRbIGxlbiBdID0gYXJndW1lbnRzWyBsZW4gXTtcblxuICAgICAgICBhZGRFbGVtZW50cy5hcHBseSh2b2lkIDAsIFsgZWxlbWVudHMgXS5jb25jYXQoIGVsZW1lbnQgKSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH07XG5cbiAgICB0aGlzLnJlbW92ZSA9IGZ1bmN0aW9uKCl7XG4gICAgICAgIHZhciBlbGVtZW50ID0gW10sIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgICAgIHdoaWxlICggbGVuLS0gKSBlbGVtZW50WyBsZW4gXSA9IGFyZ3VtZW50c1sgbGVuIF07XG5cbiAgICAgICAgcmV0dXJuIHJlbW92ZUVsZW1lbnRzLmFwcGx5KHZvaWQgMCwgWyBlbGVtZW50cyBdLmNvbmNhdCggZWxlbWVudCApKTtcbiAgICB9O1xuXG4gICAgdmFyIGhhc1dpbmRvdyA9IG51bGwsIHdpbmRvd0FuaW1hdGlvbkZyYW1lO1xuXG4gICAgaWYoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGVsZW1lbnRzKSAhPT0gJ1tvYmplY3QgQXJyYXldJyl7XG4gICAgICAgIGVsZW1lbnRzID0gW2VsZW1lbnRzXTtcbiAgICB9XG5cbiAgICAoZnVuY3Rpb24odGVtcCl7XG4gICAgICAgIGVsZW1lbnRzID0gW107XG4gICAgICAgIHRlbXAuZm9yRWFjaChmdW5jdGlvbihlbGVtZW50KXtcbiAgICAgICAgICAgIGlmKGVsZW1lbnQgPT09IHdpbmRvdyl7XG4gICAgICAgICAgICAgICAgaGFzV2luZG93ID0gd2luZG93O1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgICAgc2VsZi5hZGQoZWxlbWVudCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH0oZWxlbWVudHMpKTtcblxuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcbiAgICAgICAgZG93bjoge1xuICAgICAgICAgICAgZ2V0OiBmdW5jdGlvbigpeyByZXR1cm4gZG93bjsgfVxuICAgICAgICB9LFxuICAgICAgICBtYXhTcGVlZDoge1xuICAgICAgICAgICAgZ2V0OiBmdW5jdGlvbigpeyByZXR1cm4gbWF4U3BlZWQ7IH1cbiAgICAgICAgfSxcbiAgICAgICAgcG9pbnQ6IHtcbiAgICAgICAgICAgIGdldDogZnVuY3Rpb24oKXsgcmV0dXJuIHBvaW50OyB9XG4gICAgICAgIH0sXG4gICAgICAgIHNjcm9sbGluZzoge1xuICAgICAgICAgICAgZ2V0OiBmdW5jdGlvbigpeyByZXR1cm4gc2Nyb2xsaW5nOyB9XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHZhciBuID0gMCwgY3VycmVudCA9IG51bGwsIGFuaW1hdGlvbkZyYW1lO1xuXG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIG9uRG93biwgZmFsc2UpO1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCd0b3VjaHN0YXJ0Jywgb25Eb3duLCBmYWxzZSk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCBvblVwLCBmYWxzZSk7XG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3RvdWNoZW5kJywgb25VcCwgZmFsc2UpO1xuXG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIG9uTW92ZSwgZmFsc2UpO1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCd0b3VjaG1vdmUnLCBvbk1vdmUsIGZhbHNlKTtcblxuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWxlYXZlJywgb25Nb3VzZU91dCwgZmFsc2UpO1xuXG4gICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3Njcm9sbCcsIHNldFNjcm9sbCwgdHJ1ZSk7XG5cbiAgICBmdW5jdGlvbiBzZXRTY3JvbGwoZSl7XG5cbiAgICAgICAgZm9yKHZhciBpPTA7IGk8ZWxlbWVudHMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgaWYoZWxlbWVudHNbaV0gPT09IGUudGFyZ2V0KXtcbiAgICAgICAgICAgICAgICBzY3JvbGxpbmcgPSB0cnVlO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYoc2Nyb2xsaW5nKXtcbiAgICAgICAgICAgIHJlcXVlc3RBbmltYXRpb25GcmFtZShmdW5jdGlvbiAoKXsgcmV0dXJuIHNjcm9sbGluZyA9IGZhbHNlOyB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIG9uRG93bigpe1xuICAgICAgICBkb3duID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBvblVwKCl7XG4gICAgICAgIGRvd24gPSBmYWxzZTtcbiAgICAgICAgY2FuY2VsQW5pbWF0aW9uRnJhbWUoYW5pbWF0aW9uRnJhbWUpO1xuICAgICAgICBjYW5jZWxBbmltYXRpb25GcmFtZSh3aW5kb3dBbmltYXRpb25GcmFtZSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gb25Nb3VzZU91dCgpe1xuICAgICAgICBkb3duID0gZmFsc2U7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZ2V0VGFyZ2V0KHRhcmdldCl7XG4gICAgICAgIGlmKCF0YXJnZXQpe1xuICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBpZihjdXJyZW50ID09PSB0YXJnZXQpe1xuICAgICAgICAgICAgcmV0dXJuIHRhcmdldDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKGhhc0VsZW1lbnQoZWxlbWVudHMsIHRhcmdldCkpe1xuICAgICAgICAgICAgcmV0dXJuIHRhcmdldDtcbiAgICAgICAgfVxuXG4gICAgICAgIHdoaWxlKHRhcmdldCA9IHRhcmdldC5wYXJlbnROb2RlKXtcbiAgICAgICAgICAgIGlmKGhhc0VsZW1lbnQoZWxlbWVudHMsIHRhcmdldCkpe1xuICAgICAgICAgICAgICAgIHJldHVybiB0YXJnZXQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBnZXRFbGVtZW50VW5kZXJQb2ludCgpe1xuICAgICAgICB2YXIgdW5kZXJQb2ludCA9IG51bGw7XG5cbiAgICAgICAgZm9yKHZhciBpPTA7IGk8ZWxlbWVudHMubGVuZ3RoOyBpKyspe1xuICAgICAgICAgICAgaWYoaW5zaWRlKHBvaW50LCBlbGVtZW50c1tpXSkpe1xuICAgICAgICAgICAgICAgIHVuZGVyUG9pbnQgPSBlbGVtZW50c1tpXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiB1bmRlclBvaW50O1xuICAgIH1cblxuXG4gICAgZnVuY3Rpb24gb25Nb3ZlKGV2ZW50KXtcblxuICAgICAgICBpZighc2VsZi5hdXRvU2Nyb2xsKCkpIHsgcmV0dXJuOyB9XG5cbiAgICAgICAgaWYoZXZlbnRbJ2Rpc3BhdGNoZWQnXSl7IHJldHVybjsgfVxuXG4gICAgICAgIHZhciB0YXJnZXQgPSBldmVudC50YXJnZXQsIGJvZHkgPSBkb2N1bWVudC5ib2R5O1xuXG4gICAgICAgIGlmKGN1cnJlbnQgJiYgIWluc2lkZShwb2ludCwgY3VycmVudCkpe1xuICAgICAgICAgICAgaWYoIXNlbGYuc2Nyb2xsV2hlbk91dHNpZGUpe1xuICAgICAgICAgICAgICAgIGN1cnJlbnQgPSBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYodGFyZ2V0ICYmIHRhcmdldC5wYXJlbnROb2RlID09PSBib2R5KXtcbiAgICAgICAgICAgIC8vVGhlIHNwZWNpYWwgY29uZGl0aW9uIHRvIGltcHJvdmUgc3BlZWQuXG4gICAgICAgICAgICB0YXJnZXQgPSBnZXRFbGVtZW50VW5kZXJQb2ludCgpO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHRhcmdldCA9IGdldFRhcmdldCh0YXJnZXQpO1xuXG4gICAgICAgICAgICBpZighdGFyZ2V0KXtcbiAgICAgICAgICAgICAgICB0YXJnZXQgPSBnZXRFbGVtZW50VW5kZXJQb2ludCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cblxuICAgICAgICBpZih0YXJnZXQgJiYgdGFyZ2V0ICE9PSBjdXJyZW50KXtcbiAgICAgICAgICAgIGN1cnJlbnQgPSB0YXJnZXQ7XG4gICAgICAgIH1cblxuICAgICAgICBpZihoYXNXaW5kb3cpe1xuICAgICAgICAgICAgY2FuY2VsQW5pbWF0aW9uRnJhbWUod2luZG93QW5pbWF0aW9uRnJhbWUpO1xuICAgICAgICAgICAgd2luZG93QW5pbWF0aW9uRnJhbWUgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoc2Nyb2xsV2luZG93KTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgaWYoIWN1cnJlbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY2FuY2VsQW5pbWF0aW9uRnJhbWUoYW5pbWF0aW9uRnJhbWUpO1xuICAgICAgICBhbmltYXRpb25GcmFtZSA9IHJlcXVlc3RBbmltYXRpb25GcmFtZShzY3JvbGxUaWNrKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzY3JvbGxXaW5kb3coKXtcbiAgICAgICAgYXV0b1Njcm9sbChoYXNXaW5kb3cpO1xuXG4gICAgICAgIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHdpbmRvd0FuaW1hdGlvbkZyYW1lKTtcbiAgICAgICAgd2luZG93QW5pbWF0aW9uRnJhbWUgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoc2Nyb2xsV2luZG93KTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBzY3JvbGxUaWNrKCl7XG5cbiAgICAgICAgaWYoIWN1cnJlbnQpe1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgYXV0b1Njcm9sbChjdXJyZW50KTtcblxuICAgICAgICBjYW5jZWxBbmltYXRpb25GcmFtZShhbmltYXRpb25GcmFtZSk7XG4gICAgICAgIGFuaW1hdGlvbkZyYW1lID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKHNjcm9sbFRpY2spO1xuXG4gICAgfVxuXG5cbiAgICBmdW5jdGlvbiBhdXRvU2Nyb2xsKGVsKXtcbiAgICAgICAgdmFyIHJlY3QgPSBnZXRDbGllbnRSZWN0KGVsKSwgc2Nyb2xseCwgc2Nyb2xseTtcblxuICAgICAgICBpZihwb2ludC54IDwgcmVjdC5sZWZ0ICsgc2VsZi5tYXJnaW4pe1xuICAgICAgICAgICAgc2Nyb2xseCA9IE1hdGguZmxvb3IoXG4gICAgICAgICAgICAgICAgTWF0aC5tYXgoLTEsIChwb2ludC54IC0gcmVjdC5sZWZ0KSAvIHNlbGYubWFyZ2luIC0gMSkgKiBzZWxmLm1heFNwZWVkXG4gICAgICAgICAgICApO1xuICAgICAgICB9ZWxzZSBpZihwb2ludC54ID4gcmVjdC5yaWdodCAtIHNlbGYubWFyZ2luKXtcbiAgICAgICAgICAgIHNjcm9sbHggPSBNYXRoLmNlaWwoXG4gICAgICAgICAgICAgICAgTWF0aC5taW4oMSwgKHBvaW50LnggLSByZWN0LnJpZ2h0KSAvIHNlbGYubWFyZ2luICsgMSkgKiBzZWxmLm1heFNwZWVkXG4gICAgICAgICAgICApO1xuICAgICAgICB9ZWxzZXtcbiAgICAgICAgICAgIHNjcm9sbHggPSAwO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYocG9pbnQueSA8IHJlY3QudG9wICsgc2VsZi5tYXJnaW4pe1xuICAgICAgICAgICAgc2Nyb2xseSA9IE1hdGguZmxvb3IoXG4gICAgICAgICAgICAgICAgTWF0aC5tYXgoLTEsIChwb2ludC55IC0gcmVjdC50b3ApIC8gc2VsZi5tYXJnaW4gLSAxKSAqIHNlbGYubWF4U3BlZWRcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1lbHNlIGlmKHBvaW50LnkgPiByZWN0LmJvdHRvbSAtIHNlbGYubWFyZ2luKXtcbiAgICAgICAgICAgIHNjcm9sbHkgPSBNYXRoLmNlaWwoXG4gICAgICAgICAgICAgICAgTWF0aC5taW4oMSwgKHBvaW50LnkgLSByZWN0LmJvdHRvbSkgLyBzZWxmLm1hcmdpbiArIDEpICogc2VsZi5tYXhTcGVlZFxuICAgICAgICAgICAgKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICBzY3JvbGx5ID0gMDtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmKHNlbGYuc3luY01vdmUoKSl7XG4gICAgICAgICAgICAvKlxuICAgICAgICAgICAgTm90ZXMgYWJvdXQgbW91c2Vtb3ZlIGV2ZW50IGRpc3BhdGNoLlxuICAgICAgICAgICAgc2NyZWVuKFgvWSkgc2hvdWxkIG5lZWQgdG8gYmUgdXBkYXRlZC5cbiAgICAgICAgICAgIFNvbWUgb3RoZXIgcHJvcGVydGllcyBtaWdodCBuZWVkIHRvIGJlIHNldC5cbiAgICAgICAgICAgIEtlZXAgdGhlIHN5bmNNb3ZlIG9wdGlvbiBkZWZhdWx0IGZhbHNlIHVudGlsIGFsbCBpbmNvbnNpc3RlbmNpZXMgYXJlIHRha2VuIGNhcmUgb2YuXG4gICAgICAgICAgICAqL1xuICAgICAgICAgICAgZGlzcGF0Y2hlci5kaXNwYXRjaChlbCwge1xuICAgICAgICAgICAgICAgIHBhZ2VYOiBwb2ludC5wYWdlWCArIHNjcm9sbHgsXG4gICAgICAgICAgICAgICAgcGFnZVk6IHBvaW50LnBhZ2VZICsgc2Nyb2xseSxcbiAgICAgICAgICAgICAgICBjbGllbnRYOiBwb2ludC54ICsgc2Nyb2xseCxcbiAgICAgICAgICAgICAgICBjbGllbnRZOiBwb2ludC55ICsgc2Nyb2xseVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uICgpe1xuXG4gICAgICAgICAgICBpZihzY3JvbGx5KXtcbiAgICAgICAgICAgICAgICBzY3JvbGxZKGVsLCBzY3JvbGx5KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYoc2Nyb2xseCl7XG4gICAgICAgICAgICAgICAgc2Nyb2xsWChlbCwgc2Nyb2xseCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2Nyb2xsWShlbCwgYW1vdW50KXtcbiAgICAgICAgaWYoZWwgPT09IHdpbmRvdyl7XG4gICAgICAgICAgICB3aW5kb3cuc2Nyb2xsVG8oZWwucGFnZVhPZmZzZXQsIGVsLnBhZ2VZT2Zmc2V0ICsgYW1vdW50KTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICBlbC5zY3JvbGxUb3AgKz0gYW1vdW50O1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2Nyb2xsWChlbCwgYW1vdW50KXtcbiAgICAgICAgaWYoZWwgPT09IHdpbmRvdyl7XG4gICAgICAgICAgICB3aW5kb3cuc2Nyb2xsVG8oZWwucGFnZVhPZmZzZXQgKyBhbW91bnQsIGVsLnBhZ2VZT2Zmc2V0KTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICBlbC5zY3JvbGxMZWZ0ICs9IGFtb3VudDtcbiAgICAgICAgfVxuICAgIH1cblxufVxuXG5mdW5jdGlvbiBBdXRvU2Nyb2xsZXJGYWN0b3J5KGVsZW1lbnQsIG9wdGlvbnMpe1xuICAgIHJldHVybiBuZXcgQXV0b1Njcm9sbGVyKGVsZW1lbnQsIG9wdGlvbnMpO1xufVxuXG5mdW5jdGlvbiBpbnNpZGUocG9pbnQsIGVsLCByZWN0KXtcbiAgICBpZighcmVjdCl7XG4gICAgICAgIHJldHVybiBwb2ludEluc2lkZShwb2ludCwgZWwpO1xuICAgIH1lbHNle1xuICAgICAgICByZXR1cm4gKHBvaW50LnkgPiByZWN0LnRvcCAmJiBwb2ludC55IDwgcmVjdC5ib3R0b20gJiZcbiAgICAgICAgICAgICAgICBwb2ludC54ID4gcmVjdC5sZWZ0ICYmIHBvaW50LnggPCByZWN0LnJpZ2h0KTtcbiAgICB9XG59XG5cbi8qXG5naXQgcmVtb3RlIGFkZCBvcmlnaW4gaHR0cHM6Ly9naXRodWIuY29tL2hvbGxvd2Rvb3IvZG9tX2F1dG9zY3JvbGxlci5naXRcbmdpdCBwdXNoIC11IG9yaWdpbiBtYXN0ZXJcbiovXG5cbnJldHVybiBBdXRvU2Nyb2xsZXJGYWN0b3J5O1xuXG59KCkpO1xuLy8jIHNvdXJjZU1hcHBpbmdVUkw9ZG9tLWF1dG9zY3JvbGxlci5qcy5tYXBcbiIsIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2FjaGUgPSB7fTtcbnZhciBzdGFydCA9ICcoPzpefFxcXFxzKSc7XG52YXIgZW5kID0gJyg/OlxcXFxzfCQpJztcblxuZnVuY3Rpb24gbG9va3VwQ2xhc3MgKGNsYXNzTmFtZSkge1xuICB2YXIgY2FjaGVkID0gY2FjaGVbY2xhc3NOYW1lXTtcbiAgaWYgKGNhY2hlZCkge1xuICAgIGNhY2hlZC5sYXN0SW5kZXggPSAwO1xuICB9IGVsc2Uge1xuICAgIGNhY2hlW2NsYXNzTmFtZV0gPSBjYWNoZWQgPSBuZXcgUmVnRXhwKHN0YXJ0ICsgY2xhc3NOYW1lICsgZW5kLCAnZycpO1xuICB9XG4gIHJldHVybiBjYWNoZWQ7XG59XG5cbmZ1bmN0aW9uIGFkZENsYXNzIChlbCwgY2xhc3NOYW1lKSB7XG4gIHZhciBjdXJyZW50ID0gZWwuY2xhc3NOYW1lO1xuICBpZiAoIWN1cnJlbnQubGVuZ3RoKSB7XG4gICAgZWwuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuICB9IGVsc2UgaWYgKCFsb29rdXBDbGFzcyhjbGFzc05hbWUpLnRlc3QoY3VycmVudCkpIHtcbiAgICBlbC5jbGFzc05hbWUgKz0gJyAnICsgY2xhc3NOYW1lO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJtQ2xhc3MgKGVsLCBjbGFzc05hbWUpIHtcbiAgZWwuY2xhc3NOYW1lID0gZWwuY2xhc3NOYW1lLnJlcGxhY2UobG9va3VwQ2xhc3MoY2xhc3NOYW1lKSwgJyAnKS50cmltKCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBhZGQ6IGFkZENsYXNzLFxuICBybTogcm1DbGFzc1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGVtaXR0ZXIgPSByZXF1aXJlKCdjb250cmEvZW1pdHRlcicpO1xudmFyIGNyb3NzdmVudCA9IHJlcXVpcmUoJ2Nyb3NzdmVudCcpO1xudmFyIGNsYXNzZXMgPSByZXF1aXJlKCcuL2NsYXNzZXMnKTtcbnZhciBkb2MgPSBkb2N1bWVudDtcbnZhciBkb2N1bWVudEVsZW1lbnQgPSBkb2MuZG9jdW1lbnRFbGVtZW50O1xuXG5mdW5jdGlvbiBkcmFndWxhIChpbml0aWFsQ29udGFpbmVycywgb3B0aW9ucykge1xuICB2YXIgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgaWYgKGxlbiA9PT0gMSAmJiBBcnJheS5pc0FycmF5KGluaXRpYWxDb250YWluZXJzKSA9PT0gZmFsc2UpIHtcbiAgICBvcHRpb25zID0gaW5pdGlhbENvbnRhaW5lcnM7XG4gICAgaW5pdGlhbENvbnRhaW5lcnMgPSBbXTtcbiAgfVxuICB2YXIgX21pcnJvcjsgLy8gbWlycm9yIGltYWdlXG4gIHZhciBfc291cmNlOyAvLyBzb3VyY2UgY29udGFpbmVyXG4gIHZhciBfaXRlbTsgLy8gaXRlbSBiZWluZyBkcmFnZ2VkXG4gIHZhciBfb2Zmc2V0WDsgLy8gcmVmZXJlbmNlIHhcbiAgdmFyIF9vZmZzZXRZOyAvLyByZWZlcmVuY2UgeVxuICB2YXIgX21vdmVYOyAvLyByZWZlcmVuY2UgbW92ZSB4XG4gIHZhciBfbW92ZVk7IC8vIHJlZmVyZW5jZSBtb3ZlIHlcbiAgdmFyIF9pbml0aWFsU2libGluZzsgLy8gcmVmZXJlbmNlIHNpYmxpbmcgd2hlbiBncmFiYmVkXG4gIHZhciBfY3VycmVudFNpYmxpbmc7IC8vIHJlZmVyZW5jZSBzaWJsaW5nIG5vd1xuICB2YXIgX2NvcHk7IC8vIGl0ZW0gdXNlZCBmb3IgY29weWluZ1xuICB2YXIgX3JlbmRlclRpbWVyOyAvLyB0aW1lciBmb3Igc2V0VGltZW91dCByZW5kZXJNaXJyb3JJbWFnZVxuICB2YXIgX2xhc3REcm9wVGFyZ2V0ID0gbnVsbDsgLy8gbGFzdCBjb250YWluZXIgaXRlbSB3YXMgb3ZlclxuICB2YXIgX2dyYWJiZWQ7IC8vIGhvbGRzIG1vdXNlZG93biBjb250ZXh0IHVudGlsIGZpcnN0IG1vdXNlbW92ZVxuXG4gIHZhciBvID0gb3B0aW9ucyB8fCB7fTtcbiAgaWYgKG8ubW92ZXMgPT09IHZvaWQgMCkgeyBvLm1vdmVzID0gYWx3YXlzOyB9XG4gIGlmIChvLmFjY2VwdHMgPT09IHZvaWQgMCkgeyBvLmFjY2VwdHMgPSBhbHdheXM7IH1cbiAgaWYgKG8uaW52YWxpZCA9PT0gdm9pZCAwKSB7IG8uaW52YWxpZCA9IGludmFsaWRUYXJnZXQ7IH1cbiAgaWYgKG8uY29udGFpbmVycyA9PT0gdm9pZCAwKSB7IG8uY29udGFpbmVycyA9IGluaXRpYWxDb250YWluZXJzIHx8IFtdOyB9XG4gIGlmIChvLmlzQ29udGFpbmVyID09PSB2b2lkIDApIHsgby5pc0NvbnRhaW5lciA9IG5ldmVyOyB9XG4gIGlmIChvLmNvcHkgPT09IHZvaWQgMCkgeyBvLmNvcHkgPSBmYWxzZTsgfVxuICBpZiAoby5jb3B5U29ydFNvdXJjZSA9PT0gdm9pZCAwKSB7IG8uY29weVNvcnRTb3VyY2UgPSBmYWxzZTsgfVxuICBpZiAoby5yZXZlcnRPblNwaWxsID09PSB2b2lkIDApIHsgby5yZXZlcnRPblNwaWxsID0gZmFsc2U7IH1cbiAgaWYgKG8ucmVtb3ZlT25TcGlsbCA9PT0gdm9pZCAwKSB7IG8ucmVtb3ZlT25TcGlsbCA9IGZhbHNlOyB9XG4gIGlmIChvLmRpcmVjdGlvbiA9PT0gdm9pZCAwKSB7IG8uZGlyZWN0aW9uID0gJ3ZlcnRpY2FsJzsgfVxuICBpZiAoby5pZ25vcmVJbnB1dFRleHRTZWxlY3Rpb24gPT09IHZvaWQgMCkgeyBvLmlnbm9yZUlucHV0VGV4dFNlbGVjdGlvbiA9IHRydWU7IH1cbiAgaWYgKG8ubWlycm9yQ29udGFpbmVyID09PSB2b2lkIDApIHsgby5taXJyb3JDb250YWluZXIgPSBkb2MuYm9keTsgfVxuXG4gIHZhciBkcmFrZSA9IGVtaXR0ZXIoe1xuICAgIGNvbnRhaW5lcnM6IG8uY29udGFpbmVycyxcbiAgICBzdGFydDogbWFudWFsU3RhcnQsXG4gICAgZW5kOiBlbmQsXG4gICAgY2FuY2VsOiBjYW5jZWwsXG4gICAgcmVtb3ZlOiByZW1vdmUsXG4gICAgZGVzdHJveTogZGVzdHJveSxcbiAgICBjYW5Nb3ZlOiBjYW5Nb3ZlLFxuICAgIGRyYWdnaW5nOiBmYWxzZVxuICB9KTtcblxuICBpZiAoby5yZW1vdmVPblNwaWxsID09PSB0cnVlKSB7XG4gICAgZHJha2Uub24oJ292ZXInLCBzcGlsbE92ZXIpLm9uKCdvdXQnLCBzcGlsbE91dCk7XG4gIH1cblxuICBldmVudHMoKTtcblxuICByZXR1cm4gZHJha2U7XG5cbiAgZnVuY3Rpb24gaXNDb250YWluZXIgKGVsKSB7XG4gICAgcmV0dXJuIGRyYWtlLmNvbnRhaW5lcnMuaW5kZXhPZihlbCkgIT09IC0xIHx8IG8uaXNDb250YWluZXIoZWwpO1xuICB9XG5cbiAgZnVuY3Rpb24gZXZlbnRzIChyZW1vdmUpIHtcbiAgICB2YXIgb3AgPSByZW1vdmUgPyAncmVtb3ZlJyA6ICdhZGQnO1xuICAgIHRvdWNoeShkb2N1bWVudEVsZW1lbnQsIG9wLCAnbW91c2Vkb3duJywgZ3JhYik7XG4gICAgdG91Y2h5KGRvY3VtZW50RWxlbWVudCwgb3AsICdtb3VzZXVwJywgcmVsZWFzZSk7XG4gIH1cblxuICBmdW5jdGlvbiBldmVudHVhbE1vdmVtZW50cyAocmVtb3ZlKSB7XG4gICAgdmFyIG9wID0gcmVtb3ZlID8gJ3JlbW92ZScgOiAnYWRkJztcbiAgICB0b3VjaHkoZG9jdW1lbnRFbGVtZW50LCBvcCwgJ21vdXNlbW92ZScsIHN0YXJ0QmVjYXVzZU1vdXNlTW92ZWQpO1xuICB9XG5cbiAgZnVuY3Rpb24gbW92ZW1lbnRzIChyZW1vdmUpIHtcbiAgICB2YXIgb3AgPSByZW1vdmUgPyAncmVtb3ZlJyA6ICdhZGQnO1xuICAgIGNyb3NzdmVudFtvcF0oZG9jdW1lbnRFbGVtZW50LCAnc2VsZWN0c3RhcnQnLCBwcmV2ZW50R3JhYmJlZCk7IC8vIElFOFxuICAgIGNyb3NzdmVudFtvcF0oZG9jdW1lbnRFbGVtZW50LCAnY2xpY2snLCBwcmV2ZW50R3JhYmJlZCk7XG4gIH1cblxuICBmdW5jdGlvbiBkZXN0cm95ICgpIHtcbiAgICBldmVudHModHJ1ZSk7XG4gICAgcmVsZWFzZSh7fSk7XG4gIH1cblxuICBmdW5jdGlvbiBwcmV2ZW50R3JhYmJlZCAoZSkge1xuICAgIGlmIChfZ3JhYmJlZCkge1xuICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGdyYWIgKGUpIHtcbiAgICBfbW92ZVggPSBlLmNsaWVudFg7XG4gICAgX21vdmVZID0gZS5jbGllbnRZO1xuXG4gICAgdmFyIGlnbm9yZSA9IHdoaWNoTW91c2VCdXR0b24oZSkgIT09IDEgfHwgZS5tZXRhS2V5IHx8IGUuY3RybEtleTtcbiAgICBpZiAoaWdub3JlKSB7XG4gICAgICByZXR1cm47IC8vIHdlIG9ubHkgY2FyZSBhYm91dCBob25lc3QtdG8tZ29kIGxlZnQgY2xpY2tzIGFuZCB0b3VjaCBldmVudHNcbiAgICB9XG4gICAgdmFyIGl0ZW0gPSBlLnRhcmdldDtcbiAgICB2YXIgY29udGV4dCA9IGNhblN0YXJ0KGl0ZW0pO1xuICAgIGlmICghY29udGV4dCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBfZ3JhYmJlZCA9IGNvbnRleHQ7XG4gICAgZXZlbnR1YWxNb3ZlbWVudHMoKTtcbiAgICBpZiAoZS50eXBlID09PSAnbW91c2Vkb3duJykge1xuICAgICAgaWYgKGlzSW5wdXQoaXRlbSkpIHsgLy8gc2VlIGFsc286IGh0dHBzOi8vZ2l0aHViLmNvbS9iZXZhY3F1YS9kcmFndWxhL2lzc3Vlcy8yMDhcbiAgICAgICAgaXRlbS5mb2N1cygpOyAvLyBmaXhlcyBodHRwczovL2dpdGh1Yi5jb20vYmV2YWNxdWEvZHJhZ3VsYS9pc3N1ZXMvMTc2XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7IC8vIGZpeGVzIGh0dHBzOi8vZ2l0aHViLmNvbS9iZXZhY3F1YS9kcmFndWxhL2lzc3Vlcy8xNTVcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBzdGFydEJlY2F1c2VNb3VzZU1vdmVkIChlKSB7XG4gICAgaWYgKCFfZ3JhYmJlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAod2hpY2hNb3VzZUJ1dHRvbihlKSA9PT0gMCkge1xuICAgICAgcmVsZWFzZSh7fSk7XG4gICAgICByZXR1cm47IC8vIHdoZW4gdGV4dCBpcyBzZWxlY3RlZCBvbiBhbiBpbnB1dCBhbmQgdGhlbiBkcmFnZ2VkLCBtb3VzZXVwIGRvZXNuJ3QgZmlyZS4gdGhpcyBpcyBvdXIgb25seSBob3BlXG4gICAgfVxuICAgIC8vIHRydXRoeSBjaGVjayBmaXhlcyAjMjM5LCBlcXVhbGl0eSBmaXhlcyAjMjA3XG4gICAgaWYgKGUuY2xpZW50WCAhPT0gdm9pZCAwICYmIGUuY2xpZW50WCA9PT0gX21vdmVYICYmIGUuY2xpZW50WSAhPT0gdm9pZCAwICYmIGUuY2xpZW50WSA9PT0gX21vdmVZKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChvLmlnbm9yZUlucHV0VGV4dFNlbGVjdGlvbikge1xuICAgICAgdmFyIGNsaWVudFggPSBnZXRDb29yZCgnY2xpZW50WCcsIGUpO1xuICAgICAgdmFyIGNsaWVudFkgPSBnZXRDb29yZCgnY2xpZW50WScsIGUpO1xuICAgICAgdmFyIGVsZW1lbnRCZWhpbmRDdXJzb3IgPSBkb2MuZWxlbWVudEZyb21Qb2ludChjbGllbnRYLCBjbGllbnRZKTtcbiAgICAgIGlmIChpc0lucHV0KGVsZW1lbnRCZWhpbmRDdXJzb3IpKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgZ3JhYmJlZCA9IF9ncmFiYmVkOyAvLyBjYWxsIHRvIGVuZCgpIHVuc2V0cyBfZ3JhYmJlZFxuICAgIGV2ZW50dWFsTW92ZW1lbnRzKHRydWUpO1xuICAgIG1vdmVtZW50cygpO1xuICAgIGVuZCgpO1xuICAgIHN0YXJ0KGdyYWJiZWQpO1xuXG4gICAgdmFyIG9mZnNldCA9IGdldE9mZnNldChfaXRlbSk7XG4gICAgX29mZnNldFggPSBnZXRDb29yZCgncGFnZVgnLCBlKSAtIG9mZnNldC5sZWZ0O1xuICAgIF9vZmZzZXRZID0gZ2V0Q29vcmQoJ3BhZ2VZJywgZSkgLSBvZmZzZXQudG9wO1xuXG4gICAgY2xhc3Nlcy5hZGQoX2NvcHkgfHwgX2l0ZW0sICdndS10cmFuc2l0Jyk7XG4gICAgcmVuZGVyTWlycm9ySW1hZ2UoKTtcbiAgICBkcmFnKGUpO1xuICB9XG5cbiAgZnVuY3Rpb24gY2FuU3RhcnQgKGl0ZW0pIHtcbiAgICBpZiAoZHJha2UuZHJhZ2dpbmcgJiYgX21pcnJvcikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoaXNDb250YWluZXIoaXRlbSkpIHtcbiAgICAgIHJldHVybjsgLy8gZG9uJ3QgZHJhZyBjb250YWluZXIgaXRzZWxmXG4gICAgfVxuICAgIHZhciBoYW5kbGUgPSBpdGVtO1xuICAgIHdoaWxlIChnZXRQYXJlbnQoaXRlbSkgJiYgaXNDb250YWluZXIoZ2V0UGFyZW50KGl0ZW0pKSA9PT0gZmFsc2UpIHtcbiAgICAgIGlmIChvLmludmFsaWQoaXRlbSwgaGFuZGxlKSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpdGVtID0gZ2V0UGFyZW50KGl0ZW0pOyAvLyBkcmFnIHRhcmdldCBzaG91bGQgYmUgYSB0b3AgZWxlbWVudFxuICAgICAgaWYgKCFpdGVtKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG4gICAgdmFyIHNvdXJjZSA9IGdldFBhcmVudChpdGVtKTtcbiAgICBpZiAoIXNvdXJjZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoby5pbnZhbGlkKGl0ZW0sIGhhbmRsZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgbW92YWJsZSA9IG8ubW92ZXMoaXRlbSwgc291cmNlLCBoYW5kbGUsIG5leHRFbChpdGVtKSk7XG4gICAgaWYgKCFtb3ZhYmxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGl0ZW06IGl0ZW0sXG4gICAgICBzb3VyY2U6IHNvdXJjZVxuICAgIH07XG4gIH1cblxuICBmdW5jdGlvbiBjYW5Nb3ZlIChpdGVtKSB7XG4gICAgcmV0dXJuICEhY2FuU3RhcnQoaXRlbSk7XG4gIH1cblxuICBmdW5jdGlvbiBtYW51YWxTdGFydCAoaXRlbSkge1xuICAgIHZhciBjb250ZXh0ID0gY2FuU3RhcnQoaXRlbSk7XG4gICAgaWYgKGNvbnRleHQpIHtcbiAgICAgIHN0YXJ0KGNvbnRleHQpO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHN0YXJ0IChjb250ZXh0KSB7XG4gICAgaWYgKGlzQ29weShjb250ZXh0Lml0ZW0sIGNvbnRleHQuc291cmNlKSkge1xuICAgICAgX2NvcHkgPSBjb250ZXh0Lml0ZW0uY2xvbmVOb2RlKHRydWUpO1xuICAgICAgZHJha2UuZW1pdCgnY2xvbmVkJywgX2NvcHksIGNvbnRleHQuaXRlbSwgJ2NvcHknKTtcbiAgICB9XG5cbiAgICBfc291cmNlID0gY29udGV4dC5zb3VyY2U7XG4gICAgX2l0ZW0gPSBjb250ZXh0Lml0ZW07XG4gICAgX2luaXRpYWxTaWJsaW5nID0gX2N1cnJlbnRTaWJsaW5nID0gbmV4dEVsKGNvbnRleHQuaXRlbSk7XG5cbiAgICBkcmFrZS5kcmFnZ2luZyA9IHRydWU7XG4gICAgZHJha2UuZW1pdCgnZHJhZycsIF9pdGVtLCBfc291cmNlKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGludmFsaWRUYXJnZXQgKCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGVuZCAoKSB7XG4gICAgaWYgKCFkcmFrZS5kcmFnZ2luZykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgaXRlbSA9IF9jb3B5IHx8IF9pdGVtO1xuICAgIGRyb3AoaXRlbSwgZ2V0UGFyZW50KGl0ZW0pKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHVuZ3JhYiAoKSB7XG4gICAgX2dyYWJiZWQgPSBmYWxzZTtcbiAgICBldmVudHVhbE1vdmVtZW50cyh0cnVlKTtcbiAgICBtb3ZlbWVudHModHJ1ZSk7XG4gIH1cblxuICBmdW5jdGlvbiByZWxlYXNlIChlKSB7XG4gICAgdW5ncmFiKCk7XG5cbiAgICBpZiAoIWRyYWtlLmRyYWdnaW5nKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBpdGVtID0gX2NvcHkgfHwgX2l0ZW07XG4gICAgdmFyIGNsaWVudFggPSBnZXRDb29yZCgnY2xpZW50WCcsIGUpO1xuICAgIHZhciBjbGllbnRZID0gZ2V0Q29vcmQoJ2NsaWVudFknLCBlKTtcbiAgICB2YXIgZWxlbWVudEJlaGluZEN1cnNvciA9IGdldEVsZW1lbnRCZWhpbmRQb2ludChfbWlycm9yLCBjbGllbnRYLCBjbGllbnRZKTtcbiAgICB2YXIgZHJvcFRhcmdldCA9IGZpbmREcm9wVGFyZ2V0KGVsZW1lbnRCZWhpbmRDdXJzb3IsIGNsaWVudFgsIGNsaWVudFkpO1xuICAgIGlmIChkcm9wVGFyZ2V0ICYmICgoX2NvcHkgJiYgby5jb3B5U29ydFNvdXJjZSkgfHwgKCFfY29weSB8fCBkcm9wVGFyZ2V0ICE9PSBfc291cmNlKSkpIHtcbiAgICAgIGRyb3AoaXRlbSwgZHJvcFRhcmdldCk7XG4gICAgfSBlbHNlIGlmIChvLnJlbW92ZU9uU3BpbGwpIHtcbiAgICAgIHJlbW92ZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjYW5jZWwoKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBkcm9wIChpdGVtLCB0YXJnZXQpIHtcbiAgICB2YXIgcGFyZW50ID0gZ2V0UGFyZW50KGl0ZW0pO1xuICAgIGlmIChfY29weSAmJiBvLmNvcHlTb3J0U291cmNlICYmIHRhcmdldCA9PT0gX3NvdXJjZSkge1xuICAgICAgcGFyZW50LnJlbW92ZUNoaWxkKF9pdGVtKTtcbiAgICB9XG4gICAgaWYgKGlzSW5pdGlhbFBsYWNlbWVudCh0YXJnZXQpKSB7XG4gICAgICBkcmFrZS5lbWl0KCdjYW5jZWwnLCBpdGVtLCBfc291cmNlLCBfc291cmNlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgZHJha2UuZW1pdCgnZHJvcCcsIGl0ZW0sIHRhcmdldCwgX3NvdXJjZSwgX2N1cnJlbnRTaWJsaW5nKTtcbiAgICB9XG4gICAgY2xlYW51cCgpO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVtb3ZlICgpIHtcbiAgICBpZiAoIWRyYWtlLmRyYWdnaW5nKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBpdGVtID0gX2NvcHkgfHwgX2l0ZW07XG4gICAgdmFyIHBhcmVudCA9IGdldFBhcmVudChpdGVtKTtcbiAgICBpZiAocGFyZW50KSB7XG4gICAgICBwYXJlbnQucmVtb3ZlQ2hpbGQoaXRlbSk7XG4gICAgfVxuICAgIGRyYWtlLmVtaXQoX2NvcHkgPyAnY2FuY2VsJyA6ICdyZW1vdmUnLCBpdGVtLCBwYXJlbnQsIF9zb3VyY2UpO1xuICAgIGNsZWFudXAoKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGNhbmNlbCAocmV2ZXJ0KSB7XG4gICAgaWYgKCFkcmFrZS5kcmFnZ2luZykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgcmV2ZXJ0cyA9IGFyZ3VtZW50cy5sZW5ndGggPiAwID8gcmV2ZXJ0IDogby5yZXZlcnRPblNwaWxsO1xuICAgIHZhciBpdGVtID0gX2NvcHkgfHwgX2l0ZW07XG4gICAgdmFyIHBhcmVudCA9IGdldFBhcmVudChpdGVtKTtcbiAgICB2YXIgaW5pdGlhbCA9IGlzSW5pdGlhbFBsYWNlbWVudChwYXJlbnQpO1xuICAgIGlmIChpbml0aWFsID09PSBmYWxzZSAmJiByZXZlcnRzKSB7XG4gICAgICBpZiAoX2NvcHkpIHtcbiAgICAgICAgaWYgKHBhcmVudCkge1xuICAgICAgICAgIHBhcmVudC5yZW1vdmVDaGlsZChfY29weSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIF9zb3VyY2UuaW5zZXJ0QmVmb3JlKGl0ZW0sIF9pbml0aWFsU2libGluZyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChpbml0aWFsIHx8IHJldmVydHMpIHtcbiAgICAgIGRyYWtlLmVtaXQoJ2NhbmNlbCcsIGl0ZW0sIF9zb3VyY2UsIF9zb3VyY2UpO1xuICAgIH0gZWxzZSB7XG4gICAgICBkcmFrZS5lbWl0KCdkcm9wJywgaXRlbSwgcGFyZW50LCBfc291cmNlLCBfY3VycmVudFNpYmxpbmcpO1xuICAgIH1cbiAgICBjbGVhbnVwKCk7XG4gIH1cblxuICBmdW5jdGlvbiBjbGVhbnVwICgpIHtcbiAgICB2YXIgaXRlbSA9IF9jb3B5IHx8IF9pdGVtO1xuICAgIHVuZ3JhYigpO1xuICAgIHJlbW92ZU1pcnJvckltYWdlKCk7XG4gICAgaWYgKGl0ZW0pIHtcbiAgICAgIGNsYXNzZXMucm0oaXRlbSwgJ2d1LXRyYW5zaXQnKTtcbiAgICB9XG4gICAgaWYgKF9yZW5kZXJUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KF9yZW5kZXJUaW1lcik7XG4gICAgfVxuICAgIGRyYWtlLmRyYWdnaW5nID0gZmFsc2U7XG4gICAgaWYgKF9sYXN0RHJvcFRhcmdldCkge1xuICAgICAgZHJha2UuZW1pdCgnb3V0JywgaXRlbSwgX2xhc3REcm9wVGFyZ2V0LCBfc291cmNlKTtcbiAgICB9XG4gICAgZHJha2UuZW1pdCgnZHJhZ2VuZCcsIGl0ZW0pO1xuICAgIF9zb3VyY2UgPSBfaXRlbSA9IF9jb3B5ID0gX2luaXRpYWxTaWJsaW5nID0gX2N1cnJlbnRTaWJsaW5nID0gX3JlbmRlclRpbWVyID0gX2xhc3REcm9wVGFyZ2V0ID0gbnVsbDtcbiAgfVxuXG4gIGZ1bmN0aW9uIGlzSW5pdGlhbFBsYWNlbWVudCAodGFyZ2V0LCBzKSB7XG4gICAgdmFyIHNpYmxpbmc7XG4gICAgaWYgKHMgIT09IHZvaWQgMCkge1xuICAgICAgc2libGluZyA9IHM7XG4gICAgfSBlbHNlIGlmIChfbWlycm9yKSB7XG4gICAgICBzaWJsaW5nID0gX2N1cnJlbnRTaWJsaW5nO1xuICAgIH0gZWxzZSB7XG4gICAgICBzaWJsaW5nID0gbmV4dEVsKF9jb3B5IHx8IF9pdGVtKTtcbiAgICB9XG4gICAgcmV0dXJuIHRhcmdldCA9PT0gX3NvdXJjZSAmJiBzaWJsaW5nID09PSBfaW5pdGlhbFNpYmxpbmc7XG4gIH1cblxuICBmdW5jdGlvbiBmaW5kRHJvcFRhcmdldCAoZWxlbWVudEJlaGluZEN1cnNvciwgY2xpZW50WCwgY2xpZW50WSkge1xuICAgIHZhciB0YXJnZXQgPSBlbGVtZW50QmVoaW5kQ3Vyc29yO1xuICAgIHdoaWxlICh0YXJnZXQgJiYgIWFjY2VwdGVkKCkpIHtcbiAgICAgIHRhcmdldCA9IGdldFBhcmVudCh0YXJnZXQpO1xuICAgIH1cbiAgICByZXR1cm4gdGFyZ2V0O1xuXG4gICAgZnVuY3Rpb24gYWNjZXB0ZWQgKCkge1xuICAgICAgdmFyIGRyb3BwYWJsZSA9IGlzQ29udGFpbmVyKHRhcmdldCk7XG4gICAgICBpZiAoZHJvcHBhYmxlID09PSBmYWxzZSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG5cbiAgICAgIHZhciBpbW1lZGlhdGUgPSBnZXRJbW1lZGlhdGVDaGlsZCh0YXJnZXQsIGVsZW1lbnRCZWhpbmRDdXJzb3IpO1xuICAgICAgdmFyIHJlZmVyZW5jZSA9IGdldFJlZmVyZW5jZSh0YXJnZXQsIGltbWVkaWF0ZSwgY2xpZW50WCwgY2xpZW50WSk7XG4gICAgICB2YXIgaW5pdGlhbCA9IGlzSW5pdGlhbFBsYWNlbWVudCh0YXJnZXQsIHJlZmVyZW5jZSk7XG4gICAgICBpZiAoaW5pdGlhbCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTsgLy8gc2hvdWxkIGFsd2F5cyBiZSBhYmxlIHRvIGRyb3AgaXQgcmlnaHQgYmFjayB3aGVyZSBpdCB3YXNcbiAgICAgIH1cbiAgICAgIHJldHVybiBvLmFjY2VwdHMoX2l0ZW0sIHRhcmdldCwgX3NvdXJjZSwgcmVmZXJlbmNlKTtcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBkcmFnIChlKSB7XG4gICAgaWYgKCFfbWlycm9yKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGUucHJldmVudERlZmF1bHQoKTtcblxuICAgIHZhciBjbGllbnRYID0gZ2V0Q29vcmQoJ2NsaWVudFgnLCBlKTtcbiAgICB2YXIgY2xpZW50WSA9IGdldENvb3JkKCdjbGllbnRZJywgZSk7XG4gICAgdmFyIHggPSBjbGllbnRYIC0gX29mZnNldFg7XG4gICAgdmFyIHkgPSBjbGllbnRZIC0gX29mZnNldFk7XG5cbiAgICBfbWlycm9yLnN0eWxlLmxlZnQgPSB4ICsgJ3B4JztcbiAgICBfbWlycm9yLnN0eWxlLnRvcCA9IHkgKyAncHgnO1xuXG4gICAgdmFyIGl0ZW0gPSBfY29weSB8fCBfaXRlbTtcbiAgICB2YXIgZWxlbWVudEJlaGluZEN1cnNvciA9IGdldEVsZW1lbnRCZWhpbmRQb2ludChfbWlycm9yLCBjbGllbnRYLCBjbGllbnRZKTtcbiAgICB2YXIgZHJvcFRhcmdldCA9IGZpbmREcm9wVGFyZ2V0KGVsZW1lbnRCZWhpbmRDdXJzb3IsIGNsaWVudFgsIGNsaWVudFkpO1xuICAgIHZhciBjaGFuZ2VkID0gZHJvcFRhcmdldCAhPT0gbnVsbCAmJiBkcm9wVGFyZ2V0ICE9PSBfbGFzdERyb3BUYXJnZXQ7XG4gICAgaWYgKGNoYW5nZWQgfHwgZHJvcFRhcmdldCA9PT0gbnVsbCkge1xuICAgICAgb3V0KCk7XG4gICAgICBfbGFzdERyb3BUYXJnZXQgPSBkcm9wVGFyZ2V0O1xuICAgICAgb3ZlcigpO1xuICAgIH1cbiAgICB2YXIgcGFyZW50ID0gZ2V0UGFyZW50KGl0ZW0pO1xuICAgIGlmIChkcm9wVGFyZ2V0ID09PSBfc291cmNlICYmIF9jb3B5ICYmICFvLmNvcHlTb3J0U291cmNlKSB7XG4gICAgICBpZiAocGFyZW50KSB7XG4gICAgICAgIHBhcmVudC5yZW1vdmVDaGlsZChpdGVtKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHJlZmVyZW5jZTtcbiAgICB2YXIgaW1tZWRpYXRlID0gZ2V0SW1tZWRpYXRlQ2hpbGQoZHJvcFRhcmdldCwgZWxlbWVudEJlaGluZEN1cnNvcik7XG4gICAgaWYgKGltbWVkaWF0ZSAhPT0gbnVsbCkge1xuICAgICAgcmVmZXJlbmNlID0gZ2V0UmVmZXJlbmNlKGRyb3BUYXJnZXQsIGltbWVkaWF0ZSwgY2xpZW50WCwgY2xpZW50WSk7XG4gICAgfSBlbHNlIGlmIChvLnJldmVydE9uU3BpbGwgPT09IHRydWUgJiYgIV9jb3B5KSB7XG4gICAgICByZWZlcmVuY2UgPSBfaW5pdGlhbFNpYmxpbmc7XG4gICAgICBkcm9wVGFyZ2V0ID0gX3NvdXJjZTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKF9jb3B5ICYmIHBhcmVudCkge1xuICAgICAgICBwYXJlbnQucmVtb3ZlQ2hpbGQoaXRlbSk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmIChcbiAgICAgIChyZWZlcmVuY2UgPT09IG51bGwgJiYgY2hhbmdlZCkgfHxcbiAgICAgIHJlZmVyZW5jZSAhPT0gaXRlbSAmJlxuICAgICAgcmVmZXJlbmNlICE9PSBuZXh0RWwoaXRlbSlcbiAgICApIHtcbiAgICAgIF9jdXJyZW50U2libGluZyA9IHJlZmVyZW5jZTtcbiAgICAgIGRyb3BUYXJnZXQuaW5zZXJ0QmVmb3JlKGl0ZW0sIHJlZmVyZW5jZSk7XG4gICAgICBkcmFrZS5lbWl0KCdzaGFkb3cnLCBpdGVtLCBkcm9wVGFyZ2V0LCBfc291cmNlKTtcbiAgICB9XG4gICAgZnVuY3Rpb24gbW92ZWQgKHR5cGUpIHsgZHJha2UuZW1pdCh0eXBlLCBpdGVtLCBfbGFzdERyb3BUYXJnZXQsIF9zb3VyY2UpOyB9XG4gICAgZnVuY3Rpb24gb3ZlciAoKSB7IGlmIChjaGFuZ2VkKSB7IG1vdmVkKCdvdmVyJyk7IH0gfVxuICAgIGZ1bmN0aW9uIG91dCAoKSB7IGlmIChfbGFzdERyb3BUYXJnZXQpIHsgbW92ZWQoJ291dCcpOyB9IH1cbiAgfVxuXG4gIGZ1bmN0aW9uIHNwaWxsT3ZlciAoZWwpIHtcbiAgICBjbGFzc2VzLnJtKGVsLCAnZ3UtaGlkZScpO1xuICB9XG5cbiAgZnVuY3Rpb24gc3BpbGxPdXQgKGVsKSB7XG4gICAgaWYgKGRyYWtlLmRyYWdnaW5nKSB7IGNsYXNzZXMuYWRkKGVsLCAnZ3UtaGlkZScpOyB9XG4gIH1cblxuICBmdW5jdGlvbiByZW5kZXJNaXJyb3JJbWFnZSAoKSB7XG4gICAgaWYgKF9taXJyb3IpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHJlY3QgPSBfaXRlbS5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICBfbWlycm9yID0gX2l0ZW0uY2xvbmVOb2RlKHRydWUpO1xuICAgIF9taXJyb3Iuc3R5bGUud2lkdGggPSBnZXRSZWN0V2lkdGgocmVjdCkgKyAncHgnO1xuICAgIF9taXJyb3Iuc3R5bGUuaGVpZ2h0ID0gZ2V0UmVjdEhlaWdodChyZWN0KSArICdweCc7XG4gICAgY2xhc3Nlcy5ybShfbWlycm9yLCAnZ3UtdHJhbnNpdCcpO1xuICAgIGNsYXNzZXMuYWRkKF9taXJyb3IsICdndS1taXJyb3InKTtcbiAgICBvLm1pcnJvckNvbnRhaW5lci5hcHBlbmRDaGlsZChfbWlycm9yKTtcbiAgICB0b3VjaHkoZG9jdW1lbnRFbGVtZW50LCAnYWRkJywgJ21vdXNlbW92ZScsIGRyYWcpO1xuICAgIGNsYXNzZXMuYWRkKG8ubWlycm9yQ29udGFpbmVyLCAnZ3UtdW5zZWxlY3RhYmxlJyk7XG4gICAgZHJha2UuZW1pdCgnY2xvbmVkJywgX21pcnJvciwgX2l0ZW0sICdtaXJyb3InKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHJlbW92ZU1pcnJvckltYWdlICgpIHtcbiAgICBpZiAoX21pcnJvcikge1xuICAgICAgY2xhc3Nlcy5ybShvLm1pcnJvckNvbnRhaW5lciwgJ2d1LXVuc2VsZWN0YWJsZScpO1xuICAgICAgdG91Y2h5KGRvY3VtZW50RWxlbWVudCwgJ3JlbW92ZScsICdtb3VzZW1vdmUnLCBkcmFnKTtcbiAgICAgIGdldFBhcmVudChfbWlycm9yKS5yZW1vdmVDaGlsZChfbWlycm9yKTtcbiAgICAgIF9taXJyb3IgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGdldEltbWVkaWF0ZUNoaWxkIChkcm9wVGFyZ2V0LCB0YXJnZXQpIHtcbiAgICB2YXIgaW1tZWRpYXRlID0gdGFyZ2V0O1xuICAgIHdoaWxlIChpbW1lZGlhdGUgIT09IGRyb3BUYXJnZXQgJiYgZ2V0UGFyZW50KGltbWVkaWF0ZSkgIT09IGRyb3BUYXJnZXQpIHtcbiAgICAgIGltbWVkaWF0ZSA9IGdldFBhcmVudChpbW1lZGlhdGUpO1xuICAgIH1cbiAgICBpZiAoaW1tZWRpYXRlID09PSBkb2N1bWVudEVsZW1lbnQpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICByZXR1cm4gaW1tZWRpYXRlO1xuICB9XG5cbiAgZnVuY3Rpb24gZ2V0UmVmZXJlbmNlIChkcm9wVGFyZ2V0LCB0YXJnZXQsIHgsIHkpIHtcbiAgICB2YXIgaG9yaXpvbnRhbCA9IG8uZGlyZWN0aW9uID09PSAnaG9yaXpvbnRhbCc7XG4gICAgdmFyIHJlZmVyZW5jZSA9IHRhcmdldCAhPT0gZHJvcFRhcmdldCA/IGluc2lkZSgpIDogb3V0c2lkZSgpO1xuICAgIHJldHVybiByZWZlcmVuY2U7XG5cbiAgICBmdW5jdGlvbiBvdXRzaWRlICgpIHsgLy8gc2xvd2VyLCBidXQgYWJsZSB0byBmaWd1cmUgb3V0IGFueSBwb3NpdGlvblxuICAgICAgdmFyIGxlbiA9IGRyb3BUYXJnZXQuY2hpbGRyZW4ubGVuZ3RoO1xuICAgICAgdmFyIGk7XG4gICAgICB2YXIgZWw7XG4gICAgICB2YXIgcmVjdDtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgICBlbCA9IGRyb3BUYXJnZXQuY2hpbGRyZW5baV07XG4gICAgICAgIHJlY3QgPSBlbC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTtcbiAgICAgICAgaWYgKGhvcml6b250YWwgJiYgKHJlY3QubGVmdCArIHJlY3Qud2lkdGggLyAyKSA+IHgpIHsgcmV0dXJuIGVsOyB9XG4gICAgICAgIGlmICghaG9yaXpvbnRhbCAmJiAocmVjdC50b3AgKyByZWN0LmhlaWdodCAvIDIpID4geSkgeyByZXR1cm4gZWw7IH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGluc2lkZSAoKSB7IC8vIGZhc3RlciwgYnV0IG9ubHkgYXZhaWxhYmxlIGlmIGRyb3BwZWQgaW5zaWRlIGEgY2hpbGQgZWxlbWVudFxuICAgICAgdmFyIHJlY3QgPSB0YXJnZXQuZ2V0Qm91bmRpbmdDbGllbnRSZWN0KCk7XG4gICAgICBpZiAoaG9yaXpvbnRhbCkge1xuICAgICAgICByZXR1cm4gcmVzb2x2ZSh4ID4gcmVjdC5sZWZ0ICsgZ2V0UmVjdFdpZHRoKHJlY3QpIC8gMik7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzb2x2ZSh5ID4gcmVjdC50b3AgKyBnZXRSZWN0SGVpZ2h0KHJlY3QpIC8gMik7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmVzb2x2ZSAoYWZ0ZXIpIHtcbiAgICAgIHJldHVybiBhZnRlciA/IG5leHRFbCh0YXJnZXQpIDogdGFyZ2V0O1xuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIGlzQ29weSAoaXRlbSwgY29udGFpbmVyKSB7XG4gICAgcmV0dXJuIHR5cGVvZiBvLmNvcHkgPT09ICdib29sZWFuJyA/IG8uY29weSA6IG8uY29weShpdGVtLCBjb250YWluZXIpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRvdWNoeSAoZWwsIG9wLCB0eXBlLCBmbikge1xuICB2YXIgdG91Y2ggPSB7XG4gICAgbW91c2V1cDogJ3RvdWNoZW5kJyxcbiAgICBtb3VzZWRvd246ICd0b3VjaHN0YXJ0JyxcbiAgICBtb3VzZW1vdmU6ICd0b3VjaG1vdmUnXG4gIH07XG4gIHZhciBwb2ludGVycyA9IHtcbiAgICBtb3VzZXVwOiAncG9pbnRlcnVwJyxcbiAgICBtb3VzZWRvd246ICdwb2ludGVyZG93bicsXG4gICAgbW91c2Vtb3ZlOiAncG9pbnRlcm1vdmUnXG4gIH07XG4gIHZhciBtaWNyb3NvZnQgPSB7XG4gICAgbW91c2V1cDogJ01TUG9pbnRlclVwJyxcbiAgICBtb3VzZWRvd246ICdNU1BvaW50ZXJEb3duJyxcbiAgICBtb3VzZW1vdmU6ICdNU1BvaW50ZXJNb3ZlJ1xuICB9O1xuICBpZiAoZ2xvYmFsLm5hdmlnYXRvci5wb2ludGVyRW5hYmxlZCkge1xuICAgIGNyb3NzdmVudFtvcF0oZWwsIHBvaW50ZXJzW3R5cGVdLCBmbik7XG4gIH0gZWxzZSBpZiAoZ2xvYmFsLm5hdmlnYXRvci5tc1BvaW50ZXJFbmFibGVkKSB7XG4gICAgY3Jvc3N2ZW50W29wXShlbCwgbWljcm9zb2Z0W3R5cGVdLCBmbik7XG4gIH0gZWxzZSB7XG4gICAgY3Jvc3N2ZW50W29wXShlbCwgdG91Y2hbdHlwZV0sIGZuKTtcbiAgICBjcm9zc3ZlbnRbb3BdKGVsLCB0eXBlLCBmbik7XG4gIH1cbn1cblxuZnVuY3Rpb24gd2hpY2hNb3VzZUJ1dHRvbiAoZSkge1xuICBpZiAoZS50b3VjaGVzICE9PSB2b2lkIDApIHsgcmV0dXJuIGUudG91Y2hlcy5sZW5ndGg7IH1cbiAgaWYgKGUud2hpY2ggIT09IHZvaWQgMCAmJiBlLndoaWNoICE9PSAwKSB7IHJldHVybiBlLndoaWNoOyB9IC8vIHNlZSBodHRwczovL2dpdGh1Yi5jb20vYmV2YWNxdWEvZHJhZ3VsYS9pc3N1ZXMvMjYxXG4gIGlmIChlLmJ1dHRvbnMgIT09IHZvaWQgMCkgeyByZXR1cm4gZS5idXR0b25zOyB9XG4gIHZhciBidXR0b24gPSBlLmJ1dHRvbjtcbiAgaWYgKGJ1dHRvbiAhPT0gdm9pZCAwKSB7IC8vIHNlZSBodHRwczovL2dpdGh1Yi5jb20vanF1ZXJ5L2pxdWVyeS9ibG9iLzk5ZThmZjFiYWE3YWUzNDFlOTRiYjg5YzNlODQ1NzBjN2MzYWQ5ZWEvc3JjL2V2ZW50LmpzI0w1NzMtTDU3NVxuICAgIHJldHVybiBidXR0b24gJiAxID8gMSA6IGJ1dHRvbiAmIDIgPyAzIDogKGJ1dHRvbiAmIDQgPyAyIDogMCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZ2V0T2Zmc2V0IChlbCkge1xuICB2YXIgcmVjdCA9IGVsLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICByZXR1cm4ge1xuICAgIGxlZnQ6IHJlY3QubGVmdCArIGdldFNjcm9sbCgnc2Nyb2xsTGVmdCcsICdwYWdlWE9mZnNldCcpLFxuICAgIHRvcDogcmVjdC50b3AgKyBnZXRTY3JvbGwoJ3Njcm9sbFRvcCcsICdwYWdlWU9mZnNldCcpXG4gIH07XG59XG5cbmZ1bmN0aW9uIGdldFNjcm9sbCAoc2Nyb2xsUHJvcCwgb2Zmc2V0UHJvcCkge1xuICBpZiAodHlwZW9mIGdsb2JhbFtvZmZzZXRQcm9wXSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICByZXR1cm4gZ2xvYmFsW29mZnNldFByb3BdO1xuICB9XG4gIGlmIChkb2N1bWVudEVsZW1lbnQuY2xpZW50SGVpZ2h0KSB7XG4gICAgcmV0dXJuIGRvY3VtZW50RWxlbWVudFtzY3JvbGxQcm9wXTtcbiAgfVxuICByZXR1cm4gZG9jLmJvZHlbc2Nyb2xsUHJvcF07XG59XG5cbmZ1bmN0aW9uIGdldEVsZW1lbnRCZWhpbmRQb2ludCAocG9pbnQsIHgsIHkpIHtcbiAgdmFyIHAgPSBwb2ludCB8fCB7fTtcbiAgdmFyIHN0YXRlID0gcC5jbGFzc05hbWU7XG4gIHZhciBlbDtcbiAgcC5jbGFzc05hbWUgKz0gJyBndS1oaWRlJztcbiAgZWwgPSBkb2MuZWxlbWVudEZyb21Qb2ludCh4LCB5KTtcbiAgcC5jbGFzc05hbWUgPSBzdGF0ZTtcbiAgcmV0dXJuIGVsO1xufVxuXG5mdW5jdGlvbiBuZXZlciAoKSB7IHJldHVybiBmYWxzZTsgfVxuZnVuY3Rpb24gYWx3YXlzICgpIHsgcmV0dXJuIHRydWU7IH1cbmZ1bmN0aW9uIGdldFJlY3RXaWR0aCAocmVjdCkgeyByZXR1cm4gcmVjdC53aWR0aCB8fCAocmVjdC5yaWdodCAtIHJlY3QubGVmdCk7IH1cbmZ1bmN0aW9uIGdldFJlY3RIZWlnaHQgKHJlY3QpIHsgcmV0dXJuIHJlY3QuaGVpZ2h0IHx8IChyZWN0LmJvdHRvbSAtIHJlY3QudG9wKTsgfVxuZnVuY3Rpb24gZ2V0UGFyZW50IChlbCkgeyByZXR1cm4gZWwucGFyZW50Tm9kZSA9PT0gZG9jID8gbnVsbCA6IGVsLnBhcmVudE5vZGU7IH1cbmZ1bmN0aW9uIGlzSW5wdXQgKGVsKSB7IHJldHVybiBlbC50YWdOYW1lID09PSAnSU5QVVQnIHx8IGVsLnRhZ05hbWUgPT09ICdURVhUQVJFQScgfHwgZWwudGFnTmFtZSA9PT0gJ1NFTEVDVCcgfHwgaXNFZGl0YWJsZShlbCk7IH1cbmZ1bmN0aW9uIGlzRWRpdGFibGUgKGVsKSB7XG4gIGlmICghZWwpIHsgcmV0dXJuIGZhbHNlOyB9IC8vIG5vIHBhcmVudHMgd2VyZSBlZGl0YWJsZVxuICBpZiAoZWwuY29udGVudEVkaXRhYmxlID09PSAnZmFsc2UnKSB7IHJldHVybiBmYWxzZTsgfSAvLyBzdG9wIHRoZSBsb29rdXBcbiAgaWYgKGVsLmNvbnRlbnRFZGl0YWJsZSA9PT0gJ3RydWUnKSB7IHJldHVybiB0cnVlOyB9IC8vIGZvdW5kIGEgY29udGVudEVkaXRhYmxlIGVsZW1lbnQgaW4gdGhlIGNoYWluXG4gIHJldHVybiBpc0VkaXRhYmxlKGdldFBhcmVudChlbCkpOyAvLyBjb250ZW50RWRpdGFibGUgaXMgc2V0IHRvICdpbmhlcml0J1xufVxuXG5mdW5jdGlvbiBuZXh0RWwgKGVsKSB7XG4gIHJldHVybiBlbC5uZXh0RWxlbWVudFNpYmxpbmcgfHwgbWFudWFsbHkoKTtcbiAgZnVuY3Rpb24gbWFudWFsbHkgKCkge1xuICAgIHZhciBzaWJsaW5nID0gZWw7XG4gICAgZG8ge1xuICAgICAgc2libGluZyA9IHNpYmxpbmcubmV4dFNpYmxpbmc7XG4gICAgfSB3aGlsZSAoc2libGluZyAmJiBzaWJsaW5nLm5vZGVUeXBlICE9PSAxKTtcbiAgICByZXR1cm4gc2libGluZztcbiAgfVxufVxuXG5mdW5jdGlvbiBnZXRFdmVudEhvc3QgKGUpIHtcbiAgLy8gb24gdG91Y2hlbmQgZXZlbnQsIHdlIGhhdmUgdG8gdXNlIGBlLmNoYW5nZWRUb3VjaGVzYFxuICAvLyBzZWUgaHR0cDovL3N0YWNrb3ZlcmZsb3cuY29tL3F1ZXN0aW9ucy83MTkyNTYzL3RvdWNoZW5kLWV2ZW50LXByb3BlcnRpZXNcbiAgLy8gc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9iZXZhY3F1YS9kcmFndWxhL2lzc3Vlcy8zNFxuICBpZiAoZS50YXJnZXRUb3VjaGVzICYmIGUudGFyZ2V0VG91Y2hlcy5sZW5ndGgpIHtcbiAgICByZXR1cm4gZS50YXJnZXRUb3VjaGVzWzBdO1xuICB9XG4gIGlmIChlLmNoYW5nZWRUb3VjaGVzICYmIGUuY2hhbmdlZFRvdWNoZXMubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGUuY2hhbmdlZFRvdWNoZXNbMF07XG4gIH1cbiAgcmV0dXJuIGU7XG59XG5cbmZ1bmN0aW9uIGdldENvb3JkIChjb29yZCwgZSkge1xuICB2YXIgaG9zdCA9IGdldEV2ZW50SG9zdChlKTtcbiAgdmFyIG1pc3NNYXAgPSB7XG4gICAgcGFnZVg6ICdjbGllbnRYJywgLy8gSUU4XG4gICAgcGFnZVk6ICdjbGllbnRZJyAvLyBJRThcbiAgfTtcbiAgaWYgKGNvb3JkIGluIG1pc3NNYXAgJiYgIShjb29yZCBpbiBob3N0KSAmJiBtaXNzTWFwW2Nvb3JkXSBpbiBob3N0KSB7XG4gICAgY29vcmQgPSBtaXNzTWFwW2Nvb3JkXTtcbiAgfVxuICByZXR1cm4gaG9zdFtjb29yZF07XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZHJhZ3VsYTtcbiIsIm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gYXRvYSAoYSwgbikgeyByZXR1cm4gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYSwgbik7IH1cbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHRpY2t5ID0gcmVxdWlyZSgndGlja3knKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBkZWJvdW5jZSAoZm4sIGFyZ3MsIGN0eCkge1xuICBpZiAoIWZuKSB7IHJldHVybjsgfVxuICB0aWNreShmdW5jdGlvbiBydW4gKCkge1xuICAgIGZuLmFwcGx5KGN0eCB8fCBudWxsLCBhcmdzIHx8IFtdKTtcbiAgfSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgYXRvYSA9IHJlcXVpcmUoJ2F0b2EnKTtcbnZhciBkZWJvdW5jZSA9IHJlcXVpcmUoJy4vZGVib3VuY2UnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBlbWl0dGVyICh0aGluZywgb3B0aW9ucykge1xuICB2YXIgb3B0cyA9IG9wdGlvbnMgfHwge307XG4gIHZhciBldnQgPSB7fTtcbiAgaWYgKHRoaW5nID09PSB1bmRlZmluZWQpIHsgdGhpbmcgPSB7fTsgfVxuICB0aGluZy5vbiA9IGZ1bmN0aW9uICh0eXBlLCBmbikge1xuICAgIGlmICghZXZ0W3R5cGVdKSB7XG4gICAgICBldnRbdHlwZV0gPSBbZm5dO1xuICAgIH0gZWxzZSB7XG4gICAgICBldnRbdHlwZV0ucHVzaChmbik7XG4gICAgfVxuICAgIHJldHVybiB0aGluZztcbiAgfTtcbiAgdGhpbmcub25jZSA9IGZ1bmN0aW9uICh0eXBlLCBmbikge1xuICAgIGZuLl9vbmNlID0gdHJ1ZTsgLy8gdGhpbmcub2ZmKGZuKSBzdGlsbCB3b3JrcyFcbiAgICB0aGluZy5vbih0eXBlLCBmbik7XG4gICAgcmV0dXJuIHRoaW5nO1xuICB9O1xuICB0aGluZy5vZmYgPSBmdW5jdGlvbiAodHlwZSwgZm4pIHtcbiAgICB2YXIgYyA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgaWYgKGMgPT09IDEpIHtcbiAgICAgIGRlbGV0ZSBldnRbdHlwZV07XG4gICAgfSBlbHNlIGlmIChjID09PSAwKSB7XG4gICAgICBldnQgPSB7fTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGV0ID0gZXZ0W3R5cGVdO1xuICAgICAgaWYgKCFldCkgeyByZXR1cm4gdGhpbmc7IH1cbiAgICAgIGV0LnNwbGljZShldC5pbmRleE9mKGZuKSwgMSk7XG4gICAgfVxuICAgIHJldHVybiB0aGluZztcbiAgfTtcbiAgdGhpbmcuZW1pdCA9IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgYXJncyA9IGF0b2EoYXJndW1lbnRzKTtcbiAgICByZXR1cm4gdGhpbmcuZW1pdHRlclNuYXBzaG90KGFyZ3Muc2hpZnQoKSkuYXBwbHkodGhpcywgYXJncyk7XG4gIH07XG4gIHRoaW5nLmVtaXR0ZXJTbmFwc2hvdCA9IGZ1bmN0aW9uICh0eXBlKSB7XG4gICAgdmFyIGV0ID0gKGV2dFt0eXBlXSB8fCBbXSkuc2xpY2UoMCk7XG4gICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgIHZhciBhcmdzID0gYXRvYShhcmd1bWVudHMpO1xuICAgICAgdmFyIGN0eCA9IHRoaXMgfHwgdGhpbmc7XG4gICAgICBpZiAodHlwZSA9PT0gJ2Vycm9yJyAmJiBvcHRzLnRocm93cyAhPT0gZmFsc2UgJiYgIWV0Lmxlbmd0aCkgeyB0aHJvdyBhcmdzLmxlbmd0aCA9PT0gMSA/IGFyZ3NbMF0gOiBhcmdzOyB9XG4gICAgICBldC5mb3JFYWNoKGZ1bmN0aW9uIGVtaXR0ZXIgKGxpc3Rlbikge1xuICAgICAgICBpZiAob3B0cy5hc3luYykgeyBkZWJvdW5jZShsaXN0ZW4sIGFyZ3MsIGN0eCk7IH0gZWxzZSB7IGxpc3Rlbi5hcHBseShjdHgsIGFyZ3MpOyB9XG4gICAgICAgIGlmIChsaXN0ZW4uX29uY2UpIHsgdGhpbmcub2ZmKHR5cGUsIGxpc3Rlbik7IH1cbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHRoaW5nO1xuICAgIH07XG4gIH07XG4gIHJldHVybiB0aGluZztcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjdXN0b21FdmVudCA9IHJlcXVpcmUoJ2N1c3RvbS1ldmVudCcpO1xudmFyIGV2ZW50bWFwID0gcmVxdWlyZSgnLi9ldmVudG1hcCcpO1xudmFyIGRvYyA9IGdsb2JhbC5kb2N1bWVudDtcbnZhciBhZGRFdmVudCA9IGFkZEV2ZW50RWFzeTtcbnZhciByZW1vdmVFdmVudCA9IHJlbW92ZUV2ZW50RWFzeTtcbnZhciBoYXJkQ2FjaGUgPSBbXTtcblxuaWYgKCFnbG9iYWwuYWRkRXZlbnRMaXN0ZW5lcikge1xuICBhZGRFdmVudCA9IGFkZEV2ZW50SGFyZDtcbiAgcmVtb3ZlRXZlbnQgPSByZW1vdmVFdmVudEhhcmQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBhZGQ6IGFkZEV2ZW50LFxuICByZW1vdmU6IHJlbW92ZUV2ZW50LFxuICBmYWJyaWNhdGU6IGZhYnJpY2F0ZUV2ZW50XG59O1xuXG5mdW5jdGlvbiBhZGRFdmVudEVhc3kgKGVsLCB0eXBlLCBmbiwgY2FwdHVyaW5nKSB7XG4gIHJldHVybiBlbC5hZGRFdmVudExpc3RlbmVyKHR5cGUsIGZuLCBjYXB0dXJpbmcpO1xufVxuXG5mdW5jdGlvbiBhZGRFdmVudEhhcmQgKGVsLCB0eXBlLCBmbikge1xuICByZXR1cm4gZWwuYXR0YWNoRXZlbnQoJ29uJyArIHR5cGUsIHdyYXAoZWwsIHR5cGUsIGZuKSk7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZUV2ZW50RWFzeSAoZWwsIHR5cGUsIGZuLCBjYXB0dXJpbmcpIHtcbiAgcmV0dXJuIGVsLnJlbW92ZUV2ZW50TGlzdGVuZXIodHlwZSwgZm4sIGNhcHR1cmluZyk7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZUV2ZW50SGFyZCAoZWwsIHR5cGUsIGZuKSB7XG4gIHZhciBsaXN0ZW5lciA9IHVud3JhcChlbCwgdHlwZSwgZm4pO1xuICBpZiAobGlzdGVuZXIpIHtcbiAgICByZXR1cm4gZWwuZGV0YWNoRXZlbnQoJ29uJyArIHR5cGUsIGxpc3RlbmVyKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBmYWJyaWNhdGVFdmVudCAoZWwsIHR5cGUsIG1vZGVsKSB7XG4gIHZhciBlID0gZXZlbnRtYXAuaW5kZXhPZih0eXBlKSA9PT0gLTEgPyBtYWtlQ3VzdG9tRXZlbnQoKSA6IG1ha2VDbGFzc2ljRXZlbnQoKTtcbiAgaWYgKGVsLmRpc3BhdGNoRXZlbnQpIHtcbiAgICBlbC5kaXNwYXRjaEV2ZW50KGUpO1xuICB9IGVsc2Uge1xuICAgIGVsLmZpcmVFdmVudCgnb24nICsgdHlwZSwgZSk7XG4gIH1cbiAgZnVuY3Rpb24gbWFrZUNsYXNzaWNFdmVudCAoKSB7XG4gICAgdmFyIGU7XG4gICAgaWYgKGRvYy5jcmVhdGVFdmVudCkge1xuICAgICAgZSA9IGRvYy5jcmVhdGVFdmVudCgnRXZlbnQnKTtcbiAgICAgIGUuaW5pdEV2ZW50KHR5cGUsIHRydWUsIHRydWUpO1xuICAgIH0gZWxzZSBpZiAoZG9jLmNyZWF0ZUV2ZW50T2JqZWN0KSB7XG4gICAgICBlID0gZG9jLmNyZWF0ZUV2ZW50T2JqZWN0KCk7XG4gICAgfVxuICAgIHJldHVybiBlO1xuICB9XG4gIGZ1bmN0aW9uIG1ha2VDdXN0b21FdmVudCAoKSB7XG4gICAgcmV0dXJuIG5ldyBjdXN0b21FdmVudCh0eXBlLCB7IGRldGFpbDogbW9kZWwgfSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gd3JhcHBlckZhY3RvcnkgKGVsLCB0eXBlLCBmbikge1xuICByZXR1cm4gZnVuY3Rpb24gd3JhcHBlciAob3JpZ2luYWxFdmVudCkge1xuICAgIHZhciBlID0gb3JpZ2luYWxFdmVudCB8fCBnbG9iYWwuZXZlbnQ7XG4gICAgZS50YXJnZXQgPSBlLnRhcmdldCB8fCBlLnNyY0VsZW1lbnQ7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCA9IGUucHJldmVudERlZmF1bHQgfHwgZnVuY3Rpb24gcHJldmVudERlZmF1bHQgKCkgeyBlLnJldHVyblZhbHVlID0gZmFsc2U7IH07XG4gICAgZS5zdG9wUHJvcGFnYXRpb24gPSBlLnN0b3BQcm9wYWdhdGlvbiB8fCBmdW5jdGlvbiBzdG9wUHJvcGFnYXRpb24gKCkgeyBlLmNhbmNlbEJ1YmJsZSA9IHRydWU7IH07XG4gICAgZS53aGljaCA9IGUud2hpY2ggfHwgZS5rZXlDb2RlO1xuICAgIGZuLmNhbGwoZWwsIGUpO1xuICB9O1xufVxuXG5mdW5jdGlvbiB3cmFwIChlbCwgdHlwZSwgZm4pIHtcbiAgdmFyIHdyYXBwZXIgPSB1bndyYXAoZWwsIHR5cGUsIGZuKSB8fCB3cmFwcGVyRmFjdG9yeShlbCwgdHlwZSwgZm4pO1xuICBoYXJkQ2FjaGUucHVzaCh7XG4gICAgd3JhcHBlcjogd3JhcHBlcixcbiAgICBlbGVtZW50OiBlbCxcbiAgICB0eXBlOiB0eXBlLFxuICAgIGZuOiBmblxuICB9KTtcbiAgcmV0dXJuIHdyYXBwZXI7XG59XG5cbmZ1bmN0aW9uIHVud3JhcCAoZWwsIHR5cGUsIGZuKSB7XG4gIHZhciBpID0gZmluZChlbCwgdHlwZSwgZm4pO1xuICBpZiAoaSkge1xuICAgIHZhciB3cmFwcGVyID0gaGFyZENhY2hlW2ldLndyYXBwZXI7XG4gICAgaGFyZENhY2hlLnNwbGljZShpLCAxKTsgLy8gZnJlZSB1cCBhIHRhZCBvZiBtZW1vcnlcbiAgICByZXR1cm4gd3JhcHBlcjtcbiAgfVxufVxuXG5mdW5jdGlvbiBmaW5kIChlbCwgdHlwZSwgZm4pIHtcbiAgdmFyIGksIGl0ZW07XG4gIGZvciAoaSA9IDA7IGkgPCBoYXJkQ2FjaGUubGVuZ3RoOyBpKyspIHtcbiAgICBpdGVtID0gaGFyZENhY2hlW2ldO1xuICAgIGlmIChpdGVtLmVsZW1lbnQgPT09IGVsICYmIGl0ZW0udHlwZSA9PT0gdHlwZSAmJiBpdGVtLmZuID09PSBmbikge1xuICAgICAgcmV0dXJuIGk7XG4gICAgfVxuICB9XG59XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBldmVudG1hcCA9IFtdO1xudmFyIGV2ZW50bmFtZSA9ICcnO1xudmFyIHJvbiA9IC9eb24vO1xuXG5mb3IgKGV2ZW50bmFtZSBpbiBnbG9iYWwpIHtcbiAgaWYgKHJvbi50ZXN0KGV2ZW50bmFtZSkpIHtcbiAgICBldmVudG1hcC5wdXNoKGV2ZW50bmFtZS5zbGljZSgyKSk7XG4gIH1cbn1cblxubW9kdWxlLmV4cG9ydHMgPSBldmVudG1hcDtcbiIsIlxudmFyIE5hdGl2ZUN1c3RvbUV2ZW50ID0gZ2xvYmFsLkN1c3RvbUV2ZW50O1xuXG5mdW5jdGlvbiB1c2VOYXRpdmUgKCkge1xuICB0cnkge1xuICAgIHZhciBwID0gbmV3IE5hdGl2ZUN1c3RvbUV2ZW50KCdjYXQnLCB7IGRldGFpbDogeyBmb286ICdiYXInIH0gfSk7XG4gICAgcmV0dXJuICAnY2F0JyA9PT0gcC50eXBlICYmICdiYXInID09PSBwLmRldGFpbC5mb287XG4gIH0gY2F0Y2ggKGUpIHtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKlxuICogQ3Jvc3MtYnJvd3NlciBgQ3VzdG9tRXZlbnRgIGNvbnN0cnVjdG9yLlxuICpcbiAqIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9DdXN0b21FdmVudC5DdXN0b21FdmVudFxuICpcbiAqIEBwdWJsaWNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IHVzZU5hdGl2ZSgpID8gTmF0aXZlQ3VzdG9tRXZlbnQgOlxuXG4vLyBJRSA+PSA5XG4nZnVuY3Rpb24nID09PSB0eXBlb2YgZG9jdW1lbnQuY3JlYXRlRXZlbnQgPyBmdW5jdGlvbiBDdXN0b21FdmVudCAodHlwZSwgcGFyYW1zKSB7XG4gIHZhciBlID0gZG9jdW1lbnQuY3JlYXRlRXZlbnQoJ0N1c3RvbUV2ZW50Jyk7XG4gIGlmIChwYXJhbXMpIHtcbiAgICBlLmluaXRDdXN0b21FdmVudCh0eXBlLCBwYXJhbXMuYnViYmxlcywgcGFyYW1zLmNhbmNlbGFibGUsIHBhcmFtcy5kZXRhaWwpO1xuICB9IGVsc2Uge1xuICAgIGUuaW5pdEN1c3RvbUV2ZW50KHR5cGUsIGZhbHNlLCBmYWxzZSwgdm9pZCAwKTtcbiAgfVxuICByZXR1cm4gZTtcbn0gOlxuXG4vLyBJRSA8PSA4XG5mdW5jdGlvbiBDdXN0b21FdmVudCAodHlwZSwgcGFyYW1zKSB7XG4gIHZhciBlID0gZG9jdW1lbnQuY3JlYXRlRXZlbnRPYmplY3QoKTtcbiAgZS50eXBlID0gdHlwZTtcbiAgaWYgKHBhcmFtcykge1xuICAgIGUuYnViYmxlcyA9IEJvb2xlYW4ocGFyYW1zLmJ1YmJsZXMpO1xuICAgIGUuY2FuY2VsYWJsZSA9IEJvb2xlYW4ocGFyYW1zLmNhbmNlbGFibGUpO1xuICAgIGUuZGV0YWlsID0gcGFyYW1zLmRldGFpbDtcbiAgfSBlbHNlIHtcbiAgICBlLmJ1YmJsZXMgPSBmYWxzZTtcbiAgICBlLmNhbmNlbGFibGUgPSBmYWxzZTtcbiAgICBlLmRldGFpbCA9IHZvaWQgMDtcbiAgfVxuICByZXR1cm4gZTtcbn1cbiIsInZhciBzaSA9IHR5cGVvZiBzZXRJbW1lZGlhdGUgPT09ICdmdW5jdGlvbicsIHRpY2s7XG5pZiAoc2kpIHtcbiAgdGljayA9IGZ1bmN0aW9uIChmbikgeyBzZXRJbW1lZGlhdGUoZm4pOyB9O1xufSBlbHNlIHtcbiAgdGljayA9IGZ1bmN0aW9uIChmbikgeyBzZXRUaW1lb3V0KGZuLCAwKTsgfTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB0aWNrOyIsIihmdW5jdGlvbiAoJCwgRHJ1cGFsLCBkcnVwYWxTZXR0aW5ncywgQ0tFRElUT1IpIHtcblxuICBEcnVwYWwuYmVoYXZpb3JzLmRyYWdnYWJsZUl0ZW1zID0ge1xuICAgIGF0dGFjaDogZnVuY3Rpb24gKGNvbnRleHQsIHNldHRpbmdzKSB7XG5cbiAgICAgICQoJy5kcmFnZ2FibGUtaXRlbXMtY29udGFpbmVyJykuZWFjaChmdW5jdGlvbihlKSB7XG4gICAgICAgIGlmICghJCh0aGlzKS5oYXNDbGFzcygnZHJhZ3VsYS1wcm9jZXNzZWQnKSkge1xuICAgICAgICAgIGluaXREcmFnZ2FibGVJdGVtcygkKHRoaXMpKTtcbiAgICAgICAgICAkKHRoaXMpLmFkZENsYXNzKCdkcmFndWxhLXByb2Nlc3NlZCcpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgIH1cbiAgfTtcblxuICAvLyBNYWtlIHN1cmUgdGhpcyBXQVMgYSB3eXNpd3lnIGluaXRpYWxseSwgbm90IGFueSB0ZXh0YXJlYSwgbWF5YmUgc2VsZWN0b3JzIG9yIHNvbWV0aGluZ1xuICBmdW5jdGlvbiBpbml0Q2tlZGl0b3JGcm9tU2F2ZWRTdGF0dXMoZWwsIGRyYWdnZWRJdGVtcykge1xuICAgICQuZWFjaChkcmFnZ2VkSXRlbXMsIGZ1bmN0aW9uKGksIHZhbHVlKSB7XG4gICAgICBpZiAoJChlbCkuZmluZCgnIycrdmFsdWUuaWQpLmxlbmd0aCAmJiB2YWx1ZS5jb25maWcpIHtcbiAgICAgICAgdmFyIG5ld0VkaXRvciA9IENLRURJVE9SLnJlcGxhY2UodmFsdWUuaWQsIHZhbHVlLmNvbmZpZyk7XG4gICAgICAgIG5ld0VkaXRvci5vbignaW5zdGFuY2VSZWFkeScsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIG5ld0VkaXRvci5zZXREYXRhKHZhbHVlLmNvbnRlbnQpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGluaXREcmFnZ2FibGVJdGVtcygkZHJhZ2dhYmxlSXRlbUNvbnRhaW5lcnMpIHtcbiAgICAvLyBEZWNsYXJlIHZhcmlhYmxlcyBmb3IgdGhlIGN1cnJlbnRseSBkcmFnZ2VkIGl0ZW0gc28gdGhleSBjYW4gYmUgYWNjZXNzZWQgaW4gYW55IGV2ZW4gaGFuZGxlclxuICAgIHZhciBkcmFnZ2VkSXRlbXMgPSBbXTtcblxuICAgIC8vIEluaXRpYWxpemUgZHJhZ3VsYSBvbiBkcmFnZ2FibGUgY29udGFpbmVyc1xuICAgIHZhciBkcmFrZSA9IGRyYWd1bGEoWyRkcmFnZ2FibGVJdGVtQ29udGFpbmVyc1swXV0sIHtcbiAgICAgIC8vIE9ubHkgaGFuZGxlIGRyYWdzIGl0ZW1zXG4gICAgICBtb3ZlczogZnVuY3Rpb24gKGVsLCBjb250YWluZXIsIGhhbmRsZSkge1xuICAgICAgICByZXR1cm4gJChlbCkuY2hpbGRyZW4oJy5kcmFndWxhLWhhbmRsZScpWzBdID09PSAkKGhhbmRsZSlbMF07XG4gICAgICB9LFxuICAgICAgLy8gRHJvcCBjYW4gb25seSBoYXBwZW4gaW4gc291cmNlIGVsZW1lbnRcbiAgICAgIGFjY2VwdHM6IGZ1bmN0aW9uIChlbCwgdGFyZ2V0LCBzb3VyY2UsIHNpYmxpbmcpIHtcbiAgICAgICAgcmV0dXJuIHRhcmdldCA9PT0gc291cmNlO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gT24gZHJvcCB3ZSBuZWVkIHRvIHJlY3JlYXRlIHRoZSBlZGl0b3IgZnJvbSBzYXZlZCBjb25maWdcbiAgICBkcmFrZS5vbignZHJvcCcsIGZ1bmN0aW9uKGVsLCB0YXJnZXQsIHNvdXJjZSwgc2libGluZykge1xuICAgICAgYWRqdXN0T3JkZXIoZHJha2UpO1xuICAgICAgaW5pdENrZWRpdG9yRnJvbVNhdmVkU3RhdHVzKGVsLCBkcmFnZ2VkSXRlbXMpO1xuICAgIH0pO1xuXG4gICAgLy8gT24gY2FuY2VsIHdlIG5lZWQgdG8gcmVjcmVhdGUgdGhlIGVkaXRvciBmcm9tIHNhdmVkIGNvbmZpZ1xuICAgIGRyYWtlLm9uKCdjYW5jZWwnLCBmdW5jdGlvbihlbCwgY29udGFpbmVyLCBzb3VyY2UpIHtcbiAgICAgIGluaXRDa2VkaXRvckZyb21TYXZlZFN0YXR1cyhlbCwgZHJhZ2dlZEl0ZW1zKTtcbiAgICB9KTtcblxuICAgIC8vIE9uIGRyYWcgc3RhcnQgd2UgbmVlZCB0byBzYXZlIHRoZSBjb25maWcgZnJvbSB0aGUgY2tlZGl0b3IgaW5zdGFuY2UgYW5kIGRlc3Ryb3kgaXRcbiAgICBkcmFrZS5vbignZHJhZycsIGZ1bmN0aW9uKGVsLCBzb3VyY2UpIHtcbiAgICAgIC8vIE9uIGRyYWcgc3RhcnQsIHJlc2V0IHRoZSBhcnJheSB0byBlbXB0eSBzbyB5b3UgZG9uJ3QgdHJ5IHRvIGluaXRpYWxpemUgdGhlIHNhbWUgZWxlbWVudCBtdWx0aXBsZSB0aW1lc1xuICAgICAgZHJhZ2dlZEl0ZW1zID0gW107XG4gICAgICAvLyBHZXQgaWQgZnJvbSB0ZXh0YXJlYVxuICAgICAgdmFyICR3eXNpd3lncyA9ICQoZWwpLmZpbmQoJy5ja2UnKS5zaWJsaW5ncygndGV4dGFyZWEnKTtcbiAgICAgICR3eXNpd3lncy5lYWNoKGZ1bmN0aW9uKGksIGVsKSB7XG4gICAgICAgIHZhciBkcmFnZ2VkSXRlbUlkID0gJCh0aGlzKS5hdHRyKCdpZCcpO1xuICAgICAgICBpZiAoQ0tFRElUT1IuaW5zdGFuY2VzW2RyYWdnZWRJdGVtSWRdKSB7XG4gICAgICAgICAgdmFyIGRyYWdnZWRJdGVtSW5zdGFuY2UgPSBDS0VESVRPUi5pbnN0YW5jZXNbZHJhZ2dlZEl0ZW1JZF07XG4gICAgICAgICAgdmFyIGRyYWdnZWRJdGVtQ29uZmlnID0gZHJhZ2dlZEl0ZW1JbnN0YW5jZS5jb25maWc7XG4gICAgICAgICAgdmFyIGRyYWdnZWRJdGVtQ29udGVudCA9IGRyYWdnZWRJdGVtSW5zdGFuY2UuZ2V0RGF0YSgpO1xuICAgICAgICAgIGRyYWdnZWRJdGVtcy5wdXNoKHtcbiAgICAgICAgICAgIGlkOiBkcmFnZ2VkSXRlbUlkLFxuICAgICAgICAgICAgaW5zdGFuY2U6IGRyYWdnZWRJdGVtSW5zdGFuY2UsXG4gICAgICAgICAgICBjb25maWc6IGRyYWdnZWRJdGVtQ29uZmlnLFxuICAgICAgICAgICAgY29udGVudDogZHJhZ2dlZEl0ZW1Db250ZW50XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaWYgKGRyYWdnZWRJdGVtSW5zdGFuY2UpIHsgZHJhZ2dlZEl0ZW1JbnN0YW5jZS5kZXN0cm95KHRydWUpOyB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gSW5pdCBkb20tYXV0b3Njcm9sbGVyIGZvciBlYWNoIGRyYWtlIGluc3RhbmNlXG4gICAgdmFyIHNjcm9sbCA9IGF1dG9TY3JvbGwoW1xuICAgICAgd2luZG93XG4gICAgXSx7XG4gICAgICBtYXJnaW46IDcwLFxuICAgICAgbWF4U3BlZWQ6IDE0LFxuICAgICAgYXV0b1Njcm9sbDogZnVuY3Rpb24oKXtcbiAgICAgICAgcmV0dXJuIHRoaXMuZG93biAmJiBkcmFrZS5kcmFnZ2luZztcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGFkanVzdE9yZGVyKGRyYWd1bGFPYmplY3QpIHtcbiAgICB2YXIgJGRyYWdnYWJsZUl0ZW1zID0gJChkcmFndWxhT2JqZWN0LmNvbnRhaW5lcnNbMF0pLmNoaWxkcmVuKCk7XG4gICAgJGRyYWdnYWJsZUl0ZW1zLmVhY2goZnVuY3Rpb24oaSwgZWwpIHtcbiAgICAgIC8vIEJlY2F1c2UgZHJ1cGFsIGhhcyBubyB1c2VmdWwgc2VsZWN0b3JzIG9uIHRoZSBhZG1pbiBzaWRlIGFuZCBhZGRzIHdyYXBwZXJzIGZvciBuZXdseSBjcmVhdGVkIHBhcmFncmFwaHMsXG4gICAgICAvLyB3ZSBuZWVkIHRvIGRvIHRoaXMgaGFua3kgcGFua3kgdG8gbWFrZSBzdXJlIHdlIGFyZSBvbmx5IGFkanVzdGluZyB0aGUgd2VpZ2h0cyBvZiB0aGUgY3VycmVudGx5IGFkanVzdGVkIGl0ZW1zXG4gICAgICB2YXIgJHdlaWdodFNlbGVjdCA9ICQodGhpcykuY2hpbGRyZW4oJ2RpdicpLmNoaWxkcmVuKCdkaXYnKS5jaGlsZHJlbignLmZvcm0tdHlwZS1zZWxlY3QnKS5jaGlsZHJlbignc2VsZWN0JyksXG4gICAgICAgICAgJHdlaWdodFNlbGVjdEFqYXggPSAkKHRoaXMpLmNoaWxkcmVuKCcuYWpheC1uZXctY29udGVudCcpLmNoaWxkcmVuKCdkaXYnKS5jaGlsZHJlbignZGl2JykuY2hpbGRyZW4oJy5mb3JtLXR5cGUtc2VsZWN0JykuY2hpbGRyZW4oJ3NlbGVjdCcpO1xuICAgICAgaWYgKCR3ZWlnaHRTZWxlY3QubGVuZ3RoID4gMCkge1xuICAgICAgICAkd2VpZ2h0U2VsZWN0LnZhbChpKTtcbiAgICAgIH0gZWxzZSBpZiAoJHdlaWdodFNlbGVjdEFqYXgubGVuZ3RoID4gMCkge1xuICAgICAgICAkd2VpZ2h0U2VsZWN0QWpheC52YWwoaSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmxvZygnRXJyb3I6IENhbm5vdCBmaW5kIHZhbGlkIHBhcmFncmFwaCB3ZWlnaHQgdG8gYWRqdXN0IScpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbn0pKGpRdWVyeSwgRHJ1cGFsLCBkcnVwYWxTZXR0aW5ncywgQ0tFRElUT1IpOyIsIi8qKlxuICogQGZpbGUgZW50aXR5LWJyb3dzZXItaW1wcm92ZW1lbnRzLmpzXG4gKlxuICogQWRkcyBleHRyYSBVSSBpbXByb3ZlbWVudHMgdG8gYWxsIGVudGl0eSBicm93c2VycyBpbiB0aGUgYWRtaW4gdGhlbWUuXG4gKi9cblxuIWZ1bmN0aW9uKCQpe1xuICBcInVzZSBzdHJpY3RcIjtcblxuICBEcnVwYWwuYmVoYXZpb3JzLmVudGl0eUJyb3dzZXJJbXByb3ZlciA9IHtcbiAgICBhdHRhY2g6IGZ1bmN0aW9uKGNvbnRleHQsIHNldHRpbmdzKSB7XG4gICAgICBsZXQgJGJyb3dzZXJDb2wgPSAkKCcuZW50aXR5LWJyb3dzZXItZm9ybSAudmlld3MtY29sJywgY29udGV4dCk7XG5cbiAgICAgICRicm93c2VyQ29sLmNsaWNrKGZ1bmN0aW9uKCkge1xuICAgICAgICBsZXQgJGNoZWNrYm94ID0gJCh0aGlzKS5maW5kKCdpbnB1dFt0eXBlPVwiY2hlY2tib3hcIl0nKTtcblxuICAgICAgICAkY2hlY2tib3gucHJvcChcImNoZWNrZWRcIiwgISRjaGVja2JveC5wcm9wKFwiY2hlY2tlZFwiKSk7XG4gICAgICAgICQodGhpcykudG9nZ2xlQ2xhc3MoJ2NvbHVtbi1zZWxlY3RlZCcpO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xuXG59KGpRdWVyeSk7IiwiLyoqXG4gKiBwYXJhZ3JhcGhzLWltcHJvdmVtZW50cy5qc1xuICogSW1wcm92ZSB0aGUgcGFyYWdyYXBocyBhZG1pbiB1aVxuICovXG5cbiFmdW5jdGlvbigkKXtcbiAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgRHJ1cGFsLmJlaGF2aW9ycy5wYXJhZ3JhcGhzUHJldmlld2VySW1wcm92ZXIgPSB7XG4gICAgYXR0YWNoOiBmdW5jdGlvbihjb250ZXh0LCBzZXR0aW5ncykge1xuICAgICAgdmFyICRwcmV2aWV3ZXJCdXR0b25zID0gJCgnLmxpbmsucGFyYWdyYXBocy1wcmV2aWV3ZXInLCBjb250ZXh0KTtcblxuICAgICAgJHByZXZpZXdlckJ1dHRvbnMuZWFjaCgoaSwgZWwpID0+IHtcbiAgICAgICAgdmFyICRwcmV2aWV3ZXJCdXR0b24gPSAkKGVsKTtcbiAgICAgICAgcmVwbGFjZVBhcmFncmFwaE5hbWUoJHByZXZpZXdlckJ1dHRvbik7XG4gICAgICB9KTtcblxuICAgICAgLy8gR2V0IHBhcmFncmFwaHMgcHJldmlld3MgYnkgb25seSB0YXJnZXRpbmcgb25lcyB3aXRoIHRoZSAucGFyYWdyYXBoLXR5cGUtdG9wIGFzIGEgc2libGluZ1xuICAgICAgLy8gc28gbmVzdGVkIHBhcmFncmFwaHMgcHJldmlld3MgZG9uJ3QgYnJlYWtcbiAgICAgIHZhciAkcGFyYWdyYXBoc1RvcEVsZW1lbnRzID0gJCgnLnBhcmFncmFwaC10eXBlLXRvcCcsIGNvbnRleHQpO1xuICAgICAgdmFyICRwYXJhZ3JhcGhzUHJldmlld3MgPSAkcGFyYWdyYXBoc1RvcEVsZW1lbnRzLnNpYmxpbmdzKCcucGFyYWdyYXBoLS12aWV3LW1vZGUtLXByZXZpZXcnKTtcblxuICAgICAgZm9ybWF0UGFyYWdyYXBoc1ByZXZpZXdzKCRwYXJhZ3JhcGhzUHJldmlld3MpO1xuXG4gICAgICAvLyBOZWNlc3NhcnkgZm9yIHBhcmFncmFwaHMgcHJldmlld3MgYmVoaW5kIHRhYnNcbiAgICAgICQoJy52ZXJ0aWNhbC10YWJzX19tZW51IGEnKS5vbihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgZm9ybWF0UGFyYWdyYXBoc1ByZXZpZXdzKCRwYXJhZ3JhcGhzUHJldmlld3MpO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xuXG4gIC8vIEJlY2F1c2UgZHJ1cGFsIGJlaGF2aW9ycyBhcmUgc28gYW5ub3lpbmcsIGFkZCBkZWxlZ2F0ZWQgY2xpY2sgaGFuZGxlciBoZXJlLCBjb3VsZG4ndCBnZXQgaXQgdG8gd29yayBwcm9wZXJseVxuICAvLyBpbnNpZGUgdGhlIGJlaGF2aW9yXG4gICQoZG9jdW1lbnQpLnJlYWR5KGZ1bmN0aW9uKCkge1xuICAgICQoJ2JvZHknKS5vbignY2xpY2snLCAnLnBhcmFncmFwaC0tdmlldy1tb2RlLS1wcmV2aWV3JywgZnVuY3Rpb24oKSB7XG4gICAgICAkKHRoaXMpLnRvZ2dsZUNsYXNzKCdleHBhbmRlZCcpO1xuICAgIH0pO1xuICB9KTtcblxuICAvKipcbiAgICogQWRkIHRoZSB0eXBlIHRvIHRoZSBwcmV2aWV3ZXIgYnV0dG9uIGlmIHlvdSB3YW50XG4gICAqIEBwYXJhbSBwcmV2aWV3ZXJCdXR0b25cbiAgICovXG4gIGZ1bmN0aW9uIHJlcGxhY2VQYXJhZ3JhcGhOYW1lKHByZXZpZXdlckJ1dHRvbikge1xuICAgIHZhciBwYXJhZ3JhcGhOYW1lID0gcHJldmlld2VyQnV0dG9uLnNpYmxpbmdzKCcucGFyYWdyYXBoLXR5cGUtdGl0bGUnKS50ZXh0KCk7XG4gICAgcHJldmlld2VyQnV0dG9uLnZhbChgUHJldmlldzogJHtwYXJhZ3JhcGhOYW1lfWApO1xuICB9XG5cbiAgLyoqXG4gICAqIEZvcm1hdCB0aGUgcHJldmlld3MgdG8gYmUgZXhwYW5kYWJsZVxuICAgKiBAcGFyYW0gcGFyYWdyYXBoc1ByZXZpZXdzXG4gICAqL1xuICBmdW5jdGlvbiBmb3JtYXRQYXJhZ3JhcGhzUHJldmlld3MocGFyYWdyYXBoc1ByZXZpZXdzKSB7XG4gICAgcGFyYWdyYXBoc1ByZXZpZXdzLmVhY2goKGksIGVsKSA9PiB7XG4gICAgICB2YXIgJHRoaXMgPSAkKGVsKTtcbiAgICAgIGlmICgkdGhpcy5vdXRlckhlaWdodCgpID49IDEwMCkge1xuICAgICAgICAkdGhpcy5hZGRDbGFzcygnZXhwYW5kYWJsZScpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbn0oalF1ZXJ5KTsiLCIvKipcbiAqIEBmaWxlIGluamVjdC1zdmcuanNcbiAqXG4gKiBVc2Ugc3ZnLWluamVjdG9yLmpzIHRvIHJlcGxhY2UgYW4gc3ZnIDxpbWc+IHRhZyB3aXRoIHRoZSBpbmxpbmUgc3ZnLlxuICovXG5cbiFmdW5jdGlvbigkKXtcbiAgXCJ1c2Ugc3RyaWN0XCI7XG5cbiAgJChmdW5jdGlvbigpIHtcbiAgICAvLyBFbGVtZW50cyB0byBpbmplY3RcbiAgICBsZXQgbXlTVkdzVG9JbmplY3QgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdpbWcuaW5qZWN0LW1lJyk7XG5cbiAgICAvLyBEbyB0aGUgaW5qZWN0aW9uXG4gICAgU1ZHSW5qZWN0b3IobXlTVkdzVG9JbmplY3QpO1xuICB9KTtcblxufShqUXVlcnkpOyJdfQ==
