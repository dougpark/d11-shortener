// src/utils/preview.ts — fetch URL title and favicon for the "Add Bookmark" auto-fill

/** Fetched metadata for a URL. */
export type UrlPreview = {
    title: string | null
    description: string | null
    favicon_url: string | null
}

/**
 * Fetch the <title>, meta description, and favicon from a remote URL.
 * Must be called from within a Cloudflare Worker (outbound fetch is allowed).
 * Never throws — returns nulls on any failure.
 */
export async function fetchUrlPreview(url: string): Promise<UrlPreview> {
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': 'd11.me/1.0 (+https://d11.me)' },
            // Timeout via AbortSignal — Workers have a default of 30 s
            signal: AbortSignal.timeout(8_000),
            redirect: 'follow',
        })

        if (!res.ok) return { title: null, description: null, favicon_url: null }

        const html = await res.text()

        const title = extractMeta(html, /<title[^>]*>([^<]+)<\/title>/i)
        const description =
            extractMetaAttr(html, 'name', 'description') ??
            extractMetaAttr(html, 'property', 'og:description')

        // Build favicon URL from the origin
        const origin = new URL(url).origin
        const favicon_url = `${origin}/favicon.ico`

        return { title, description, favicon_url }
    } catch {
        return { title: null, description: null, favicon_url: null }
    }
}

function extractMeta(html: string, pattern: RegExp): string | null {
    const m = html.match(pattern)
    return m ? decodeHtmlEntities(m[1].trim()) : null
}

function extractMetaAttr(html: string, attr: string, value: string): string | null {
    // Matches <meta name="description" content="..." /> in any attribute order
    const pattern = new RegExp(
        `<meta[^>]+${attr}=["']${value}["'][^>]+content=["']([^"']+)["']`,
        'i',
    )
    const alt = new RegExp(
        `<meta[^>]+content=["']([^"']+)["'][^>]+${attr}=["']${value}["']`,
        'i',
    )
    const m = html.match(pattern) ?? html.match(alt)
    return m ? decodeHtmlEntities(m[1].trim()) : null
}

function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
}
