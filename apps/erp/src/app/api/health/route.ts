import { NextResponse } from "next/server";
import { pingDatabase } from "@/server/database/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await pingDatabase();

    if (health.ok) {
      return NextResponse.json(
        {
          status: "healthy",
          database: "connected",
          engine: health.engine,
          latencyMs: health.latencyMs,
          version: "1.0.0",
          timestamp: new Date().toISOString(),
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate",
          },
        }
      );
    }

    return NextResponse.json(
      {
        status: "unhealthy",
        database: "disconnected",
        engine: health.engine,
        error: "Database unavailable",
        latencyMs: health.latencyMs,
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        status: "unhealthy",
        database: "disconnected",
        error: "Database health check failed",
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
