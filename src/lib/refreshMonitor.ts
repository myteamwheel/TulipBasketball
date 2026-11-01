export type RefreshProgress = {
  runId: string;
  status: "RUNNING" | "SUCCESS" | "PARTIAL_FAILURE" | "FAILED";
  errors?: { source: string; message: string }[];
};

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Refresh monitoring stopped."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

/** Follow the exact run the user started; never infer completion from elapsed time. */
export async function monitorRefresh(
  runId: string,
  key: string,
  options: {
    signal: AbortSignal;
    onProgress: (run: RefreshProgress) => void;
    fetcher?: typeof fetch;
    pollMs?: number;
    timeoutMs?: number;
  },
): Promise<RefreshProgress> {
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60_000);
  const fetcher = options.fetcher ?? fetch;
  while (!options.signal.aborted && Date.now() < deadline) {
    const response = await fetcher(`/api/admin/refresh?runId=${encodeURIComponent(runId)}`, {
      headers: { "x-admin-key": key },
      cache: "no-store",
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]),
    });
    const body = await response.json() as { run?: RefreshProgress; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Unable to check refresh progress.");
    const run = body.run;
    if (!run || run.runId !== runId || !["RUNNING", "SUCCESS", "PARTIAL_FAILURE", "FAILED"].includes(run.status)) {
      throw new Error("The refresh status could not be verified.");
    }
    options.onProgress(run);
    if (run.status !== "RUNNING") return run;
    await wait(options.pollMs ?? 3000, options.signal);
  }
  if (options.signal.aborted) throw options.signal.reason ?? new Error("Refresh monitoring stopped.");
  throw new Error("The refresh is taking longer than expected. Check Refresh history for its final result.");
}
