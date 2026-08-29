import { AppCore } from '@karkardmitry/kadmium-core';
import { User, Post } from './models';

async function main() {
  const app = new AppCore();
  app.register([User, Post]);
  await app.registry.validate();
  const ir = app.ir('User');
  console.log('User fields:');
  for (const [name, f] of Object.entries(ir.fields)) {
    console.log(
      `  ${name}: type=${f.type} tsType=${f.tsType} sourceModel=${f.sourceModel ?? '-'}`,
    );
  }
}
main().catch(console.error);
