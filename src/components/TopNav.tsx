"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links=[{href:"/",label:"My Team"},{href:"/forecast",label:"Predictions"},{href:"/league",label:"League"},{href:"/trade-finder",label:"Trade Lab"},{href:"/waivers",label:"Waivers"},{href:"/transactions",label:"Transactions"},{href:"/players",label:"Players"},{href:"/refresh-history",label:"Refreshes",utility:true},{href:"/settings",label:"Data Health",utility:true}];
export default function TopNav(){const pathname=usePathname();return <nav aria-label="Primary" className="flex w-full flex-wrap items-center gap-x-0.5 gap-y-0.5 py-1">{links.map((link)=>{const active=link.href==="/"?pathname===link.href:pathname.startsWith(link.href);return <Link key={link.href} href={link.href} className={`rounded-md px-2 py-1.5 text-[10px] font-medium transition sm:px-2.5 sm:text-[11px] ${active?"bg-neutral-800 text-neutral-100":link.utility?"text-neutral-600 hover:bg-neutral-900 hover:text-neutral-300":"text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"}`}>{link.label}</Link>})}</nav>}
