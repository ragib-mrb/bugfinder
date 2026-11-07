# Contributing to bugfinder

Thanks for helping! Bug reports, ideas, docs fixes and code are all welcome.

## Before you start

- **Bugs:** open an issue with the bug template. A small Express app that shows the problem helps most.
- **A wrong "likely cause":** these reports are very useful. Tell us what bugfinder pointed at and what the real cause was.
- **New features** (another framework, database or logger): open an issue first, so we can agree on the idea before you spend time on it.
- **Small fixes** (typos, docs, tests): send a pull request straight away.
- Looking for something to do? Try the issues labelled [`good first issue`](https://github.com/ragib-mrb/bugfinder/labels/good%20first%20issue) or [`help wanted`](https://github.com/ragib-mrb/bugfinder/labels/help%20wanted). Comment on the issue so others know you're on it.

## Set up

You need Node.js 22 or newer to work on bugfinder (apps using it can run Node 18 or newer).

```bash
git clone https://github.com/<your-username>/bugfinder.git
cd bugfinder
npm install
npm test
```

Useful scripts:

| Command             | What it does                                                |
| ------------------- | ----------------------------------------------------------- |
| `npm test`          | Runs all tests (Vitest), on Express 4 and 5                 |
| `npm run lint`      | ESLint                                                      |
| `npm run typecheck` | TypeScript type check                                       |
| `npm run format`    | Formats the code with Prettier                              |
| `npm run build`     | Builds `dist/`                                              |
| `npm run example`   | Runs a demo shop with planted bugs on http://localhost:3078 |

`npm test`, `typecheck` and `build` first bundle the browser script and the story page into `src/**/*.generated.ts`. Don't edit those files by hand.

## Project layout

- `src/index.ts`: entry point; installs the hooks unless bugfinder is off
- `src/middleware.ts`: the Express middleware; records requests and serves the story page
- `src/hooks.ts`: hooks into `console`, Express errors, Mongoose and mysql2
- `src/context.ts`: keeps track of which request is running
- `src/inject.ts`: adds the browser script to HTML pages
- `src/client/`: the browser script (clicks, requests, errors)
- `src/stories.ts`: groups events into stories and finds the likely cause
- `src/report.ts`: the Markdown bug report
- `src/redact.ts`: hides secrets and folds library stack frames
- `src/store.ts`: keeps events in memory
- `src/ui/`: the story page
- `examples/shop.mjs`: the demo app
- `test/`: tests, one file per area

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Keep the change focused: one fix or feature per pull request.
3. Add or update tests for what you changed.
4. Run `npm run lint`, `npm run typecheck`, `npm test` and `npm run format:check` before you push. CI runs the same checks.
5. Update `README.md` if behaviour or options change, and add a line under "Unreleased" in `CHANGELOG.md`.
6. Write a clear title, e.g. `fix: link XHR requests to the click that sent them`.

## Rules that keep bugfinder safe

- **No runtime dependencies.** Express is a peer dependency; Mongoose and mysql2 are only hooked if the app uses them.
- **Never record what people type.** Clicks are recorded by label only.
- **Never keep secrets or query values.** Request bodies only for failed requests, with secret-looking keys hidden; SQL and Mongo filter values are never kept.
- **Nothing leaves the machine.** Everything stays in memory; the page loads nothing from the internet.

## Code of conduct

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
