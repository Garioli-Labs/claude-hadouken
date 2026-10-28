# REA

[Português](REA)

## hadouken-rea: reverse engineering

`hadouken-rea` is an optional plugin in the `claude-hadouken` marketplace. It turns on the MCP server from the `rea-agents` package, which gives Claude reverse-engineering tools to inspect binaries and applications.

- **Turning it on:** the one-command installer turns it on at the first install, if Node is recent enough. By hand: `claude plugin install hadouken-rea@claude-hadouken` and `claude plugin enable hadouken-rea@claude-hadouken`. If you turned it off, it stays off.
- **Requirements:** Node 22.19+, 24.11+ or 26+.
- **First time:** `npx` downloads the package (about 20 to 30 s) and `/mcp` may report a timeout; reconnect through `/mcp` or open a new session.
- **Pinned version:** the plugin opens an exact `rea-agents` version; the kit's weekly robot updates it only with the test suite green on Linux, Windows and macOS.
- **Isolation:** the server runs with its cwd in the plugin folder, never in the open project, so a repository `node_modules` or `.npmrc` does not get in. Give REA absolute paths.

> [!WARNING]
> REA **runs the analysed programs with your user's permissions**. Only analyse what you would run on your own machine, or use a virtual machine.

More details, together with hadouken-kit, in [hadouken-kit and hadouken-rea](Kit-en).

---
