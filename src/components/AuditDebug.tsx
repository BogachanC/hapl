import { useSubscriptionAudit } from "@/hooks/useSubscriptionAudit";

export default function AuditDebug() {
  useSubscriptionAudit();
  return null;
}
