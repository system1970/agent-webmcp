// Ambient text-import shape for bundled markdown (skill.ts). Bun resolves
// `with { type: "text" }` at runtime; this satisfies the typecheckers.
declare module "*.md" {
  const content: string
  export default content
}
