// Where the raw bytes live.
//
// In production these point at a second registrable domain with no access to the app's
// cookies (§6.5). Until M13 splits the deploy they fall back to the app origin, which
// is a knowing compromise: `nosniff` plus a correct content type is already enough in
// a correct browser, and the separate origin is the defence for when that fails.
//
// Set NEXT_PUBLIC_RAW_ORIGIN locally (`pnpm dev:raw` runs the second port) so the
// cross-origin behaviour is exercised from the milestone that writes it rather than
// discovered on deploy day.

const RAW_ORIGIN = process.env.NEXT_PUBLIC_RAW_ORIGIN ?? "";

export function rawUrl(id: string): string {
  return `${RAW_ORIGIN}/raw/${id}`;
}

export function downloadUrl(id: string): string {
  return `${RAW_ORIGIN}/dl/${id}`;
}

/** True once the raw endpoints are on their own origin, which is what makes the
 *  cookie isolation real rather than nominal. */
export const RAW_ORIGIN_IS_SPLIT = RAW_ORIGIN !== "";
