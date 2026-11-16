import archive from "@/data/draft-selections.json";
import DraftGradesBoard from "@/components/DraftGradesBoard";
import { currentDraftQuotes } from "@/lib/draftMarket";
import { draftContributions, contributionChecked } from "@/lib/draftContributions";
import { getLeagueHistory } from "@/lib/leagueHistory";
import { gradeDrafts, type Selection } from "@/lib/draftGrades";

export const dynamic = "force-dynamic";
export const metadata = { title: "Draft Grades · Dynasty Boys" };

export default async function DraftGradesPage() {
  const picks: Selection[] = archive.picks.filter(pick => !pick.auction).map(pick => ({
    ...pick,
    team: !pick.team && pick.manager?.toLowerCase() === "jeffsharpington" ? "Jeff" : pick.team,
  }));
  const history = await getLeagueHistory();
  const currentManagers = history.seasons[0]?.managers.filter(m => m.ownerId).map(m => ({ id: m.ownerId!, name: m.name })) ?? [];
  const live = await currentDraftQuotes([...new Set(picks.map(p=>p.playerId))]);
  const today = new Date().toISOString().slice(0,10);
  const rows = gradeDrafts(picks.map(p=>{
    const quote = live.get(p.playerId);
    return quote && (!p.now || quote.date >= p.now.date) ? {...p, now:quote} : p;
  }),today);
  return <DraftGradesBoard rows={rows} checked={archive.checked} today={today} currentManagers={currentManagers} contributions={draftContributions(picks, history)} contributionChecked={contributionChecked} />;
}
