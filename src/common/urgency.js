/**
 * Turns a deletion date into an actionable urgency state.
 * Exposed as globalThis.CHROMESH.urgency.
 *
 * Model:
 *   deletionDate  = the day Odoo.sh announces the build will be deleted.
 *   lastSafeDay   = deletionDate - 1 calendar day, rolled back to the previous
 *                   working day. This is the last day you can still rebuild
 *                   during office hours. A deletion announced on a Monday means
 *                   the real deadline is the Friday before.
 *   workdaysLeft  = working days in (today, lastSafeDay].
 *                   0  -> act today, it is the last safe day
 *                   <0 -> too late (or already deleted)
 */
(function (root) {
    const ns = (root.CHROMESH = root.CHROMESH || {});
    const wd = ns.workdays;

    const LEVELS = {
        EXPIRED: "expired",
        CRITICAL: "critical",
        WARNING: "warning",
        OK: "ok",
        UNKNOWN: "unknown",
    };

    function evaluate(deletionDate, settings = {}, now = new Date()) {
        if (!deletionDate) {
            return { level: LEVELS.UNKNOWN };
        }
        const options = {
            country: settings.country || "FR",
            useHolidays: settings.useHolidays !== false,
        };
        const today = wd.startOfDay(now);
        const deletion = wd.startOfDay(deletionDate);
        const lastSafeDay = wd.previousWorkday(wd.addDays(deletion, -1), options);
        const workdaysLeft = wd.countWorkdays(today, lastSafeDay, options);
        const calendarDaysLeft = wd.countCalendarDays(today, deletion);
        const shiftedByWeekend = wd.countCalendarDays(lastSafeDay, wd.addDays(deletion, -1)) > 0;

        const criticalAt = Number.isFinite(settings.criticalDays) ? settings.criticalDays : 2;
        const warningAt = Number.isFinite(settings.warningDays) ? settings.warningDays : 5;

        let level;
        if (calendarDaysLeft <= 0 || workdaysLeft < 0) {
            level = LEVELS.EXPIRED;
        } else if (workdaysLeft <= criticalAt) {
            level = LEVELS.CRITICAL;
        } else if (workdaysLeft <= warningAt) {
            level = LEVELS.WARNING;
        } else {
            level = LEVELS.OK;
        }

        return {
            level,
            deletionDate: deletion,
            lastSafeDay,
            workdaysLeft,
            calendarDaysLeft,
            shiftedByWeekend,
            isToday: workdaysLeft === 0 && level !== LEVELS.EXPIRED,
        };
    }

    const DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
    });

    function badgeLabel(state) {
        switch (state.level) {
            case LEVELS.EXPIRED:
                return "EXPIRÉ";
            case LEVELS.UNKNOWN:
                return "?";
            default:
                return state.workdaysLeft === 0 ? "AUJOURD'HUI" : `J-${state.workdaysLeft}`;
        }
    }

    function describe(state) {
        if (state.level === LEVELS.UNKNOWN) {
            return "Aucune date de suppression trouvée pour cette branche.";
        }
        const deletion = DATE_FMT.format(state.deletionDate);
        const safe = DATE_FMT.format(state.lastSafeDay);
        if (state.level === LEVELS.EXPIRED) {
            return `Build supprimé (ou en cours de suppression) depuis le ${deletion}. Rebuild nécessaire.`;
        }
        const plural = Math.abs(state.workdaysLeft) > 1 ? "s" : "";
        const base =
            state.workdaysLeft === 0
                ? `Dernier jour utile : aujourd'hui. Suppression annoncée le ${deletion}.`
                : `${state.workdaysLeft} jour${plural} ouvré${plural} restant${plural} — dernier jour utile ${safe}, suppression le ${deletion}.`;
        return state.shiftedByWeekend
            ? `${base} Attention : l'échéance tombe un week-end ou un jour férié, la marge réelle est plus courte que le calendrier.`
            : base;
    }

    /** Sort key: the most urgent first. */
    function rank(state) {
        const order = { expired: 0, critical: 1, warning: 2, ok: 3, unknown: 4 };
        return order[state.level] * 10000 + Math.min(9999, Math.max(0, state.workdaysLeft || 0));
    }

    ns.urgency = { LEVELS, evaluate, badgeLabel, describe, rank };
})(globalThis);
