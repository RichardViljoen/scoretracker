# ScoreTracker — Agent Notes

Offline-capable PWA scoreboard (Blue vs Red) with on-device Vosk voice control.
Plain HTML/CSS/JS, no build step. `serve.js` is a local static server only.

## Getting changes to the user's phone
The user picks changes up **from GitHub** (`origin` = `RichardViljoen/scoretracker`, branch `main`).
A local commit is not enough: **commit, then `git push origin main`**, then tell the user
to tap **Update App** and confirm the version on the start screen matches.

## Every shipped change bumps the version in three places
- `APP_VERSION` in `app.js`
- `CACHE_NAME` in `sw.js` (`scoretracker-vNN`) — if this is missed the phone keeps the old cached files
- keep both in sync; the start screen shows `APP_VERSION`

## Git hygiene
Other sessions may share this working directory. Commit explicit paths only
(`git commit -m "..." -- app.js sw.js`), never `git add -A` / `git commit -a`.

## Voice recognition (see `app.js`)
- Closed Vosk grammar (`VOICE_GRAMMAR`): every sound is forced onto the nearest phrase, so
  false triggers come from ambient noise and from the app's own spoken score.
- Echo cancellation is OFF (needed so announcements stay on the Bluetooth speaker), so audio is
  not fed to the recognizer while `isAnnouncing`.
- Only `point red` / `point blue` may fire from a partial result, and only after
  `PARTIAL_STABLE_COUNT` identical partials. Everything else waits for the final result.
- `end match` / `reset match` / `start match` require the wake word ("computer ...").
- A voice "end match" leaves the mic open (standby) so "computer start match" works; in standby
  nothing else is accepted. The End/Home buttons turn the mic fully off.
- Final results are logged as `Voice final: <text> minConf <n>`; tune `VOICE_MIN_CONFIDENCE` from that.
- Stability history: v10 (1 Oct) was stable; v11 added spoken score + partial results and v14
  turned echo cancellation off. If voice gets flaky again, bisect between those.
