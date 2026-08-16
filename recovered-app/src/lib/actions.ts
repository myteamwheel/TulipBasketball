"use server";

import { prisma } from "@/lib/prisma";
import { isAuthenticated } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function addPlayerNote(playerId: string, body: string) {
  if (!(await isAuthenticated())) throw new Error("Unauthorized");
  const note = await prisma.userNote.create({
    data: { playerId, body: body.slice(0, 2000) },
  });
  revalidatePath(`/players/${playerId}`);
  return { id: note.id, body: note.body, createdAt: note.createdAt.toISOString() };
}
