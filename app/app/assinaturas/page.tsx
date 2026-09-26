import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/require-role";
import { BillingDashboardClient } from "./_components/BillingDashboardClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clientes e assinaturas" };

export default async function AssinaturasPage() {
  const auth = await requireRole("manager", { resource: "billing_export" });
  if (!auth.ok) redirect(auth.response.status === 401 ? "/login" : "/403");
  return (
    <BillingDashboardClient
      canConfigure={auth.org.role === "admin" && !auth.user.support}
      organizationName={auth.org.name}
      organizationId={auth.org.orgId}
      key={auth.org.orgId}
    />
  );
}
