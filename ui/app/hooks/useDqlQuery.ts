import { useState, useEffect } from "react";
import { queryExecutionClient } from "@dynatrace-sdk/client-query";

export interface QueryResult {
  records: Record<string, any>[] | null;
  loading: boolean;
  error: string | null;
}

export function useDqlQuery(query: string): QueryResult {
  const [records, setRecords] = useState<Record<string, any>[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    queryExecutionClient
      .queryExecute({
        body: {
          query,
          requestTimeoutMilliseconds: 30000,
          maxResultRecords: 1000,
        },
      })
      .then(async (response) => {
        if (cancelled) return null;
        if (response.result) {
          setRecords((response.result.records as Record<string, any>[] | null) ?? []);
          return null;
        }
        if (response.state === "RUNNING" && response.requestToken) {
          return pollQuery(response.requestToken);
        }
        return null;
      })
      .then((polledResult) => {
        if (cancelled || !polledResult) return;
        setRecords((polledResult.result?.records as Record<string, any>[] | null) ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Query failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [query]);

  return { records, loading, error };
}

async function pollQuery(requestToken: string, retries = 10) {
  for (let i = 0; i < retries; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const response = await queryExecutionClient.queryPoll({ requestToken });
    if (response.state === "SUCCEEDED") return response;
    if (response.state === "FAILED" || response.state === "CANCELLED") {
      throw new Error(`Query ${response.state.toLowerCase()}`);
    }
  }
  throw new Error("Query timed out");
}
