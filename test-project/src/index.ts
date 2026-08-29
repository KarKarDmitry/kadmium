import { AppCore } from '@karkardmitry/kadmium-core';

async function main() {
  // AppCore сам находит модели по kadmium.config.ts
  const app = await AppCore.init();

  console.log('=== Test project ===');
  console.log(`Models: ${app.modelCount}`);

  for (const ir of app.allIrs) {
    console.log(`\n--- ${ir.name} ---`);
    for (const [name, field] of Object.entries(ir.fields)) {
      const alias = field.alias !== name ? ` (alias: ${field.alias})` : '';
      const ref = field.ref ? ` → ${field.ref}` : '';
      console.log(`  ${name}: ${field.tsType}${alias}${ref}`);
    }
  }

  console.log('\n✅ All ok!');
}

main().catch(console.error);
