// Rung 2: a filename extension, when one was supplied.
//
// `curl -F 'f=@deploy.yaml'` gives this for free and the web form does not, which is
// why it is a rung rather than the answer. Linguist-style, trimmed to grammars this
// project actually renders.

const BY_EXTENSION: Readonly<Record<string, string>> = {
  // scripts and config, which is most of what gets pasted
  py: "python",
  pyi: "python",
  rb: "ruby",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  ps1: "powershell",
  sql: "sql",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  env: "ini",
  properties: "ini",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  md: "markdown",
  markdown: "markdown",

  // compiled languages
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  scala: "scala",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  lua: "lua",
  pl: "perl",
  r: "r",
  dart: "dart",

  // the ones that are usually logs
  log: "log",
  out: "log",
  err: "log",

  txt: "plaintext",
  text: "plaintext",
  csv: "csv",
  diff: "diff",
  patch: "diff",
  tf: "terraform",
  tfvars: "terraform",
  gradle: "groovy",
  graphql: "graphql",
  gql: "graphql",
  proto: "proto",
};

/** Files whose whole name carries the language, where an extension would not. */
const BY_FILENAME: Readonly<Record<string, string>> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
  vagrantfile: "ruby",
  brewfile: "ruby",
  jenkinsfile: "groovy",
  "cargo.lock": "toml",
  "go.mod": "go-module",
  "go.sum": "plaintext",
  ".gitignore": "plaintext",
  ".dockerignore": "plaintext",
  ".env": "ini",
  ".babelrc": "json",
  ".eslintrc": "json",
};

/** The grammar a filename implies, or null. */
export function languageForFilename(filename: string): string | null {
  const name = filename.trim().toLowerCase();
  if (name === "") return null;

  // The basename only: a path should not let a directory decide the language.
  const base = name.split(/[\\/]/).at(-1) ?? name;

  const whole = BY_FILENAME[base];
  if (whole !== undefined) return whole;

  // `values-staging.yaml.j2` is a template of YAML; take the last extension that is
  // something we know, so a templating suffix does not hide the real one.
  const parts = base.split(".");
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const candidate = BY_EXTENSION[parts[i]];
    if (candidate !== undefined) return candidate;
  }
  return null;
}
