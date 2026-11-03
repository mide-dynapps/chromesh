(async function () {
    const { workdays, urgency, store } = globalThis.CHROMESH;
    const LEVELS = urgency.LEVELS;

    const list = document.getElementById("list");
    const empty = document.getElementById("empty");
    const footer = document.getElementById("footer");

    document.getElementById("options").addEventListener("click", () => {
        chrome.runtime.openOptionsPage();
    });
    document.getElementById("refresh").addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "chromesh:refresh-now" });
        window.close();
    });

    const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

    function actionButton(label, title, run) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.title = title;
        button.addEventListener("click", async (event) => {
            // Le <li> ouvre la branche : le clic ne doit pas lui parvenir.
            event.stopPropagation();
            await run();
            await render();
        });
        return button;
    }

    async function render() {
        const [settings, branches, status] = await Promise.all([
            store.getSettings(),
            store.getBranches(),
            store.getStatus(),
        ]);

        const rows = Object.entries(branches)
            .filter(([key]) => !store.isIgnored(key, settings.ignored))
            .map(([key, entry]) => ({
                key,
                entry,
                state: entry.expirationDate
                    ? urgency.evaluate(workdays.fromIsoDay(entry.expirationDate), settings)
                    : { level: LEVELS.UNKNOWN },
            }))
            .filter((row) => row.state.level !== LEVELS.UNKNOWN)
            .sort((a, b) => urgency.rank(a.state) - urgency.rank(b.state));

        list.replaceChildren();
        const footerParts = [];
        empty.hidden = rows.length > 0;

        let oldest = Infinity;
        for (const row of rows) {
            const [project, branch] = row.key.split("::");
            oldest = Math.min(oldest, row.entry.fetchedAt || Infinity);

            const item = document.createElement("li");
            item.title = urgency.describe(row.state);

            const chip = document.createElement("span");
            chip.className = `chip ${row.state.level}`;
            chip.textContent = urgency.badgeLabel(row.state);

            const meta = document.createElement("div");
            meta.className = "meta";

            const name = document.createElement("div");
            name.className = "branch";
            name.textContent = branch;

            const detail = document.createElement("div");
            detail.className = "detail";
            detail.textContent =
                row.state.level === LEVELS.EXPIRED
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
            list.append(item);
        }
        if (Number.isFinite(oldest)) {
            footerParts.push(`Relevé le plus ancien : ${fmt.format(new Date(oldest))}`);
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

    await render();
})();
