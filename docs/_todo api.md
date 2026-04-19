# API's

## Pinboard's API is famously "no-nonsense." It uses a RESTful approach that has remained virtually unchanged for over a decade.

The Token: It uses a username:TOKEN format for authentication.

### Core Endpoints:

/posts/add: To save a link with tags and descriptions.

/posts/all: To export every bookmark you’ve ever saved (crucial for your initial import).

/tags/get: To pull that list of 750 tags you’re currently wrestling with.



## Useful APIs for your d11-lumin Stack
Since you're on Bun and Cloudflare, you can integrate modern APIs that Pinboard never could.


### API Category	Service Recommendation	Why it's useful for you
Search/Research	Tavily or Serper	Let your AI "Search Agent" find new technical articles to add to your archive.

Metadata/OG	Microlink.io	Automatically grab the "Open Graph" image and description for a site so your dashboard looks great.

Archiving	Wayback Machine API	As a fallback, have your script "Save Page Now" to the Internet Archive so you have a secondary copy.

Notifications	Pushover or Telegram	Send a push notification to your phone when your AI agent finds a "high-priority" article on Bun or Linux.