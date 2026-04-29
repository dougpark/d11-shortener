# create a new rss post api
- inbound api to create a new rss post

## example json

{
  "scraped_at": "2026-04-27T22:16:45.807Z",
  "source": "https://pinboard.in/popular",
  "count": 100,
  "items": [
    {
      "title": "BEWARE SOFTWARE BRAIN | The Verge",
      "url": "https://www.theverge.com/podcast/917029/software-brain-ai-backlash-databases-automation",
      "count": 20,
      "scraped_at": "2026-04-27T22:16:45.807Z"
    }]
}

## batch size of 100

## Save to RSS posts table with source = "rss" and scraped_at timestamp from the payload

- do we have a count column? we don't need to save it.
- what other data will we need to make a valid post?

## ignore duplicates may overlap on daily run, based on URL

## add to log

## authorize with new api token and scope 


