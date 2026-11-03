(async function () {
    const { store } = globalThis.CHROMESH;

    const CHECKBOXES = ["useHolidays", "notify", "showBadges", "showBanner", "showProjectBanner", "scanAllProjects"];
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

    showBuild();

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

    /** Version, navigateur et mode d'installation, en bas de page. */
    async function showBuild() {
        const parts = [`Chromesh ${chrome.runtime.getManifest().version}`];

        const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
        const brand = brands.find((b) => /Edge|Chrome/.test(b.brand));
        if (brand) {
            parts.push(`${brand.brand.replace(/^(Google|Microsoft) /, "")} ${brand.version}`);
        } else {
            const edge = navigator.userAgent.match(/Edg\/(\d+)/);
            const chromeVersion = navigator.userAgent.match(/Chrome\/(\d+)/);
            if (edge) {
                parts.push(`Edge ${edge[1]}`);
            } else if (chromeVersion) {
                parts.push(`Chrome ${chromeVersion[1]}`);
            }
        }

        // management.getSelf ne demande pas la permission "management".
        try {
            const self = await chrome.management.getSelf();
            if (self.installType === "development") {
                parts.push("non empaquetée");
            }
        } catch (error) {
            // API absente : le mode d'installation n'est pas affiché.
        }

        parts.push(`ID ${chrome.runtime.id}`);
        document.getElementById("build").textContent = parts.join(" · ");
    }
})();
