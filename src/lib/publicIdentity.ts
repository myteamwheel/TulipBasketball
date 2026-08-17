export function publicTeamName(manager:{teamName:string|null;sleeperRosterId:number}):string{const teamName=manager.teamName?.trim();return teamName||`Team ${manager.sleeperRosterId}`;}
