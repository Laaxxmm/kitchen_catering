"use client";

/**
 * Root error boundary — catches errors thrown outside the (dashboard)
 * segment (auth/public layouts, the root layout itself) that the
 * dashboard error.tsx can't. Must render its own <html>/<body> because
 * it replaces the root layout when active.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 480, margin: "15vh auto", padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#555", marginBottom: 16 }}>
            This is a display error — your data is safe. Try again, or reload for the latest version.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "1px solid #0d7a6f",
              background: "#0d7a6f",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ fontSize: 12, color: "#999", marginTop: 16 }}>Reference: {error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
