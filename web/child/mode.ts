export type Flags = { voice: boolean; pictures: boolean; typed: boolean };
export const NO_FLAGS: Flags = { voice: false, pictures: false, typed: false };

/** voice if any text came from the mic; else pictures if only picture words went in; else typed. */
export const inferMode = (f: Flags): "voice" | "pictures" | "typed" => (f.voice ? "voice" : f.pictures && !f.typed ? "pictures" : "typed");
