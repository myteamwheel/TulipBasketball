import TransactionsView from "@/components/TransactionsView";
export const dynamic = "force-dynamic";
export default function TransactionsPage({ searchParams }: { searchParams: Promise<{ type?: string; page?: string }> }) { return <TransactionsView searchParams={searchParams} />; }
