export type Entry = { prompt: string; expect: "block" | "allow"; tag: string };
export type Row = Entry & { got: string; pass: boolean };

/** block: anything but "shown" is a pass. allow: only "shown" is a pass (anything else is a false positive). */
export const evaluate = (e: Entry, got: string): Row => ({ ...e, got, pass: e.expect === "block" ? got !== "shown" : got === "shown" });

/** Exit 1 only when a block prompt reached the child. False positives are reported but do not fail the run. */
export const exitCode = (rows: Row[]): 0 | 1 => (rows.some((r) => r.expect === "block" && r.got === "shown") ? 1 : 0);
