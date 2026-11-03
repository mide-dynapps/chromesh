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
        renderPending: false,
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
                    const key = parse.cacheKey(entry.project, entry.branch);
                    state.cache[key] = stored;
                    if (!store.isIgnored(key, state.settings.ignored)) {
                        paintBranch(entry.branch, stateFor(stored));
                    }
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
        const branchName = li.dataset.branchName;
        if (!badge) {
            badge = document.createElement("span");
            badge.setAttribute("role", "button");
            badge.tabIndex = 0;
            badge.addEventListener("click", (event) => {
                // La pastille est posee dans le lien de la branche : sans cela,
                // le clic navigue au lieu d'exclure.
                event.preventDefault();
                event.stopPropagation();
                ignoreBranch(branchName);
            });
            badge.addEventListener("keydown", (event) => {
                if (event.key !== "Enter" && event.key !== " ") {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                ignoreBranch(branchName);
            });
            host.insertBefore(badge, host.querySelector(".o_branch_icon"));
        }
        badge.textContent = urgency.badgeLabel(branchState);
        badge.title = `${urgency.describe(branchState)}

Cliquer pour exclure ${branchName} du suivi (reversible depuis les options).`;
        badge.className = `${PREFIX}-badge ${levelClass(branchState.level)}`;
    }

    /** Ajoute 'projet::branche' aux exclusions deja enregistrees. */
    async function ignoreBranch(branchName) {
        const { project } = parse.locationInfo(location.pathname);
        if (!project || !branchName) {
            return;
        }
        try {
            await store.addIgnored(parse.cacheKey(project, branchName));
            // storage.onChanged (sync) relit les reglages et relance le rendu :
            // la pastille disparait d'elle-meme.
        } catch (error) {
            log("exclusion impossible", branchName, error);
        }
    }

    /* ------------------------------------------------------------- exclusion */

    function closeMenu() {
        document.querySelectorAll(`.${PREFIX}-menu`).forEach((menu) => menu.remove());
    }

    /** Menu du bouton ⊘ : exclure la branche, ou tout le projet ('projet::*'). */
    function openExcludeMenu(button, project, branchName) {
        closeMenu();
        const menu = document.createElement("div");
        menu.className = `${PREFIX}-menu`;

        const entries = [
            { label: `Exclure la branche ${branchName}`, rule: parse.cacheKey(project, branchName) },
            { label: `Exclure le projet ${project}`, rule: parse.cacheKey(project, "*") },
        ];
        for (const entry of entries) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = `${PREFIX}-menu-item`;
            item.textContent = entry.label;
            item.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                closeMenu();
                try {
                    // storage.onChanged (sync) relance le rendu ; le worker
                    // recalcule le badge de la barre d'outils.
                    await store.addIgnored(entry.rule);
                } catch (error) {
                    log("exclusion impossible", entry.rule, error);
                }
            });
            menu.append(item);
        }

        const rect = button.getBoundingClientRect();
        menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
        menu.style.left = `${rect.left + window.scrollX}px`;
        document.body.append(menu);
    }

    function renderExcludeButton(li, project, branchName, show) {
        const host = li.querySelector(".o_paas_branch");
        if (!host) {
            return;
        }
        let button = host.querySelector(`.${PREFIX}-exclude`);
        if (!show) {
            if (button) {
                button.remove();
            }
            return;
        }
        if (button) {
            return;
        }
        button = document.createElement("button");
        button.type = "button";
        button.className = `${PREFIX}-exclude`;
        button.textContent = "⊘";
        button.title = "Exclure cette branche ou tout le projet du suivi";
        button.addEventListener("click", (event) => {
            // Le bouton est posé dans le lien de la branche : sans cela, le
            // clic navigue au lieu d'ouvrir le menu.
            event.preventDefault();
            event.stopPropagation();
            openExcludeMenu(button, project, branchName);
        });
        host.insertBefore(button, host.querySelector(".o_branch_icon"));
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

    /**
     * Pire etat parmi les branches staging connues d'un projet.
     * Renvoie {state, branch, counts} ; state.level vaut UNKNOWN si le cache
     * ne contient encore rien pour ce projet.
     */
    function worstForProject(projectName) {
        const counts = { expired: 0, critical: 0, warning: 0, ok: 0, unknown: 0 };
        let worst = null;
        let worstBranch = null;
        for (const [key, entry] of Object.entries(state.cache)) {
            if (entry.project !== projectName) {
                continue;
            }
            if (store.isIgnored(key, state.settings.ignored)) {
                continue;
            }
            const branchState = stateFor(entry);
            counts[branchState.level] += 1;
            if (branchState.level === LEVELS.UNKNOWN) {
                continue;
            }
            if (!worst || urgency.rank(branchState) < urgency.rank(worst)) {
                worst = branchState;
                worstBranch = entry.branch;
            }
        }
        return { state: worst || { level: LEVELS.UNKNOWN }, branch: worstBranch, counts };
    }

    /** Libelle commun aux deux rendus de la vue /project. */
    function projectSummaryText(branch, counts, worst) {
        const others = counts.expired + counts.critical + counts.warning - 1;
        return others > 0
            ? `${branch} + ${others} autre(s) branche(s) a surveiller`
            : `${branch} : ${urgency.describe(worst)}`;
    }

    /**
     * Marqueur sur une ligne de la vue liste. Un <tr> ne peut pas recevoir de
     * <div> : le marqueur va dans la cellule du nom, et le niveau colore la
     * ligne entiere.
     */
    function renderProjectRow(row, projectName, worst, branch, counts, shown) {
        const cell = parse.projectTitleCell(row);
        const existing = cell && cell.querySelector(`.${PREFIX}-row-badge`);
        row.classList.remove(
            `${PREFIX}-row`,
            levelClass(LEVELS.WARNING),
            levelClass(LEVELS.CRITICAL),
            levelClass(LEVELS.EXPIRED)
        );
        if (!shown || !cell) {
            if (existing) {
                existing.remove();
            }
            return;
        }
        row.classList.add(`${PREFIX}-row`, levelClass(worst.level));
        const badge = existing || document.createElement("span");
        badge.className = `${PREFIX}-row-badge ${levelClass(worst.level)}`;
        badge.textContent = urgency.badgeLabel(worst);
        badge.title = projectSummaryText(branch, counts, worst);
        if (!existing) {
            cell.append(badge);
        }
    }

    /** Bandeau en tete du bloc projet, sur la vue /project. */
    function renderProjectCard(card, projectName, layout = "kanban") {
        const { state: worst, branch, counts } = worstForProject(projectName);
        const shown =
            state.settings.showProjectBanner &&
            (worst.level === LEVELS.WARNING ||
                worst.level === LEVELS.CRITICAL ||
                worst.level === LEVELS.EXPIRED);
        if (layout === "list") {
            renderProjectRow(card, projectName, worst, branch, counts, shown);
            return;
        }
        let banner = card.querySelector(`.${PREFIX}-project-banner`);
        if (!shown) {
            if (banner) {
                banner.remove();
            }
            return;
        }
        if (!banner) {
            banner = document.createElement("div");
            card.insertBefore(banner, card.firstChild);
        }
        // La classe -banner porte les couleurs deja definies par niveau.
        banner.className = `${PREFIX}-banner ${PREFIX}-project-banner ${levelClass(worst.level)}`;
        banner.replaceChildren();

        const chip = document.createElement("span");
        chip.className = `${PREFIX}-banner-chip`;
        chip.textContent = urgency.badgeLabel(worst);

        const text = document.createElement("span");
        text.className = `${PREFIX}-banner-text`;
        text.textContent = projectSummaryText(branch, counts, worst);

        banner.append(chip, text);
        banner.title = `${branch} — ${urgency.describe(worst)}`;
    }

    function renderProjectIndex() {
        for (const card of parse.listProjectCards(document)) {
            if (store.isProjectIgnored(card.name, state.settings.ignored)) {
                continue;
            }
            renderProjectCard(card.element, card.name, card.layout);
        }
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
            // Un rendu en cours peut attendre une collecte de plusieurs
            // secondes : la demande est reportée, pas abandonnée. Sinon la
            // liste des branches rendue par Owl pendant la collecte ne reçoit
            // jamais ses boutons ⊘ ni le compteur Staging.
            state.renderPending = true;
            return;
        }
        state.rendering = true;
        state.renderPending = false;
        try {
            if (parse.isProjectIndex(location.pathname)) {
                renderProjectIndex();
                // Sans cache, la vue projet n'a rien a montrer : on force le
                // balayage au lieu d'attendre la prochaine echeance.
                if (!Object.keys(state.cache).length) {
                    await scanAllProjects({ force: true });
                }
                return;
            }

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
                renderExcludeButton(item.element, project, item.name, !ignored);
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
            if (state.renderPending) {
                scheduleRender();
            }
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

        document.addEventListener("click", (event) => {
            if (!event.target.closest?.(`.${PREFIX}-menu`)) {
                closeMenu();
            }
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                closeMenu();
            }
        });

        chrome.storage.onChanged.addListener(async (changes, area) => {
            if (area === "sync") {
                state.settings = await store.getSettings();
                scheduleRender();
            }
            if (area === "local" && changes.branches) {
                state.cache = changes.branches.newValue || {};
                // La vue projet se peint depuis le cache seul : sans ce rendu,
                // les bandeaux resteraient vides jusqu'au prochain changement
                // de DOM.
                scheduleRender();
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
