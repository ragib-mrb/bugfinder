# Security policy

## Supported versions

Only the latest release of `@ragib.mrb/bugfinder` gets security fixes.

## Reporting a vulnerability

Please **don't** open a public issue for security problems.

Report it privately through GitHub: go to the [Security tab](https://github.com/ragib-mrb/bugfinder/security) and click **Report a vulnerability**. Include the bugfinder, Express and Node.js versions, what an attacker could do, and the steps to reproduce it.

You'll get a reply within 7 days. Once a fix is released, you'll be credited in the release notes unless you'd rather not be.

## What counts

bugfinder is a development tool. It is off when `NODE_ENV` is `production` and only answers requests from `localhost` by default. Problems that matter most:

- the story page or its data being reachable from outside localhost while the defaults are on
- typed input, passwords, tokens, or SQL and Mongo filter values being recorded or shown
- script injection through URLs, log lines, error messages or click labels shown on the story page
- the injected script changing how the app's own pages or responses behave
