# API Reference

## 目次

- [Class: BeliefNestWrapper](#class-beliefnestwrapper)
  - [BeliefNestWrapper()](#beliefnestwrapper)
  - [create_sim()](#create_sim)
  - [remove_sim()](#remove_sim)
  - [execute()](#execute)
  - [execute_mc_commands()](#execute_mc_commands)
  - [execute_mc_commands_by_admin()](#execute_mc_commands_by_admin)
  - [switch_branch()](#switch_branch)
  - [overwrite_belief()](#overwrite_belief)
  - [get_branch_str()](#get_branch_str)
  - [load_from_template()](#load_from_template)
  - [get_sim_status()](#get_sim_status)
  - [get_offset()](#get_offset)
  - [close()](#close)
  - [_start_observation()](#_start_observation)
  - [_stop_observation()](#_stop_observation)
  - [_dump_observation()](#_dump_observation)
- [Config](#config)
- [Argument: belief_path](#argument-belief_path)
- [Jinja2 Filters](#jinja2-filters)

----------------

## Class: BeliefNestWrapper

### BeliefNestWrapper
コンストラクタ．Minecraftサーバと接続するJavascriptサーバを起動し，Real worldを作成する．観測は開始されない．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `config`			| `dict`		| (required)       	| 設定を記述した辞書．詳細は[こちら](#config) |
| `initial_state`	| `dict`        | (required)      	| 初期状態を記述した辞書．generate_init_state.jsにより事前に作成． |
| `resume`			| `bool`		| `False`          	| 途中から再開するかどうか。Trueの場合，config, initial_stateは読み込まれない．|
| `mf_server_host`	| `str`         | `localhost`      	| Javascriptサーバのホスト．  |
| `mf_server_port`	| `int`         | `3000`      		| Javascriptサーバのポート番号．  |
| `mc_host`			| `str`         | `localhost`      	| Real worldを作成するMinecraftサーバのホスト．  |
| `mc_port`			| `int`         | `25565`      		| Real worldを作成するMinecraftサーバのポート番号．  |
| `mq_host`        | `str`    | `localhost` | RabbitMQサーバのホスト.                                 |
| `ckpt_dir`		| `str`         | `ckpt`     		| ckptフォルダのパス．resume=Trueの場合，存在するフォルダを指定する必要がある．  |
| `log_dir	`		| `str`         | `logs`      		| logsフォルダのパス．  |
| `logger`			| `Logger`      | `None`      		| ロガー．  |
| `log_level`		| `int`         | `20`(INFO)      	| ロガーで記録するレベル．  |

----------------

### create_sim
新たにシミュレータを作成する．観測は開始されない．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | 新たに作成するシミュレータの親シミュレータ．詳細は[こちら](#argument-belief_path)。|
| `agent_name`			| `str`			| (required)   | 新たにシミュレータを持つエージェント名．|
| `offset`				| `list[int]`   | (required)   | シミュレータのオフセット．|
| `player_prefix`		| `str`          | (required)  | プレイヤーが持つprefix．同じMinecraftワールド内では同一のprefixを指定するシミュレータは存在できない．|
| `mc_host`				| `str`          | `None`      | シミュレータ作成先のMinecraftサーバのホスト．`None`の場合、実世界と同じ  |
| `mc_port`				| `int`          | `None`      | シミュレータ作成先のMinecraftサーバのポート番号．`None`の場合、実世界と同じ  |

#### Returns
なし

----------------

### remove_sim
シミュレータを削除する．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | 削除するシミュレータ．詳細は[こちら](#argument-belief_path)。|

#### Returns
なし

----------------

### execute
エージェントを制御するJavascriptプログラムを実行する．デフォルトではプログラム実行前後に観測開始・停止処理を行う．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`				| `str`			| (required)   | 制御したいエージェントがいるシミュレータ．詳細は[こちら](#argument-belief_path)。|
| `agent_name`				| `str`			| (required)   | 制御したいエージェントの名前．|
| `code`					| `str`   		| (required)   | 実行するプログラム．|
| `start_stop_observation`	| `bool`        | `True`		| Trueの場合，プログラム実行前後に観測開始・停止処理を行う． |
| `wait_sec`				| `int`         | `4`  			| プログラム終了後に待機する秒数．短い場合，最後の行動が記録されないことがある．|


#### Returns
| 型            | 説明                             |
|----------------|----------------------------------|
| `bool`		| 実行に成功したかどうか|
| `str`			| 実行に失敗した場合のエラーメッセージ|

----------------

### execute_mc_commands
エージェントにMinecraftコマンドを実行させる．デフォルトではプログラム実行前後に観測開始・停止処理を行う．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | コマンドを実行させたいエージェントがいるシミュレータ．詳細は[こちら](#argument-belief_path)。|
| `agent_name`			| `str`			| (required)   | コマンドをじっこうさせたいエージェントの名前．|
| `commands`			| `str\|list[str]`   | (required)   | 実行するコマンド（のリスト）．|
| `start_stop_observation`	| `bool`        | `True`		| Trueの場合，プログラム実行前後に観測開始・停止処理を行う． |
| `wait_sec`				| `int`         | `1`  			| プログラム終了後に待機する秒数．短い場合，最後の行動が記録されないことがある．|

#### Returns
なし

----------------

### execute_mc_commands_by_admin
管理者プレイヤーにMinecraftコマンドを実行させる．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | コマンドを実行させたい管理者プレイヤーがいるシミュレータ．詳細は[こちら](#argument-belief_path)。|
| `commands`			| `str\|list[str]`   | (required)   | 実行するコマンド（のリスト）．|

#### Returns
なし

----------------

### switch_branch
ブランチの切り替え・作成を行う．各シミュレータでは時系列の分岐を作ることができ，その分岐をブランチと呼ぶ．ブランチが既に存在する場合，そのブランチに切り替える．ブランチが存在しない場合，現在のブランチを派生させた新しいブランチを作成する．`follow`ブランチはシミュレータをfollowモードにする特殊なブランチである．それ以外の名前のブランチでは，シミュレータはobserveモードとなる．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | ブランチを切り替えたいシミュレータ．詳細は[こちら](#argument-belief_path)。|
| `branch_name`			| `str`		| (required)   | 切り替え先のブランチ名．|

#### Returns
なし

----------------

### get_branch_str
ブランチを表す文字列を取得する．文字列の例として，Real worldのdefaultブランチの下にあるanneのシミュレータのbブランチは，以下のように表される．

`world[default].anne[b]`

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | ブランチを表す文字列を取得したいシミュレータ．詳細は[こちら](#argument-belief_path)。|

#### Returns
| 型            | 説明                             |
|----------------|----------------------------------|
| `str`			| ブランチを表す文字列|

----------------

### overwrite_belief
シミュレータの状態を上書きする．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | 上書きしたいシミュレータ．詳細は[こちら](#argument-belief_path)。|
| `blocks`			| `list[dict]`		| `[]`   | 変更したいブロックの情報．キーとして`position`と`name`を持つ辞書をリストで与える．例として`[{"position": [0, -52, -10], "name": "gold_block"}]`を与えることができる． |
| `chests`			| `list[dict]`		| `[]`   | 変更したいチェストの情報．キーとして`position`と`items`を持つ辞書をリストで与える．例として`[{"position": [-2, -51, -4], "items":{"iron_chestplate":1}}]`を与えることができる．|

#### Returns
| 型            | 説明                             |
|----------------|----------------------------------|
| `bool`		| 実行に成功したかどうか|
| `str`			| 実行に失敗した場合のエラーメッセージ|

----------------

### load_from_template
テンプレートを与えると，信念情報を埋め込んだ文字列を返す．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | 信念情報を取得するシミュレータ．`template`内の変数`branch`に代入される．詳細は[こちら](#argument-belief_path)。|
| `template`			| `str`		| (required)   | Jinja2形式のテンプレートの文字列．詳細は[こちら](#jinja2-filters)|
| `variables`			| `dict`	| `{}`		   | テンプレートで用いる追加の変数．|

#### Returns
| 型            | 説明                             |
|----------------|----------------------------------|
| `str`			| 信念情報を埋め込んだ文字列|

----------------

### get_sim_status
シミュレータの情報を返す．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| `None`   | 情報を取得するシミュレータ．詳細は[こちら](#argument-belief_path)。Noneの場合，全シミュレータの情報を返す．|

#### Returns
| 型            | 説明                             |
|----------------|----------------------------------|
| `list[dict]`	| シミュレータの情報を持つ辞書のリスト．|

----------------

### get_offset
シミュレータのオフセットを返す．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | オフセットを取得するシミュレータ．詳細は[こちら](#argument-belief_path)。|

#### Returns
| 型            | 説明                             |
|----------------|----------------------------------|
| `list[int]`	| シミュレータのオフセット．|

----------------

### close
全プレイヤーをワールドから退出させ，Javascriptサーバを停止する．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `clear_env`			| `bool`		| `True`   | Trueの場合，全シミュレータのブロックを削除する |

#### Returns
なし

----------------

### _start_observation
観測を開始する．execute()においてプログラム実行前に呼ばれる．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | 観測を開始するシミュレータ．詳細は[こちら](#argument-belief_path)。|

#### Returns
なし

----------------

### _stop_observation
観測を停止する．execute()においてプログラム実行後に呼ばれる．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | 観測を停止するシミュレータ．詳細は[こちら](#argument-belief_path)。|

#### Returns
なし

----------------

### _dump_observation
観測を保存する．load_from_template()において呼ばれる．

#### Parameters
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `belief_path`			| `str`		| (required)   | 観測を保存するシミュレータ．詳細は[こちら](#argument-belief_path)。|
| `recursive`			| `bool`		| `False`   | Trueの場合，その子孫シミュレータでも観測を保存する．|

#### Returns
なし

## Config
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `envBox`			| `list[list[int]]`		| (required)   | 環境の範囲を表す直方体の2頂点の座標．`[[x1,y1,z1],[x2,y2,z2]]`の形式で与える．x1<x2, y1<y2, z1<z2である必要がある．|
| `staticBlockTypes`		| `list[str]`	| (required)   | エージェントが初期知識として位置を知っているブロックの種類名．なおその後にこれらのブロックが配置・破壊された場合については他のブロックと同等に扱われる．|
| `adminAgentName`			| `str`			| (required)   | 管理者プレイヤーの名前．|
| `canDigWhenMove`			| `bool`		| (required)   | Trueの場合，エージェントが移動する際にブロックを破壊を許可する．|
| `moveTimeoutSec`			| `int`			| (required)   | エージェントの移動のタイムアウト秒数．|
| `players`					| `dict`		| (required)   | プレイヤー情報．[下記](#players)を参照．|
| `observation`				| `dict`		| (required)   | 観測に関するオプション．[下記](#observation)を参照．|

### players
参加する全てのエージェント名とプレイヤーの種類を指定．種類にはプログラム制御のBotPlayerと人間の直接制御のHumanPlayerがある．

例：
```
"players": {
	"sally": {
		"type": "BotPlayer"
	},
	"anne": {
		"type": "HumanPlayer"
	}
},
```

### observation
| 名前         | 型            | デフォルト値 | 説明                             |
|--------------|----------------|--------------|----------------------------------|
| `playerObsInterval`			| `int`		| `5`   | エージェント情報の観測インターバル．tick(1/20秒)数で指定．|
| `blockObsInterval`			| `int`		| `10`   | ブロック情報の観測インターバル．tick(1/20秒)数で指定．|
| `maxVisibleDistance`			| `int`		| `20`   |エージェントが観測可能な最大距離．|
| `disablePositionFiltering`	| `bool`	| `False`   | Trueの場合，エージェント位置が全エージェントに共有される．|
| `useLegacyBlockVis`			| `bool`		| `False`   | Trueの場合，旧バージョンのブロック観測関数が使用される．低速だが，大まかなブロックの形状を考慮する．|
<!--| `positionMemoryMode`			| `str`		| `last_seen`   | |-->

## Argument: belief_path
パス形式でシミュレータを指定する文字列．

| 文字列         | 意味            |
|--------------|----------------|
| `/`			| Real world		|
| `/anne/`			| Real world内のanneが持つシミュレータ	|
| `/anne/sally/`			| Real world内のanneが持つシミュレータ内のsallyが持つシミュレータ	|


## Jinja2 Filters

| 名前            | 説明                             |
|----------------|----------------------------------|
| `position`	| エージェントの位置．`position("sally")`でsallyの情報を取得．引数を指定しない場合，そのシミュレータの持ち主となるエージェントが対象．|
| `thought`	| thinkプリミティブの使用履歴．シミュレータの持ち主となるエージェントのみが対象．|
| `chat_log`	| 発言履歴．全エージェントの発言が出力される．|
| `inventory`	| エージェントのインベントリ情報．`inventory("sally")`でsallyの情報を取得．引数を指定しない場合，そのシミュレータの持ち主となるエージェントが対象．|
| `equipment`	| エージェントの装備情報．`equipment("sally")`でsallyの情報を取得．引数を指定しない場合，そのシミュレータの持ち主となるエージェントが対象．|
| `helditem`	| エージェントが手に持っているアイテムの情報．`helditem("sally")`でsallyの情報を取得．引数を指定しない場合，そのシミュレータの持ち主となるエージェントが対象．|
| `chests`	| チェスト情報．チェストの位置と中身を出力．|
| `other_players`	| シミュレータの持ち主以外のエージェントの情報．位置などの情報を出力．|
| `blocks`	| ブロックの情報．ブロックの種類ごとにどこに存在するかを出力．`blocks(["chest", "lever"])`で"chest", "lever"に関する情報のみを出力．|
| `blocks_and_visibilities`	| ブロックの情報とその視認情報．blocksの情報に加え，そのブロックをこれまでに見たか，今見えているか，を出力．`blocks_and_visibilities(["chest", "lever"])`で"chest", "lever"に関する情報のみを出力．`blocks_and_visibilities(["chest", "lever"], [other_branch_str, ...])`で他のエージェントから見えているかも同時に出力．branch_strについては[こちら](#get_branch_str)を参照．|
| `block_property`	| ブロックのプロパティ．引数にブロック名を指定すると，該当する全ブロックについて位置とプロパティが出力される．|
| `events`	| イベント一覧．|
| `events_and_visibilities`	| イベント一覧とその視認情報．eventsの情報に加え，そのイベントを自身が見たかを出力する．デフォルトではシミュレータの持ち主を"I"と表現するが，events_and_visibilities("sally")とすると"sally"が"I"で表現される．|


### 使用例
```
Thought:
{{ branch | thought }}

Blocks seen so far:
{{ branch | blocks_and_visibilities(["chest", "lever"]) }}
```

得られる文字列の例
```
Thought:
t=368   anne thought "Done."

Blocks seen so far:
chest visibilities:{
  "(-2, -51, -4)": {
    "Me": {
      "seen_before": true,
      "visible_now": true
    }
  },
  "(2, -51, -4)": {
    "Me": {
      "seen_before": true,
      "visible_now": true
    }
  }
}
lever visibilities:{
  "(0, -51, -4)": {
    "Me": {
      "seen_before": true,
      "visible_now": true
    }
  }
}
```


