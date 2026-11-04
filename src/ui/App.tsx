import { useEffect, useState } from 'preact/hooks';
import { useData, useRoute } from './store';
import { ScanPage } from './Scan';
import { CandidatesPage, CandidatePage, NewCandidatePage } from './Candidates';
import { ProductsPage, ProductPage, ProductNewPage } from './Products';
import { InventoryPage, InventoryItemPage } from './Inventory';
import { RequestsPage, RequestPage } from './Requests';
import { MorePage, SettingsPage, FeesPage, ShippingPage, FxPage, BackupPage, TrashPage, AboutPage } from './More';

const NAV: [string, string, string, string[]][] = [
  ['scan', 'スキャン', '⌖', ['scan']],
  ['candidates', '候補', '⚖', ['candidates', 'candidate', 'candidate-new']],
  ['products', '商品', '☰', ['products', 'product', 'product-new']],
  ['inventory', '在庫', '▦', ['inventory']],
  ['more', 'その他', '⋯', ['more', 'requests', 'request', 'settings', 'fees', 'shipping', 'fx', 'backup', 'trash', 'about']],
];

function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    addEventListener('online', a); addEventListener('offline', b);
    return () => { removeEventListener('online', a); removeEventListener('offline', b); };
  }, []);
  return on;
}

export function App() {
  const { loaded, error } = useData();
  const [head = 'scan', id] = useRoute();
  const online = useOnline();
  let page;
  switch (head) {
    case 'scan': page = <ScanPage />; break;
    case 'candidates': page = <CandidatesPage />; break;
    case 'candidate-new': page = <NewCandidatePage />; break;
    case 'candidate': page = <CandidatePage id={id} key={id} />; break;
    case 'products': page = <ProductsPage />; break;
    case 'product-new': page = <ProductNewPage />; break;
    case 'product': page = <ProductPage id={id} key={id} />; break;
    case 'inventory': page = id ? <InventoryItemPage id={id} key={id} /> : <InventoryPage />; break;
    case 'more': page = <MorePage />; break;
    case 'requests': page = <RequestsPage />; break;
    case 'request': page = <RequestPage id={id} key={id} />; break;
    case 'settings': page = <SettingsPage />; break;
    case 'fees': page = <FeesPage />; break;
    case 'shipping': page = <ShippingPage />; break;
    case 'fx': page = <FxPage />; break;
    case 'backup': page = <BackupPage />; break;
    case 'trash': page = <TrashPage />; break;
    case 'about': page = <AboutPage />; break;
    default: page = <ScanPage />;
  }
  return (
    <div class="app">
      {!online && <div class="offline">オフライン：保存済みデータで計算しています（外部検索・最新相場は使えません）</div>}
      {error && <div class="warn">{error}</div>}
      <main>{loaded ? page : <p class="empty">読み込み中…</p>}</main>
      <nav class="tabs">
        {NAV.map(([k, l, ic, match]) => (
          <a key={k} href={'#/' + k} class={match.includes(head) ? 'on' : ''}><span class="ic">{ic}</span><span>{l}</span></a>
        ))}
      </nav>
    </div>
  );
}
