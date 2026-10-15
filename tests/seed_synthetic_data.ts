import { seedSyntheticData } from "../apps/erp/src/server/database/seedSyntheticData";

async function main() {
  const result = await seedSyntheticData({
    allowSyntheticSeed: true,
    verbose: true,
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
