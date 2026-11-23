import { cre, handler, Runner } from '@chainlink/cre-sdk';
import { checkRegistry, type Config } from './registry-workflow';

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(config => [
    handler(new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }), checkRegistry)
  ]);
}
