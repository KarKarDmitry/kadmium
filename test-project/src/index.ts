import { AppCore } from '@karkardmitry/kadmium-core';

async function main() {
  const app = await AppCore.init();

  console.log('=== Kadmium test project ===');
  console.log(`Models: ${app.modelCount}`);

  for (const ir of app.allIrs) {
    console.log(`\n--- ${ir.name} (table ${ir.collection}) ---`);
    for (const [name, field] of Object.entries(ir.fields)) {
      const alias = field.alias !== name ? ` (alias: ${field.alias})` : '';
      const ref = field.ref ? ` → ${field.ref}` : '';
      console.log(`  ${name}: ${field.tsType}${alias}${ref}`);
    }
  }

  console.log('\n✅ OK');
}

main().catch(console.error);
