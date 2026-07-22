# 家計ノート(プレーンHTML/CSS/JS版)

ビルド不要・npm不要のバージョンです。ファイルをそのままGitHub Pagesに置くだけで動きます。
iPadだけで公開まで完結できます。

## 構成

- `index.html` — 画面の骨組み
- `style.css` — デザイン
- `app.js` — すべてのロジック(Supabaseとの通信もここ)
- `config.js` — Supabaseの接続情報(自分で編集する必要があります)
- `supabase/schema.sql` — Supabaseに1回だけ実行するテーブル定義

## 1. Supabaseプロジェクトを準備

1. https://supabase.com で無料プロジェクトを作成
2. SQL Editorで `supabase/schema.sql` の中身を実行
3. Authentication > Providers で Email(Magic Link)が有効になっていることを確認
4. Settings > API から `Project URL` と `anon public` キーをコピー

## 2. config.js を編集

`config.js` をテキストエディタ(iPadなら「テキスト編集」アプリやGitHubのWeb編集画面でOK)で開き、
以下を書き換えます。

```js
const SUPABASE_URL = "https://xxxxxxxxxxxx.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-public-key";
```

※ anon public キーは公開されても問題ない設計のキーです(実際のアクセス制御はSupabase側の
Row Level Securityが行うため)。このファイルはそのままGitHubにコミットして大丈夫です。

## 3. iPadでGitHubにアップロード

1. github.com で空のリポジトリを新規作成
2. リポジトリの「Add file」→「Upload files」
3. `index.html` `style.css` `app.js` `config.js` `supabase` フォルダをまとめてアップロード
4. 「Commit changes」で確定

## 4. GitHub Pagesを有効化

1. リポジトリの「Settings」→「Pages」
2. 「Build and deployment」の Source を **Deploy from a branch** のまま、
   Branch を `main` / `/(root)` にして Save
3. 数十秒後、`https://ユーザー名.github.io/リポジトリ名/` が公開されます

ビルドが不要なので、Actionsの設定もSecretsの登録も不要です。ファイルを置くだけで完了します。

## 5. ログインURLの設定

Supabaseの「Authentication」→「URL Configuration」→「Redirect URLs」に、
上記で発行されたPagesのURLを追加してください。これを忘れると、届いたログインメールの
リンクをタップしても正しく戻ってこられません。

## 6. 家族と共有する

「設定」タブに表示される招待コード(あなたのユーザーID)を家族に伝え、
相手が同じ画面で「招待コードを入力して参加」すると、二人で同じ家計簿を編集できるようになります。

## 今後ファイルを更新するとき

`app.js` などを直接GitHubのWeb上で開いて鉛筆アイコンで編集→「Commit changes」するだけで、
即座にPages上の公開内容にも反映されます(ビルド待ちは発生しません)。

## Reactのビルド版との違い

以前お渡ししたReact + Vite版(`kakeibo-web.zip`)と機能はほぼ同じですが、こちらは:
- ビルドツール・npm不要
- GitHub Actions不要、ファイルをそのまま置くだけ
- グラフはrechartsの代わりにChart.js(CDN経由)を使用
- アイコンはlucide-reactの代わりに絵文字を使用

という違いがあります。今後の編集も、iPad上でGitHubのファイルを直接テキスト編集するだけで完結します。
