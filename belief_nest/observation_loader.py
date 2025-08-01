import os
import re
import io
import json
import yaml
from bisect import bisect_left
import base64

from jinja2 import Environment, StrictUndefined, DebugUndefined
import numpy as np


loader = None
agent_names = None
    

class ObservationLoader:
    def __init__(self, ckpt_dir):
        self.ckpt_dir = ckpt_dir
        self.cache = {}

    def _cached_load(self, filepath, filetype):
        if filepath in self.cache:
            return self.cache[filepath]

        # Actually open the file and parse its content
        with open(filepath, "r", encoding="utf-8") as f:
            if filetype == "yaml":
                obj = yaml.safe_load(f)
            elif filetype == "json":
                obj = json.load(f)
            else:
                raise ValueError(f"Unsupported filetype: {filetype}")

        # Save the parsed object to the cache
        self.cache[filepath] = obj
        return obj

    def parse_source_str(self, branch_str):
        branches = branch_str.split(".")
        branch_ckpt_dir = os.path.join(self.ckpt_dir, *branches)

        return branch_ckpt_dir

    def get_latest_state(self, branch_str):
        branch_ckpt_dir = self.parse_source_str(branch_str)
        assert os.path.exists(branch_ckpt_dir), f"Directory {branch_ckpt_dir} does not exist."

        file_info = get_obs_file_info(branch_ckpt_dir, "state", "new")
        if not file_info["filename"]:
            raise Exception(f"No state data found.")

        # Read and parse state file
        state = self._cached_load(os.path.join(branch_ckpt_dir, file_info["filename"]), "json")

        return state, file_info["tick"]

    def get_state(self, branch_str, tick):
        branch_ckpt_dir = self.parse_source_str(branch_str)
        assert os.path.exists(branch_ckpt_dir), f"Directory {branch_ckpt_dir} does not exist."

        file_info_list = get_obs_file_info(branch_ckpt_dir, "state", "list")
        if not len(file_info_list):
            raise Exception(f"No state data found.")
        
        for file_info in file_info_list:
            if file_info["tick"] == tick:
                # Read and parse state file
                state = self._cached_load(os.path.join(branch_ckpt_dir, file_info["filename"]), "yaml")
                return state, tick
                
        raise Exception(f"No state data found at tick '{tick}'.")

    def get_latest_history(self, branch_str):
        branch_ckpt_dir = self.parse_source_str(branch_str)
        assert os.path.exists(branch_ckpt_dir), f"Directory {branch_ckpt_dir} does not exist."

        file_info = get_obs_file_info(branch_ckpt_dir, "history", "new")
        if not file_info["filename"]:
            raise Exception(f"No history data found. Observation must be performed to load it.")

        # Read and parse history file
        history = self._cached_load(os.path.join(branch_ckpt_dir, file_info["filename"]), "json")

        latest_key = sorted(map(int, history["__SortedMap__"].keys()))[-1]
        latest_history = history["__SortedMap__"][str(latest_key)]

        return latest_history, latest_key

    def get_previous_history(self, branch_str, now_tick):
        branch_ckpt_dir = self.parse_source_str(branch_str)
        assert os.path.exists(branch_ckpt_dir), f"Directory {branch_ckpt_dir} does not exist."

        file_info_list = get_obs_file_info(branch_ckpt_dir, "history", "list")
        if not len(file_info_list):
            raise Exception(f"No history data found. Observation must be performed to load it.")
        
        def get_last_min_index(f_idx):
            file_info = file_info_list[f_idx]
            # Read and parse history file
            history = self._cached_load(os.path.join(branch_ckpt_dir, file_info["filename"]), "json")

            f_ticks = sorted(map(int, history["__SortedMap__"].keys()))
            # Find the last index where value < now_tick
            idx = bisect_left(f_ticks, now_tick) - 1
            if idx < 0:
                return None, None

            tick = f_ticks[idx]
            return history, tick
        
        ticks = list(map(lambda file_info: file_info["tick"], file_info_list))
        file_idx = bisect_left(ticks, now_tick - 1)
        
        history, tick = get_last_min_index(file_idx)
        if history is None:  # if now_tick is the first tick of selected history file
            if file_idx == 0:  # if there is no previous history file
                return None, None
            history, tick = get_last_min_index(file_idx - 1)  # search from previous history file

        return history["__SortedMap__"][str(tick)], tick

    def get_history(self, branch_str, tick):
        branch_ckpt_dir = self.parse_source_str(branch_str)
        assert os.path.exists(branch_ckpt_dir), f"Directory {branch_ckpt_dir} does not exist."

        file_info_list = get_obs_file_info(branch_ckpt_dir, "history", "list")
        if not len(file_info_list):
            return None, tick

        ticks = list(map(lambda file_info: file_info["tick"], file_info_list))
        idx = bisect_left(ticks, tick)

        file_info = file_info_list[idx]
        # Read and parse history file
        history = self._cached_load(os.path.join(branch_ckpt_dir, file_info["filename"]), "json")
        if str(tick) in history["__SortedMap__"]:
            return history["__SortedMap__"][str(tick)], tick
                
        return None, tick

class Vec3BoolMap:
    def __init__(self, range_):
        self.range = (np.array(range_[0]), np.array(range_[1]))
        self.size = self.range[1] - self.range[0] + 1
        total_size = int(np.prod(self.size))
        self.data = np.zeros(total_size, dtype=bool)

    def _is_within_range(self, vec: np.ndarray) -> bool:
        return np.all(vec >= self.range[0]) and np.all(vec <= self.range[1])

    def _to_index(self, vec: np.ndarray) -> int:
        rel = vec - self.range[0]
        return int(rel[0] + self.size[0] * (rel[1] + self.size[1] * rel[2]))

    def from_base64(self, base64_str: str):
        byte_array = base64.b64decode(base64_str)
        binary_str = ''.join(f'{byte:08b}' for byte in byte_array)
        total_size = int(np.prod(self.size))
        self.data = np.array([bit == '1' for bit in binary_str[:total_size]], dtype=bool)

    def has(self, vec: np.ndarray) -> bool:
        if not self._is_within_range(vec):
            return False
        return bool(self.data[self._to_index(vec)])


def get_obs_file_info(branch_ckpt_dir, type_, mode):
    files = os.listdir(branch_ckpt_dir)
    regex = re.compile(rf"^{re.escape(type_)}#(-?\d+)\.json$")
    
    result = []
    for file in files:
        match = regex.match(file)
        if match:
            result.append({
                "filename": file,
                "tick": int(match.group(1))
            })
    
    result.sort(key=lambda x: x["tick"])
    
    if len(result) == 0 and mode != "list":
        return {"filename": None, "tick": None}
    
    if mode == "list":
        return result  # [{'filename': ..., 'tick': ...}, ...]
    elif mode == "new":
        return result[-1] if result else None  # {'filename': ..., 'tick': ...}
    elif mode == "old":
        return result[0] if result else None  # {'filename': ..., 'tick': ...}
    

def get_main_agent_name(branch_str):
    main_agent_name = branch_str.split(".")[-1].split("[")[0]
    if main_agent_name == "world":
        raise Exception("Cannot get main_agent_name of world.")
    return main_agent_name


def can_agent_see_block(branch_str, block_pos, tick=None):
    if tick is not None:
        history_at_tick, t = loader.get_history(branch_str, tick)
    else:
        history_at_tick, t = loader.get_latest_history(branch_str)

    while True:
        if "visibility" not in history_at_tick:
            raise Exception(f"No visibility data found in branch '{branch_str}' at tick '{t}'. Visibility is not recorded in non-'follow' branches.")

        if "blocks" in history_at_tick["visibility"]:
            break
        history_at_tick, t = loader.get_previous_history(branch_str, t)
        if history_at_tick is None:
            raise Exception(f'Failed to get history of block visibility in branch "{branch_str}".')

    try:
        block_vis = history_at_tick["visibility"]["blocks"]
        vec3boolmap = Vec3BoolMap(
            (np.array(block_vis["__Vec3BoolMap__"]["range"][0]["__Vec3__"]),
             np.array(block_vis["__Vec3BoolMap__"]["range"][1]["__Vec3__"]))
        )
        vec3boolmap.from_base64(block_vis["__Vec3BoolMap__"]["base64"])
        return vec3boolmap.has(np.array(block_pos))
    except:
        raise Exception(f'Cannot get block visibility data in branch "{branch_str}" at tick "{t}".')


def get_last_seen_block_info(branch_str, block_pos):
    state, _ = loader.get_latest_state(branch_str)

    block_pos_arr = np.array(block_pos)

    for block in state["blocks"]["__Vec3Map__"]:
        if np.sum(np.abs(block_pos_arr - np.array(block["position"]))) == 0:
            return block
            
    return None

#### FILTER DIFINITION ####

def position(branch_str, agent_name=None, ignore_last_seen=True):
    latest_state, _ = loader.get_latest_state(branch_str)
    main_agent_name = get_main_agent_name(branch_str)
    if agent_name is None:
        agent_name = main_agent_name

    try:
        if agent_name != main_agent_name and ignore_last_seen:
            history_at_tick, _  = loader.get_latest_history(branch_str)
            if 'visibility' in history_at_tick:
                can_see_agent = history_at_tick['visibility']['players'][agent_name]
                if not can_see_agent:
                    return "Cannot be seen"
        
        return latest_state["status"][agent_name]["visible"]["position"]["__Vec3__"]
    except:
        return "No data"
    
def thought(branch_str):
    latest_state, _ = loader.get_latest_state(branch_str)
    string = ""
    for tick, events in latest_state["events"].items():
        for e in events:
            if e["eventName"] != "think":
                continue
            if "hidden" not in e:
                continue
            string += f't={tick}   {e["agentName"]} thought "{e["hidden"]["msg"]}"\n'

    if not string:
        string = "No thought"

    return string

def chat_log(branch_str):
    latest_state, _ = loader.get_latest_state(branch_str)
    string = ""
    for tick, events in latest_state["events"].items():
        for e in events:
            if e["eventName"] != "chat":
                continue
            string += f't={tick}   {e["visible"]["agentName"]} said "{e["visible"]["msg"]}"\n'

    if not string:
        string = "No chats"

    return string

def inventory(branch_str, agent_name=None):
    latest_state, _ = loader.get_latest_state(branch_str)
    if agent_name is None:
        agent_name = get_main_agent_name(branch_str)

    try:
        inv = latest_state["status"][agent_name]["hidden"]["inventory"]
        if inv:
            return str(inv)
        return "Empty"
    except:
        return "No data"
    
def equipment(branch_str, agent_name=None):
    latest_state, _ = loader.get_latest_state(branch_str)
    if agent_name is None:
        agent_name = get_main_agent_name(branch_str)

    try:
        eq = latest_state["status"][agent_name]["visible"]["equipment"]
        if eq:
            return str(eq)
        return "Empty"
    except:
        return "No data"
    
def helditem(branch_str, agent_name=None):
    latest_state, _ = loader.get_latest_state(branch_str)
    if agent_name is None:
        agent_name = get_main_agent_name(branch_str)

    try:
        return latest_state["status"][agent_name]["visible"]["equipment"][4]
    except:
        return "No data"

def chests(branch_str):
    latest_state, _ = loader.get_latest_state(branch_str)
    chests = {}
    for dic in latest_state["containers"]["__Vec3Map__"]:
        pos = tuple(dic["position"])
        chests[pos] = {}
        for name in dic:
            if name == "position":
                continue
            chests[pos][name] = dic[name]
        
    string = ""
    for pos, c in chests.items():
        string += f"{pos}: {c}\n"

    return string


def other_players(branch_str):
    latest_state, _ = loader.get_latest_state(branch_str)
    main_agent_name = get_main_agent_name(branch_str)

    dic = {}
    for agent_name in latest_state["status"]:
        if agent_name == main_agent_name:
            continue
        dic[agent_name] = {}
        dic[agent_name]["position"] = position(branch_str, agent_name=agent_name)
        dic[agent_name]["helditem"] = helditem(branch_str, agent_name=agent_name)
        dic[agent_name]["inventory"] = inventory(branch_str, agent_name=agent_name)

    return json.dumps(dic, ensure_ascii=False, indent=2)


def blocks(branch_str, block_names=None):
    latest_state, _ = loader.get_latest_state(branch_str)
    all_blocks = latest_state["blocks"]["__Vec3Map__"]

    if block_names is None:
        block_names = list(set(map(lambda b:b['name'], all_blocks)))
    
    string = ""
    for name in block_names:
        string += f'{name}:\n'
        pos_list = []
        for b in all_blocks:
            if b["name"] != name:
                continue
            pos = tuple(b["position"])
            pos_list.append(pos)

        if len(pos_list) > 0:
            string += '\n'.join(map(str,pos_list)) + "\n"
        else:
            string += "Not observed\n"

    return string

def blocks_and_visibilities(branch_str, block_names=None, other_branch_str_list=[]):
    assert isinstance(other_branch_str_list, list)

    latest_state, _ = loader.get_latest_state(branch_str)
    all_blocks = latest_state["blocks"]["__Vec3Map__"]

    if block_names is None:
        block_names = list(set(map(lambda b:b['name'], all_blocks)))
    
    string = ""
    for name in block_names:
        string += f'{name} visibilities:'

        info = {}
        for b in all_blocks:
            if b["name"] != name:
                continue
            pos = tuple(b["position"])
            pos_str = str(pos)
            info[pos_str] = {}
            block_info_from_me = get_last_seen_block_info(branch_str, pos)
            info[pos_str]["Me"] = {
                "seen_before": (block_info_from_me is not None),
                "visible_now": can_agent_see_block(branch_str, pos)
            }

            for other_branch_str in other_branch_str_list:
                agent_name = get_main_agent_name(other_branch_str)
                block_info = get_last_seen_block_info(other_branch_str, pos)
                info[pos_str][f"{agent_name} from me"] = {
                    "seen_before": (block_info is not None and block_info["name"] == block_info_from_me["name"]),
                    "visible_now": can_agent_see_block(other_branch_str, pos)
                }

        if len(info) > 0:
            string += json.dumps(info, indent=2) + "\n"
        else:
            string += " Not observed\n"

    return string


def block_property(branch_str, block_name):
    assert isinstance(block_name, str)
    latest_state, _ = loader.get_latest_state(branch_str)
    all_blocks = latest_state["blocks"]["__Vec3Map__"]

    string = ""
    for b in all_blocks:
        if b["name"] != block_name:
            continue
        props = b.get("properties", {})
        string += f"{b['position']} : {json.dumps(props)}\n"

    return string

def _event_to_description(e):
    event_name = e['eventName']
    if event_name == "depositItemIntoChest":
        chest_pos = e['visible']['chestPos']['__Vec3__']
        description = f"chest:{tuple(chest_pos)} & items:{e['visible']['depositedItems']}"
    elif event_name == "getItemFromChest":
        chest_pos = e['visible']['chestPos']['__Vec3__']
        description = f"chest:{tuple(chest_pos)} & items:{e['visible']['gotItems']}"
    elif event_name == "chat":
        description = f"said \"{e['visible']['msg']}\""
    elif event_name == "moveTo":
        start_pos = e['visible']['startPos']['__Vec3__']
        goal_pos = e['visible']['goalPos']['__Vec3__']
        description = f"From {tuple(start_pos)} To {tuple(goal_pos)}"
    elif event_name == "craftItem":
        description = f"Crafted {e['visible']['producedCount']} {e['visible']['itemName']}(s)"
    elif event_name == "mineBlock":
        pos = e['visible']['pos']['__Vec3__']
        description = f"Mined 1 {e['visible']['blockName']} at {tuple(pos)}"
    elif event_name == "smeltItem":
        description = f"Smelted {e['visible']['materialName']} into {e['visible']['producedCount']} {e['visible']['producedItemName']}(s)"
    elif event_name == "think":
        description = f"thought that \"{e['hidden']['msg']}\""
    elif event_name == "useLever":
        type_ = e['visible']['type']
        lever_pos = e['visible']['leverPos']['__Vec3__']
        description = f"{type_} the lever at {tuple(lever_pos)}"
    elif event_name == "giveItemToOther":
        other_agent_name = e['visible']['otherAgentName']
        item_name = e['visible']['itemName']
        count = e['visible']['count']
        description = f"gave {count} {item_name} to {other_agent_name}"
    elif event_name == "receiveItemFromOther":
        other_agent_name = e['visible']['otherAgentName']
        item_name = e['visible']['itemName']
        count = e['visible']['count']
        description = f"received {count} {item_name} from {other_agent_name}"
    #elif event_name == "emote":
    #    description = e['visible']['description']
    #elif event_name == "blockUpdate":
    #    description = ""
    else:
        raise Exception(f"Unknown event '{event_name}'.")
    
    return description

def events(branch_str):
    latest_state, _ = loader.get_latest_state(branch_str)
    string = "time;action;agent_name;description\n"
    for tick, events_at_tick in latest_state["events"].items():
        for e in events_at_tick:
            event_name = e['eventName']
            if event_name in ["think", "blockUpdate"]:
                continue
            if event_name == "chat":
                agent_name = e["visible"]["agentName"]
            else:
                agent_name = e["agentName"]
            description = _event_to_description(e)
            string += f'{tick};{event_name};{agent_name};{description}\n'

    return string

def events_and_visibilities(branch_str, agent_name_i_have=None):
    latest_state, _ = loader.get_latest_state(branch_str)
    if not agent_name_i_have:
        agent_name_i_have = get_main_agent_name(branch_str)

    see_agent_name = get_main_agent_name(branch_str)
    
    visibility = {}
    event_info_list = []
    for tick, events_at_tick in latest_state["events"].items():
        tick = int(tick)
        for e in events_at_tick:
            event_name = e['eventName']
            if event_name in ["think", "blockUpdate"]:
                continue

            if event_name == "chat":
                agent_name = e["visible"]["agentName"]
            else:
                agent_name = e["agentName"]

            description = _event_to_description(e)

            event_info_list.append({
                "tick": tick,
                "agent_name": agent_name,
                "event_name": event_name,
                "description": description
            })

        visibility[tick] = {}
        history_at_tick, _  = loader.get_history(branch_str, tick)
        for saw_agent_name in agent_names:
            if 'visibility' not in history_at_tick:
                visibility[tick][saw_agent_name] = "####"
            elif saw_agent_name == see_agent_name:
                visibility[tick][saw_agent_name] = True
            else:
                visibility[tick][saw_agent_name] = history_at_tick['visibility']['players'][saw_agent_name]

    string = "time"
    for saw_agent_name in agent_names:
        s1 = "I" if see_agent_name == agent_name_i_have else see_agent_name
        s2 = "me" if saw_agent_name == agent_name_i_have else saw_agent_name
        s3 = "My" if saw_agent_name == agent_name_i_have else f"{saw_agent_name}'s"

        string += f";can_{s1}_see_{s2}"
        string += f";{s3}_action_{s1}_can_recognize"
        string += f";{s3}_action_description"
    string += "\n"

    for event_info in event_info_list:
        tick = event_info["tick"]
        string += str(tick)
        for saw_agent_name in agent_names:
            string += ";" + str(visibility[tick][saw_agent_name])
            if event_info["agent_name"] == saw_agent_name:
                string += f";{event_info['event_name']};{event_info['description']}"
            else:
                string += ";none;"                

        string += "\n"

    return string

FILTERS = [
    position,
    thought,
    chat_log,
    inventory,
    equipment,
    helditem,
    chests,
    other_players,
    blocks,
    blocks_and_visibilities,
    block_property,
    events,
    events_and_visibilities,
]

FILTER_DICT = {f.__name__: f for f in FILTERS}

#### END FILTER DIFINITION ####

def initialize_observation_loader(ckpt_dir, t_agent_names):
    global loader, agent_names
    loader = ObservationLoader(ckpt_dir)
    agent_names = t_agent_names

def get_loader():
    if not loader:
        raise Exception("Call `initialize_observation_loader` before calling `get_loader`.")
    return loader

def get_agent_names():
    if not agent_names:
        raise Exception("Call `initialize_observation_loader` before calling `get_agent_names`.")
    return agent_names

def load_from_template(template, variables={}, extra_filters=[], allow_filter_override=False):
    if not loader:
        raise Exception("Call `initialize_observation_loader` before calling `load_from_template`.")

    env = Environment(
            undefined=StrictUndefined,
            trim_blocks=True,
            lstrip_blocks=True
        )
    
    extra_filter_dict = {f.__name__: f for f in extra_filters}

    if not allow_filter_override:
        overridden_keys = set(FILTER_DICT.keys()) & set(extra_filter_dict.keys())
        if overridden_keys:
            raise Exception(f"Cannot override filters. Set allow_filter_override=True to override filters. Overriden: {', '.join(overridden_keys)}")

    env.filters = dict(
            **FILTER_DICT,
            **extra_filter_dict
        )
    template = env.from_string(template)
    rendered_content = template.render(variables)

    return rendered_content
