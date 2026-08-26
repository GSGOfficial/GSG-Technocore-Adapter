/** Minimal `--flag value` / `--boolean-flag` parser shared by the CLI scripts. */
export function parseArgs(argv: string[]): { flags: Record<string, string>; booleans: Set<string> } {
  const flags: Record<string, string> = {};
  const booleans = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i++;
    } else {
      booleans.add(name);
    }
  }
  return { flags, booleans };
}
