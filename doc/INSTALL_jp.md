# インストール方法

BeliefNest の動作には Python 3.9 以上および Node.js 16.13.0 以上が必要です。動作確認は Windows 11 上で行っています。以下の手順に従ってインストールしてください。

[こちら](https://github.com/sagara-r/BeliefNest/releases)から`Source code (zip)`をダウンロードし、解凍してください。

## ステップ 1: Python のインストール
先に，Python 3.9以上を実行可能な環境を構築してください．Python自体のインストール方法については[こちら](https://www.python.jp/install/windows/install.html)．
その後，コマンドプロンプト等を開き，以下を実行してください．

```bash
cd BeliefNest
pip install -e .
```

## ステップ 2: Node.js のインストール
先に，Node.js 16.13.0 以上を実行可能な環境を構築してください．Node.js自体のインストール方法については[こちら](https://nodejs.org/ja/download)．
その後，コマンドプロンプト等を開き，以下を実行してください．
```bash
cd belief_nest/env/mineflayer
npm install
```

## ステップ 3: Docker のインストール
Windows を使用している場合は、[Docker Docs](https://docs.docker.com/desktop/setup/install/windows-install/) からインストーラをダウンロードして実行してください。

## ステップ 4: Minecraft のインストール

[Minecraft Launcher](https://www.minecraft.net/)をインストールし，Minecraft: Java Edition（バージョン1.19）をプレイできるようにしてください．クライアントとして使用します．Java Edition のライセンスが必要です．

Minecraft Launcherの「起動構成」タブの「新規作成」から，バージョン1.19 を選択してください．
