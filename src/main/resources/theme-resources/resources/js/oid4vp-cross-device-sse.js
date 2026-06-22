(function() {
    function parseConfig(root) {
        if (!root) {
            return null;
        }

        var statusUrl = root.dataset.statusUrl || "";
        var refreshUrl = root.dataset.refreshUrl || "";
        var requestHandle = root.dataset.requestHandle || "";
        if (!statusUrl || !requestHandle) {
            return null;
        }

        return {
            statusUrl: statusUrl,
            refreshUrl: refreshUrl,
            requestHandle: requestHandle
        };
    }

    function buildStatusUrl(config) {
        return config.statusUrl + "?request_handle=" + encodeURIComponent(config.requestHandle);
    }

    function showQrExpiredStatus() {
        var qrStatus = document.getElementById("oid4vp-qr-status");

        if (!qrStatus) {
            return;
        }

        qrStatus.hidden = false;
        qrStatus.setAttribute("aria-hidden", "false");
    }

    function hideQrExpiredStatus() {
        var qrStatus = document.getElementById("oid4vp-qr-status");

        if (!qrStatus) {
            return;
        }

        qrStatus.hidden = true;
        qrStatus.setAttribute("aria-hidden", "true");
    }

    function buildRefreshUrl(refreshUrl, requestHandle) {
        var separator = refreshUrl.indexOf("?") === -1 ? "?" : "&";
        return refreshUrl + separator + "request_handle=" + encodeURIComponent(requestHandle);
    }

    function setRefreshBusy(refreshButton, busy) {
        if (!refreshButton) {
            return;
        }

        refreshButton.disabled = busy;
        refreshButton.setAttribute("aria-busy", busy ? "true" : "false");
    }

    function updateRequestHandle(root, oldRequestHandle, newRequestHandle) {
        var requestHandleInput = document.getElementById("requestHandle");
        var crossDeviceRequestHandleInput = document.getElementById("crossDeviceRequestHandle");

        root.dataset.requestHandle = newRequestHandle;

        if (crossDeviceRequestHandleInput) {
            crossDeviceRequestHandleInput.value = newRequestHandle;
        }

        if (requestHandleInput && requestHandleInput.value === oldRequestHandle) {
            requestHandleInput.value = newRequestHandle;
        }
    }

    function updateQrCode(data) {
        var qrCode = document.getElementById("oid4vp-qr-code");

        if (!qrCode || !data.qrCodeBase64) {
            return;
        }

        qrCode.src = "data:image/png;base64," + data.qrCodeBase64;

        if (data.walletUrl) {
            qrCode.dataset.walletUrl = data.walletUrl;
        }
    }

    function parseJsonResponse(response) {
        return response.json().catch(function() {
            return {};
        }).then(function(payload) {
            if (!response.ok) {
                var message = payload.error_description || payload.error || "Refresh failed";
                var error = new Error(message);
                error.payload = payload;
                throw error;
            }

            return payload;
        });
    }

    function initOid4vpCrossDeviceSse(config) {
        if (!config || !config.statusUrl || !config.requestHandle || !window.EventSource) {
            return null;
        }

        var statusUrl = buildStatusUrl(config);
        var currentSource = null;
        var stopped = false;

        window.__oid4vpSseReady = false;

        function stop() {
            stopped = true;
            if (currentSource) {
                currentSource.close();
            }
        }

        function connect() {
            if (stopped) {
                return;
            }
            currentSource = new EventSource(statusUrl);

            currentSource.addEventListener("complete", function(event) {
                window.__oid4vpSseReady = true;
                stop();
                try {
                    var data = JSON.parse(event.data);
                    if (data.redirect_uri) {
                        window.location.href = data.redirect_uri;
                    }
                } catch (error) {
                    console.error("OID4VP: Failed to parse completion event", error);
                }
            });

            currentSource.addEventListener("ping", function() {
                window.__oid4vpSseReady = true;
            });

            currentSource.addEventListener("timeout", function() {
                window.__oid4vpSseReady = true;
                showQrExpiredStatus();
                stop();
            });

            currentSource.addEventListener("expired", function() {
                window.__oid4vpSseReady = true;
                showQrExpiredStatus();
                stop();
            });

            currentSource.onopen = function() {
                window.__oid4vpSseReady = true;
            };

            currentSource.onerror = function() {
                window.__oid4vpSseReady = false;

                if (currentSource && currentSource.readyState === EventSource.CLOSED) {
                    showQrExpiredStatus();
                    stop();
                }
            };
        }

        connect();

        return {
            close: function() {
                stop();
            }
        };
    }

    function initOid4vpRefresh(root) {
        var refreshButton = document.getElementById("oid4vp-refresh-btn");

        if (!root || !refreshButton || !window.fetch) {
            return;
        }

        refreshButton.addEventListener("click", function(event) {
            event.preventDefault();
            refreshButton.blur();

            var config = parseConfig(root);
            if (!config || !config.refreshUrl || !config.requestHandle || refreshButton.disabled) {
                return;
            }

            var oldRequestHandle = config.requestHandle;
            setRefreshBusy(refreshButton, true);

            fetch(buildRefreshUrl(config.refreshUrl, oldRequestHandle), {
                method: "POST",
                headers: {
                    "Accept": "application/json"
                },
                credentials: "same-origin"
            })
                .then(parseJsonResponse)
                .then(function(data) {
                    if (!data.requestHandle || !data.statusUrl || !data.qrCodeBase64) {
                        throw new Error("Refresh response is missing required data");
                    }

                    if (window.__oid4vpSse) {
                        window.__oid4vpSse.close();
                    }

                    root.dataset.statusUrl = data.statusUrl;
                    root.dataset.refreshUrl = data.refreshUrl || config.refreshUrl;
                    updateRequestHandle(root, oldRequestHandle, data.requestHandle);
                    updateQrCode(data);
                    hideQrExpiredStatus();

                    window.__oid4vpSse = initOid4vpCrossDeviceSse({
                        statusUrl: data.statusUrl,
                        requestHandle: data.requestHandle
                    });
                })
                .then(function() {
                    setRefreshBusy(refreshButton, false);
                }, function(error) {
                    console.error("OID4VP: Failed to refresh QR code", error);
                    setRefreshBusy(refreshButton, false);
                });
        });
    }

    window.initOid4vpCrossDeviceSse = initOid4vpCrossDeviceSse;

    var root = document.getElementById("oid4vp-cross-device-sse-config");
    var config = parseConfig(root);
    if (config) {
        window.__oid4vpSse = initOid4vpCrossDeviceSse(config);
        initOid4vpRefresh(root);
    }
})();
