"use client";

import { Button } from "@/components/ui/button";

/** Shown when a page fails on the server or client. The reference matches the server log. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        The problem has been logged. Please try again; if it keeps happening, contact support
        {error.digest ? (
          <>
            {" "}with reference <span className="font-mono">{error.digest}</span>
          </>
        ) : null}
        .
      </p>
      <Button className="mt-6" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
