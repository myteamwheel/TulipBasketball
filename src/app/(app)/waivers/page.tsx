import WaiverMarketBoard from "@/components/WaiverMarketBoard";
import SectionHeader from "@/components/SectionHeader";
import { getWaiverMarket } from "@/lib/waiverMarket";

export const dynamic = "force-dynamic";

export default async function WaiversPage() {
  const data = await getWaiverMarket();
  const universeIncomplete = data.valuedUniverse < 400;
  const metric = (label: string, value: string | number, green = false) => <div className="rounded-md bg-neutral-950 p-2.5"><div className="text-xs uppercase tracking-wide text-neutral-400">{label}</div><div className={`mt-1 text-lg font-semibold ${green ? "text-emerald-300" : "text-neutral-100"}`}>{value}</div></div>;
  return <div className="min-w-0 space-y-5">
    <div><h1 className="text-xl font-semibold text-neutral-100">Waiver Market</h1><p className="mt-1 max-w-3xl text-sm leading-5 text-neutral-500">Verified unrostered Dynasty Bois players with current value, weekly role, team need and projection context.</p></div>
    {universeIncomplete ? <div className="rounded-lg border border-amber-900/70 bg-amber-950/20 p-3 text-xs leading-5 text-amber-200">The fresh valued universe currently contains {data.valuedUniverse} players. Unknown ownership is never presented as a waiver.</div> : null}
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 sm:p-4"><SectionHeader title="Market coverage" description="Free agents require verified Sleeper non-ownership and fresh KTC identity."/><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{metric("Fresh universe", data.valuedUniverse)}{metric("League-owned", data.ownedValued)}{metric("Verified free agents", data.rows.length, true)}{metric("FAAB left", data.faabRemaining === null ? "—" : `$${data.faabRemaining}`, true)}</div></section>
    <section><SectionHeader title="Available players" description="Weekly projection and role come from the same validated projection pass used by the Forecast pages."/><WaiverMarketBoard rows={data.rows}/></section>
  </div>;
}
