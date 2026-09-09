import { installKtcFetchCompatibility } from "@/lib/ktcPageCompat";

export async function register() {
  // KTC's public rankings page changed its embedded `playersArray` payload in
  // September 2026 while keeping the complete rankings in rendered public DOM
  // rows. Keep the existing market-ingestion safety checks intact and repair
  // only that one upstream response shape before the application reads it.
  installKtcFetchCompatibility();
}
