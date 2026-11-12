import type { Instrumentation } from "next";
import { buildErrorReport, reportServerError } from "@/lib/observability/errors";

export function register() {
  // No SDK to initialise: errors are reported through onRequestError below.
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  await reportServerError(buildErrorReport(err, request, context));
};
