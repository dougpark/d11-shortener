# Outbound: The "Personal Channel"

You can turn d11-lumin into its own RSS producer so your family can "subscribe" to you.

Endpoint: Create a route like d11.me/feed/[token].

XML Generation: When a reader hits that URL, your Worker queries D1 for the last 20 bookmarks.

Output: It generates a standard XML file:

<rss version="2.0">
  <channel>
    <title>d11-lumin: [User Name]</title>
    <item>
      <title>Title of the Article</title>
      <link>https://d11.me/l/short-slug</link>
      <description>The AI-generated summary from Gemma 4.</description>
    </item>
  </channel>
</rss>