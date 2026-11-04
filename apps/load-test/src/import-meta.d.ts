// The game client's modules reached through type imports read Vite's
// `import.meta.env`; the bots never run that code, only its types are checked.
interface ImportMeta {
  readonly env: Readonly<Record<string, string | boolean | undefined>>;
}
