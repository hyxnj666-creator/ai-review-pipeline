import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, t } from '../core/logger.mjs';

export async function run() {
  const target = resolve(process.cwd(), '.ai-pipeline.json');
  if (existsSync(target)) {
    log('ℹ️', t('initExists', target));
    return;
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const templatePath = resolve(__dirname, '../../templates/ai-pipeline.json');
  const content = readFileSync(templatePath, 'utf-8');
  writeFileSync(target, content, 'utf-8');
  log('✅', t('initCreated', target));
  log('💡', t('initDone'));
}
