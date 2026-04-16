import zhMessages from '../i18n/zh.mjs';
import enMessages from '../i18n/en.mjs';

let messages = zhMessages;
let _lang = 'zh';

export function setLang(lang) {
  _lang = lang === 'en' ? 'en' : 'zh';
  messages = _lang === 'en' ? enMessages : zhMessages;
}

export function getLang() { return _lang; }

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

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function createSpinner(text) {
  let i = 0;
  let timer = null;
  const isTTY = process.stderr.isTTY;
  return {
    start() {
      if (!isTTY) { process.stderr.write(`${text}\n`); return; }
      timer = setInterval(() => {
        const frame = SPINNER_FRAMES[i++ % SPINNER_FRAMES.length];
        const elapsed = Math.floor(i * 0.08);
        process.stderr.write(`\r${frame}  ${text} (${elapsed}s)`);
      }, 80);
    },
    stop(finalText) {
      if (timer) { clearInterval(timer); timer = null; }
      if (isTTY) process.stderr.write('\r' + ' '.repeat(80) + '\r');
      if (finalText) process.stderr.write(finalText + '\n');
    },
  };
}
