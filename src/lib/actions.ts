"use server";

/** Personal notes are intentionally not exposed or writable from the public dashboard. */
export async function addPlayerNote(): Promise<never> {
  throw new Error("Notes are disabled on the public dashboard.");
}
