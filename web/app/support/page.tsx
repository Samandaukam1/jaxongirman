import { legalMetadata, legalPage } from "@/app/_legal/LegalPage";

// The words live in the database (site_pages); see web/lib/site-pages.ts.
export const generateMetadata = legalMetadata("support");
export default legalPage("support");
