/**
 * Tests de la logique pure : jours ouvrés, niveaux d'urgence, stockage,
 * filtre du popup. Aucun DOM, aucun réseau, aucun navigateur.
 *
 *   node tests/run.js
 *
 * Ce que ces tests ne couvrent pas : l'injection dans les pages Odoo.sh, le
 * service worker, les notifications. Seul un chargement dans Edge ou Chrome
 * les vérifie.
 */
const { loadCommon, suite, check, equal, throws, report } = require("./harness");

const DAY = 86400000;

(async function main() {
    /* --------------------------------------------------------- jours ouvrés */
    {
        const { workdays } = loadCommon();
        suite("workdays");

        equal("Pâques 2026 tombe le 5 avril", workdays.isoDay(workdays.easterSunday(2026)), "2026-04-05");
        equal("Pâques 2027 tombe le 28 mars", workdays.isoDay(workdays.easterSunday(2027)), "2027-03-28");

        const ascension = workdays.addDays(workdays.easterSunday(2026), 39);
        equal("Ascension 2026 au 14 mai", workdays.isoDay(ascension), "2026-05-14");

        check(
            "le 14 juillet est férié en France",
            workdays.isHoliday(new Date(2026, 6, 14), { country: "FR" })
        );
        check(
            "le 14 juillet n'est pas férié en Belgique",
            !workdays.isHoliday(new Date(2026, 6, 14), { country: "BE" })
        );
        check(
            "les fériés sont ignorés quand useHolidays vaut false",
            !workdays.isHoliday(new Date(2026, 6, 14), { country: "FR", useHolidays: false })
        );

        // Vendredi 16/10/2026 -> lundi 19/10 : un seul jour ouvré.
        equal(
            "un week-end ne compte pas",
            workdays.countWorkdays(new Date(2026, 9, 16), new Date(2026, 9, 19), { country: "FR" }),
            1
        );
        equal(
            "le comptage est signé",
            workdays.countWorkdays(new Date(2026, 9, 19), new Date(2026, 9, 16), { country: "FR" }),
            -1
        );
        equal(
            "deux dates identiques donnent zéro",
            workdays.countWorkdays(new Date(2026, 9, 19), new Date(2026, 9, 19)),
            0
        );
        equal(
            "au-delà de MAX_SPAN_DAYS le comptage renvoie null",
            workdays.countWorkdays(new Date(2026, 0, 1), new Date(2060, 0, 1)),
            null
        );

        // Samedi 17/10/2026 -> le jour ouvré précédent est le vendredi 16.
        equal(
            "previousWorkday recule au vendredi",
            workdays.isoDay(workdays.previousWorkday(new Date(2026, 9, 17), { country: "FR" })),
            "2026-10-16"
        );
        equal(
            "isoDay n'applique pas de décalage UTC",
            workdays.isoDay(new Date(2026, 0, 1, 23, 30)),
            "2026-01-01"
        );
    }

    /* ------------------------------------------------------------- urgence */
    {
        const { urgency, workdays } = loadCommon();
        suite("urgency");

        const settings = { country: "FR", criticalDays: 2, warningDays: 5 };
        // Suppression annoncée le dimanche 18/10/2026 : dernier jour utile
        // vendredi 16, puisque le samedi 17 n'est pas ouvré.
        const deletion = workdays.fromIsoDay("2026-10-18");
        const at = (iso) => urgency.evaluate(deletion, settings, workdays.fromIsoDay(iso));

        equal("mardi 13/10 : trois jours ouvrés restants", at("2026-10-13").workdaysLeft, 3);
        equal("mardi 13/10 : niveau attention", at("2026-10-13").level, "warning");
        equal("jeudi 15/10 : niveau critique", at("2026-10-15").level, "critical");
        equal("vendredi 16/10 : dernier jour utile", at("2026-10-16").workdaysLeft, 0);
        check("vendredi 16/10 : marqué comme aujourd'hui", at("2026-10-16").isToday);
        equal("samedi 17/10 : expiré", at("2026-10-17").level, "expired");
        equal("dimanche 18/10 : expiré", at("2026-10-18").level, "expired");
        check("le recul par le week-end est signalé", at("2026-10-13").shiftedByWeekend);

        equal("sans date, le niveau est inconnu", urgency.evaluate(null, settings).level, "unknown");
        equal(
            "une date aberrante donne inconnu plutôt qu'un faux J-xxxx",
            urgency.evaluate(workdays.fromIsoDay("2099-01-01"), settings, workdays.fromIsoDay("2026-01-01"))
                .level,
            "unknown"
        );

        equal("libellé du dernier jour", urgency.badgeLabel(at("2026-10-16")), "AUJOURD'HUI");
        equal("libellé J-3", urgency.badgeLabel(at("2026-10-13")), "J-3");
        equal("libellé expiré", urgency.badgeLabel(at("2026-10-17")), "EXPIRÉ");
        check(
            "le tri place l'expiré avant le critique",
            urgency.rank(at("2026-10-17")) < urgency.rank(at("2026-10-15"))
        );
    }

    /* ---------------------------------------------------- exclusions, cache */
    {
        const { store } = loadCommon();
        suite("store — exclusions");

        const rules = ["demo-v19::Develop", "autre::*", "tiers"];
        check("branche nommée exclue", store.isIgnored("demo-v19::Develop", rules));
        check("la casse est ignorée", store.isIgnored("DEMO-V19::develop", rules));
        check("autre branche du même projet gardée", !store.isIgnored("demo-v19::Staging", rules));
        check("projet exclu par ::*", store.isIgnored("autre::Develop", rules));
        check("projet exclu par son nom nu", store.isIgnored("tiers::Develop", rules));
        check("isProjectIgnored suit ::*", store.isProjectIgnored("autre", rules));
        check("isProjectIgnored ignore une règle de branche", !store.isProjectIgnored("demo-v19", rules));
    }

    {
        const { store } = loadCommon();
        suite("store — réglages");

        equal("un seuil hors borne est ramené au maximum", store.clamp("criticalDays", 999), 30);
        equal("un seuil négatif est ramené au minimum", store.clamp("refreshHours", -4), 1);
        equal("une valeur non numérique retombe sur le défaut", store.clamp("notifyHour", "abc"), 9);

        const fixed = store.normalizeSettings({ ...store.DEFAULTS, criticalDays: 8, warningDays: 3 });
        equal("warningDays ne peut pas passer sous criticalDays", fixed.warningDays, 8);

        await store.setSettings({ notifyHour: 99, refreshHours: 0 });
        const saved = await store.getSettings();
        equal("notifyHour est borné à 23", saved.notifyHour, 23);
        equal("refreshHours est borné à 1", saved.refreshHours, 1);

        await throws(
            "une liste d'exclusions trop lourde est refusée",
            () => store.setSettings({ ignored: Array.from({ length: 900 }, (_, i) => `projet-${i}::branche`) }),
            "chrome.storage.sync"
        );
    }

    {
        const { store } = loadCommon();
        suite("store — cache des branches");

        await store.putBranch({ project: "demo-v19", branch: "Develop", expirationDate: "2026-10-18" });
        await store.putBranch({ project: "demo-v19", branch: "Staging", expirationDate: "2026-10-20" });
        await store.putBranch({ project: "autre", branch: "Develop", expirationDate: "2026-10-21" });

        equal("trois branches en cache", Object.keys(await store.getBranches()).length, 3);

        const removed = await store.pruneProject("demo-v19", ["demo-v19::Develop"]);
        equal("la branche disparue est purgée", removed, ["demo-v19::Staging"]);
        equal(
            "les autres projets ne sont pas touchés",
            Object.keys(await store.getBranches()).sort(),
            ["autre::Develop", "demo-v19::Develop"]
        );

        // Écritures concurrentes : sans file d'attente, la dernière écrase les
        // précédentes et il n'en resterait qu'une.
        const { store: fresh } = loadCommon();
        await Promise.all(
            Array.from({ length: 12 }, (_, i) =>
                fresh.putBranch({ project: "p", branch: `b${i}`, expirationDate: "2026-10-18" })
            )
        );
        equal("douze écritures concurrentes sont toutes conservées", Object.keys(await fresh.getBranches()).length, 12);

        const ignored = await fresh.addIgnored("p::b1");
        equal("addIgnored enregistre la règle", ignored, ["p::b1"]);
        equal("addIgnored ignore un doublon", await fresh.addIgnored("p::b1"), ["p::b1"]);
        equal("addIgnored ignore une règle déjà couverte", await fresh.addIgnored("p::*"), ["p::b1", "p::*"]);
    }

    {
        const { store } = loadCommon();
        suite("store — jeton de balayage");

        const first = await store.claimScan(6 * 3600000);
        check("le premier appel prend le jeton", first.claimed);
        const second = await store.claimScan(6 * 3600000);
        check("le deuxième appel renonce", !second.claimed);
        const forced = await store.claimScan(6 * 3600000, { force: true });
        check("force passe outre", forced.claimed);

        await store.releaseScan(first.previous);
        const afterRelease = await store.claimScan(6 * 3600000);
        check("après libération, un nouvel appel reprend le jeton", afterRelease.claimed);

        await store.releaseScan(Date.now() - DAY);
        const stale = await store.claimScan(6 * 3600000);
        check("un jeton vieux de 24 h n'empêche pas un nouveau balayage", stale.claimed);
    }

    /* ------------------------------------------------------- filtre du popup */
    {
        const { filter } = loadCommon();
        suite("filter");

        const rows = [
            { project: "demo-v19", branch: "Développe", level: "critical" },
            { project: "autre", branch: "Staging", level: "ok" },
            { project: "tiers", branch: "Develop", level: "expired" },
        ];
        const state = filter.empty();
        check("un filtre vide est inactif", !filter.isActive(state));
        check("toutes les lignes passent", rows.every((row) => filter.matches(row, state)));

        state.text = "DEVELOPPE";
        check("la recherche ignore la casse et les accents", filter.matches(rows[0], state));
        check("une ligne hors recherche est écartée", !filter.matches(rows[1], state));

        state.text = "";
        state.hiddenLevels.add("ok");
        check("un niveau masqué écarte la ligne", !filter.matches(rows[1], state));
        check("le filtre est actif", filter.isActive(state));

        equal("comptage par niveau", filter.countByLevel(rows), {
            expired: 1,
            critical: 1,
            warning: 0,
            ok: 1,
        });
    }

    /* ------------------------------------------------------ analyse des URL */
    {
        const { parse } = loadCommon();
        suite("parse — URL et dates");

        equal("projet et branche", parse.locationInfo("/project/demo-v19/branches/Develop/history"), {
            project: "demo-v19",
            branch: "Develop",
        });
        equal("projet seul", parse.locationInfo("/project/demo-v19").branch, null);
        check("index des projets reconnu", parse.isProjectIndex("/project"));
        check("index des projets avec barre finale", parse.isProjectIndex("/project/"));
        check("une page projet n'est pas l'index", !parse.isProjectIndex("/project/demo-v19"));

        equal("date anglaise longue", parse.parseLongDate("18 October 2026").getDate(), 18);
        equal("date française longue", parse.parseLongDate("1er octobre 2026").getMonth(), 9);
        equal("date ISO", parse.parseLongDate("2026-10-18").getFullYear(), 2026);
        equal("chaîne vide", parse.parseLongDate(""), null);
    }

    process.exit(report() ? 0 : 1);
})();
