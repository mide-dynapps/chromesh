/**
 * Settings (chrome.storage.sync) and branch cache (chrome.storage.local).
 * Exposed as globalThis.CHROMESH.store.
 *
 * Toutes les écritures passent par une file (`serialize`). chrome.storage
 * n'offre pas de compare-and-swap : deux lectures-écritures concurrentes sur
 * le même objet — deux onglets qui collectent, ou le worker et un onglet —
 * feraient perdre la première. La file ne protège que le contexte courant ;
 * entre contextes, c'est `claimScan` qui évite les collectes simultanées.
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
        showProjectBanner: true,
        scanAllProjects: true,
        trackOnline: false,
        ignored: [],
    };

    /** Bornes appliquées aux réglages numériques, à la lecture comme à l'écriture. */
    const RANGES = {
        criticalDays: [0, 30],
        warningDays: [0, 60],
        notifyHour: [0, 23],
        refreshHours: [1, 72],
    };

    /** chrome.storage.sync plafonne chaque clé à 8 192 octets. */
    const SYNC_ITEM_LIMIT = 8192;

    let queue = Promise.resolve();

    /** Exécute `task` après les écritures déjà en file. */
    function serialize(task) {
        const run = queue.then(task, task);
        queue = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

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
    const ONLINE_CHECKED_KEY = "onlineChecked";
    /** Au-delà, une trace de lecture Online est purgée. */
    const ONLINE_CHECKED_TTL = 30 * 86400000;

    /** Ramène une valeur dans sa borne, ou renvoie le défaut si elle n'est pas un nombre. */
    function clamp(name, value) {
        const range = RANGES[name];
        const number = Number(value);
        if (!range || !Number.isFinite(number)) {
            return Number.isFinite(number) ? number : DEFAULTS[name];
        }
        return Math.min(range[1], Math.max(range[0], Math.round(number)));
    }

    /**
     * Applique les bornes et la cohérence des seuils. Un `warningDays`
     * inférieur à `criticalDays` rendrait le niveau « attention » inatteignable.
     */
    function normalizeSettings(settings) {
        const next = { ...settings };
        for (const name of Object.keys(RANGES)) {
            next[name] = clamp(name, next[name]);
        }
        if (next.warningDays < next.criticalDays) {
            next.warningDays = next.criticalDays;
        }
        next.ignored = Array.isArray(next.ignored)
            ? next.ignored.map((line) => String(line).trim()).filter(Boolean)
            : [];
        return next;
    }

    async function getSettings() {
        const stored = await chrome.storage.sync.get(DEFAULTS);
        return normalizeSettings({ ...DEFAULTS, ...stored });
    }

    /**
     * Écrit les réglages. Lève si `ignored` dépasse le quota par clé de
     * chrome.storage.sync : sans ce contrôle, l'écriture échouerait en silence
     * et l'utilisateur croirait sa liste enregistrée.
     */
    async function setSettings(patch) {
        const next = normalizeSettings({ ...DEFAULTS, ...patch });
        const clean = Object.fromEntries(Object.keys(patch).map((key) => [key, next[key]]));
        if (clean.ignored) {
            const bytes = new TextEncoder().encode(JSON.stringify(clean.ignored)).length;
            if (bytes > SYNC_ITEM_LIMIT) {
                throw new Error(
                    `La liste des branches ignorées pèse ${bytes} octets, au-delà des ` +
                        `${SYNC_ITEM_LIMIT} autorisés par chrome.storage.sync. Retire des lignes.`
                );
            }
        }
        await serialize(() => chrome.storage.sync.set(clean));
        return clean;
    }

    /**
     * Ajoute une regle d'exclusion ('projet::branche' ou 'projet') a celles
     * deja enregistrees. Sans effet si la cle est deja couverte.
     * Retourne la liste resultante.
     */
    async function addIgnored(key) {
        const rule = String(key || "").trim();
        if (!rule) {
            return (await getSettings()).ignored;
        }
        return serialize(async () => {
            const settings = await getSettings();
            const ignored = settings.ignored || [];
            if (isIgnored(rule, ignored) || ignored.some((line) => line.trim() === rule)) {
                return ignored;
            }
            const next = [...ignored, rule];
            await chrome.storage.sync.set({ ignored: next });
            return next;
        });
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
        return serialize(async () => {
            const branches = await getBranches();
            const key = `${entry.project}::${entry.branch}`;
            branches[key] = { ...branches[key], ...entry, fetchedAt: entry.fetchedAt || Date.now() };
            await chrome.storage.local.set({ [CACHE_KEY]: branches });
            return branches[key];
        });
    }

    async function dropBranches(keys) {
        if (!keys.length) {
            return [];
        }
        return serialize(async () => {
            const branches = await getBranches();
            const removed = keys.filter((key) => key in branches);
            removed.forEach((key) => delete branches[key]);
            await chrome.storage.local.set({ [CACHE_KEY]: branches });
            return removed;
        });
    }

    /**
     * Aligne le cache d'un projet sur ce que l'API vient de renvoyer : toute
     * branche absente de `keep` a disparu d'Odoo.sh et doit sortir du cache.
     * Sans cela, une branche supprimée reste en mémoire, bascule en `expired`
     * et compte dans le badge indéfiniment.
     * Retourne les clés retirées.
     */
    async function pruneProject(project, keep) {
        const kept = new Set(keep);
        const branches = await getBranches();
        const stale = Object.keys(branches).filter(
            (key) => branches[key].project === project && !kept.has(key)
        );
        return dropBranches(stale);
    }

    async function getNotified() {
        const data = await chrome.storage.local.get({ [NOTIFIED_KEY]: {} });
        return data[NOTIFIED_KEY];
    }

    async function setNotified(map) {
        return serialize(() => chrome.storage.local.set({ [NOTIFIED_KEY]: map }));
    }

    const EMPTY_STATUS = { lastScanAt: 0, lastError: null, lastErrorAt: 0 };

    /** Dernier état de la collecte : succès, erreur, date du dernier scan complet. */
    async function getStatus() {
        const data = await chrome.storage.local.get({ [STATUS_KEY]: EMPTY_STATUS });
        return { ...EMPTY_STATUS, ...data[STATUS_KEY] };
    }

    async function writeStatus(patch) {
        const current = await getStatus();
        const next = { ...current, ...patch };
        await chrome.storage.local.set({ [STATUS_KEY]: next });
        return next;
    }

    async function setStatus(patch) {
        return serialize(() => writeStatus(patch));
    }

    /**
     * Réserve le balayage complet. `lastScanAt` sert de jeton : il est posé
     * avant la collecte, donc un deuxième contexte — autre onglet, service
     * worker — voit l'échéance comme non atteinte et renonce.
     *
     * Retourne {claimed, previous}. En cas d'échec de la collecte, l'appelant
     * doit rendre le jeton par `releaseScan(previous)` : sinon l'erreur
     * bloquerait toute reprise jusqu'à la prochaine échéance.
     */
    async function claimScan(intervalMs, { force = false } = {}) {
        return serialize(async () => {
            const status = await getStatus();
            const previous = status.lastScanAt || 0;
            if (!force && Date.now() - previous < intervalMs) {
                return { claimed: false, previous };
            }
            await writeStatus({ lastScanAt: Date.now() });
            return { claimed: true, previous };
        });
    }

    /** Rend le jeton pris par `claimScan`, pour autoriser une reprise immédiate. */
    async function releaseScan(previous) {
        return serialize(() => writeStatus({ lastScanAt: previous || 0 }));
    }

    /**
     * Bases Odoo Online : date de la dernière lecture de session, par hôte.
     * Sert à ne pas rappeler /web/session/get_session_info à chaque page.
     * Tenu à part du cache des branches : une base hors essai n'y figure pas,
     * mais sa lecture doit quand même être espacée.
     */
    async function onlineCheckedRecently(host, intervalMs, now = Date.now()) {
        const data = await chrome.storage.local.get({ [ONLINE_CHECKED_KEY]: {} });
        const last = data[ONLINE_CHECKED_KEY][host] || 0;
        return now - last < intervalMs;
    }

    async function markOnlineChecked(host, now = Date.now()) {
        return serialize(async () => {
            const data = await chrome.storage.local.get({ [ONLINE_CHECKED_KEY]: {} });
            const checked = data[ONLINE_CHECKED_KEY];
            for (const [name, at] of Object.entries(checked)) {
                if (now - at > ONLINE_CHECKED_TTL) {
                    delete checked[name];
                }
            }
            checked[host] = now;
            await chrome.storage.local.set({ [ONLINE_CHECKED_KEY]: checked });
        });
    }

    ns.store = {
        DEFAULTS,
        RANGES,
        SYNC_ITEM_LIMIT,
        clamp,
        normalizeSettings,
        isIgnored,
        isProjectIgnored,
        getSettings,
        setSettings,
        addIgnored,
        getBranches,
        putBranch,
        dropBranches,
        pruneProject,
        getNotified,
        setNotified,
        getStatus,
        setStatus,
        claimScan,
        releaseScan,
        onlineCheckedRecently,
        markOnlineChecked,
    };
})(globalThis);
