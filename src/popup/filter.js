/*
 * Filtre d'affichage du popup : recherche texte et niveaux masqués.
 * Logique pure, sans DOM ni stockage, testable sous Node.
 * Le filtre ne persiste pas : il repart à zéro à chaque ouverture du popup.
 * Il ne remplace pas les exclusions (`ignored`), qui restent le seul réglage
 * durable.
 */
(function (root) {
    const ns = (root.CHROMESH = root.CHROMESH || {});

    /** Niveaux proposés dans la barre, dans l'ordre d'affichage. */
    const LEVEL_CHOICES = [
        { level: "expired", label: "Expiré" },
        { level: "critical", label: "Critique" },
        { level: "warning", label: "Attention" },
        { level: "ok", label: "OK" },
    ];

    /** Minuscules, sans accents, sans espaces de bord. */
    function normalize(text) {
        return String(text || "")
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .toLowerCase()
            .trim();
    }

    function empty() {
        return { text: "", hiddenLevels: new Set() };
    }

    function isActive(filter) {
        return normalize(filter.text) !== "" || filter.hiddenLevels.size > 0;
    }

    /**
     * `row` : { project, branch, level }. La recherche porte sur le projet ou
     * la branche, en sous-chaîne.
     */
    function matches(row, filter) {
        if (filter.hiddenLevels.has(row.level)) {
            return false;
        }
        const needle = normalize(filter.text);
        if (!needle) {
            return true;
        }
        return normalize(row.project).includes(needle) || normalize(row.branch).includes(needle);
    }

    /** Compte par niveau, sur la liste non filtrée. */
    function countByLevel(rows) {
        const counts = Object.fromEntries(LEVEL_CHOICES.map((choice) => [choice.level, 0]));
        for (const row of rows) {
            if (row.level in counts) {
                counts[row.level] += 1;
            }
        }
        return counts;
    }

    ns.filter = { LEVEL_CHOICES, normalize, empty, isActive, matches, countByLevel };
})(globalThis);
