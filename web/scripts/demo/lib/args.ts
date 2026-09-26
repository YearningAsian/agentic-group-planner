/** Seed stages fast-forward the Saturday trip (design §10.3); each lives in stages/ with its own owner. */
export const STAGES = ["planned", "discussed", "booked"] as const;
export type Stage = (typeof STAGES)[number];

export interface SeedArgs {
  batch: string;
  stage: Stage | undefined;
  /** reset:demo only: also delete the seeded users, places, and routes. */
  all: boolean;
}

// Batch names end up in emails and row tags: demo, dev-vo, e2e-a1b2, test:<uuid>.
const BATCH = /^[a-z0-9][a-z0-9:-]{0,62}$/;

/** Parses `--batch <name>`, `--stage <stage>`, and `--all`, in `--flag value` or `--flag=value` form. */
export function parseSeedArgs(argv: string[]): SeedArgs {
  const args: SeedArgs = { batch: "demo", stage: undefined, all: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const eq = arg.indexOf("=");
    const [flag, inline] = eq === -1 ? [arg, undefined] : [arg.slice(0, eq), arg.slice(eq + 1)];
    const value = () => inline ?? argv[++i];
    if (flag === "--batch") {
      const batch = value();
      if (!batch || !BATCH.test(batch)) throw new Error("--batch needs a name of lowercase letters, digits, and dashes, like dev-vo.");
      args.batch = batch;
    } else if (flag === "--stage") {
      const stage = value();
      if (!STAGES.includes(stage as Stage)) throw new Error("--stage must be planned, discussed, or booked.");
      args.stage = stage as Stage;
    } else if (flag === "--all") {
      args.all = true;
    } else if (flag !== "--") {
      throw new Error(`Unknown option ${flag}. Use --batch <name>, --stage <stage>, or --all.`);
    }
  }
  // The demo batch is for checks on the deployed app; it always starts from a fresh seed.
  if (args.stage && args.batch === "demo") throw new Error("--stage isn't allowed on the demo batch; pass --batch <name>.");
  return args;
}
