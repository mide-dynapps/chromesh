/**
 * Content script des bases Odoo Online (`*.odoo.com`).
 *
 * Il n'est inscrit par le service worker que si le réglage « Surveiller les
 * bases Odoo Online » est actif et que l'accès à *.odoo.com a été accordé.
 * Option désactivée : ce script n'est pas injecté, aucune requête n'est faite.
 *
 * Contrôles, du moins coûteux au plus coûteux :
 *   réglage actif → hôte candidat → pas de lecture récente → appel session
 *   → instance Online → base d'essai → base non exclue.
 * Aucun élément n'est injecté dans la page.
 */
(async function () {
    const { store, online } = globalThis.CHROMESH;
    const host = location.hostname.toLowerCase();

    const settings = await store.getSettings();
    if (!settings.trackOnline || !online.isCandidateHost(host)) {
        return;
    }
    if (await store.onlineCheckedRecently(host, settings.refreshHours * 3600000)) {
        return;
    }

    let info;
    try {
        const response = await fetch("/web/session/get_session_info", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: {} }),
        });
        const payload = await response.json();
        info = payload && payload.result;
    } catch (error) {
        console.debug("[chromesh] session Odoo Online illisible", error);
        return;
    }
    if (!info || !info.uid) {
        // Pas de session ouverte : on retentera à la prochaine page.
        return;
    }
    await store.markOnlineChecked(host);

    const decision = online.decide(info, host);
    if (decision.action === "skip") {
        if (decision.mixed) {
            console.info("[chromesh] signaux Odoo Online contradictoires, base ignorée", online.saasSignals(info, host));
        }
        return;
    }
    if (decision.action === "drop") {
        await store.dropBranches([decision.key]);
    } else if (!store.isIgnored(decision.key, settings.ignored)) {
        await store.putBranch(decision.entry);
    } else {
        return;
    }
    chrome.runtime.sendMessage({ type: "chromesh:refreshed" }).catch(() => undefined);
})();
