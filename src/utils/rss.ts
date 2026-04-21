// src/utils/rss.ts — RSS fetch, XML parse, keyword extraction

// ─── Stop words: connectors + common news verbs ───────────────────────────────
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'that', 'this', 'it', 'is', 'was', 'are', 'be', 'has', 'have', 'had', 'will', 'would',
    'could', 'from', 'as', 'its', 'which', 'who', 'what', 'how', 'if', 'than', 'so', 'out',
    'over', 'about', 'up', 'into', 'their', 'our', 'your', 'after', 'before', 'between',
    'during', 'without', 'within', 'through', 'not', 'no', 'do', 'did', 'does', 'been',
    'can', 'may', 'might', 'shall', 'get', 'got', 'let', 'set',
    // news verbs / filler adjectives
    'new', 'latest', 'first', 'best', 'top', 'major', 'free', 'open', 'big', 'old',
    'says', 'said', 'report', 'reports', 'reveals', 'launches', 'released', 'releases',
    'announces', 'introduces', 'updates', 'adds', 'removes', 'fixes', 'gets', 'makes',
    'brings', 'shows', 'warns', 'calls', 'asks', 'gives', 'takes', 'comes', 'goes',
    'now', 'just', 'still', 'already', 'also', 'only', 'even', 'more', 'less', 'most',
    'least', 'very', 'much', 'many', 'some', 'all', 'both', 'any', 'here', 'there',
    'using', 'used', 'use', 'give', 'take', 'make', 'find', 'help', 'work', 'works',
    'way', 'ways', 'year', 'years', 'week', 'weeks', 'day', 'days', 'time', 'times',
    'back', 'down', 'like', 'look', 'need', 'want', 'know', 'think', 'good', 'right',
    'long', 'high', 'low', 'old', 'full', 'small', 'large', 'early', 'late', 'next',
    'under', 'another', 'reason', 'forces', 'force', 'circumstances', 'mysterious',
    'freaked', 'youre', 'heres', 'thats', 'whats', 'theyre', 'isnt', 'doesnt', 'wont',
    'shows', 'claims', 'sees', 'hits', 'hits', 'hits', 'found', 'called', 'named', 'lets',
])

// ─── Pull keywords from a title string ───────────────────────────────────────
export function extractKeywords(title: string): string[] {
    // Decode common HTML entities before processing
    const decoded = title
        .replace(/&amp;/gi, 'and')
        .replace(/&lt;/gi, '')
        .replace(/&gt;/gi, '')
        .replace(/&quot;|&#x27;|&#039;/gi, '')
        .replace(/&[a-z]+;|&#[0-9]+;|&#x[0-9a-f]+;/gi, ' ')  // strip remaining entities

    return [
        ...new Set(
            decoded
                .toLowerCase()
                // split on anything that isn't alphanumeric, hyphen, or dot-digit (e.g. gpt-4, node.js)
                .split(/[^a-z0-9.\-]+/)
                .map(w => w.replace(/^[.\-]+|[.\-]+$/g, ''))  // trim leading/trailing punctuation
                .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)) // drop pure numbers
        ),
    ]
}

// ─── Merge RSS categories + title keywords into a JSON tag_list string ────────
export function buildTagList(categories: string[], titleKeywords: string[]): string {
    const tags = [
        ...new Set([
            ...categories.map(c =>
                c.toLowerCase()
                    .trim()
                    .replace(/&amp;|&/g, 'and')  // "Biz & IT" → "biz-and-it"
                    .replace(/\s+/g, '-')
                    .replace(/[^a-z0-9\-]/g, '')
                    .replace(/-{2,}/g, '-')       // collapse double-dashes
                    .replace(/^-+|-+$/g, '')      // trim leading/trailing dashes
            ).filter(c => c.length >= 2),
            ...titleKeywords,
        ]),
    ]
    return JSON.stringify(tags)
}

// ─── RSS item shape returned by the parser ────────────────────────────────────
export interface RssItem {
    guid: string
    url: string
    title: string
    summary: string
    categories: string[]
    publishedAt: string | null
}

// ─── Naive XML extractor: pull text content of a tag ─────────────────────────
function tagText(xml: string, tag: string): string {
    // Handles <tag>...</tag> and <tag><![CDATA[...]]></tag>
    const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, 'i'))
    if (!m) return ''
    return (m[1] ?? m[2] ?? '').trim()
}

// Pull all occurrences of <category>
function allCategories(xml: string): string[] {
    const results: string[] = []
    const re = /<category[^>]*>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/category>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) {
        const val = (m[1] ?? m[2] ?? '').trim()
        if (val) results.push(val)
    }
    return results
}

// ─── Parse RSS 2.0 / Atom XML into RssItem[] ─────────────────────────────────
export function parseFeed(xml: string): RssItem[] {
    const items: RssItem[] = []

    // Split on <item> or <entry> (Atom)
    const itemRe = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi
    let m: RegExpExecArray | null

    while ((m = itemRe.exec(xml)) !== null) {
        const block = m[1]

        // URL: prefer <link href="..."> (Atom) then text content of <link>
        let url = ''
        const atomLink = block.match(/<link[^>]+href=["']([^"']+)["']/)
        if (atomLink) {
            url = atomLink[1].trim()
        } else {
            url = tagText(block, 'link')
        }

        // Skip items without a URL
        if (!url) continue

        // GUID: prefer <guid>, fall back to <id> (Atom), then URL
        const guid = tagText(block, 'guid') || tagText(block, 'id') || url

        const title = tagText(block, 'title') || url

        // Summary: prefer <description>, then <summary> (Atom), then <content>
        const rawSummary =
            tagText(block, 'description') ||
            tagText(block, 'summary') ||
            tagText(block, 'content')

        // Strip HTML tags
        const summary = rawSummary
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()

        const categories = allCategories(block)

        // Date: prefer <pubDate>, then <published> / <updated> (Atom)
        const rawDate =
            tagText(block, 'pubDate') ||
            tagText(block, 'published') ||
            tagText(block, 'updated')

        let publishedAt: string | null = null
        if (rawDate) {
            try {
                publishedAt = new Date(rawDate).toISOString()
            } catch {
                publishedAt = null
            }
        }

        items.push({ guid, url, title, summary, categories, publishedAt })
    }

    return items
}

// ─── Fetch a feed URL and return parsed items ─────────────────────────────────
export async function fetchFeed(url: string): Promise<RssItem[]> {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'd11-lumin/1.0 RSS reader' },
        signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Feed fetch failed: ${res.status} ${url}`)
    const xml = await res.text()
    return parseFeed(xml)
}
