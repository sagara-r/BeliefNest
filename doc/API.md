# API Reference

## Table of Contents

* [Class: BeliefNestWrapper](#class-beliefnestwrapper)

  * [BeliefNestWrapper()](#beliefnestwrapper)
  * [create\_sim()](#create_sim)
  * [remove\_sim()](#remove_sim)
  * [execute()](#execute)
  * [execute\_mc\_commands()](#execute_mc_commands)
  * [execute\_mc\_commands\_by\_admin()](#execute_mc_commands_by_admin)
  * [switch\_branch()](#switch_branch)
  * [overwrite\_belief()](#overwrite_belief)
  * [get\_branch\_str()](#get_branch_str)
  * [load\_from\_template()](#load_from_template)
  * [get\_sim\_status()](#get_sim_status)
  * [get\_offset()](#get_offset)
  * [close()](#close)
  * [\_start\_observation()](#_start_observation)
  * [\_stop\_observation()](#_stop_observation)
  * [\_dump\_observation()](#_dump_observation)
* [Config](#config)
* [Argument: belief\_path](#argument-belief_path)
* [Jinja2 Filters](#jinja2-filters)

---

## Class: BeliefNestWrapper

### BeliefNestWrapper

Constructor. Launches a JavaScript server connected to a Minecraft server and creates the real world. Observation is not started.

#### Parameters

| Name             | Type     | Default     | Description                                                                                   |
| ---------------- | -------- | ----------- | --------------------------------------------------------------------------------------------- |
| `config`         | `dict`   | (required)  | Dictionary specifying configuration. See [here](#config) for details.                         |
| `initial_state`  | `dict`   | (required)  | Dictionary describing the initial state, pre-generated using `generate_init_state.js`.        |
| `resume`         | `bool`   | `False`     | Whether to resume from a previous state. If `True`, `config` and `initial_state` are ignored. |
| `mf_server_host` | `str`    | `localhost` | Host of the JavaScript server.                                                                |
| `mf_server_port` | `int`    | `3000`      | Port of the JavaScript server.                                                                |
| `mc_host`        | `str`    | `localhost` | Host of the Minecraft server where the real world is created.                                 |
| `mc_port`        | `int`    | `25565`     | Port of the Minecraft server where the real world is created.                                 |
| `mq_host`        | `str`    | `localhost` | Host of the RabbitMQ server.                                 |
| `ckpt_dir`       | `str`    | `ckpt`      | Path to the checkpoint folder. Required if `resume=True`.                                     |
| `log_dir`        | `str`    | `logs`      | Path to the logs folder.                                                                      |
| `logger`         | `Logger` | `None`      | Logger instance.                                                                              |
| `log_level`      | `int`    | `20` (INFO) | Logging level.                                                                                |

---

### create\_sim

Creates a new simulator. Observation is not started.

#### Parameters

| Name            | Type        | Default    | Description                                                                                               |
| --------------- | ----------- | ---------- | --------------------------------------------------------------------------------------------------------- |
| `belief_path`   | `str`       | (required) | Parent simulator of the new simulator. See [here](#argument-belief_path) for details.                     |
| `agent_name`    | `str`       | (required) | Name of the agent that will own the new simulator.                                                        |
| `offset`        | `list[int]` | (required) | Offset of the simulator.                                                                                  |
| `player_prefix` | `str`       | (required) | Prefix assigned to the player. Simulators within the same Minecraft world must not share the same prefix. |
| `mc_host`       | `str`       | `None`     | Host of the Minecraft server where the simulator is created. If `None`, uses the same as the real world.  |
| `mc_port`       | `int`       | `None`     | Port of the Minecraft server where the simulator is created. If `None`, uses the same as the real world.  |

#### Returns

None

---

### remove\_sim

Deletes a simulator.

#### Parameters

| Name          | Type  | Default    | Description                                                             |
| ------------- | ----- | ---------- | ----------------------------------------------------------------------- |
| `belief_path` | `str` | (required) | Simulator to be deleted. See [here](#argument-belief_path) for details. |

#### Returns

None

---

### execute

Executes the JavaScript program that controls an agent. By default, starts and stops observation before and after execution.

#### Parameters

| Name                     | Type   | Default    | Description                                                               |
| ------------------------ | ------ | ---------- | ------------------------------------------------------------------------- |
| `belief_path`            | `str`  | (required) | Simulator containing the agent.                                           |
| `agent_name`             | `str`  | (required) | Name of the agent to be controlled.                                       |
| `code`                   | `str`  | (required) | Program to be executed.                                                   |
| `start_stop_observation` | `bool` | `True`     | Whether to automatically start and stop observation.                      |
| `wait_sec`               | `int`  | `4`        | Seconds to wait after execution. A short delay may miss the final action. |

#### Returns

| Type   | Description                        |
| ------ | ---------------------------------- |
| `bool` | Whether execution was successful.  |
| `str`  | Error message if execution failed. |

---

### execute\_mc\_commands

Executes Minecraft commands via the agent.

#### Parameters

| Name                     | Type   | Default      | Description                                          |                        |
| ------------------------ | ------ | ------------ | ---------------------------------------------------- | ---------------------- |
| `belief_path`            | `str`  | (required)   | Simulator containing the agent.                      |                        |
| `agent_name`             | `str`  | (required)   | Name of the agent.                                   |                        |
| `commands`               | \`str  | list\[str]\` | (required)                                           | Command(s) to execute. |
| `start_stop_observation` | `bool` | `True`       | Whether to automatically start and stop observation. |                        |
| `wait_sec`               | `int`  | `1`          | Wait time after execution.                           |                        |

#### Returns

None

---

### execute\_mc\_commands\_by\_admin

Executes Minecraft commands as the admin player.

#### Parameters

| Name          | Type  | Default      | Description                            |                        |
| ------------- | ----- | ------------ | -------------------------------------- | ---------------------- |
| `belief_path` | `str` | (required)   | Simulator containing the admin player. |                        |
| `commands`    | \`str | list\[str]\` | (required)                             | Command(s) to execute. |

#### Returns

None

---

### switch\_branch

Switches or creates a branch. If the branch exists, it switches to it; otherwise, it creates a new branch from the current one. The `follow` branch is a special branch that sets the simulator to follow mode. Branches with any other name will set the simulator to control mode.
<!--(See our [Paper]())-->

#### Parameters

| Name          | Type  | Default    | Description                               |
| ------------- | ----- | ---------- | ----------------------------------------- |
| `belief_path` | `str` | (required) | Simulator for which to switch the branch. |
| `branch_name` | `str` | (required) | Name of the target branch.                |

#### Returns

None

---

### overwrite\_belief
Overwrites the state of the simulator.

#### Parameters  
| Name         | Type            | Default Value | Description                             |
|--------------|------------------|----------------|------------------------------------------|
| `belief_path` | `str`            | (required)     | The simulator to be modified. See [this section](#argument-belief_path) for details. |
| `blocks`      | `list[dict]`     | `[]`           | Information about blocks to be modified. Provide a list of dictionaries with `position` and `name` as keys. For example: `[{"position": [0, -52, -10], "name": "gold_block"}]`. |
| `chests`      | `list[dict]`     | `[]`           | Information about chests to be modified. Provide a list of dictionaries with `position` and `items` as keys. For example: `[{"position": [-2, -51, -4], "items": {"iron_chestplate": 1}}]`. |

#### Returns  
| Type        | Description                             |
|-------------|------------------------------------------|
| `bool`      | Whether the operation was successful     |
| `str`       | Error message if the operation failed    |

---

### get\_branch\_str

Returns a string representing the branch.
Example: `world[default].anne[b]`

#### Parameters

| Name          | Type  | Default    | Description                                |
| ------------- | ----- | ---------- | ------------------------------------------ |
| `belief_path` | `str` | (required) | Simulator whose branch string is returned. |

#### Returns

| Type  | Description                   |
| ----- | ----------------------------- |
| `str` | Branch representation string. |

---

### load\_from\_template

Fills in belief information into a template and returns the resulting string.

#### Parameters

| Name          | Type   | Default    | Description                                                                    |
| ------------- | ------ | ---------- | ------------------------------------------------------------------------------ |
| `belief_path` | `str`  | (required) | Simulator providing the belief information. Assigned to the `branch` variable. |
| `template`    | `str`  | (required) | Jinja2 template string.                                                        |
| `variables`   | `dict` | `{}`       | Additional variables used in the template.                                     |

#### Returns

| Type  | Description                                       |
| ----- | ------------------------------------------------- |
| `str` | Rendered string with embedded belief information. |

---

### get\_sim\_status

Returns information about the simulator.

#### Parameters

| Name          | Type  | Default | Description                                                                                |
| ------------- | ----- | ------- | ------------------------------------------------------------------------------------------ |
| `belief_path` | `str` | `None`  | Simulator to retrieve information from. If `None`, returns information for all simulators. |

#### Returns

| Type         | Description                                            |
| ------------ | ------------------------------------------------------ |
| `list[dict]` | List of dictionaries containing simulator information. |

---

### get\_offset

Returns the offset of the simulator.

#### Parameters

| Name          | Type  | Default    | Description                            |
| ------------- | ----- | ---------- | -------------------------------------- |
| `belief_path` | `str` | (required) | Simulator to retrieve the offset from. |

#### Returns

| Type        | Description              |
| ----------- | ------------------------ |
| `list[int]` | Offset of the simulator. |

---

### close

Disconnects all players and stops the JavaScript server.

#### Parameters

| Name        | Type   | Default | Description                                      |
| ----------- | ------ | ------- | ------------------------------------------------ |
| `clear_env` | `bool` | `True`  | If `True`, deletes all blocks in all simulators. |

#### Returns

None

---

### \_start\_observation

Starts observation. Called before program execution in `execute()`.

#### Parameters

| Name          | Type  | Default    | Description                        |
| ------------- | ----- | ---------- | ---------------------------------- |
| `belief_path` | `str` | (required) | Simulator to start observation in. |

#### Returns

None

---

### \_stop\_observation

Stops observation. Called after program execution in `execute()`.

#### Parameters

| Name          | Type  | Default    | Description                       |
| ------------- | ----- | ---------- | --------------------------------- |
| `belief_path` | `str` | (required) | Simulator to stop observation in. |

#### Returns

None

---

### \_dump\_observation

Saves observation data. Called in `load_from_template()`.

#### Parameters

| Name          | Type   | Default    | Description                                                    |
| ------------- | ------ | ---------- | -------------------------------------------------------------- |
| `belief_path` | `str`  | (required) | Simulator to save observation data from.                       |
| `recursive`   | `bool` | `False`    | If `True`, also saves observations from descendant simulators. |

#### Returns

None

---

## Config

| Name               | Type              | Default    | Description                                                                                                                                       |
| ------------------ | ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `envBox`           | `list[list[int]]` | (required) | Coordinates of two opposite corners defining the 3D environment space. Format: `[[x1,y1,z1],[x2,y2,z2]]`. Must satisfy `x1<x2`, `y1<y2`, `z1<z2`. |
| `staticBlockTypes` | `list[str]`       | (required) | List of block types whose positions are known initially. Later modifications to these blocks are treated like any other block.                    |
| `adminAgentName`   | `str`             | (required) | Name of the admin player.                                                                                                                         |
| `canDigWhenMove`   | `bool`            | (required) | If `True`, agents are allowed to break blocks when moving.                                                                                        |
| `moveTimeoutSec`   | `int`             | (required) | Timeout duration (seconds) for agent movement.                                                                                                    |
| `players`          | `dict`            | (required) | Player information. See [below](#players).                                                                                                        |
| `observation`      | `dict`            | (required) | Observation-related options. See [below](#observation).                                                                                           |

### players

Specify the names and types of all participating agents. Types include `BotPlayer` for program-controlled and `HumanPlayer` for human-controlled players.

Example:

```json
"players": {
  "sally": {
    "type": "BotPlayer"
  },
  "anne": {
    "type": "HumanPlayer"
  }
}
```

### observation

| Name                       | Type   | Default | Description                                                                                             |
| -------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------- |
| `playerObsInterval`        | `int`  | `5`     | Interval for observing agent information, in ticks (1/20 sec).                                          |
| `blockObsInterval`         | `int`  | `10`    | Interval for observing block information, in ticks.                                                     |
| `maxVisibleDistance`       | `int`  | `20`    | Maximum distance agents can observe.                                                                    |
| `disablePositionFiltering` | `bool` | `False` | If `True`, all agent positions are shared among all agents.                                             |
| `useLegacyBlockVis`        | `bool` | `False` | If `True`, uses the older block visibility function. Slower but considers approximate shapes of blocks. |

---

## Argument: belief\_path

String that specifies a simulator using path notation.

| String         | Meaning                                          |
| -------------- | ------------------------------------------------ |
| `/`            | Real world                                       |
| `/anne/`       | Simulator owned by Anne in the real world        |
| `/anne/sally/` | Simulator owned by Sally within Anne's simulator |

---

## Jinja2 Filters

| Name                      | Description                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `position`                | Position of an agent. `position("sally")` returns Sally’s position. If no argument, returns the owner agent's position. |
| `thought`                 | Log of `think` primitive usage. Only for the simulator’s owner.                                                         |
| `chat_log`                | Log of all agents’ utterances.                                                                                          |
| `inventory`               | Agent’s inventory. Same usage as `position`.                                                                            |
| `equipment`               | Agent’s equipped items. Same usage as `position`.                                                                       |
| `helditem`                | Item currently held in hand. Same usage as `position`.                                                                  |
| `chests`                  | Information about chests (locations and contents).                                                                      |
| `other_players`           | Info about agents other than the owner (e.g., positions).                                                               |
| `blocks`                  | Locations of specified block types. `blocks(["chest", "lever"])` returns info on only those types.                      |
| `blocks_and_visibilities` | Adds visibility info to `blocks`. Optionally checks visibility from other agents.                                       |
| `block_property`          | Properties of blocks of a given type.                                                                                   |
| `events`                  | List of events.                                                                                                         |
| `events_and_visibilities` | List of events and whether they were observed. `"I"` refers to the owner unless overridden.                             |

### Example

```jinja2
Thought:
{{ branch | thought }}

Blocks seen so far:
{{ branch | blocks_and_visibilities(["chest", "lever"]) }}
```

Example output:

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
