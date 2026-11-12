import { legalMetadata, legalPage } from "@/app/_legal/LegalPage";

// The words live in the database (site_pages); see web/lib/site-pages.ts.
export const generateMetadata = legalMetadata("terms");
export default legalPage("terms");
