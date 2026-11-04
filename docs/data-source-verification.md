# データ取得検証表（2026-11-04 確認）

追加仕様書 4章に基づく。アプリ内「その他 → 接続状態・データ取得検証表」と同じ内容（`src/core/sources.ts`）。
状態：未検証／利用可能／設定待ち／手動のみ／利用不可。**「利用可能」は実データで接続を確認できたものだけ**に付ける。

| サービス | 取得方式 | 状態 | データの種類 | 前提（アカウント・権限・費用） | 制限・上限 | 取得できる項目／欠損 | 実データ確認 |
|---|---|---|---|---|---|---|---|
| eBay | 公式API（Browse API）＋成約は手動 | 設定待ち | 出品中／成約（手動） | eBay Developers Program（無料）の Production キー、中継サーバー | Browse API は出品のみ。成約の Marketplace Insights API は Limited Release（承認制）なので使わない | タイトル・価格・送料（不明あり）・状態・URL・件数／成約価格・販売日なし | 未（模擬データでテスト済み） |
| Yahoo!ショッピング | 公式API（商品検索 v3） | 設定待ち | カタログ・参考価格 | Client ID（無料）、ガイドライン同意 | 短時間の大量アクセスで一時停止（目安 1クエリ/秒） | 商品名・価格・画像・JAN／レトロ品は欠損が多い | 未（模擬データでテスト済み） |
| Yahoo!オークション | 手動取り込み＋検索リンク | 手動のみ | 入札中／落札（手動） | なし | 公式オークションWeb APIは2018〜2020年に提供終了 | 本人が入力した価格・終了日・即決価格・本文 | ― |
| メルカリ | 手動取り込み＋検索リンク | 手動のみ | 出品中（手動） | なし | 一般向け公式検索APIは確認できず。自動収集しない | 本人が入力した価格・状態・本文 | ― |
| Amazon | 手動取り込み＋検索リンク | 未検証 | カタログ・参考価格 | Creators API はアソシエイト内で提供。この用途で使える根拠が未確認 | PA-API は2026年5月15日に廃止 | ―（未接続） | ― |
| X | 公式API（従量課金）候補／現状は手動 | 設定待ち | SNS話題 | 開発者アカウントと前払いクレジット。**予算未決のため接続しない** | 2026年2月から従量課金が標準（無料枠なし）。直近7日の検索 | ―（未接続） | ― |
| YouTube | 公式API（Data API v3）候補／現状は手動 | 設定待ち | SNS話題 | Google Cloud プロジェクトと APIキー（無料） | 既定 1日10,000ユニット、search.list は1日100回 | タイトル・説明・公開日時・統計などのメタデータのみ | ― |

## 根拠資料
- eBay Browse API：https://developer.ebay.com/develop/api/buy/browse_api
- eBay Marketplace Insights API（Limited Release）：https://developer.ebay.com/api-docs/buy/marketplace-insights/overview.html
- Yahoo!ショッピング 商品検索（v3）：https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html
- ヤフオク API 提供終了のお知らせ：https://developer.yahoo.co.jp/changelog/auctions.html
- メルカリ利用規約：https://static.jp.mercari.com/tos
- Amazon アソシエイト利用条件：https://affiliate-program.amazon.com/help/operating/policies
- X 開発者プラットフォーム：https://developer.x.com/
- YouTube Data API 概要（利用枠）：https://developers.google.com/youtube/v3/getting-started

X の料金は第三者の解説記事で確認した。実装前に公式の料金ページで再確認すること。
