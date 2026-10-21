import { cache } from "react";
import { validateSession, validateSessionDetailed } from "./auth";
import { AuthenticatedUser } from "../../types";

/**
 * React Server Component request-memoized session validation.
 * Deduplicates database roundtrips across Layout, Page, and nested Server Components
 * within a single HTTP request pass.
 */
export const validateSessionCached = cache(
  async (sessionToken: string): Promise<AuthenticatedUser | null> => {
    return validateSession(sessionToken);
  }
);

export const validateSessionDetailedCached = cache(
  async (sessionToken: string) => {
    return validateSessionDetailed(sessionToken);
  }
);
