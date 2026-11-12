(async function () {
    const { store, online } = globalThis.CHROMESH;

    const CHECKBOXES = [
        "useHolidays",
        "notify",
        "showBadges",
        "showBanner",
        "showProjectBanner",
        "scanAllProjects",
        "trackOnline",
    ];
    const ONLINE_ACCESS = { origins: [online.ORIGIN] };
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

    // L'accès à *.odoo.com se demande au clic : le navigateur exige un geste
    // de l'utilisateur, et l'appel doit précéder tout await.
    const trackOnline = document.getElementById("trackOnline");
    const onlineError = document.getElementById("online-error");
    trackOnline.addEventListener("change", () => {
        onlineError.hidden = true;
        if (!trackOnline.checked) {
            return;
        }
        chrome.permissions.request(ONLINE_ACCESS).then(
            (granted) => {
                if (!granted) {
                    trackOnline.checked = false;
                    onlineError.textContent = "Accès à *.odoo.com refusé : l'option reste désactivée.";
                    onlineError.hidden = false;
                }
            },
            (error) => {
                trackOnline.checked = false;
                onlineError.textContent = String(error.message || error);
                onlineError.hidden = false;
            }
        );
    });

    document.getElementById("save").addEventListener("click", async () => {
        const patch = { country: document.getElementById("country").value };
        CHECKBOXES.forEach((id) => {
            patch[id] = document.getElementById(id).checked;
        });
        NUMBERS.forEach((id) => {
            const raw = document.getElementById(id).value.trim();
            // Un champ vide vaut 0 pour Number() : sans ce test, il effacerait
            // le reglage au lieu de revenir au defaut.
            patch[id] = raw === "" ? store.DEFAULTS[id] : Number(raw);
        });
        patch.ignored = document
            .getElementById("ignored")
            .value.split("\n")
            .map((line) => line.trim())
            .filter(Boolean);

        const saved = document.getElementById("saved");
        const failed = document.getElementById("save-error");
        failed.hidden = true;
        try {
            // store.setSettings borne les nombres et force warningDays >=
            // criticalDays : les champs sont relus pour montrer le resultat.
            const written = await store.setSettings(patch);
            if (!patch.trackOnline) {
                // Option coupée : l'accès à *.odoo.com est rendu. Le service
                // worker désinscrit le script sur ce changement.
                await chrome.permissions.remove(ONLINE_ACCESS).catch(() => false);
            }
            NUMBERS.forEach((id) => {
                document.getElementById(id).value = written[id];
            });
            saved.hidden = false;
            setTimeout(() => {
                saved.hidden = true;
            }, 1800);
        } catch (error) {
            failed.textContent = String(error.message || error);
            failed.hidden = false;
        }
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
