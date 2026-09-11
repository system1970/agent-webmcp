export default function Home() {
  return (
    <main>
      <p className="eyebrow">hello world</p>
      <h1>agent-webmcp</h1>
      <p className="lede">
        Ultra-light WebMCP browser CLI for AI agents. One static Go binary. No
        daemon. Chrome is the server.
      </p>

      <pre>
        <code>{`agent-webmcp open <url> --session demo
agent-webmcp list --session demo
agent-webmcp invoke <tool> --params '{...}' --session demo`}</code>
      </pre>

      <ul className="facts">
        <li>~15ms cold start · ~39ms invoke round-trips</li>
        <li>headless or headful Chrome, isolated sessions per task</li>
        <li>custom tool packs for sites without native WebMCP tools</li>
      </ul>

      <p className="links">
        <a href="https://github.com/system1970/agent-webmcp">github</a>
        <span>·</span>
        <a href="https://github.com/system1970/agent-webmcp/releases/tag/v0.1.0">
          release v0.1.0
        </a>
        <span>·</span>
        <a href="https://webmcp.com">webmcp directory</a>
      </p>
    </main>
  );
}
