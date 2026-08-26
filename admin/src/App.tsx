import { useEffect, type ReactNode } from "react";

import { AdminLayout } from "@/components/AdminLayout";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AccessDeniedPage } from "@/pages/AccessDeniedPage";
import { AppStorePage } from "@/pages/AppStorePage";
import { AuditPage } from "@/pages/AuditPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { FinancePage } from "@/pages/FinancePage";
import { GamesPage } from "@/pages/GamesPage";
import { FontsPage } from "@/pages/FontsPage";
import { GiftsPage } from "@/pages/GiftsPage";
import { LoginPage } from "@/pages/LoginPage";
import { JElementFamilyPage } from "@/pages/JElementFamilyPage";
import { JElementsPage } from "@/pages/JElementsPage";
import { JslaydDesignsPage } from "@/pages/JslaydDesignsPage";
import { PptxTemplatesPage } from "@/pages/PptxTemplatesPage";
import { PresentationsPage } from "@/pages/PresentationsPage";
import { MarketplaceFinancePage } from "@/pages/MarketplaceFinancePage";
import { MarketplacePage } from "@/pages/MarketplacePage";
import { ModulesPage } from "@/pages/ModulesPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { PricingPage } from "@/pages/PricingPage";
import { QrVideoPage } from "@/pages/QrVideoPage";
import { TariffsPage } from "@/pages/TariffsPage";
import { SurveysPage } from "@/pages/SurveysPage";
import { UsagePage } from "@/pages/UsagePage";
import { UsersPage } from "@/pages/UsersPage";
import { navigate, usePathname } from "@/lib/router";
import { useAuth } from "@/providers/AuthProvider";

const pages: Record<string, ReactNode> = {
  "/": <DashboardPage />,
  "/users": <UsersPage />,
  "/presentations": <PresentationsPage />,
  "/jslayd": <JslaydDesignsPage />,
  "/pptx": <PptxTemplatesPage />,
  "/jelements": <JElementsPage />,
  "/qr-video": <QrVideoPage />,
  "/tariflar": <TariffsPage />,
  "/usage": <UsagePage />,
  "/pricing": <PricingPage />,
  "/audit": <AuditPage />,
  "/fonts": <FontsPage />,
  "/gifts": <GiftsPage />,
  "/finance": <FinancePage />,
  "/modules": <ModulesPage />,
  "/surveys": <SurveysPage />,
  "/marketplace": <MarketplacePage />,
  "/marketplace-finance": <MarketplaceFinancePage />,
  "/games": <GamesPage />,
  "/orders": <OrdersPage />,
  "/app-store": <AppStorePage />,
};

export default function App() {
  const { session, loading, isAdmin, accessChecked } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !session && pathname !== "/login") navigate("/login", true);
    else if (session && accessChecked && isAdmin
      && (pathname === "/login" || (!pages[pathname] && !/^\/jelements\/[0-9a-f-]{36}$/.test(pathname)))) navigate("/", true);
  }, [accessChecked, isAdmin, loading, pathname, session]);

  if (loading || (session && !accessChecked)) return <LoadingScreen />;
  if (!session) return <LoginPage />;
  if (!isAdmin) return <AccessDeniedPage />;

  // One parameterised route. The rest of this console is a flat table of
  // paths, and adding a router for a single detail page would be a dependency
  // bought for one screen.
  const family = /^\/jelements\/([0-9a-f-]{36})$/.exec(pathname);
  const page = family
    ? <JElementFamilyPage familyId={family[1]!} />
    : pages[pathname] ?? pages["/"];

  return <AdminLayout pathname={pathname}>{page}</AdminLayout>;
}
