// hello.echo — echo verb. `args` is {all, positional, flags}.
// Page tools arrive as tools.*; discover with webmcp.search,
// fan out with batch (cap 8). Must return a value explicitly.
return {
  echo: args.positional,
  flags: args.flags,
  plugin: "hello.echo",
};
