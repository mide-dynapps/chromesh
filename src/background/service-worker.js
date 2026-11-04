/**
 * Background worker : badge de la barre d'outils, notifications, déclenchement
 * de la collecte.
 *
 * Il tente d'abord l'API lui-même. Si le cookie de session n'est pas transmis
 * (SameSite), il délègue à un onglet odoo.sh ouvert. S'il n'y en a aucun, il se
 * contente du dernier état connu — et le dit dans le popup.
 */
// parse.js n'est pas chargé : il ne sert qu'à lire le DOM, ce que le worker
// ne fait jamais.
importScripts(
    "/src/common/workdays.js",
    "/src/common/urgency.js",
    "/src/common/settings.js",
    "/src/common/api.js"
);

const { workdays, urgency, store, api } = globalThis.CHROMESH;
const LEVELS = urgency.LEVELS;
const ALARM = "chromesh:check";

function entryState(entry, settings) {
    if (!entry || !entry.expirationDate) {
        return { level: LEVELS.UNKNOWN };
    }
    return urgency.evaluate(workdays.fromIsoDay(entry.expirationDate), settings);
}

async function evaluateAll() {
    const [settings, branches] = await Promise.all([store.getSettings(), store.getBranches()]);
    const rows = Object.entries(branches)
        .filter(([key]) => !store.isIgnored(key, settings.ignored))
        .map(([key, entry]) => ({ key, entry, state: entryState(entry, settings) }))
        .filter((row) => row.state.level !== LEVELS.UNKNOWN)
        .sort((a, b) => urgency.rank(a.state) - urgency.rank(b.state));
    return { settings, rows };
}

async function updateBadge(rows) {
    const urgent = rows.filter(
        (row) => row.state.level === LEVELS.CRITICAL || row.state.level === LEVELS.EXPIRED
    ).length;
    await chrome.action.setBadgeText({ text: urgent ? String(urgent) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#d9480f" });
}

async function maybeNotify(settings, rows) {
    if (!settings.notify) {
        return;
    }
    const now = new Date();
    if (now.getHours() < settings.notifyHour) {
        return;
    }
    const today = workdays.isoDay(now);
    const notified = await store.getNotified();
    let changed = false;

    for (const row of rows) {
        if (row.state.level !== LEVELS.CRITICAL && row.state.level !== LEVELS.EXPIRED) {
            continue;
        }
        if (notified[row.key] === today) {
            continue;
        }
        const [project, branch] = row.key.split("::");
        // Les deux segments sont encodés : un ':' dans un nom de projet ou de
        // branche casserait sinon la relecture au clic.
        const id = `chromesh:${encodeURIComponent(project)}:${encodeURIComponent(branch)}:${today}`;
        await chrome.notifications.create(id, {
            type: "basic",
            iconUrl: chrome.runtime.getURL("icons/icon128.png"),
            title:
                row.state.level === LEVELS.EXPIRED
                    ? `${branch} — build staging expiré`
                    : `${branch} — ${urgency.badgeLabel(row.state)}`,
            message: `${project} · ${urgency.describe(row.state)}`,
            priority: row.state.level === LEVELS.EXPIRED ? 1 : 2,
        });
        notified[row.key] = today;
        changed = true;
    }
    if (changed) {
        await store.setNotified(notified);
    }
}

/**
 * Rafraîchit les données. Essaie l'API directement, sinon délègue à un onglet.
 * Retourne la voie utilisée : 'worker', 'tab' ou 'none'.
 */
async function refresh({ force = false } = {}) {
    const settings = await store.getSettings();
    // Jeton partagé avec les onglets : un seul balayage complet à la fois.
    const { claimed, previous } = await store.claimScan(settings.refreshHours * 3600000, { force });
    if (!claimed) {
        return "skipped";
    }

    try {
        const projects = await api.listProjects();
        await store.setStatus({ lastError: null, collector: "worker" });
        for (const project of projects) {
            if (store.isProjectIgnored(project.name, settings.ignored)) {
                continue;
            }
            // Le slug vient déjà de /app/projects : pas de get_info.
            const { keys } = await api.collectProject(project.name, {
                slug: project.slug,
                onEntry: (entry) => store.putBranch(entry),
            });
            await store.pruneProject(project.name, keys);
        }
        return "worker";
    } catch (error) {
        // Cas attendu : le cookie de session n'accompagne pas la requête.
        console.debug("[chromesh] collecte directe impossible, délégation à un onglet", error);
    }

    const tabs = await chrome.tabs.query({ url: "https://www.odoo.sh/*" });
    for (const tab of tabs) {
        try {
            const response = await chrome.tabs.sendMessage(tab.id, {
                type: "chromesh:collect-all",
                force: true,
            });
            if (response?.ok) {
                await store.setStatus({ collector: "tab" });
                return "tab";
            }
        } catch {
            // onglet sans content script actif, on essaie le suivant
        }
    }
    // Aucun onglet n'a pu collecter : le jeton est rendu, sinon l'ouverture
    // d'un onglet dans la minute qui suit ne déclencherait rien.
    await store.releaseScan(previous);
    await store.setStatus({ collector: "none" });
    return "none";
}

async function check(options = {}) {
    await refresh(options).catch((error) => console.debug("[chromesh] refresh", error));
    const { settings, rows } = await evaluateAll();
    await updateBadge(rows);
    await maybeNotify(settings, rows);
}

function schedule() {
    chrome.alarms.create(ALARM, { periodInMinutes: 60, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
    schedule();
    check({ force: true });
});

chrome.runtime.onStartup.addListener(() => {
    schedule();
    check();
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) {
        check();
    }
});

// Une exclusion (page, popup ou options) change le décompte : badge recalculé.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.ignored) {
        evaluateAll().then(({ rows }) => updateBadge(rows));
    }
});

chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "chromesh:refreshed") {
        // Le content script vient d'écrire : on recalcule sans re-collecter.
        evaluateAll().then(({ settings, rows }) => {
            updateBadge(rows);
            maybeNotify(settings, rows);
        });
    }
    if (message?.type === "chromesh:refresh-now") {
        check({ force: true });
    }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
    const match = /^chromesh:([^:]*):([^:]*):/.exec(notificationId);
    if (!match) {
        return;
    }
    const project = decodeURIComponent(match[1]);
    const branch = decodeURIComponent(match[2]);
    if (!project || !branch) {
        return;
    }
    await chrome.tabs.create({ url: api.branchUrl(project, branch) });
    chrome.notifications.clear(notificationId);
});
