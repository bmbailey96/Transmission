# Transmission V2

Transmission is a personal album-release radar. V2 is intentionally one engine, not a collection of independent background jobs.

## One source of truth

All active state lives in one Netlify Blob store: `transmission-v2`.

The active data flow is:

`discover -> score upcoming once -> release date arrives -> score released album once -> Spotify side effect`

The homepage and Monday digest are read-only views of that same V2 state.

The user's direct 2026 picks, albums to hear, and anticipated records live in
`data/curated2026.js`. They are separate from the model's guesses in V2 state.

Legacy discovery/mover/backfill functions remain in the repository for reference and rollback, but they are unscheduled.

## Discovery

The V2 engine combines:

- the existing music-news RSS feeds
- Wikipedia's current-year album list
- the existing taste/watchlist data for priority

A temporary extraction or scoring failure does **not** mark an RSS item seen. It is retried on a later engine run.

The engine checkpoints state after each mutating stage so a late timeout cannot erase earlier discoveries from the same run.

## Scoring

Upcoming records get one score based on confirmed pre-release evidence and the taste profile.

When the release date arrives, the record gets one fresh post-release score using real evidence about the released album.

There is no score jitter, rescore carousel, or second AI call grading the first AI call's number.

## Spotify

Spotify is a side effect, not release state.

For released albums above the threshold:

- `pending` and real API `error` states are retryable
- 429 responses obey Spotify's Retry-After guidance
- retries use bounded exponential backoff
- `added`, `not_found`, `not_needed`, and `quarantined` are terminal
- album search validates artist/title before tracks are added

A Spotify failure cannot make the album disappear from Transmission.

The active discovery playlist accepts one track from an unfamiliar released
album scored 85+, up to 50 tracks. Existing songs are not pruned by the engine.
`node scripts/spotify-audit.js` makes a read-only full playlist report using
the deployment's Spotify environment variables. Applying a reviewed report
requires `--apply` and `SPOTIFY_EXPECTED_SNAPSHOT`; the script copies the entire
playlist to a private archive and verifies its count before replacing tracks.

## Interface

The radar/signal design stays.

The primary page opens on the full chronological upcoming feed, with an out-now
feed and a separate My Albums tab for direct picks, to-hear, and anticipated
records. Each release retains its cover, score band, evidence level, short
headline, expandable reasoning, and Spotify status when released. Scores under
60 are collapsed within each date. There is no 30-record cutoff. If credits
block scoring, the status says so instead of reporting a healthy scan.

The old interface remains at `/legacy.html`.
