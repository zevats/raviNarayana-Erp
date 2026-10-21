import { seedSyntheticData } from "./helpers/seedSyntheticData";
import { resolveFixtureDbPath } from "./helpers/fixtureUtils";

async function main() {
  const rawPath = process.env.ERP_DATABASE_PATH;
  if (!rawPath || rawPath.trim().length === 0) {
    throw new Error(
      "Missing required ERP_DATABASE_PATH environment variable for synthetic data seeding. Refusing to proceed without explicit fixture path."
    );
  }

  // Pre-validate path to ensure fail-closed behavior before calling seeder
  const validatedFixturePath = resolveFixtureDbPath(rawPath);

  const result = await seedSyntheticData({
    allowSyntheticSeed: true,
    verbose: true,
    fixturePath: validatedFixturePath,
  });

  console.log("\n================================================================================");
  console.log("RAVINARAYAN ERP — SYNTHETIC DATA SEEDING COMPLETE");
  console.log("================================================================================");
  console.log(result.message);
  console.log("\nSeeded Entity Quantities:");
  for (const [entity, count] of Object.entries(result.stats)) {
    console.log(`  • ${entity.padEnd(25)}: ${count}`);
  }
  console.log("================================================================================\n");
}

main().catch((err) => {
  console.error("\n[FATAL SEEDING ERROR]:", err.message);
  process.exit(1);
});
