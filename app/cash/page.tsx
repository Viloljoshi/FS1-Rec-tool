import { redirect } from 'next/navigation';

// The /cash placeholder has been folded into /roadmap. Any lingering links
// (bookmarks, older emails) now land on the roadmap page where cash is
// listed as a planned Phase 4 item with its rationale.
export default function CashRedirectPage(): never {
  redirect('/roadmap');
}
