# 定期リサーチの手順（週1回の自動実行用）

目的：国内で仕入れて eBay で売れそうな「ゲーム・レトロゲーム・ゲーム機・純正周辺機器・ホビー」の候補を見つけ、
`public/research/index.json` に**蓄積**する。アプリの「その他 → 定期リサーチ」に表示される。

## 毎回やること
1. `public/research/index.json` を読む（既存の候補・過去の実施記録）。
2. 今回のテーマを2つ選ぶ。前回と重ならないよう、次を順番に回す：
   レトロゲーム（ソフト）／ゲーム機（本体）／純正周辺機器／携帯機／限定版・特典付き／ホビー（フィギュア・プラモデル・トイ）
3. Web検索で根拠を集める（目安10〜20回）。使ってよい情報源：
   - eBay の公開ページ（カテゴリーの Best selling、ストアの出品例、売却済み検索の結果ページ）
   - 価格ガイド（PriceCharting・RetroCharting など）、ニュース・業界記事、YouTube の動画タイトル・説明（話題の把握のみ）
   - 国内相場：ヤフオク落札相場・中古店の買取/販売価格の公開ページ
   - しないこと：ログインが必要なページ、規約で禁止された自動収集、CAPTCHA回避、メルカリの自動取得
4. 候補を更新する：
   - 既存の候補（同じ商品）が再び見つかったら `lastSeen` を更新し、`seenCount` を+1、`signals` に今回の根拠を追加
   - 新しい候補は `id`（英小文字とハイフン）を付けて追加。1回あたり新規は最大10件
   - `why` は1〜2文。`risks` に偽物・動作確認・送料・地域制限などを書く
   - 数字は出典にあるものだけ。出品価格は「出品価格」、成約は「成約」と必ず区別する。推測で埋めない
   - 根拠が古い（1年以上前）ものは使わない
5. `runs` に今回の記録（日付・テーマ・要約1文・レポートのパス）を追加し、`updatedAt` を更新。
6. `research/reports/YYYY-MM-DD.md` に、傾向（3行）と新規・再登場の候補一覧を書く。
7. JSON が正しいことを確認（`node -e "JSON.parse(require('fs').readFileSync('public/research/index.json'))"`）。
8. main に commit・push し、`bash scripts/deploy-pages.sh` で公開サイトに反映する。

## 形式（1件）
```json
{
  "id": "gb-light",
  "nameJa": "ゲームボーイライト（本体）",
  "nameEn": "Nintendo Game Boy Light MGB-101",
  "category": "ゲーム機",
  "platform": "ゲームボーイ",
  "why": "…",
  "ebayActive": null,
  "domestic": null,
  "risks": ["…"],
  "searchTerms": "game boy light japan",
  "firstSeen": "ISO日時", "lastSeen": "ISO日時", "seenCount": 1,
  "signals": [{ "date": "ISO日時", "kind": "記事|価格ガイド|eBay出品例|eBay売れ筋表示|YouTube話題|国内相場", "text": "…", "source": "…", "url": "https://…" }]
}
```
`category` は「ゲーム／ゲーム機／周辺機器／ホビー」のいずれか。
EOF
mkdir -p /home/claude/ebay-sourcing/scripts && cat > /home/claude/ebay-sourcing/scripts/deploy-pages.sh <<'EOF'
#!/usr/bin/env bash
# dist をビルドして gh-pages ブランチへ反映する（GitHub Pages）
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d node_modules ] || npm ci --no-audit --no-fund
npm run build
TMP=$(mktemp -d)
cp -r dist/. "$TMP/"
touch "$TMP/.nojekyll"
REMOTE=$(git remote get-url origin)
cd "$TMP"
git init -q -b gh-pages
git -c user.name="uenokun516-ai" -c user.email="uenokun516@gmail.com" add -A
git -c user.name="uenokun516-ai" -c user.email="uenokun516@gmail.com" commit -qm "公開用ビルド $(date -u +%Y-%m-%dT%H:%MZ)"
git push -f "$REMOTE" gh-pages
echo "deployed"
EOF
chmod +x /home/claude/ebay-sourcing/scripts/deploy-pages.sh; cd /home/claude/ebay-sourcing && npx vitest run 2>&1 | grep Tests && npx tsc --noEmit -p . && npx vite build 2>&1 | grep built && ls dist/research