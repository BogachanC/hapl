import { useSubscriptionAudit } from "@/hooks/useSubscriptionAudit";

export default function AuditDebug() {
  const { data, isLoading, error } = useSubscriptionAudit();

  if (isLoading) return <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", overflowX: "auto" }}>Audit loading…</pre>;
  if (error) return <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", overflowX: "auto", color: "red" }}>Audit error: {String(error)}</pre>;
  if (!data) return <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", overflowX: "auto" }}>No audit data</pre>;

  return (
    <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", overflowX: "auto" }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
