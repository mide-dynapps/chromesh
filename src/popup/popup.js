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

    const fmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });
    const footerParts = [];

    if (!rows.length) {
        empty.hidden = false;
    } else {
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

            meta.append(name, detail);
            item.append(chip, meta);
            item.addEventListener("click", () => chrome.tabs.create({ url: row.entry.url }));
            list.append(item);
        }
        if (Number.isFinite(oldest)) {
            footerParts.push(`Relevé le plus ancien : ${fmt.format(new Date(oldest))}`);
        }
    }

    if (status.collector === "none") {
        footerParts.push("Aucun onglet odoo.sh ouvert : données figées.");
    }
    if (status.lastError) {
        footerParts.push(`Dernière erreur : ${status.lastError}`);
    }
    footer.textContent = footerParts.join(" · ");
})();
