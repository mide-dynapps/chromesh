/**
 * Harnais de test, sans dépendance.
 *
 * Les scripts de `src/common/` sont des IIFE qui s'accrochent à `globalThis`.
 * On les évalue tels quels dans le contexte courant, après avoir posé un faux
 * `chrome.storage` en mémoire. Aucun navigateur, aucun réseau.
 *
 * Usage : node tests/run.js
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

/** chrome.storage minimal : sync et local, avec le même contrat de get/set. */
function fakeStorageArea() {
    const data = new Map();
    return {
        _data: data,
        async get(query) {
            if (typeof query === "string") {
                return data.has(query) ? { [query]: data.get(query) } : {};
            }
            const result = {};
            for (const [key, fallback] of Object.entries(query || {})) {
                result[key] = data.has(key) ? data.get(key) : fallback;
            }
            return result;
        },
        async set(patch) {
            for (const [key, value] of Object.entries(patch)) {
                // Le stockage du navigateur sérialise : on reproduit la copie,
                // sinon un test verrait des mutations que l'extension ne voit pas.
                data.set(key, JSON.parse(JSON.stringify(value)));
            }
        },
        async remove(key) {
            data.delete(key);
        },
        async clear() {
            data.clear();
        },
    };
}

function installChrome() {
    globalThis.chrome = {
        storage: { sync: fakeStorageArea(), local: fakeStorageArea() },
        runtime: { id: "test", getManifest: () => ({ version: "0.0.0-test" }) },
    };
    return globalThis.chrome;
}

/** Évalue un script de src/ dans le contexte courant. */
function loadScript(relative) {
    const file = path.join(ROOT, relative);
    vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });
}

function loadCommon() {
    delete globalThis.CHROMESH;
    installChrome();
    loadScript("src/common/workdays.js");
    loadScript("src/common/urgency.js");
    loadScript("src/common/settings.js");
    loadScript("src/common/parse.js");
    loadScript("src/popup/filter.js");
    return globalThis.CHROMESH;
}

/* ------------------------------------------------------------- assertions */

const results = { passed: 0, failed: [] };
let current = "";

function suite(name) {
    current = name;
    console.log(`\n${name}`);
}

function check(label, condition, detail) {
    if (condition) {
        results.passed += 1;
        console.log(`  ok   ${label}`);
        return;
    }
    results.failed.push(`${current} › ${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function equal(label, actual, expected) {
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    check(label, same, same ? "" : `attendu ${JSON.stringify(expected)}, reçu ${JSON.stringify(actual)}`);
}

async function throws(label, run, match) {
    try {
        await run();
        check(label, false, "aucune erreur levée");
    } catch (error) {
        const text = String(error.message || error);
        check(label, !match || text.includes(match), match ? `message « ${text} »` : "");
    }
}

function report() {
    console.log(`\n${results.passed} assertion(s) passée(s), ${results.failed.length} échec(s).`);
    results.failed.forEach((line) => console.log(`  - ${line}`));
    return results.failed.length === 0;
}

module.exports = { loadCommon, installChrome, suite, check, equal, throws, report };
