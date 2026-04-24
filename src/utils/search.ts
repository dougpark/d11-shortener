// src/utils/search.ts — Natural-language date phrase parser for omni-search

export interface ParsedSearch {
    /** Search terms with date phrases stripped out */
    cleanQuery: string
    /** ISO 8601 lower bound (inclusive), e.g. from "since <date>" */
    since?: string
    /** ISO 8601 upper bound (inclusive, end-of-day), e.g. from "before <date>" */
    before?: string
}

// Matches a loose date string: "april 9, 2023", "2023-04-09", "april 2023", etc.
const DATE_PATTERN = `[a-zA-Z]+ \\d{1,2},?\\s*\\d{4}|\\d{4}-\\d{2}-\\d{2}|[a-zA-Z]+ \\d{4}`

const SINCE_RE = new RegExp(`\\bsince\\s+(${DATE_PATTERN})`, 'i')
const BEFORE_RE = new RegExp(`\\bbefore\\s+(${DATE_PATTERN})`, 'i')
const BETWEEN_RE = new RegExp(`\\bbetween\\s+(${DATE_PATTERN})\\s+and\\s+(${DATE_PATTERN})`, 'i')

function toIsoDate(raw: string): string | undefined {
    const ms = Date.parse(raw.trim())
    if (isNaN(ms)) return undefined
    return new Date(ms).toISOString().slice(0, 10) // "YYYY-MM-DD"
}

function endOfDay(isoDate: string): string {
    return `${isoDate}T23:59:59Z`
}

/**
 * Extracts natural-language date phrases from a raw search string.
 * Returns the query with those phrases removed plus optional `since`/`before` bounds.
 *
 * Supported phrases (case-insensitive):
 *   since april 9, 2023
 *   before april 9, 2023
 *   between april 9, 2023 and may 1, 2023
 */
export function parseSearchQuery(raw: string): ParsedSearch {
    let q = raw.trim()
    let since: string | undefined
    let before: string | undefined

    // "between X and Y" — check first so "and" isn't consumed by SINCE_RE
    const betweenMatch = BETWEEN_RE.exec(q)
    if (betweenMatch) {
        const d1 = toIsoDate(betweenMatch[1])
        const d2 = toIsoDate(betweenMatch[2])
        if (d1) since = d1 + 'T00:00:00Z'
        if (d2) before = endOfDay(d2)
        q = q.replace(betweenMatch[0], '').trim()
    } else {
        const sinceMatch = SINCE_RE.exec(q)
        if (sinceMatch) {
            const d = toIsoDate(sinceMatch[1])
            if (d) since = d + 'T00:00:00Z'
            q = q.replace(sinceMatch[0], '').trim()
        }

        const beforeMatch = BEFORE_RE.exec(q)
        if (beforeMatch) {
            const d = toIsoDate(beforeMatch[1])
            if (d) before = endOfDay(d)
            q = q.replace(beforeMatch[0], '').trim()
        }
    }

    // Collapse multiple spaces left by phrase removal
    const cleanQuery = q.replace(/\s{2,}/g, ' ').trim()

    return { cleanQuery, since, before }
}

/**
 * Converts a plain search string into an FTS5 prefix-match query.
 * Each whitespace-separated term becomes `"term"*` so that partial
 * words match (e.g. "Wed" matches "Wednesday").
 *
 * Internal double-quotes are escaped as "" per FTS5 spec.
 * Empty / whitespace-only input returns undefined.
 */
export function toFtsQuery(search: string): string | undefined {
    const terms = search.trim().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return undefined
    return terms.map(t => `"${t.replace(/"/g, '""')}"*`).join(' ')
}
