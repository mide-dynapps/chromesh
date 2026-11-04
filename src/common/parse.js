/**
 * Scraping of the Odoo.sh pages.
 * Exposed as globalThis.CHROMESH.parse.
 *
 * Reference markup (Odoo.sh, october 2026):
 *   li.o_branch[data-branch-name] inside the <ul> that follows
 *   .o_stage[data-stage="staging"] in .o_branches_listing
 *   <div class="mt-2"><strong>This staging build will be deleted on 18 October 2026.</strong></div>
 *   inside the newest .o_tracking of .o_branch_history
 */
(function (root) {
    const ns = (root.CHROMESH = root.CHROMESH || {});

    const MONTHS = {
        january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
        july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
        janvier: 1, "février": 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
        juillet: 7, "août": 8, aout: 8, septembre: 9, octobre: 10, novembre: 11,
        "décembre": 12, decembre: 12,
    };

    /** Matches the English and French wordings of the garbage-collection notice. */
    const DELETION_RE =
        /(?:will be deleted on|sera supprim[ée]e? le|supprim[ée]e? le)\s+([^.\n<]{3,40})/i;

    function parseLongDate(input) {
        const text = String(input || "").trim().replace(/,/g, " ").replace(/\s+/g, " ");
        if (!text) {
            return null;
        }

        // "18 October 2026" / "1er octobre 2026"
        let m = /^(\d{1,2})(?:er|st|nd|rd|th)?\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})$/.exec(text);
        if (m && MONTHS[m[2].toLowerCase()]) {
            return new Date(+m[3], MONTHS[m[2].toLowerCase()] - 1, +m[1]);
        }

        // "October 18 2026"
        m = /^([A-Za-zÀ-ÿ]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})$/.exec(text);
        if (m && MONTHS[m[1].toLowerCase()]) {
            return new Date(+m[3], MONTHS[m[1].toLowerCase()] - 1, +m[2]);
        }

        // "2026-10-18"
        m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (m) {
            return new Date(+m[1], +m[2] - 1, +m[3]);
        }

        // "18/10/2026"
        m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
        if (m) {
            return new Date(+m[3], +m[2] - 1, +m[1]);
        }

        const parsed = Date.parse(text);
        if (!Number.isNaN(parsed)) {
            const date = new Date(parsed);
            return new Date(date.getFullYear(), date.getMonth(), date.getDate());
        }
        return null;
    }

    /**
     * Finds the deletion notice in a branch history document.
     * Returns {date, rawText, element} or null.
     */
    function findDeletionNotice(scope) {
        const trackings = scope.querySelectorAll(".o_branch_history .o_tracking");
        const candidates = trackings.length ? trackings : [scope];
        for (const tracking of candidates) {
            const text = tracking.textContent || "";
            const match = DELETION_RE.exec(text);
            if (!match) {
                continue;
            }
            const date = parseLongDate(match[1]);
            if (!date) {
                continue;
            }
            const anchor =
                [...tracking.querySelectorAll("strong, div")].find((el) =>
                    DELETION_RE.test(el.textContent || "") && el.children.length === 0
                ) || tracking;
            return { date, rawText: match[0].trim(), element: anchor };
        }
        return null;
    }

    /** True when the newest build of this branch is already garbage collected. */
    function isLatestBuildDropped(scope) {
        const first = scope.querySelector(".o_branch_history .o_tracking");
        return Boolean(first && /\bDROPPED\b/i.test(first.textContent || ""));
    }

    /** All branches of the left panel, with their stage. */
    function listBranches(scope) {
        const branches = [];
        scope.querySelectorAll(".o_branches_listing .o_stage[data-stage]").forEach((stageEl) => {
            const stage = stageEl.dataset.stage;
            let node = stageEl.nextElementSibling;
            while (node && node.tagName !== "UL") {
                node = node.nextElementSibling;
            }
            if (!node) {
                return;
            }
            node.querySelectorAll("li.o_branch[data-branch-name]").forEach((li) => {
                branches.push({ name: li.dataset.branchName, stage, element: li });
            });
        });
        return branches;
    }

    /** True on the project index (/project or /project/), not on a project. */
    function isProjectIndex(pathname) {
        return /^\/project\/?$/.test(pathname || "");
    }

    /**
     * Project blocks of the index page. Relevé le 03/11 sur /project, qui a
     * deux rendus sans changement d'URL :
     *
     *   kanban : div.row.o_project_cards > div.o_project_card_container
     *              > div.card.o_sh_display_kanban
     *            titre = a.x-odoo-sh-project-name[href="/project/<name>"]
     *   liste  : div.o_sh_display_list > table > tbody
     *              > tr.o_project_card_container
     *            titre = th.x-odoo-sh-project-name (texte nu, sans lien)
     *            seul lien projet = le bouton « Open », dernière cellule
     *
     * Le nom vient toujours du href, jamais du texte : le libellé affiché est
     * `name` (« DEMO_V19 ») alors que la clé de cache est `project_name`
     * (« demo-v19 »). Returns [{name, element, layout}], layout « kanban » ou
     * « list ».
     */
    const PROJECT_LINK_SELECTOR = "a.x-odoo-sh-project-name";
    const CARD_SELECTOR =
        '.o_sh_display_kanban, .o_project_card_container, .o_project_card, .o_paas_project, .card, [class*="project_card"]';
    // /project/<segment> qui ne désignent pas un projet.
    const RESERVED_NAMES = new Set(["create", "new"]);

    function listProjectCards(scope) {
        const cards = new Map();
        // Le lien de titre en kanban ; en liste il n'existe pas, tout lien
        // /project/<name> fait l'affaire puisqu'il n'y en a qu'un par ligne.
        let anchors = [...scope.querySelectorAll(PROJECT_LINK_SELECTOR)];
        if (!anchors.length) {
            anchors = [...scope.querySelectorAll('a[href^="/project/"]')];
        }
        anchors.forEach((anchor) => {
            const raw = /^\/project\/([^/?#]+)/.exec(anchor.getAttribute("href") || "")?.[1];
            if (!raw) {
                return;
            }
            const name = decodeURIComponent(raw);
            if (RESERVED_NAMES.has(name) || cards.has(name)) {
                return;
            }
            const card = anchor.closest(CARD_SELECTOR);
            if (card) {
                const layout = card.tagName === "TR" ? "list" : "kanban";
                cards.set(name, { name, element: card, layout });
            }
        });
        return [...cards.values()];
    }

    /**
     * Bloc qui contient toutes les tuiles ou lignes de projets : point
     * d'insertion de la barre de filtre, juste avant lui.
     */
    function projectListAnchor(cards) {
        if (!cards.length) {
            return null;
        }
        const first = cards[0].element;
        if (cards[0].layout === "list") {
            return first.closest("table") || first.closest("tbody");
        }
        return first.closest(".o_project_card_container")?.parentElement || first.parentElement;
    }

    /**
     * Element a masquer pour retirer un projet de la liste : en kanban la
     * cellule de grille, qui laisserait sinon un trou, et en liste le <tr>,
     * qui est deja la carte.
     */
    function projectHideTarget(card) {
        return card.element.closest(".o_project_card_container") || card.element;
    }

    /** {project, branch} from /project/<project>/branches/<branch>/... */
    function locationInfo(pathname) {
        const m = /^\/project\/([^/]+)(?:\/branches\/([^/]+))?/.exec(pathname || "");
        return m ? { project: m[1], branch: m[2] ? decodeURIComponent(m[2]) : null } : { project: null, branch: null };
    }

    const cacheKey = (project, branch) => `${project}::${branch}`;

    ns.parse = {
        DELETION_RE,
        parseLongDate,
        findDeletionNotice,
        isLatestBuildDropped,
        listBranches,
        isProjectIndex,
        listProjectCards,
        projectListAnchor,
        projectHideTarget,
        locationInfo,
        cacheKey,
    };
})(globalThis);
