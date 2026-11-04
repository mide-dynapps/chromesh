/**
 * Working-day arithmetic with national holidays.
 * Exposed as globalThis.CHROMESH.workdays (classic script, shared by content
 * script, service worker via importScripts, popup and options pages).
 */
(function (root) {
    const ns = (root.CHROMESH = root.CHROMESH || {});

    const pad = (n) => String(n).padStart(2, "0");

    /** Local-midnight copy of a date. */
    function startOfDay(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    /** 'YYYY-MM-DD' in local time (never use toISOString, it shifts to UTC). */
    function isoDay(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function fromIsoDay(value) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
        return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
    }

    function addDays(date, count) {
        const next = startOfDay(date);
        next.setDate(next.getDate() + count);
        return next;
    }

    /** Anonymous Gregorian computus. */
    function easterSunday(year) {
        const a = year % 19;
        const b = Math.floor(year / 100);
        const c = year % 100;
        const d = Math.floor(b / 4);
        const e = b % 4;
        const f = Math.floor((b + 8) / 25);
        const g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30;
        const i = Math.floor(c / 4);
        const k = c % 4;
        const l = (32 + 2 * e + 2 * i - h - k) % 7;
        const m = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * m + 114) / 31);
        const day = ((h + l - 7 * m + 114) % 31) + 1;
        return new Date(year, month - 1, day);
    }

    const fixedDays = (year, pairs) => pairs.map(([m, d]) => new Date(year, m - 1, d));

    const BUILDERS = {
        FR(year) {
            const easter = easterSunday(year);
            return [
                ...fixedDays(year, [[1, 1], [5, 1], [5, 8], [7, 14], [8, 15], [11, 1], [11, 11], [12, 25]]),
                addDays(easter, 1),   // lundi de Paques
                addDays(easter, 39),  // Ascension
                addDays(easter, 50),  // lundi de Pentecote
            ];
        },
        BE(year) {
            const easter = easterSunday(year);
            return [
                ...fixedDays(year, [[1, 1], [5, 1], [7, 21], [8, 15], [11, 1], [11, 11], [12, 25]]),
                addDays(easter, 1),
                addDays(easter, 39),
                addDays(easter, 50),
            ];
        },
        LU(year) {
            const easter = easterSunday(year);
            return [
                ...fixedDays(year, [[1, 1], [5, 1], [5, 9], [6, 23], [8, 15], [11, 1], [12, 25], [12, 26]]),
                addDays(easter, 1),
                addDays(easter, 39),
                addDays(easter, 50),
            ];
        },
        NONE() {
            return [];
        },
    };

    const holidayCache = new Map();

    function holidaySet(country, year) {
        const code = BUILDERS[country] ? country : "FR";
        const cacheKey = `${code}-${year}`;
        if (!holidayCache.has(cacheKey)) {
            holidayCache.set(cacheKey, new Set(BUILDERS[code](year).map(isoDay)));
        }
        return holidayCache.get(cacheKey);
    }

    function holidayName(date, options) {
        // Only used for tooltips: we report "ferie" without naming the day.
        return isHoliday(date, options) ? "ferie" : null;
    }

    function isWeekend(date) {
        const day = date.getDay();
        return day === 0 || day === 6;
    }

    function isHoliday(date, options = {}) {
        if (options.useHolidays === false) {
            return false;
        }
        return holidaySet(options.country || "FR", date.getFullYear()).has(isoDay(date));
    }

    function isWorkday(date, options = {}) {
        return !isWeekend(date) && !isHoliday(date, options);
    }

    /** Walk backwards until a working day is found (max one year). */
    function previousWorkday(date, options = {}) {
        let cursor = startOfDay(date);
        for (let guard = 0; guard < 366 && !isWorkday(cursor, options); guard += 1) {
            cursor = addDays(cursor, -1);
        }
        return cursor;
    }

    function nextWorkday(date, options = {}) {
        let cursor = startOfDay(date);
        for (let guard = 0; guard < 366 && !isWorkday(cursor, options); guard += 1) {
            cursor = addDays(cursor, 1);
        }
        return cursor;
    }

    /** Au-delà, la date reçue est aberrante : mieux vaut le dire que compter faux. */
    const MAX_SPAN_DAYS = 4000;

    /**
     * Signed count of working days in the half-open interval (from, to].
     * Negative when `to` is before `from`.
     * Returns null when the two dates are more than MAX_SPAN_DAYS apart: a
     * truncated count would silently look like a valid deadline.
     */
    function countWorkdays(from, to, options = {}) {
        const start = startOfDay(from);
        const end = startOfDay(to);
        if (start.getTime() === end.getTime()) {
            return 0;
        }
        const step = end > start ? 1 : -1;
        let cursor = start;
        let count = 0;
        let guard = 0;
        while (cursor.getTime() !== end.getTime()) {
            if (guard >= MAX_SPAN_DAYS) {
                return null;
            }
            guard += 1;
            cursor = addDays(cursor, step);
            if (isWorkday(cursor, options)) {
                count += 1;
            }
        }
        return step * count;
    }

    function countCalendarDays(from, to) {
        const ms = startOfDay(to) - startOfDay(from);
        return Math.round(ms / 86400000);
    }

    ns.workdays = {
        MAX_SPAN_DAYS,
        startOfDay,
        isoDay,
        fromIsoDay,
        addDays,
        easterSunday,
        isWeekend,
        isHoliday,
        holidayName,
        isWorkday,
        previousWorkday,
        nextWorkday,
        countWorkdays,
        countCalendarDays,
    };
})(globalThis);
