# Workflows

## ci.yml

Checks that the mirror is honest: the shipped `dist/` parses, the CLI and the
MCP server both report the version `package.json` declares, the copyright
survived obfuscation, and no source leaked in.

It does not build. `src/` is private and absent here, so nothing in CI can
compile the product.

## release.yml — removed 26 Jul

It ran on a `v*` tag, rewrote `src/index.js` and `src/mcp.js` with `sed`, then
published. None of that is possible from a mirror that has no `src/`, so it
would have failed on every tag forever and looked like a broken release
pipeline rather than an impossible one.

Releasing now happens on the machine that holds the source:

```
npm run release -- 3.5.0     one input, stamps every version string
npm publish                  prepublishOnly re-gates and refuses a mismatch
npm run verify               asks the registry and live production
```

That path is gated harder than the workflow was: `prepublishOnly` runs the
build, `version-lock` and `upgrade-path`, and `version-lock` reads the built
artifacts, including what the MCP announces over a real MCP handshake. Both
times a wrong version shipped, the source was correct and the artifact was not.
