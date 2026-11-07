# Security

## Reporting a vulnerability

Please report security problems privately through
[GitHub's private vulnerability reporting](https://github.com/Kkkermit/Trading212.js/security/advisories/new), not in a
public issue. Include what you found, how to reproduce it, and which version. You will get an answer within a week.

Anything that could expose an API key or secret, send a request somewhere other than Trading 212, or place, repeat
or alter an order without the user asking is treated as critical.

## What this library promises

- Your API key and secret are sent only to `demo.trading212.com` or `live.trading212.com`, or to a `baseUrl` you set
  yourself.
- They never appear in log lines, errors, hook events or test recordings.
- Redirects are never followed with your credentials, and signed download links never receive them.
- Orders are never retried automatically.
- The package has no runtime dependencies, and releases are published from GitHub Actions with npm provenance.

## Supported versions

Only the latest release gets fixes while the library is on 0.x.
