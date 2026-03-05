"use strict";
/*
 * Cadence Language Server v2 — Web Worker
 *
 * This script runs inside a Web Worker. It:
 *   1. Loads the Go WASM runtime (wasm_exec.js shim)
 *   2. Instantiates the Cadence LSP WASM binary
 *   3. Bridges postMessage <==> Go global functions
 *   4. Resolves address imports via sync XHR to Flow REST API
 *
 * Communication protocol (all via postMessage):
 *   Main -> Worker: { type: "init",      wasmUrl: string, accessNode?: string }
 *   Main -> Worker: { type: "toServer",  message: string }
 *   Main -> Worker: { type: "setConfig", accessNode?: string }
 *   Main -> Worker: { type: "resolveResponse", id: number, code?: string }
 *   Worker -> Main: { type: "fromServer", message: string }
 *   Worker -> Main: { type: "ready" }
 *   Worker -> Main: { type: "error", error: string }
 *   Worker -> Main: { type: "resolveString", id: number, location: string }
 */
let currentAccessNode = "https://rest-mainnet.onflow.org";
// Cache for resolved address code
const addressCodeCache = new Map();
/**
 * Synchronously fetch a contract from Flow REST API.
 * Runs inside the Worker so it doesn't block the main thread.
 */
function fetchContractSync(address, contractName) {
    const normalized = address.replace(/^0x/, "").padStart(16, "0");
    const url = `${currentAccessNode}/v1/accounts/0x${normalized}?expand=contracts`;
    try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url, false); // synchronous
        xhr.send();
        if (xhr.status !== 200)
            return undefined;
        const data = JSON.parse(xhr.responseText);
        const contracts = data?.contracts;
        if (!contracts || typeof contracts !== "object")
            return undefined;
        const encoded = contracts[contractName];
        if (typeof encoded === "string" && encoded.length > 0) {
            try {
                return atob(encoded);
            }
            catch {
                return encoded;
            }
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Resolve an address import. Called synchronously by Go WASM.
 * locationID format: "A.0xADDR.ContractName"
 */
function resolveAddress(locationID) {
    const parts = locationID.split(".");
    let address;
    let contractName;
    if (parts[0] === "A" && parts.length >= 3) {
        address = parts[1];
        contractName = parts.slice(2).join(".");
    }
    else if (parts.length >= 2) {
        address = parts[0];
        contractName = parts.slice(1).join(".");
    }
    else {
        return undefined;
    }
    const normalized = address.replace(/^0x/, "").padStart(16, "0");
    const addrKey = `0x${normalized}`;
    const cacheKey = `${addrKey}.${contractName}`;
    if (addressCodeCache.has(cacheKey)) {
        return addressCodeCache.get(cacheKey);
    }
    const code = fetchContractSync(addrKey, contractName);
    if (code) {
        addressCodeCache.set(cacheKey, code);
    }
    return code;
}
// String import resolution — we use a sync request back to main thread
// via SharedArrayBuffer when available, otherwise fall back to undefined.
// The main thread can pre-populate string imports by sending them as config.
const stringCodeMap = new Map();
function resolveString(locationID) {
    return stringCodeMap.get(locationID);
}
/**
 * Minimal fs polyfill for Go WASM (only writeSync is needed).
 */
function installFsPolyfill() {
    const g = globalThis;
    if (!g.fs) {
        const decoder = new TextDecoder("utf-8");
        let outputBuf = "";
        g.fs = {
            constants: { O_WRONLY: -1, O_RDWR: -1, O_CREAT: -1, O_TRUNC: -1, O_APPEND: -1, O_EXCL: -1 },
            writeSync(fd, buf) {
                outputBuf += decoder.decode(buf);
                const nl = outputBuf.lastIndexOf("\n");
                if (nl !== -1) {
                    console.debug(`[cadence-lsp fd=${fd}]`, outputBuf.substring(0, nl));
                    outputBuf = outputBuf.substring(nl + 1);
                }
                return buf.length;
            },
            write(fd, buf, offset, length, position, callback) {
                if (offset !== 0 || length !== buf.length || position !== null) {
                    callback(new Error("not implemented"));
                    return;
                }
                const n = g.fs.writeSync(fd, buf);
                callback(null, n);
            },
            chmod(_path, _mode, callback) { callback(new Error("ENOSYS")); },
            chown(_path, _uid, _gid, callback) { callback(new Error("ENOSYS")); },
            close(_fd, callback) { callback(new Error("ENOSYS")); },
            fchmod(_fd, _mode, callback) { callback(new Error("ENOSYS")); },
            fchown(_fd, _uid, _gid, callback) { callback(new Error("ENOSYS")); },
            fstat(_fd, callback) { callback(new Error("ENOSYS")); },
            fsync(_fd, callback) { callback(null); },
            ftruncate(_fd, _length, callback) { callback(new Error("ENOSYS")); },
            lchown(_path, _uid, _gid, callback) { callback(new Error("ENOSYS")); },
            link(_path, _link, callback) { callback(new Error("ENOSYS")); },
            lstat(_path, callback) { callback(new Error("ENOSYS")); },
            mkdir(_path, _perm, callback) { callback(new Error("ENOSYS")); },
            open(_path, _flags, _mode, callback) { callback(new Error("ENOSYS")); },
            read(_fd, _buffer, _offset, _length, _position, callback) { callback(new Error("ENOSYS")); },
            readdir(_path, callback) { callback(new Error("ENOSYS")); },
            readlink(_path, callback) { callback(new Error("ENOSYS")); },
            rename(_from, _to, callback) { callback(new Error("ENOSYS")); },
            rmdir(_path, callback) { callback(new Error("ENOSYS")); },
            stat(_path, callback) { callback(new Error("ENOSYS")); },
            symlink(_path, _link, callback) { callback(new Error("ENOSYS")); },
            truncate(_path, _length, callback) { callback(new Error("ENOSYS")); },
            unlink(_path, callback) { callback(new Error("ENOSYS")); },
            utimes(_path, _atime, _mtime, callback) { callback(new Error("ENOSYS")); },
        };
    }
    if (!g.process) {
        g.process = {
            getuid() { return -1; },
            getgid() { return -1; },
            geteuid() { return -1; },
            getegid() { return -1; },
            getgroups() { throw new Error("ENOSYS"); },
            pid: -1,
            ppid: -1,
            umask() { throw new Error("ENOSYS"); },
            cwd() { throw new Error("ENOSYS"); },
            chdir() { throw new Error("ENOSYS"); },
        };
    }
}
async function startLSP(wasmUrl) {
    installFsPolyfill();
    const g = globalThis;
    if (typeof g.Go === "undefined") {
        const shimUrl = g.__WASM_EXEC_URL__ ?? new URL("wasm_exec.js", self.location.href).href;
        importScripts(shimUrl);
    }
    // Register import resolvers before Go starts
    g.__CADENCE_LSP_RESOLVE_ADDRESS__ = resolveAddress;
    g.__CADENCE_LSP_RESOLVE_STRING__ = resolveString;
    const go = new g.Go();
    const result = await WebAssembly.instantiateStreaming(fetch(wasmUrl), go.importObject);
    go.run(result.instance).catch((err) => {
        self.postMessage({ type: "error", error: String(err) });
    });
    await waitForReady();
    // Wire up toClient callback
    const setClient = g.__CADENCE_LSP_SET_CLIENT__;
    setClient((msg) => {
        self.postMessage({ type: "fromServer", message: msg });
    });
    self.postMessage({ type: "ready" });
}
function waitForReady() {
    const g = globalThis;
    return new Promise((resolve) => {
        const check = () => {
            if (g.__CADENCE_LSP_READY__ === true) {
                resolve();
            }
            else {
                setTimeout(check, 10);
            }
        };
        check();
    });
}
// Handle messages from the main thread.
self.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object")
        return;
    switch (data.type) {
        case "init":
            if (data.accessNode) {
                currentAccessNode = data.accessNode;
            }
            startLSP(data.wasmUrl).catch((err) => {
                self.postMessage({ type: "error", error: String(err) });
            });
            break;
        case "toServer": {
            const g = globalThis;
            const toServer = g.__CADENCE_LSP_TO_SERVER__;
            if (typeof toServer === "function") {
                toServer(data.message);
            }
            break;
        }
        case "setConfig":
            if (data.accessNode) {
                currentAccessNode = data.accessNode;
            }
            break;
        case "setStringCode":
            // Allow main thread to push local file content for string imports
            if (data.location && typeof data.code === "string") {
                stringCodeMap.set(data.location, data.code);
            }
            break;
        case "clearStringCode":
            stringCodeMap.clear();
            break;
        case "preloadAddressCode":
            // Pre-populate address code cache
            if (data.address && data.contractName && data.code) {
                const normalized = data.address.replace(/^0x/, "").padStart(16, "0");
                const cacheKey = `0x${normalized}.${data.contractName}`;
                addressCodeCache.set(cacheKey, data.code);
            }
            break;
    }
});
//# sourceMappingURL=worker.js.map