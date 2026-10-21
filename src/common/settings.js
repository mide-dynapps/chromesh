/**
 * Settings (chrome.storage.sync) and branch cache (chrome.storage.local).
 * Exposed as globalThis.CHROMESH.store.
 */
(function (root) {
    const ns = (root.CHROMESH = root.CHROMESH || {});

    const DEFAULTS = {
        country: "FR",
        useHolidays: true,
        criticalDays: 2,
        warningDays: 5,
        notify: true,
        notifyHour: 9,
        refreshHours: 6,
        showBadges: true,
        showBanner: true,
        scanAllProjects: true,
        ignored: [],
    };

    /**
     * Une entrée de `ignored` vaut soit une branche précise (`projet::branche`),
     * soit un projet entier (`projet::*` ou `projet` tout court).
     */
    function splitKey(key) {
        const index = String(key).indexOf("::");
        return index === -1
            ? { project: String(key).trim(), branch: null }
            : {
                  project: String(key).slice(0, index).trim(),
                  branch: String(key).slice(index + 2).trim(),
              };
    }

    function isProjectIgnored(project, ignored) {
        const needle = String(project || "").trim().toLowerCase();
        if (!needle) {
            return false;
        }
        return (ignored || []).some((line) => {
            const rule = splitKey(line);
            if (rule.branch !== null && rule.branch !== "*") {
                return false;
            }
            return rule.project.toLowerCase() === needle;
        });
    }

    function isIgnored(key, ignored) {
        const target = splitKey(key);
        if (isProjectIgnored(target.project, ignored)) {
            return true;
        }
        const branch = (target.branch || "").toLowerCase();
        const project = target.project.toLowerCase();
        return (ignored || []).some((line) => {
            const rule = splitKey(line);
            if (rule.branch === null || rule.branch === "*") {
                return false;
            }
            return rule.project.toLowerCase() === project && rule.branch.toLowerCase() === branch;
        });
    }

    const CACHE_KEY = "branches";
    const NOTIFIED_KEY = "notified";
    const STATUS_KEY = "status";

    async function getSettings() {
        const stored = await chrome.storage.sync.get(DEFAULTS);
        return { ...DEFAULTS, ...stored };
    }

    async function setSettings(patch) {
        await chrome.storage.sync.set(patch);
    }

    async function getBranches() {
        const data = await chrome.storage.local.get({ [CACHE_KEY]: {} });
        return data[CACHE_KEY];
    }

    /**
     * entry = {project, branch, expirationDate: 'YYYY-MM-DD'|null, dropped,
     *          readable, branchId, url, fetchedAt}
     */
    async function putBranch(entry) {
        const branches = await getBranches();
        const key = `${entry.project}::${entry.branch}`;
        branches[key] = { ...branches[key], ...entry, fetchedAt: entry.fetchedAt || Date.now() };
        await chrome.storage.local.set({ [CACHE_KEY]: branches });
        return branches[key];
    }

    async function dropBranches(keys) {
        if (!keys.length) {
            return;
        }
        const branches = await getBranches();
        keys.forEach((key) => delete branches[key]);
        await chrome.storage.local.set({ [CACHE_KEY]: branches });
    }

    async function getNotified() {
        const data = await chrome.storage.local.get({ [NOTIFIED_KEY]: {} });
        return data[NOTIFIED_KEY];
    }

    async function setNotified(map) {
        await chrome.storage.local.set({ [NOTIFIED_KEY]: map });
    }

    /** Dernier état de la collecte : succès, erreur, date du dernier scan complet. */
    async function getStatus() {
        const data = await chrome.storage.local.get({
            [STATUS_KEY]: { lastScanAt: 0, lastError: null, lastErrorAt: 0 },
        });
        return data[STATUS_KEY];
    }

    async function setStatus(patch) {
        const current = await getStatus();
        const next = { ...current, ...patch };
        await chrome.storage.local.set({ [STATUS_KEY]: next });
        return next;
    }

    ns.store = {
        DEFAULTS,
        isIgnored,
        isProjectIgnored,
        getSettings,
        setSettings,
        getBranches,
        putBranch,
        dropBranches,
        getNotified,
        setNotified,
        getStatus,
        setStatus,
    };
})(globalThis);
