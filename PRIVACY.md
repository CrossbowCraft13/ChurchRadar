# Privacy

Church Radar has no accounts, no ads, no analytics and no third-party SDKs. This page describes the
only data it handles.

## What the app stores on your device

- **Map and app shell** — IndexedDB and the service worker cache, so the radar opens quickly. Clearing
  site data removes it.
- **Check-in identity** — a random ID and its signing key, kept in an HttpOnly cookie on the app's own
  origin. It exists so that one person cannot count as two reporters on the same church. It is not
  linked to a name, email, phone number or advertising ID.

## What the server stores

When you mark a church as meeting, the app sends the church ID and a timestamp to the check-in Worker,
which stores them in a Cloudflare D1 database along with the hashed check-in identity. Nothing else is
stored: no location trace, no name, no device fingerprint. Reports expire on their own (90 minutes by
default) and are then removed.

Requests are served by Cloudflare, which processes IP addresses and user agents to deliver them; the
app does not log them and keeps no analytics.

## What other people see

An active check-in is visible to everyone as "N people reporting" on that church. It is presented as a
community report, not a verified fact, and carries no information about who reported it.

## Third parties

- **OpenStreetMap** — map tiles and live church scans (`tile.openstreetmap.org`, Overpass mirrors). Your
  IP address is visible to those servers, which is how any web request works. Their privacy policies
  apply.
- **Wikidata** — church data is bundled with the app; no request per view.

No data is sold, shared, or used for advertising, and there is no tracking of any kind.

## Removing your data

Check-ins expire automatically. To clear the local identity immediately, clear the app's site data
(Android: Settings → Apps → Church Radar → Storage → Clear storage). You can also email the address on
the GitHub profile with a church and approximate time and the check-in will be removed by hand.

Source code: https://github.com/CrossbowCraft13/ChurchRadar
