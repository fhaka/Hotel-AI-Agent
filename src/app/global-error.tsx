"use client";

/** Last-resort error page when the root layout itself fails. Must render its own <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "6rem 1rem" }}>
        <h1>Something went wrong</h1>
        <p>Please try again. {error.digest ? `Reference: ${error.digest}` : null}</p>
        <button onClick={() => reset()}>Try again</button>
      </body>
    </html>
  );
}
