/**
 * Client de l'API interne d'Odoo.sh.
 * Exposé via globalThis.CHROMESH.api.
 *
 * Routes observées (POST, enveloppe JSON-RPC, params vide) :
 *   /app/projects                         liste des projets
 *   /app/project/<nom>/get_info           dont active_repo -> slug du dépôt
 *   /app/project/<slug>/branches          [{id, name, stage, slug, last_build_id, ...}]
 *   /app/branch/<id>/builds               [{branch_info, builds: [{..., expiration_date}]}]
 *   /app/branch/<id>/history              {num_trackings, trackings: [{..., expiration_date}]}
 *
 * expiration_date est une date ISO ('2026-10-18') : c'est le jour où Odoo.sh
 * supprime le build. C'est la seule donnée dont l'extension a besoin.
 */
(function (root) {
    const ns = (root.CHROMESH = root.CHROMESH || {});
    const BASE = "https://www.odoo.sh";

    /**
     * `status` est le code HTTP quand il y en a un, `code` une cause
     * applicative : 'non-json', 'odoo-error', 'empty-projects',
     * 'slug-not-found'. Les appelants trient dessus plutôt que sur le texte.
     */
    class ApiError extends Error {
        constructor(message, { status = null, code = null } = {}) {
            super(message);
            this.name = "ApiError";
            this.status = status;
            this.code = code;
        }
    }

    async function call(path, params = {}) {
        const response = await fetch(`${BASE}${path}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "call", params }),
        });
        const text = await response.text();
        let payload;
        try {
            payload = JSON.parse(text);
        } catch {
            // Session expirée : Odoo renvoie la page de login en HTML.
            throw new ApiError(
                `réponse non JSON sur ${path} (HTTP ${response.status}) — session probablement expirée`,
                { status: response.status, code: "non-json" }
            );
        }
        if (payload.error) {
            throw new ApiError(payload.error.message || `erreur Odoo sur ${path}`, {
                status: response.status,
                code: "odoo-error",
            });
        }
        return payload.result ?? payload;
    }

    const asArray = (value, ...keys) => {
        if (Array.isArray(value)) {
            return value;
        }
        if (value && typeof value === "object") {
            for (const key of keys) {
                if (Array.isArray(value[key])) {
                    return value[key];
                }
            }
        }
        return [];
    };

    /** 'acme-demo-v19-123456' : des mots en minuscules puis un id. */
    const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9.]+)*-\d{3,}$/i;

    function findSlug(value, depth = 0) {
        if (typeof value === "string") {
            return SLUG_RE.test(value) ? value : null;
        }
        if (!value || typeof value !== "object" || depth > 3) {
            return null;
        }
        // technical_name est le champ réel de get_info().active_repo, relevé le
        // 19/10/2026 : 'acme-demo-v19-123456'. Les autres restent en
        // repli, la forme n'est pas documentée.
        for (const key of ["technical_name", "slug", "repo_slug", "full_name", "name"]) {
            const found = findSlug(value[key], depth + 1);
            if (found) {
                return found;
            }
        }
        for (const nested of Object.values(value)) {
            const found = findSlug(nested, depth + 1);
            if (found) {
                return found;
            }
        }
        return null;
    }

    function normalizeProject(entry) {
        if (typeof entry === "string") {
            return { name: entry, slug: null };
        }
        if (!entry || typeof entry !== "object") {
            return { name: null, slug: null };
        }
        // project_name d'abord : c'est lui qui sert dans les URL et dans
        // get_info ('demo-v19'). `name` porte le libellé affiché ('DEMO_V19'),
        // qui ne résout pas.
        return {
            name: entry.project_name || entry.name || entry.shortname || entry.project || null,
            slug: findSlug(entry),
        };
    }

    async function listProjects() {
        // Forme relevée le 19/10/2026 : {hosting_user_id, repos: [...]}, chaque
        // entrée portant project_name et technical_name — le slug est là, pas
        // besoin d'un get_info par projet.
        const result = await call("/app/projects");
        const projects = asArray(result, "repos", "projects", "data")
            .map(normalizeProject)
            .filter((project) => project.name);
        // Un tableau vide n'est pas un état légitime : un utilisateur d'Odoo.sh
        // a au moins un projet. Mieux vaut une erreur lisible qu'un popup muet.
        if (!projects.length) {
            throw new ApiError(
                `/app/projects n'a renvoyé aucun projet exploitable (${JSON.stringify(result)?.slice(0, 200)})`,
                { code: "empty-projects" }
            );
        }
        return projects;
    }

    // Le slug d'un dépôt ne change pas : une seule requête get_info par projet
    // et par session du worker ou de l'onglet.
    const slugCache = new Map();

    async function projectSlug(projectName) {
        if (slugCache.has(projectName)) {
            return slugCache.get(projectName);
        }
        const info = await call(`/app/project/${encodeURIComponent(projectName)}/get_info`);
        const slug = findSlug(info.active_repo) || findSlug(info.repos) || findSlug(info);
        if (!slug) {
            throw new ApiError(`slug du dépôt introuvable pour le projet ${projectName}`, {
                code: "slug-not-found",
            });
        }
        slugCache.set(projectName, slug);
        return slug;
    }

    async function listBranches(slug) {
        const result = await call(`/app/project/${encodeURIComponent(slug)}/branches`);
        return asArray(result, "branches", "data");
    }

    /** Le build courant de la branche, celui qui porte l'expiration qui compte. */
    async function latestBuild(branchId) {
        const result = await call(`/app/branch/${branchId}/builds`);
        const page = Array.isArray(result) ? result[0] : result;
        if (!page) {
            return null;
        }
        const builds = asArray(page, "builds");
        const lastId = page.branch_info?.last_build_id?.[0];
        return builds.find((build) => build.id === lastId) || builds[0] || null;
    }

    const branchUrl = (projectName, branchName) =>
        `${BASE}/project/${projectName}/branches/${encodeURIComponent(branchName)}/history`;

    /**
     * Collecte les branches staging d'un projet.
     * options: {slug, onEntry(entry)}
     * Retourne {slug, branches, staging, entries, keys}. `keys` est la liste
     * des clés de cache vues chez Odoo.sh : l'appelant s'en sert pour purger
     * du cache les branches disparues.
     */
    async function collectProject(projectName, options = {}) {
        const slug = options.slug || (await projectSlug(projectName));
        const branches = await listBranches(slug);
        const staging = branches.filter((branch) => branch.stage === "staging");
        const entries = [];

        for (const branch of staging) {
            let build = null;
            try {
                build = await latestBuild(branch.id);
            } catch (error) {
                console.debug("[chromesh] build illisible", branch.name, error);
            }
            const entry = {
                project: projectName,
                projectSlug: slug,
                branch: branch.name,
                branchId: branch.id,
                branchSlug: branch.slug || null,
                expirationDate: build?.expiration_date || null,
                dropped: (build?.status || branch.last_build_status) === "dropped",
                buildId: build?.id || null,
                buildUrl: build?.url || null,
                readable: Boolean(build),
                url: branchUrl(projectName, branch.name),
                fetchedAt: Date.now(),
            };
            entries.push(entry);
            if (options.onEntry) {
                await options.onEntry(entry);
            }
        }
        return {
            slug,
            branches,
            staging,
            entries,
            keys: entries.map((entry) => `${entry.project}::${entry.branch}`),
        };
    }

    ns.api = {
        ApiError,
        BASE,
        call,
        listProjects,
        projectSlug,
        listBranches,
        latestBuild,
        collectProject,
        branchUrl,
        findSlug,
    };
})(globalThis);
