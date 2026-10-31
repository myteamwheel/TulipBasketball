import TransactionsView from "@/components/TransactionsView";
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Trade Review · Dynasty Boys' };
export default function TradeReviewPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
 return <TransactionsView searchParams={searchParams} review />;
}
