# Transmission V2 rules

Transmission is a release radar, not a collection of independent jobs.

## One source of truth
- V2 state lives in the Netlify Blob store `transmission-v2`.
- `v2-engine-background` is the only scheduled writer.
- The homepage and weekly email are read-only views of that state.
- Legacy functions remain only for rollback/reference and must stay unscheduled.

## Release lifecycle
A release moves in one direction:

`discovered -> upcoming -> released -> Spotify terminal state`

Discovery, classification and writing use rules-v1 with no AI calls. Conservative headline extraction identifies supported album announcements; ambiguous announcements enter a bounded review inbox. Structured release listings fill coverage gaps.
Attention bands describe recorded evidence: direct pick, returning artist, stated curiosity, or exploration. They are not probabilities. Quiet listening periods are not negative evidence. Old AI estimates remain archived and are not displayed as current judgments.
Dates advance independently of taste judgments. No new rules-only release automatically enters Spotify under the old prediction threshold. Existing previously scored queue entries retain their original handling.

## Spotify
Spotify is a side effect, not proof that release processing succeeded.

Only unfamiliar released albums predicted at 85+ enter the discovery queue.
At most one track per album is added, and additions pause at 50 tracks.
Directly named favorites stay in the user's picks, not the sampling queue.
An existing playlist is never silently trimmed by the scheduled engine.

Terminal states:
- `added`
- `not_found`
- `not_needed`
- `quarantined`

Retryable states:
- `pending`
- `error`

Retries are bounded. 429 responses obey Retry-After. Album search must validate artist/title before adding tracks.

## UI
Keep the radar/signal visual language.
The front page answers:
1. What is coming?
2. What just came out?
3. How strong is the signal?
4. Did Spotify sync it?

Debug/backfill machinery does not belong in the primary UI.


## Failure handling
- External phases fail independently. RSS, Wikipedia, release transition, and Spotify failures must not roll back successful work from another phase.
- An RSS URL becomes "seen" only after it was successfully classified and, when applicable, successfully scored/handled.
- Transient extraction or scoring failures remain retryable.
- The engine must persist a failed `lastRun` with phase errors instead of leaving the UI showing a stale successful scan.
