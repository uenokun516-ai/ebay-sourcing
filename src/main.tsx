import { render } from 'preact';
import { DataProvider } from './ui/store';
import { App } from './ui/App';
import './styles.css';

render(<DataProvider><App /></DataProvider>, document.getElementById('app')!);

// オフライン用キャッシュ（HTTPS または localhost のときのみ）
if ('serviceWorker' in navigator && window.isSecureContext && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* 埋め込み表示などで登録できない環境は無視 */ });
  });
}

// 標準 BarcodeDetector のない端末（iPhone Safari 等）では、オフラインでもスキャンできるよう読み取りライブラリを先読みしてキャッシュさせる
if (!('BarcodeDetector' in window)) {
  setTimeout(() => { import('@zxing/browser').catch(() => {}); import('@zxing/library').catch(() => {}); }, 2500);
}
