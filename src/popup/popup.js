(async function () {
    const { workdays, urgency, store, filter: filtering } = globalThis.CHROMESH;
    const LEVELS = urgency.LEVELS;

    const list = document.getElementById("list");
    const empty = document.getElementById("empty");
    const noMatch = document.getElementById("no-match");
    const footer = document.getElementById("footer");
    const filters = document.getElementById("filters");
    const search = document.getElementById("search");
    const clear = document.getElementById("clear");
    const levels = document.getElementById("levels");

    document.getElementById("options").addEventListener("click", () => {
        chrome.runtime.openOptionsPage();
    });
    document.getElementById("refresh").addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "chromesh:refresh-now" });
        window.close();
    });

    const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

    // Filtre d'affichage : repart à zéro à chaque ouverture du popup.
    const filter = filtering.empty();
    // Dernière lecture du stockage, réutilisée à chaque frappe dans la recherche.
    let data = { rows: [], settings: {}, status: {} };

    search.addEventListener("input", () => {
        filter.text = search.value;
        draw();
    });
    search.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && filtering.isActive(filter)) {
            // Sans cela, Échap ferme le popup.
            event.preventDefault();
            resetFilter();
        }
    });
    clear.addEventListener("click", () => {
        resetFilter();
        search.focus();
    });

    function resetFilter() {
        filter.text = "";
        filter.hiddenLevels.clear();
        search.value = "";
        draw();
    }

    function actionButton(label, title, run) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.title = title;
        button.addEventListener("click", async (event) => {
            // Le <li> ouvre la branche : le clic ne doit pas lui parvenir.
            event.stopPropagation();
            await run();
            await load();
        });
        return button;
    }

    async function load() {
        const [settings, branches, status] = await Promise.all([
            store.getSettings(),
            store.getBranches(),
            store.getStatus(),
        ]);

        const rows = Object.entries(branches)
            .filter(([key]) => !store.isIgnored(key, settings.ignored))
            .map(([key, entry]) => {
                const [project, branch] = key.split("::");
                const state = entry.expirationDate
                    ? urgency.evaluate(workdays.fromIsoDay(entry.expirationDate), settings)
                    : { level: LEVELS.UNKNOWN };
                return { key, project, branch, entry, state, level: state.level };
            })
            .filter((row) => row.level !== LEVELS.UNKNOWN)
            .sort((a, b) => urgency.rank(a.state) - urgency.rank(b.state));

        data = { rows, settings, status };
        draw();
    }

    // Boutons créés une fois : les recréer à chaque rendu ferait perdre le focus.
    const levelButtons = filtering.LEVEL_CHOICES.map(({ level, label }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `level ${level}`;
        button.addEventListener("click", () => {
            if (filter.hiddenLevels.has(level)) {
                filter.hiddenLevels.delete(level);
            } else {
                filter.hiddenLevels.add(level);
            }
            draw();
        });
        levels.append(button);
        return { level, label, button };
    });

    function drawLevels(counts) {
        for (const { level, label, button } of levelButtons) {
            const shown = !filter.hiddenLevels.has(level);
            button.classList.toggle("off", !shown);
            button.setAttribute("aria-pressed", String(shown));
            button.textContent = `${label} ${counts[level]}`;
            button.title = shown ? `Masquer le niveau ${label}` : `Afficher le niveau ${label}`;
        }
    }

    function drawRow(row) {
        const { project, branch } = row;

        const item = document.createElement("li");
        item.title = urgency.describe(row.state);

        const chip = document.createElement("span");
        chip.className = `chip ${row.level}`;
        chip.textContent = urgency.badgeLabel(row.state);

        const meta = document.createElement("div");
        meta.className = "meta";

        const name = document.createElement("div");
        name.className = "branch";
        name.textContent = branch;

        const detail = document.createElement("div");
        detail.className = "detail";
        detail.textContent =
            row.level === LEVELS.EXPIRED
                ? `${project} · à rebuild`
                : `${project} · dernier jour utile ${row.state.lastSafeDay.toLocaleDateString("fr-FR")}`;

        const actions = document.createElement("span");
        actions.className = "actions";
        actions.append(
            actionButton("⊘ branche", `Exclure la branche ${branch}`, () => store.addIgnored(row.key)),
            actionButton("⊘ projet", `Exclure toutes les branches du projet ${project}`, () =>
                store.addIgnored(`${project}::*`)
            )
        );

        meta.append(name, detail);
        item.append(chip, meta, actions);
        item.addEventListener("click", () => chrome.tabs.create({ url: row.entry.url }));
        return item;
    }

    function draw() {
        const { rows, settings, status } = data;
        const visible = rows.filter((row) => filtering.matches(row, filter));
        const hidden = rows.length - visible.length;

        filters.hidden = rows.length === 0;
        clear.hidden = !filtering.isActive(filter);
        empty.hidden = rows.length > 0;
        noMatch.hidden = rows.length === 0 || visible.length > 0;
        drawLevels(filtering.countByLevel(rows));
        list.replaceChildren(...visible.map(drawRow));

        const footerParts = [];
        // Fraîcheur des données : calculée sur toutes les branches, filtre ou non.
        const oldest = Math.min(...rows.map((row) => row.entry.fetchedAt || Infinity));
        if (Number.isFinite(oldest)) {
            footerParts.push(`Relevé le plus ancien : ${fmt.format(new Date(oldest))}`);
        }
        if (hidden) {
            footerParts.push(`${hidden} masquée(s) par le filtre`);
        }
        const excluded = (settings.ignored || []).length;
        if (excluded) {
            footerParts.push(`${excluded} exclusion(s), réversibles dans les paramètres`);
        }
        if (status.collector === "none") {
            footerParts.push("Aucun onglet odoo.sh ouvert : données figées.");
        }
        if (status.lastError) {
            footerParts.push(`Dernière erreur : ${status.lastError}`);
        }
        footer.textContent = footerParts.join(" · ");
    }

    await load();
    if (!filters.hidden) {
        search.focus();
    }
})();
