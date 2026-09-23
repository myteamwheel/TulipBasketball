import type { AuditSnapshotData, AuditSnapshotSummary } from "@/lib/audit";

type PdfLine = { text: string; size?: number; gapAfter?: number };

const printable = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

function wrap(value: string, width = 92) {
  const words = printable(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function money(value: number | null | undefined) {
  return value === null || value === undefined
    ? "-"
    : Math.round(value).toLocaleString("en-US");
}

function line(text: string, size = 9, gapAfter = 0): PdfLine[] {
  return wrap(text, size >= 15 ? 70 : size >= 11 ? 82 : 96).map(
    (part, index, all) => ({
      text: part,
      size,
      gapAfter: index === all.length - 1 ? gapAfter : 0,
    }),
  );
}

function documentLines(
  data: AuditSnapshotData,
  snapshots: AuditSnapshotSummary[],
): PdfLine[] {
  const out: PdfLine[] = [];
  out.push(...line("Orlando Oswalds - Dynasty Bois Audit", 18, 8));
  out.push(
    ...line(
      `Snapshot ${data.snapshotDate} | generated ${data.generatedAt.slice(0, 16).replace("T", " ")} UTC | model ${data.version}`,
      8,
      12,
    ),
  );
  out.push(...line("Current position", 13, 5));
  out.push(
    ...line(
      `Total dynasty capital ${money(data.team.totalDynastyValue)} (#${data.team.totalRank}/${data.league.length}) | player capital ${money(data.team.playerCapital)} (#${data.team.playerRank}) | draft capital ${money(data.team.draftCapital)} (#${data.team.draftRank}).`,
      9,
      2,
    ),
  );
  out.push(
    ...line(
      `Start-eligible lineup ${money(data.team.optimalLineupValue)} (#${data.team.lineupRank}) | depth ${money(data.team.depthValue)} (#${data.team.depthRank}) | ${data.team.valuedPlayerCount}/${data.team.playerCount} current player values.`,
      9,
      10,
    ),
  );

  out.push(...line("What changed", 13, 5));
  if (!data.changes.length) out.push(...line("No material change from the prior validated snapshot.", 9, 8));
  for (const change of data.changes) {
    out.push(...line(`${change.title}: ${change.detail}`, 9, 3));
  }

  out.push(...line("League comparison", 13, 5));
  for (const team of data.league) {
    out.push(
      ...line(
        `#${team.totalRank} ${team.teamName} | total ${money(team.totalDynastyValue)} | players ${money(team.playerCapital)} | picks ${money(team.draftCapital)} | lineup #${team.lineupRank}`,
        8,
        1,
      ),
    );
  }

  out.push(...line("Orlando roster", 13, 5));
  for (const player of data.roster) {
    out.push(
      ...line(
        `${player.position} ${player.name} (${player.nflTeam ?? "FA"}) | ${player.slot} | value ${money(player.value)} | 7d ${money(player.change7d)} | 30d ${money(player.change30d)}`,
        8,
        1,
      ),
    );
  }

  out.push(...line("Future picks", 13, 5));
  if (!data.picks.length) out.push(...line("No validated future-pick inventory is available.", 9, 5));
  for (const pick of data.picks) {
    out.push(...line(`${pick.label} | value ${money(pick.value)}`, 8, 1));
  }

  out.push(...line("Activity by season", 13, 5));
  for (const activity of data.activity) {
    out.push(
      ...line(
        `${activity.season}: ${activity.trades} trades, ${activity.waiverClaims} waiver claims, ${activity.freeAgentAdds} free-agent adds, ${activity.drops} drops.`,
        8,
        1,
      ),
    );
  }

  out.push(...line("Recommendations", 13, 5));
  for (const recommendation of data.recommendations) {
    out.push(
      ...line(
        `${recommendation.kind}: ${recommendation.title}. ${recommendation.detail}`,
        9,
        3,
      ),
    );
  }

  out.push(...line("Snapshot trend", 13, 5));
  for (const snapshot of [...snapshots].reverse().slice(-30)) {
    out.push(
      ...line(
        `${snapshot.snapshotDate}: total ${money(snapshot.teamValue)} (#${snapshot.teamRank}), lineup ${money(snapshot.lineupValue)} (#${snapshot.lineupRank}), ${snapshot.changeCount} recorded changes.`,
        8,
        1,
      ),
    );
  }

  out.push(...line("Method and health", 13, 5));
  out.push(
    ...line(
      `This report is generated from validated dashboard database history. The current snapshot retains unknown values as unknown, includes future picks only when market and ownership data are available, and withholds weekly forecast output until at least 75% of rostered skill players are classified. Projection coverage is ${(data.projection.coverage * 100).toFixed(1)}%.`,
      8,
      4,
    ),
  );
  out.push(
    ...line(
      "The historical strategy findings are descriptive. They are prompts for review, not automatic trade instructions.",
      8,
    ),
  );
  return out;
}

function escapePdf(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

export function buildAuditPdf(
  data: AuditSnapshotData,
  snapshots: AuditSnapshotSummary[],
) {
  const lines = documentLines(data, snapshots);
  const pages: PdfLine[][] = [];
  let page: PdfLine[] = [];
  let remaining = 690;
  for (const item of lines) {
    const height = (item.size ?? 9) + 4 + (item.gapAfter ?? 0);
    if (page.length && height > remaining) {
      pages.push(page);
      page = [];
      remaining = 690;
    }
    page.push(item);
    remaining -= height;
  }
  if (page.length) pages.push(page);

  const objects: string[] = [];
  const pageRefs = pages.map((_, index) => `${4 + index * 2} 0 R`);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((items, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    let y = 744;
    const commands = ["BT"];
    for (const item of items) {
      const size = item.size ?? 9;
      commands.push(
        `/F1 ${size} Tf`,
        `1 0 0 1 48 ${y} Tm`,
        `(${escapePdf(item.text)}) Tj`,
      );
      y -= size + 4 + (item.gapAfter ?? 0);
    }
    commands.push(
      "/F1 8 Tf",
      `1 0 0 1 500 28 Tm`,
      `(Page ${index + 1} of ${pages.length}) Tj`,
      "ET",
    );
    const stream = commands.join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index++) {
    offsets[index] = Buffer.byteLength(pdf, "ascii");
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let index = 1; index < objects.length; index++) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}
