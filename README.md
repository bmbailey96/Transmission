# Transmission (working title)

A personal release radar. This drop is just the two pieces built and tested so far: the scoring engine and the cover art fetch chain. They're now wired up as actual Netlify Functions with a tiny test page, so the whole thing can be tested by deploying it and clicking links in a browser, no local Node install needed at all.

## Deploying this with zero local installs

Netlify builds the code on its own servers, not your computer, as long as it can pull it from a GitHub repo. So the only two things needed locally are a web browser and the ability to drag a folder.

**1. Get the code onto GitHub**
- Go to github.com and log in.
- Click the **+** icon top right, then **New repository**. Name it `transmission`, leave it Private, don't add a README, click **Create repository**.
- On the new empty repo's page, click **uploading an existing file**.
- Open the unzipped `transmission` folder on your computer, select everything inside it, and drag that selection into GitHub's upload box.
- Scroll down, click **Commit changes**.

**2. Connect it to Netlify**
- Go to app.netlify.com and log in.
- Click **Add new project** (or **Add new site**, the wording shifts sometimes), then **Import an existing project**, then **Deploy with GitHub**.
- Pick the `transmission` repo from the list.
- Netlify should auto-detect the build settings from `netlify.toml` already in the repo. Leave them as shown and click **Deploy**.

**3. Add the keys**
- Once the site exists, go to its **Site configuration** (or **Site settings**) → **Environment variables** → **Add a variable**.
- Add `ANTHROPIC_API_KEY` with your real key from console.anthropic.com.
- Add `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` the same way.
- If the site already finished its first deploy before you added these, go to the **Deploys** tab and click **Trigger deploy** → **Deploy site** once, just so the new variables are picked up.

**4. Test it**
- Netlify gives the site a live URL like `https://something-random.netlify.app`.
- Open it. There's a plain page with two links.
- "Run the scoring engine, live" actually calls the Anthropic API with the six real test cases from the planning conversation and shows the score and reasoning for each.
- "Run the cover art chain, live" runs the fallback chain against three real releases and shows whatever image it actually found.

If either page shows an error instead of results, that's useful information, not a dead end, copy whatever it says and we'll fix it from there. First deploys with serverless functions sometimes need one round of troubleshooting even for people who do this daily, that's normal, not a sign something's fundamentally wrong.

## Updating your taste profile later, also with zero installs

`data/tasteProfile.js` and `data/albumHistory.js` hold your actual taste description and ranked album lists. Once this is connected to GitHub, you never need to touch a terminal to edit them again: open the file on github.com, click the pencil (edit) icon, change the text, commit. Netlify rebuilds and redeploys automatically within a minute or two.

## What's built and tested so far

**Scoring engine** (`lib/scoring/`) Reads the taste data, builds a system prompt, scores a release 0-100 with a short grounded reason. Never invents what an unreleased album sounds like, only uses real evidence and the artist's track record.

**Cover art** (`lib/art/`) Spotify, then Bandcamp's own page, then iTunes Search, then MusicBrainz's Cover Art Archive, then the press article that confirmed the release. Tested live: iTunes missed Slow Pulp's actual album entirely while indexing all its singles, MusicBrainz caught it clean, which is the whole argument for a chain instead of one source.

**Date verification** (`lib/dates/`) Resolves conflicting dates from different sources, structured beats prose, ties break on corroboration then recency. Tested against the literal failure mode it exists for, a wrong-year blog mention next to two correct structured sources, it threw out the wrong one.

## What's not built yet

- The actual source-scraping pipeline that finds candidates in the first place.
- Storage for accumulated results, probably Netlify Blobs.
- The real frontend, home rails and the rolling calendar.
- The scheduled function that ties the pipeline together and runs every few hours.
- The "no" button and its log, the scoring engine already accepts one as an argument, nothing populates it yet.

## If you ever do get Node locally

`npm install`, copy `.env.example` to `.env`, fill in the same three keys, then `npm run test:scoring` or `npm run test:art` run the same tests from a terminal instead of a browser. Not required, just there if useful later.
