# Contributing

## Before A Change

1. Open an issue for changes that alter the packet contract, release gate, storage format, authentication, or model policy.
2. Keep personal credentials and review packets out of the repository.
3. Preserve the separation between Claude visible output and phone only diagnostics.

## Local Validation

```powershell
npm install
npm run config:init
npm run verify
npm run test:e2e
npm run plugin:validate
```

Add focused tests for every changed gate outcome or job transition. UI changes must be checked at mobile and desktop widths.

## Pull Requests

Describe:

1. User behavior changed
2. Trust boundary changed
3. New failure paths
4. Tests run
5. Migration or environment changes

Do not include captured private packets, tokens, model authentication, or production Redis records.
