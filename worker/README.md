# 中継サーバー（Cloudflare Workers）の設定

アプリの「ネットで調べる」で Yahoo!ショッピングと eBay を自動検索するための中継サーバーです。
APIキーはここ（Cloudflare 側）にだけ保存し、アプリやバックアップには入れません。無料枠で動きます。

## 事前に用意するもの（すべて無料・本人が登録）
1. **Yahoo!デベロッパーネットワーク**：https://e.developer.yahoo.co.jp/dashboard/ でアプリケーションを登録し、**Client ID** を控える
2. **eBay Developers Program**：https://developer.ebay.com/ で登録し、**Production** の Keyset を作成。**App ID（Client ID）** と **Cert ID（Client Secret）** を控える
3. **Cloudflare**：https://dash.cloudflare.com/ でアカウントを作成

## Worker の作成
1. Cloudflare ダッシュボード → Workers & Pages → 作成 → 「Hello World」から Worker を作る（名前：`ebay-sourcing-proxy` など）
2. 「コードを編集」で中身をすべて消し、`worker/worker.js` の内容を貼り付けて「デプロイ」
3. Worker の「設定 → 変数とシークレット」で次を追加（種類はシークレット）
   | 名前 | 値 |
   |---|---|
   | `YAHOO_APP_ID` | Yahoo! の Client ID |
   | `EBAY_CLIENT_ID` | eBay の App ID |
   | `EBAY_CLIENT_SECRET` | eBay の Cert ID |
   | `ALLOWED_ORIGIN` | `https://uenokun516-ai.github.io` |
   | `APP_KEY` | 好きな合言葉（英数字20文字程度） |
4. Worker の URL（`https://ebay-sourcing-proxy.<名前>.workers.dev`）を控える

## アプリ側
「その他 → 設定 → ネット検索」に Worker の URL と合言葉を入れ、「接続テスト」→「保存」。

## 取得できるもの・できないもの
- Yahoo!ショッピング：JANコードから商品名・画像・国内の出品価格（主に新品）
- eBay Browse API：GTIN（JAN）またはキーワードで **出品中** の価格・件数。**成約（売れた価格）は取得できません**
- 呼び出しは画面でボタンを押したときだけ。結果は Worker で1日キャッシュします
