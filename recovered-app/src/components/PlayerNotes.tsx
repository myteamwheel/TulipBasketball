"use client";

import { useState, useTransition } from "react";
import { formatDateTimeEastern } from "@/lib/format";

interface Note {
  id: string;
  body: string;
  createdAt: string;
}

export default function PlayerNotes({
  playerId,
  initialNotes,
  addNoteAction,
}: {
  playerId: string;
  initialNotes: Note[];
  addNoteAction: (playerId: string, body: string) => Promise<Note>;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!body.trim()) return;
    const text = body;
    setBody("");
    startTransition(async () => {
      const note = await addNoteAction(playerId, text);
      setNotes((prev) => [note, ...prev]);
    });
  }

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Add a note…"
          className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-emerald-500"
        />
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-60"
        >
          Add
        </button>
      </div>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="rounded-md bg-neutral-950 p-2 text-xs">
            <p className="text-neutral-200">{n.body}</p>
            <p className="mt-0.5 text-[10px] text-neutral-600">{formatDateTimeEastern(n.createdAt)}</p>
          </li>
        ))}
        {notes.length === 0 && <li className="text-xs text-neutral-500">No notes yet.</li>}
      </ul>
    </div>
  );
}
