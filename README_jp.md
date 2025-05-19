# BeliefNest: 心の理論を持つ身体化エージェントのための共同行為シミュレータ

<div align="center">

<!--[\[Arxiv\]]()-->

[![Python Version](https://img.shields.io/badge/Python-3.9-blue.svg)](https://github.com/sagara-r/BeliefNest)
[![GitHub license](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/sagara-r/BeliefNest/blob/main/LICENSE)

---

![](images/overview.png)

</div>

**BeliefNest** は、身体化エージェントが心の理論を活用して共同行為タスクを遂行することを可能にする、オープンソースシミュレータです。BeliefNestは Minecraft 環境内に動的かつ階層的にシミュレータを生成し、エージェント自身および他者の入れ子構造の信念状態を明示的に表現します。これによりオープンドメインタスクで心の理論を用いたエージェント制御を可能とします。本シミュレータは各信念に基づくプロンプト生成機構を備えており、大規模言語モデル(LLM)を活用したエージェント制御手法の設計・検証を可能とします。

このリポジトリでは BeliefNest のコードを公開しています。コードは [MITライセンス](LICENSE) のもとで提供されています。

---

# インストール方法

本ツールは Docker 内で完結して動作するため、Python や Node.js をローカルにセットアップする必要はありません。[こちら](https://github.com/sagara-r/BeliefNest/releases)から最新版をダウンロードしてください。動作確認は Windows 11 上で行っています。以下の手順に従ってインストールしてください。

## Docker のインストール

Windows を使用している場合は、[Docker Docs](https://docs.docker.com/desktop/setup/install/windows-install/) からインストーラをダウンロードして実行してください。

## Minecraft のインストール

[Minecraft Launcher](https://www.minecraft.net/)をインストールし，Minecraft: Java Edition（バージョン1.19）をプレイできるようにしてください．クライアントとして使用します．Java Edition のライセンスが必要です．

Minecraft Launcherの「起動構成」タブの「新規作成」から，バージョン1.19 を選択してください．

---

# 使用方法

## サンプル実行のための手順
RabbitMQ サーバ、Minecraftサーバ、mainプログラムの3つを異なるターミナルで起動します。

### RabbitMQ サーバの起動

あらかじめDocker Desktopを起動しておいてください。

ダウンロードした`BeliefNest-*.*.*`フォルダ内の`rabbitmq.bat`をダブルクリックして起動してください。

### Minecraft サーバの起動

`mc_server/flat`内の`mc_server.bat`をダブルクリックし、サーバを起動してください。

ターミナルに`Done (*.**s)! For help, type "help"`と表示されたら、ターミナルで `op operator` を一度実行してください。異なるワールドを使用する場合を除き、複数回実行する必要はありません。

Minecraft クライアントを起動し、「Multiplayer」からワールドに参加してください。ワールドが表示されない場合は、「Add Server」で `localhost:25565` のようなサーバアドレスを指定してください。

ワールドに参加したら、ターミナルで`op xxx`および`gamemode creative xxx`を実行してください。ただし`xxx`はあなたのユーザ名です。Minecraftの画面でスペースを素早く2回押すとスペースで上昇できるようになります。WASDおよびShiftで移動できます。

---

### サンプルコードの実行

[こちら](https://platform.openai.com/api-keys)からOpenAI API キーを発行してください。アカウントの作成が必要です。
`examples/sally_anne`内の`api_key.py` に取得したAPIキーの値を記入し、`main.bat`をダブルクリックして実行してください．

サンプルコード実行時のOpenAI APIの費用は0.1ドル以下です。

---

## 他のMinecraftワールドの使用

他のMinecraftワールドを使用することができます。別のフォルダに`mc_server/flat`フォルダの`docker-compose.yaml`および`mc_server.bat`をコピーし、コピーした`mc_server.bat`をダブルクリックして実行してください。

また、Windows上で実行しているMinecraftワールドに接続することも可能です。`BeliefNestWrapper`クラスのコンストラクタの`mqHost`に`host.docker.internal`を指定してください。ワールド内ではブロックが強制的に置き換えられますので、既存のワールドを使用する際には注意してください。

「Singleplayer」モードの「Open to LAN」を使用することも可能ですが、最大8体のプレイヤーしかログインできないため、非常に小規模な実験しか実行できません。

ワールド内に必要なブロックを配置したら、以下の方法で初期状態と設定ファイルを作成してください。

### 初期状態の作成

`belief_nest/env/mineflayer`内でコマンドプロンプトを起動し、以下を実行してください．
```
node generate_init_state.js
```

作成された`state#-1.js`を適当なフォルダに移動し，`main.py`から読み込んでください．

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
