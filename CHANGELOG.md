# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

- Report: include operating system in Environment section (#4)

## [0.1.0] - 2026-11-06

First release.

- One line for Express 4 or 5: `app.use(bugfinder(app))`. Story page at `/__bugfinder`.
- Turns each click into a story: browser requests, errors and console warnings; server requests, console output and errors; Mongoose and mysql2 queries.
- Joins browser requests to server requests by an ID header, or by method, path and time for a frontend on another dev server.
- Points at the likely cause (deepest failure first) and the slowest step.
- **Copy bug report**: Markdown with the cause, steps, a `curl` command, the error and the timeline.
- Off in production and limited to localhost by default; never records typed input, hides secret-looking keys, keeps no query values.

[Unreleased]: https://github.com/ragib-mrb/bugfinder/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ragib-mrb/bugfinder/releases/tag/v0.1.0
