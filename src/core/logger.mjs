import zhMessages from '../i18n/zh.mjs';
import enMessages from '../i18n/en.mjs';

let messages = zhMessages;

export function setLang(lang) {
  messages = lang === 'en' ? enMessages : zhMessages;
}

export function t(key, ...args) {
  const val = messages[key];
  if (typeof val === 'function') return val(...args);
  return val || key;
}

export function log(icon, msg) {
  console.log(`${icon}  ${msg}`);
}

export function separator(title) {
  console.log();
  console.log('═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
  console.log();
}
