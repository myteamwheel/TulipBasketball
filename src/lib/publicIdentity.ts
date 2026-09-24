export function publicTeamName(manager:{teamName:string|null;sleeperRosterId:number}):string{
  const teamName=manager.teamName?.trim();
  if(teamName)return teamName;
  if(manager.sleeperRosterId===12)return "Jeff";
  return `Unnamed team · Roster ${manager.sleeperRosterId}`;
}
