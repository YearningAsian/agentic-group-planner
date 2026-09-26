import { z } from "zod";

/** A timestamp with an explicit offset, as Postgres and the optimizer send them. */
export const Timestamp = z.iso.datetime({ offset: true });

/** Money is always integer cents, computed on the server. */
export const Cents = z.number().int().min(0);
