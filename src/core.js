(function (window, factory) {
    "use strict";

    if (typeof module === "object" && module.exports) {
        module.exports = factory(window, Object);
    } else if (typeof define === "function" && define.amd) {
        define([], function () {
            return factory(window, Object);
        });
    } else {
        window["Core"] = factory(window, Object);
    }

}(this, function (window, Object) {
    const document = window.document;
    const slice = [].slice;
    const Object_create = Object.create;
    const Object_freeze = Object.freeze;
    const Object_keys = Object.keys;
    const XMLHttpRequest = window.XMLHttpRequest;

    const EXPANDO = "__core" + (10000 * Math.random()).toFixed(0) + ":" + Date.now();
    const SENTINEL = { __SENTINEL__: true };

    if (!window["CustomEvent"]) {
        throw Error("One or more requirements of the execution environment have not been met.");
    }

    const state = {
        globalKeys: Object_create(null),
        initHref: document.location.href,
        route: null,
        session: null,
        siteConfig: JSON.parse(document.querySelector("#site-config").innerText),
    };
    Object_keys(window).forEach(function (key) {
        state.globalKeys[key] = key;
    });

    const api = {
        "log": function log() {
            console.log.apply(
                console,
                ["(Core@" + api.version + " (t " + Date.now() + "))"]
                    .concat(slice.call(arguments))
            );
        },
        "use": function use(fn) {
            fn.call(null, sandbox);
        },
        "version": "0.1.0",
    };

    const sandbox = Object_create(api);

    function initPubsub(Y) {
        const subs = [];
        const dataHistory = [];

        function clone(it) {
            return JSON.parse(JSON.stringify(it));
        }

        function on(channel, fn, options) {
            options = options || { replay: true };
            Y.log("pubsub.on()", channel, fn);
            const fullChannel = "channel:" + channel;

            function callback(ev) {
                dataHistory.push(clone(ev.detail));
                fn.call(null, clone(ev.detail));
            }

            document.addEventListener(fullChannel, callback);
            function dispose() {
                Y.log("pubsub.on().dispose", channel, fn);
                document.removeEventListener(fullChannel, callback);
            }
            subs.push(dispose);

            if (options.replay) {
                dataHistory.map(clone).forEach(function (entry) {
                    Y.log("pubsub.on:replaying", channel, entry);
                    fn.call(null, entry);
                });
            }
            return dispose;
        }

        function emit(channel, data) {
            Y.log("pubsub.emit()", channel, data);
            const fullChannel = "channel:" + channel;
            document.dispatchEvent(new CustomEvent(fullChannel, {
                detail: data,
            }));
        }

        Y["emit"] = emit;
        Y["on"] = on;
    }

    initPubsub(sandbox);
    Object_freeze(sandbox);

    function onDomReady(fn) {
        if (document.readyState !== "loading") {
            fn();
        } else {
            document.addEventListener("DOMContentLoaded", function () {
                fn();
            });
        }
    }

    function removeChildren(node) {
        api.log("[INFO] removeChildren(", node, ")");
        while (node.childNodes.length) {
            node.removeChild(node.firstChild);
        }
    }

    const REQUEST_DONE = 4;
    const HTTP_OK_LOCAL = 0;
    const HTTP_OK = 200;
    const HTTP_BAD_REQUEST = 400;
    const DEFAULT_TIMEOUT_MS = 10000;

    function request(url, options, next) {
        const config = {
            body: options.body || null,
            headers: options.headers || {},
            method: options.method || "GET",
            responseType: options.responseType || "text",
            timeout: options.timeout || DEFAULT_TIMEOUT_MS,
            withCredentials: Boolean(options.withCredentials),
        };

        let xhr = new XMLHttpRequest();
        let aborted = false;
        const abort = xhr.abort;

        xhr.abort = function () {
            aborted = true;
            abort.call(xhr);
        };

        xhr.onerror = function () {
            const text = xhr.responseText;
            xhr = null;
            next(new Error(text));
        };

        xhr.withCredentials = config.withCredentials;

        xhr.open(config.method, url, true);

        xhr.ontimeout = function (error) {
            xhr = null;
            next(error);
        };
        xhr.timeout = config.timeout;

        xhr.responseType = config.responseType;

        xhr.onreadystatechange = function () {
            if (aborted) {
                return;
            }

            if (xhr.readyState !== REQUEST_DONE) {
                return;
            }

            if (xhr.status === HTTP_OK_LOCAL || xhr.status >= HTTP_OK && xhr.status < HTTP_BAD_REQUEST) {
                const result = config.responseType === "document" ? xhr.responseXML : xhr.responseText;
                xhr = null;
                next(null, result);
                return;
            }

            const error = new Error(xhr.responseText);
            error.status = status;
            error.statusText = xhr.statusText;
            xhr = null;

            next(error);
        };

        xhr.send(config.body);
    }

    window.onerror = function (error) {
        api.log("[ERR] window.onerror", error);
    };

    function isTransferable(node) {
        return node.parentNode.tagName.toUpperCase() === "BODY" ||
            (node.parentNode.tagName.toUpperCase() === "HEAD" && node.tagName.toUpperCase() === "TITLE");
    }

    onDomReady(function () {
        api.log("[INFO] DOMContentLoaded");

        let headerNodes = document.querySelectorAll("head > *");
        let i = 0;
        while (i < headerNodes.length) {
            const current = headerNodes[i];
            if (isTransferable(current)) {
                i += 1;
                continue;
            }
            current[EXPANDO] = SENTINEL;
            i += 1;
        }
        headerNodes = null;
    });

    function initRouting() {
        const pushState = window.history.pushState;

        window.history.pushState = function (data, title, url) {
            pushState.call(window.history, data, title, url);
            checkRoute();
        };

        function loadRoute(route) {
            request(route.entry, { responseType: "document" }, function (err, html) {
                if (err) {
                    api.log("[ERR]", err);
                    return;
                }

                state.route = route;
                const baseUrl = route.entry.replace(/[^\/]+$/, "");

                api.log("[INFO] Document fetched for route", baseUrl, route, typeof html, html);
                removeChildren(document.body);

                api.log("[INFO] Removing global remnants...");
                Object_keys(window).forEach(function (key) {
                    if (!state.globalKeys[key]) {
                        const maybeCoreGlobal = window[key];

                        if (maybeCoreGlobal === api) {
                            return;
                        }

                        api.log("[INFO] > Deleting", key, "...");
                        delete window[key];
                    }
                });

                let headerNodes = document.querySelectorAll("head > *");
                let i = 0;
                while (i < headerNodes.length) {
                    const node = headerNodes[i];
                    if (node[EXPANDO] !== SENTINEL) {
                        //api.log("[INFO] > Removing <head> node", node);
                        node.parentNode.removeChild(node);
                    }
                    i += 1;
                }
                headerNodes = null;

                const header = document.querySelector("head");
                headerNodes = html.querySelectorAll("head > *");
                i = 0;
                while (i < headerNodes.length) {
                    //api.log("[INFO] Appending <head> node", headerNodes[i]);
                    const node = headerNodes[i];
                    if (isTransferable(node)) {
                        header.appendChild(node.cloneNode(true));
                    }
                    i += 1;
                }
                headerNodes = null;

                let newBody = html.querySelectorAll("body > *");
                i = 0;
                while (i < newBody.length) {
                    //api.log("[INFO] Appending <body> node", newBody[i]);
                    const node = newBody[i].cloneNode(true);
                    if (node.tagName.toUpperCase() === "SCRIPT" && node.hasAttribute("src")) {
                        // FIXME: Adjust baseUrl for resources!
                        //node.src = baseUrl + node.src;
                    }
                    document.body.appendChild(node);
                    i += 1;
                }
                newBody = null;
            });
        }

        function checkRoute() {
            const pathname = document.location.pathname;
            const routes = state.siteConfig.routes;
            api.log("[INFO] checkRoute()", routes);

            let i = 0;
            while (i < routes.length) {
                const current = routes[i];
                if (pathname.indexOf(current.route) === 0) {
                    api.log("[INFO] Match on route ", current);

                    if (current !== state.route) {
                        api.log("[INFO] This is a new route, loading ", current);
                        loadRoute(current);
                        break;
                    }
                }
                i += 1;
            }
        }

        window.addEventListener("popstate", function onpopstate(ev) {
            api.log("[INFO] window.onpopstate", ev);
            checkRoute();
        });

        api.log("[INFO] initRouting()", state);
        checkRoute();
    }

    function refreshSession() {
        request(state.siteConfig.session, {}, function (err, text) {
            if (err) {
                api.log("[ERR]", err);
                return;
            }

            state.session = JSON.parse(text);
            document.querySelector("html").setAttribute("lang", state.session.lang)
            api.log("[INFO] Session loaded", { state: state });
            initRouting();
        });
    }

    refreshSession();

    const finalApi = Object_freeze(api);
    api.log("[INFO] Core loaded", { Core: finalApi, state: state });
    return finalApi;
}));