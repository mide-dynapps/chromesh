/**
 * Bases Odoo Online : décide, à partir de la session d'une base ouverte, s'il
 * faut suivre son échéance. Fonctions pures, sans réseau ni stockage.
 * Exposé comme globalThis.CHROMESH.online.
 *
 * La donnée vient de POST /web/session/get_session_info, appelé par
 * `src/content/online.js` avec la session de l'utilisateur. Pour un
 * administrateur, la réponse porte `expiration_date` ("YYYY-MM-DD HH:MM:SS")
 * et `expiration_reason` ("trial", "renewal"…).
 *
 * Odoo Online et une production Odoo.sh renvoient la même `server_version`
 * (`18.0+e`) et la même raison `renewal`. Deux signaux les séparent (sondes
 * du 12/11/2026) : sur Odoo Online, `db` est égal au sous-domaine et la clé
 * `odoo_website_url` est présente. Odoo.sh nomme sa base
 * `<owner>-<projet>-<branche>-<id>` et n'envoie pas cette clé.
 */
(function (root) {
    const ns = (root.CHROMESH = root.CHROMESH || {});

    /** Libellé de « projet » sous lequel les bases Online sont rangées en cache. */
    const PROJECT = "Odoo Online";

    /** Raisons d'expiration suivies. Les renouvellements d'abonnement ne le sont pas. */
    const TRACKED_REASONS = ["trial"];

    /** Hôtes de odoo.com qui ne sont jamais une base client. */
    const EXCLUDED_HOSTS = ["www.odoo.com", "odoo.com"];

    /** Motifs d'injection du content script, et accès demandé à l'activation. */
    const ORIGIN = "https://*.odoo.com/*";
    const MATCHES = ["https://*.odoo.com/odoo*", "https://*.odoo.com/web*"];
    const EXCLUDE_MATCHES = [
        "https://www.odoo.com/*",
        "https://*.dev.odoo.com/*",
        "https://*.odoo.com/web/login*",
        "https://*.odoo.com/web/signup*",
        "https://*.odoo.com/web/reset_password*",
    ];

    function normalizeHost(host) {
        return String(host || "").trim().toLowerCase();
    }

    /** Sous-domaine de odoo.com à un seul niveau, hors builds Odoo.sh (`*.dev.odoo.com`). */
    function isCandidateHost(host) {
        const name = normalizeHost(host);
        if (EXCLUDED_HOSTS.includes(name) || !name.endsWith(".odoo.com")) {
            return false;
        }
        return name.split(".").length === 3;
    }

    /** Les deux signaux d'une instance Odoo Online, lus séparément. */
    function saasSignals(info, host) {
        const label = normalizeHost(host).split(".")[0];
        return {
            dbMatchesHost: Boolean(info && info.db) && String(info.db).toLowerCase() === label,
            hasWebsiteUrl: Boolean(info) && Object.prototype.hasOwnProperty.call(info, "odoo_website_url"),
        };
    }

    /** Instance Odoo Online : les deux signaux sont exigés. */
    function isSaas(info, host) {
        const signals = saasSignals(info, host);
        return isCandidateHost(host) && signals.dbMatchesHost && signals.hasWebsiteUrl;
    }

    function cacheKey(db) {
        return `${PROJECT}::${db}`;
    }

    /** "2026-11-19 14:47:52" → "2026-11-19". null si le format est inattendu. */
    function toIsoDay(value) {
        const match = /^(\d{4}-\d{2}-\d{2})\b/.exec(String(value || ""));
        return match ? match[1] : null;
    }

    /**
     * Décide quoi faire de la session lue.
     *  - skip : pas une instance Online, rien à toucher ;
     *  - drop : instance Online qui n'est plus suivie (abonnement souscrit,
     *           utilisateur non admin) — son entrée sort du cache ;
     *  - put  : base d'essai, `entry` est à écrire en cache.
     * `mixed` signale des signaux SaaS contradictoires, à journaliser.
     */
    function decide(info, host, now = Date.now()) {
        if (!isSaas(info, host)) {
            const signals = saasSignals(info, host);
            return { action: "skip", mixed: signals.dbMatchesHost !== signals.hasWebsiteUrl };
        }
        const key = cacheKey(info.db);
        const expirationDate = toIsoDay(info.expiration_date);
        if (!expirationDate || !TRACKED_REASONS.includes(info.expiration_reason)) {
            return { action: "drop", key };
        }
        return {
            action: "put",
            key,
            entry: {
                project: PROJECT,
                branch: String(info.db),
                expirationDate,
                reason: info.expiration_reason,
                source: "online",
                readable: true,
                dropped: false,
                // /web existe dans toutes les versions ; en 18+ il redirige vers /odoo.
                url: `https://${normalizeHost(host)}/web`,
                fetchedAt: now,
            },
        };
    }

    ns.online = {
        PROJECT,
        TRACKED_REASONS,
        ORIGIN,
        MATCHES,
        EXCLUDE_MATCHES,
        isCandidateHost,
        saasSignals,
        isSaas,
        cacheKey,
        toIsoDay,
        decide,
    };
})(globalThis);
