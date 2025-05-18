# BeliefNest: 心の理論を持つ身体化エージェントのための共同行為シミュレータ

<div align="center">

[\[Arxiv\]]()

[![Python Version](https://img.shields.io/badge/Python-3.9-blue.svg)](https://github.com/sagara-r/BeliefNest)
[![GitHub license](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/sagara-r/BeliefNest/blob/main/LICENSE)

---

![](images/overview.png)

</div>

**BeliefNest** は、身体化エージェントが心の理論を活用して共同行為タスクを遂行することを可能にする、オープンソースシミュレータです。BeliefNestは Minecraft 環境内に動的かつ階層的にシミュレータを生成し、エージェント自身および他者の入れ子構造の信念状態を明示的に表現します。これによりオープンドメインタスクで心の理論を用いたエージェント制御を可能とします。本シミュレータは各信念に基づくプロンプト生成機構を備えており、大規模言語モデル(LLM)を活用したエージェント制御手法の設計・検証を可能とします。

このリポジトリには BeliefNest のコードを含みます。コードは [MITライセンス](LICENSE) のもとで提供されています。

---

# インストール方法

[こちら](https://github.com/sagara-r/BeliefNest/releases)から最新版をダウンロードしてください．BeliefNest の動作には Python 3.9 以上および Node.js 16.13.0 以上が必要です。動作確認は Windows 11 上で行っています。以下の手順に従ってインストールしてください。

インストール方法の詳細は[こちら](doc/INSTALL_jp.md)

## ステップ 1: Python のインストール

```
cd BeliefNest
pip install -e .
```

## ステップ 2: Node.js のインストール

```
cd belief_nest/env/mineflayer
npm install
```

## ステップ 3: Docker のインストール

Windows を使用している場合は、[Docker Docs](https://docs.docker.com/desktop/setup/install/windows-install/) からインストーラをダウンロードして実行してください。

## ステップ 4: Minecraft のインストール

[Minecraft Launcher](https://www.minecraft.net/)をインストールし，Minecraft: Java Edition（バージョン1.19）をプレイできるようにしてください．クライアントとして使用します．Java Edition のライセンスが必要です．

Minecraft Launcherの「起動構成」タブの「新規作成」から，バージョン1.19 を選択してください．

---

# 使用方法

## はじめに
RabbitMQ サーバ，Minecraftサーバ, mainプログラムの3つを異なるターミナルで起動します．

### RabbitMQ サーバの起動

Docker Desktop を使用している場合は、あらかじめアプリケーションを起動しておいてください。

```
docker run -it --rm --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:4.1-management
```

### Minecraft サーバの起動

[Minecraft公式サイト](https://www.minecraft.net/download/server) を参照してサーバを起動するか、以下のコマンドを使用して起動できます。

```
cd mc_server/flat
docker compose up -d
docker attach minecraft-server
```

「Singleplayer」モードの「Open to LAN」を使用することも可能ですが、最大8体のプレイヤーしかログインできないため、非常に小規模な実験しか実行できません。

Minecraftサーバのターミナルで `/op operator` を一度実行してください。異なるワールドを使用する場合を除き、複数回実行する必要はありません。

Minecraft クライアントを起動し、「Multiplayer」からワールドに参加してください。ワールドが表示されない場合は、「Add Server」で `localhost:25565` のようなサーバアドレスを指定してください。

---

### サンプルコードの実行

```
cd examples/sally_anne/
```

`api_key.py` に API キーの値を記入した後、以下のコマンドを実行してください。

```
python main.py
```

---

## 独自ワールドの使用

初期状態と設定ファイルを変更してください。

### 初期状態の作成

```
cd belief_nest/env/mineflayer/
node generate_init_state.js
mv state#-1.js /path/to/main_dir
```

---

## API

[doc/API.md](doc/API_jp.md) を参照してください。

---

# ライセンス

本プロジェクトはMITライセンスの下で公開しています．詳細はLICENSEファイルを参照してください．

本プロジェクトの一部には，[MineDojo/Voyager](https://github.com/MineDojo/Voyager)から改変したコードを含んでおり，こちらもMITライセンスの下で公開されています．

# 論文

```bibtex
@article{sagara2025beliefnest,
  title={####},
  author={Rikunari SAGARA, Koichiro TERAO, Naoto IWAHASHI},
  year={2025},
  journal={arXiv preprint arXiv: ####}
}
```
