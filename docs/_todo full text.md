# implement a full clean text capture of the link, preserve copy for future

## Short
Recommendation: Use short_description for a human-readable summary (keep it reasonable, say ≤2000 chars), and wire up full_text for the raw page content if you want full-page capture. That would also let you search across full_text separately without cluttering the visible description.

## Reasonable Limits for D1 & R2
For a family-sized project like Lumin, I recommend setting these "soft limits" in your Bun script:

Per Bookmark Limit: 100,000 characters. This covers 99.9% of all technical articles ever written. If an article is longer, it's likely a book or a massive spec, which you should probably store as a PDF in R2 anyway.

## Integrating Images into the PDF
One of the biggest risks with archiving is "Link Rot" for images. If you save a PDF today, and 5 years from now the original site goes down, your PDF might show broken image boxes.

## The "Archivist" Solution:

Base64 Injection: Your Bun script should find all <img> tags, download the images locally, and convert them to Base64 strings.

Embed: Inject those strings back into the HTML before sending it to the PDF engine. This makes the PDF "self-contained"—all the images are baked into the file itself.

## The Workflow for d11-lumin
With your setup, the ultimate high-fidelity workflow looks like this:

Trigger: You save a link to d11.me.

Cleanup: Your Cloudflare Worker pulls the "Reader View."

Local Heavy Lifting: Your Linux workstation wakes up, runs a headless Playwright instance.

PDF Generation: It prints the page to a PDF, embedding all images.

Long-Term Storage: The PDF is uploaded to Cloudflare R2.

Accessibility: On your Lumin dashboard, you see two buttons: "View Original" and "Open PDF Mirror."