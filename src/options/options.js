(async function () {
    const { store } = globalThis.CHROMESH;

    const CHECKBOXES = ["useHolidays", "notify", "showBadges", "showBanner", "scanAllProjects"];
    const NUMBERS = ["criticalDays", "warningDays", "notifyHour", "refreshHours"];

    const settings = await store.getSettings();

    document.getElementById("country").value = settings.country;
    CHECKBOXES.forEach((id) => {
        document.getElementById(id).checked = Boolean(settings[id]);
    });
    NUMBERS.forEach((id) => {
        document.getElementById(id).value = settings[id];
    });
    document.getElementById("ignored").value = (settings.ignored || []).join("\n");

    document.getElementById("save").addEventListener("click", async () => {
        const patch = { country: document.getElementById("country").value };
        CHECKBOXES.forEach((id) => {
            patch[id] = document.getElementById(id).checked;
        });
        NUMBERS.forEach((id) => {
            const value = Number(document.getElementById(id).value);
            patch[id] = Number.isFinite(value) ? value : store.DEFAULTS[id];
        });
        patch.ignored = document
            .getElementById("ignored")
            .value.split("\n")
            .map((line) => line.trim())
            .filter(Boolean);

        await store.setSettings(patch);
        const saved = document.getElementById("saved");
        saved.hidden = false;
        setTimeout(() => {
            saved.hidden = true;
        }, 1800);
    });
})();
