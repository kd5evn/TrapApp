# TrapApp

An iPad web app that lets a trap club run its squad queue without paper. Members and staff drag shooter names into squad posts for two trap fields; one tap on Complete moves every squad up and updates the estimated clay count.

It installs to the iPad Home Screen from Safari and then works with no Wi-Fi.

## Install on the iPad

1. With internet, open the app's address in Safari (see "Publishing" below).
2. Tap Share, then Add to Home Screen.
3. Open it once from the Home Screen while online so everything is cached. After that it runs fully offline.

Data lives in the iPad's Safari storage for this app. Use History, Export (CSV) to keep a copy of a day.

## Run locally

    npm run serve    # http://localhost:8080
    npm test         # rules tests (node:test)

## Files

- `core.js`: the rules (place, move, complete, clay count, undo). No browser code, fully tested.
- `app.js`, `index.html`, `styles.css`: the screen.
- `sw.js`, `manifest.webmanifest`, `icons/`: offline install. Bump `VERSION` in `sw.js` whenever app files change so iPads pick up the update.
- `tests/core.test.js`: rules tests.

## Publishing

GitHub Pages serves the repo root. The address is https://kd5evn.github.io/TrapApp/ once Pages is enabled (Settings, Pages, branch `main`, folder `/`).

## Documents

- [Design document](docs/Trap-Squad-Tracker-Design-Document.md) (Draft v0.3)
- [Screen wireframe](docs/wireframe.svg)
- [Squad lifecycle diagram](docs/squad-lifecycle.svg)
