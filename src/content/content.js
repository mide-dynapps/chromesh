/**
 * Content script.
 *
 * Deux rôles distincts :
 *  - collecteur : interroge l'API /app/ d'Odoo.sh depuis la page, donc avec le
 *    cookie de session, et écrit le résultat dans chrome.storage.local ;
 *  - afficheur : injecte les pastilles et le bandeau dans le DOM rendu par Owl.
 *
 * Le DOM n'est plus sur le chemin critique de la donnée : il ne sert qu'à
 * savoir où accrocher les pastilles.
 */
(function () {
    const { workdays, parse, urgency, store, api } = globalThis.CHROMESH;
    const LEVELS = urgency.LEVELS;

    const PREFIX = "csh";
    const state = {
        settings: null,
        cache: {},
        collecting: new Set(),
        rendering: false,
    };

    const log = (...args) => console.debug("[chromesh]", ...args);
    const levelClass = (level) => `${PREFIX}-${level}`;

    /* --------------------------------------------------------------- collecte */

    function isStale(entry) {
        if (!entry || !entry.fetchedAt) {
            return true;
        }
        return Date.now() - entry.fetchedAt > state.settings.refreshHours * 3600000;
    }

    async function collectProject(projectName, slug = null) {
        if (state.collecting.has(projectName)) {
            return;
        }
        state.collecting.add(projectName);
        try {
            await api.collectProject(projectName, {
                slug,
                onEntry: async (entry) => {
                    const stored = await store.putBranch(entry);
                    state.cache[parse.cacheKey(entry.project, entry.branch)] = stored;
                    paintBranch(entry.branch, stateFor(stored));
                },
            });
            await store.setStatus({ lastError: null });
        } catch (error) {
            log("collecte échouée", projectName, error);
            await store.setStatus({ lastError: String(error.message || error), lastErrorAt: Date.now() });
        } finally {
            state.collecting.delete(projectName);
            chrome.runtime.sendMessage({ type: "chromesh:refreshed" }).catch(() => {});
        }
    }

    /** Balayage de tous les projets, au plus une fois par période de rafraîchissement. */
    async function scanAllProjects({ force = false } = {}) {
        if (!state.settings.scanAllProjects) {
            return;
        }
        const status = await store.getStatus();
        if (!force && Date.now() - (status.lastScanAt || 0) < state.settings.refreshHours * 3600000) {
            return;
        }
        await store.setStatus({ lastScanAt: Date.now() });
        try {
            const projects = await api.listProjects();
            log(`balayage de ${projects.length} projet(s)`);
            for (const project of projects) {
                if (store.isProjectIgnored(project.name, state.settings.ignored)) {
                    continue;
                }
                // Le slug vient déjà de /app/projects : pas de get_info.
                await collectProject(project.name, project.slug);
            }
        } catch (error) {
            log("liste des projets illisible", error);
            await store.setStatus({ lastError: String(error.message || error), lastErrorAt: Date.now() });
        }
    }

    /* -------------------------------------------------------------- évaluation */

    function stateFor(entry) {
        if (!entry || !entry.expirationDate) {
            return { level: LEVELS.UNKNOWN };
        }
        return urgency.evaluate(workdays.fromIsoDay(entry.expirationDate), state.settings);
    }

    /* --------------------------------------------------------------- rendu DOM */

    function paintBranch(branchName, branchState) {
        const li = document.querySelector(
            `.o_branches_listing li.o_branch[data-branch-name="${CSS.escape(branchName)}"]`
        );
        if (li) {
            renderBadge(li, branchState);
        }
        const current = parse.locationInfo(location.pathname);
        if (current.branch === branchName) {
            renderBanner(branchState);
        }
    }

    function renderBadge(li, branchState) {
        const host = li.querySelector(".o_paas_branch");
        if (!host) {
            return;
        }
        let badge = host.querySelector(`.${PREFIX}-badge`);
        if (branchState.level === LEVELS.UNKNOWN) {
            if (badge) {
                badge.remove();
            }
            return;
        }
        if (!badge) {
            badge = document.createElement("span");
            host.insertBefore(badge, host.querySelector(".o_branch_icon"));
        }
        badge.textContent = urgency.badgeLabel(branchState);
        badge.title = urgency.describe(branchState);
        badge.className = `${PREFIX}-badge ${levelClass(branchState.level)}`;
    }

    function renderStageSummary(counts) {
        const stageEl = document.querySelector('.o_branches_listing .o_stage[data-stage="staging"]');
        if (!stageEl) {
            return;
        }
        let summary = stageEl.querySelector(`.${PREFIX}-stage-summary`);
        const total = counts.expired + counts.critical;
        if (!total) {
            if (summary) {
                summary.remove();
            }
            return;
        }
        if (!summary) {
            summary = document.createElement("span");
            summary.className = `${PREFIX}-stage-summary`;
            stageEl.insertBefore(summary, stageEl.querySelector(".o_add_branch"));
        }
        summary.textContent = String(total);
        summary.title = `${counts.expired} branche(s) expirée(s), ${counts.critical} critique(s)`;
    }

    function renderBanner(branchState) {
        const anchor = document.querySelector(".o_branch_main_content");
        if (!anchor || !state.settings.showBanner) {
            return;
        }
        let banner = anchor.querySelector(`.${PREFIX}-banner`);
        if (branchState.level === LEVELS.UNKNOWN || branchState.level === LEVELS.OK) {
            if (banner) {
                banner.remove();
            }
            return;
        }
        if (!banner) {
            banner = document.createElement("div");
            anchor.insertBefore(banner, anchor.firstChild);
        }
        banner.className = `${PREFIX}-banner ${levelClass(branchState.level)}`;
        banner.replaceChildren();

        const chip = document.createElement("span");
        chip.className = `${PREFIX}-banner-chip`;
        chip.textContent = urgency.badgeLabel(branchState);

        const text = document.createElement("span");
        text.className = `${PREFIX}-banner-text`;
        text.textContent = urgency.describe(branchState);

        banner.append(chip, text);

        const rebuild = [...document.querySelectorAll(".o_branch_main_content a.btn")].find((el) =>
            /rebuild/i.test(el.textContent || "")
        );
        if (rebuild) {
            const action = document.createElement("button");
            action.type = "button";
            action.className = `${PREFIX}-banner-action`;
            action.textContent = "Rebuild";
            action.addEventListener("click", () => rebuild.click());
            banner.append(action);
        }
    }

    /** Surligne la phrase d'Odoo.sh quand elle est présente dans le DOM rendu. */
    function highlightNotice(branchState) {
        const notice = parse.findDeletionNotice(document);
        if (!notice || !notice.element) {
            return;
        }
        notice.element.classList.add(`${PREFIX}-notice`, levelClass(branchState.level));
        notice.element.title = urgency.describe(branchState);
    }

    /* ------------------------------------------------------------------- boucle */

    async function render() {
        if (state.rendering) {
            return;
        }
        state.rendering = true;
        try {
            const { project, branch } = parse.locationInfo(location.pathname);
            if (!project) {
                return;
            }

            const projectIgnored = store.isProjectIgnored(project, state.settings.ignored);
            const staging = parse.listBranches(document).filter((item) => item.stage === "staging");
            const counts = { expired: 0, critical: 0, warning: 0, ok: 0, unknown: 0 };
            let needsCollect = !projectIgnored && !staging.length;

            for (const item of staging) {
                const key = parse.cacheKey(project, item.name);
                const ignored = store.isIgnored(key, state.settings.ignored);
                const entry = state.cache[key];
                const branchState = ignored ? { level: LEVELS.UNKNOWN } : stateFor(entry);
                counts[branchState.level] += 1;
                if (state.settings.showBadges) {
                    renderBadge(item.element, branchState);
                }
                if (!ignored && isStale(entry)) {
                    needsCollect = true;
                }
            }
            if (state.settings.showBadges) {
                renderStageSummary(counts);
            }

            if (branch) {
                const key = parse.cacheKey(project, branch);
                const currentState = store.isIgnored(key, state.settings.ignored)
                    ? { level: LEVELS.UNKNOWN }
                    : stateFor(state.cache[key]);
                renderBanner(currentState);
                highlightNotice(currentState);
            }

            if (needsCollect) {
                await collectProject(project);
            }
        } finally {
            state.rendering = false;
        }
    }

    let debounce = null;
    function scheduleRender() {
        clearTimeout(debounce);
        debounce = setTimeout(() => render().catch(log), 250);
    }

    async function start() {
        state.settings = await store.getSettings();
        state.cache = await store.getBranches();
        await render();

        const target = document.querySelector(".paas-app") || document.body;
        new MutationObserver((records) => {
            const touched = records.some((record) =>
                [...record.addedNodes].some(
                    (node) => node.nodeType === 1 && !String(node.className || "").includes(`${PREFIX}-`)
                )
            );
            if (touched) {
                scheduleRender();
            }
        }).observe(target, { childList: true, subtree: true });

        chrome.storage.onChanged.addListener(async (changes, area) => {
            if (area === "sync") {
                state.settings = await store.getSettings();
                scheduleRender();
            }
            if (area === "local" && changes.branches) {
                state.cache = changes.branches.newValue || {};
            }
        });

        // Le service worker ne peut pas porter le cookie de session : il
        // délègue la collecte à cet onglet.
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message?.type !== "chromesh:collect-all") {
                return false;
            }
            scanAllProjects({ force: Boolean(message.force) })
                .then(() => sendResponse({ ok: true }))
                .catch((error) => sendResponse({ ok: false, error: String(error) }));
            return true;
        });

        // Balayage de fond, après l'affichage du projet courant.
        setTimeout(() => scanAllProjects().catch(log), 4000);
    }

    start().catch((error) => log("démarrage impossible", error));
})();
