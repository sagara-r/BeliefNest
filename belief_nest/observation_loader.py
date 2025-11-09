import os
import re
import io
import json
import yaml
from bisect import bisect_left
import base64
from pathlib import Path
import copy
import time

from jinja2 import Environment, StrictUndefined, DebugUndefined
import numpy as np


loader = None
agent_names = None
    

class ObservationLoader:
    def __init__(self, ckpt_dir):
        self.ckpt_dir = ckpt_dir
        self.cache = {}
        self.dir_cache = {}
        self.exist_cache = {}

        self.statecache = {}

    def _cached_load(self, filepath, filetype, deepcopy=False):
        if filepath in self.cache:
            if deepcopy:
                return copy.deepcopy(self.cache[filepath])
            else:
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
    
    def _cached_listdir(self, branch_ckpt_dir, valid_ms=2000):
        if branch_ckpt_dir in self.dir_cache:
            now = time.perf_counter()
            if now - self.dir_cache[branch_ckpt_dir]["time"] < valid_ms:
                return self.dir_cache[branch_ckpt_dir]["files"]
        
        files = os.listdir(branch_ckpt_dir)
        self.dir_cache[branch_ckpt_dir] = {
            "time": time.perf_counter(),
            "files": files,
        }
        return files
    
    def _cached_exists(self, path, valid_ms=2000, check_if_false=False):
        if path in self.cache:
            return True
        
        if path in self.exist_cache:
            now = time.perf_counter()
            if now - self.exist_cache[path]["time"] < valid_ms:
                exist = self.exist_cache[path]["exist"]
                if not check_if_false or exist:
                    return exist
            
        exist = Path(path).exists()
        self.exist_cache[path] = {
            "time": time.perf_counter(),
            "exist": exist,
        }
        return exist

    def parse_source_str(self, branch_str):
        dirs = branch_str.split(".")
        branch_ckpt_dir = os.path.join(self.ckpt_dir, *dirs)

        return branch_ckpt_dir
    
    def find_base_ckpt_dir(self, branch_str):
        dirs = branch_str.split(".")

        base_ckpt_dir = None
        agent_list = None
        for idx in range(len(dirs)-1):
            ckpt_dir = os.path.join(self.ckpt_dir, *dirs[:idx+1])
            if self._cached_exists(ckpt_dir):
                base_ckpt_dir = ckpt_dir
            else:
                agent_list = []
                for elem in dirs[idx:]:
                    tmp = elem.split("[")
                    agent_name = tmp[0] # sally[follow] -> sally
                    branch_name = tmp[1].split("]")[0] # sally[follow] -> follow
                    
                    assert branch_name == "follow"
                    if agent_name not in agent_list:
                        agent_list.append(agent_name)

                break

        assert base_ckpt_dir is not None and agent_list is not None

        return base_ckpt_dir, agent_list
    
    def _get_internal_latest_state(self, branch_str, base_ckpt_dir, agent_list):
        assert len(agent_list) >= 1
        internal_ckpt_dir = str(Path(base_ckpt_dir) / ".internal")

        if len(agent_list) == 1:
            file_info = get_obs_file_info(internal_ckpt_dir, "state", "new", agent_name=agent_list[0])
            state = self._cached_load(os.path.join(internal_ckpt_dir, file_info["filename"]), "json")
            return state, file_info["tick"]
        
        # load history files
        obj_history_files = get_obs_file_info(base_ckpt_dir, "history", "list")
        
        # initialize state
        agent_list_key = tuple(agent_list)
        if agent_list_key in self.statecache:
            start_tick = sorted(self.statecache[agent_list_key].keys())[-1]
            state = self.statecache[agent_list_key][start_tick]

            if obj_history_files[-1]["tick"] == start_tick:
                return state, start_tick
            
            state = copy.deepcopy(state)
            obj_state = copy.deepcopy(self.statecache["OBJ"][start_tick])
        else:
            init_file_info = get_obs_file_info(internal_ckpt_dir, "state", "old", agent_name=agent_list[0])
            state = self._cached_load(os.path.join(internal_ckpt_dir, init_file_info["filename"]), "json", deepcopy=True)
            state["containers"] = {}
            start_tick = init_file_info["tick"]

            init_file_info = get_obs_file_info(base_ckpt_dir, "state", "old")
            obj_state = self._cached_load(os.path.join(base_ckpt_dir, init_file_info["filename"]), "json", deepcopy=True)

        obj_block_state_map = Vec3Map(obj_state["blocks"])

        tick = start_tick
        for obj_history_file in obj_history_files:
            obj_filename = obj_history_file["filename"]
            obj_file_tick = obj_history_file["tick"]
            if obj_file_tick <= start_tick:
                continue

            obj_history = self._cached_load(str(Path(base_ckpt_dir).joinpath(obj_filename)), "json")
            
            for key in obj_history["__SortedMap__"]:
                tick = int(key)
                if tick <= start_tick:
                    continue

                for e in obj_history["__SortedMap__"][key]["events"]:
                    if e["eventName"] == "blockUpdate":
                        obj_block_state_map.set(e["blockPos"], copy.deepcopy(e["visible"]))

                filtered_history, _ = self._get_internal_history(branch_str, base_ckpt_dir, agent_list, tick)

                block_vis = filtered_history["visibility"]["blocks"]
                block_visibility_from_agent = Vec3BoolMap(
                    (np.array(block_vis["__Vec3BoolMap__"]["range"][0]["__Vec3__"]),
                    np.array(block_vis["__Vec3BoolMap__"]["range"][1]["__Vec3__"]))
                )
                block_visibility_from_agent.from_base64(block_vis["__Vec3BoolMap__"]["base64"])

                update_state(tick, state, filtered_history, obj_block_state_map, agent_list)

        obj_state["blocks"] = obj_block_state_map.to_dict()

        # save cache
        self.statecache.setdefault(tuple(agent_list), {})
        self.statecache[tuple(agent_list)][tick] = state

        self.statecache.setdefault("OBJ", {})
        self.statecache["OBJ"][tick] = obj_state

        return state, tick
    
    def _get_internal_latest_history(self, branch_str, base_ckpt_dir, agent_list):
        return self._get_internal_history(branch_str, base_ckpt_dir, agent_list, tick=None)
    
    def _get_internal_history(self, branch_str, base_ckpt_dir, agent_list, tick=None):
        assert len(agent_list) >=1
        internal_ckpt_dir = str(Path(base_ckpt_dir) / ".internal")

        file_info_list = get_obs_file_info(internal_ckpt_dir, "history", "list", agent_name=agent_list[0])
        if not len(file_info_list):
            return None, tick

        if tick is None:
            file_info = file_info_list[-1]
            history = self._cached_load(os.path.join(internal_ckpt_dir, file_info["filename"]), "json")
            sorted_ticks = sorted(map(int, history["__SortedMap__"].keys()))
            tick = sorted_ticks[-1]
        else:
            ticks = list(map(lambda file_info: file_info["tick"], file_info_list))
            idx = bisect_left(ticks, tick)

            file_info = file_info_list[idx]
            # Read and parse history file
            history = self._cached_load(os.path.join(internal_ckpt_dir, file_info["filename"]), "json")
            
            if str(tick) not in history["__SortedMap__"]:
                return None, tick
        
        history_at_tick = history["__SortedMap__"][str(tick)]
        assert "visibility" in history_at_tick, f"Error tick={tick}, keys()={list(history_at_tick.keys())}, status={history_at_tick['status']}"

        if len(agent_list) == 1:
            return history_at_tick, tick
        
        def history2blockvis(history_at_tick, tick, agent_name):
            assert "visibility" in history_at_tick, f"Error agent_name={agent_name}, tick={tick}, keys()={list(history_at_tick.keys())}, agent_list={agent_list}, status={history_at_tick['status']}"
            if "blocks" not in history_at_tick["visibility"]:
                history_at_tick, _ = self.get_previous_block_vis(branch_str, tick)

            tmp = history_at_tick["visibility"]["blocks"]["__Vec3BoolMap__"]
            block_vis = Vec3BoolMap(
                (tmp["range"][0]["__Vec3__"], 
                tmp["range"][1]["__Vec3__"])
            )
            block_vis.from_base64(tmp["base64"])
            return block_vis
        
        player_vis = history_at_tick["visibility"]["players"]
        player_vis[agent_list[0]] = True
        block_vis = history2blockvis(history_at_tick, tick, agent_list[0])
        for see_agent in agent_list[1:]:
            see_agent_history_at_tick, _ = self._get_internal_history(branch_str, base_ckpt_dir, [see_agent], tick=tick)
            see_agent_block_vis = history2blockvis(see_agent_history_at_tick, tick, see_agent)

            block_vis = block_vis.intersection(see_agent_block_vis)

            see_agent_player_vis = see_agent_history_at_tick["visibility"]["players"]
            see_agent_player_vis[see_agent] = True
            for agent in player_vis:
                if not player_vis[agent] or not see_agent_player_vis[agent]:
                    player_vis[agent] = False

        status = filter_status(history_at_tick["status"], see_agent, player_vis)
        events = filter_events(history_at_tick["events"], see_agent, player_vis, block_vis)
        history_at_tick = { 
            "status": status,
            "events": events,
            "visibility": {
                "players": player_vis,
                "blocks": {
                    "__Vec3BoolMap__": {
                        "range": [
                            {"__Vec3__": list(block_vis.range[0])},
                            {"__Vec3__": list(block_vis.range[1])},
                        ],
                        "base64": block_vis.to_base64()
                    }
                },
            },
        }

        return history_at_tick, tick


    def get_latest_state(self, branch_str):
        branch_ckpt_dir = self.parse_source_str(branch_str)

        if self._cached_exists(branch_ckpt_dir):
            file_info = get_obs_file_info(branch_ckpt_dir, "state", "new")
            if not file_info["filename"]:
                raise Exception(f"No state data found.")

            # Read and parse state file
            state = self._cached_load(os.path.join(branch_ckpt_dir, file_info["filename"]), "json")

            return state, file_info["tick"]
        
        else:
            base_ckpt_dir, agent_list = self.find_base_ckpt_dir(branch_str)
            state, tick = self._get_internal_latest_state(branch_str, base_ckpt_dir, agent_list)
            return state, tick


    def get_state(self, branch_str, tick):
        branch_ckpt_dir = self.parse_source_str(branch_str)

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
        
        if self._cached_exists(branch_ckpt_dir):
            file_info = get_obs_file_info(branch_ckpt_dir, "history", "new")
            if not file_info["filename"]:
                raise Exception(f"No history data found. Observation must be performed to load it.")

            # Read and parse history file
            history = self._cached_load(os.path.join(branch_ckpt_dir, file_info["filename"]), "json")

            latest_key = sorted(map(int, history["__SortedMap__"].keys()))[-1]
            latest_history = history["__SortedMap__"][str(latest_key)]

            return latest_history, latest_key
        
        else:
            base_ckpt_dir, agent_list = self.find_base_ckpt_dir(branch_str)
            history, tick = self._get_internal_latest_history(branch_str, base_ckpt_dir, agent_list)
            return history, tick

    def get_history(self, branch_str, tick):
        branch_ckpt_dir = self.parse_source_str(branch_str)

        if self._cached_exists(branch_ckpt_dir):
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
        
        else:
            base_ckpt_dir, agent_list = self.find_base_ckpt_dir(branch_str)
            history_at_tick, tick = self._get_internal_history(branch_str, base_ckpt_dir, agent_list, tick)
            return history_at_tick, tick
        
    def get_previous_block_vis(self, branch_str, now_tick):
        branch_ckpt_dir = self.parse_source_str(branch_str)

        if self._cached_exists(branch_ckpt_dir):
            file_info_list = get_obs_file_info(branch_ckpt_dir, "history", "list")
            internal = False
        else:
            base_ckpt_dir, agent_list = self.find_base_ckpt_dir(branch_str)
            branch_ckpt_dir = str(Path(base_ckpt_dir).joinpath(".internal"))
            file_info_list = get_obs_file_info(branch_ckpt_dir, "history", "list", agent_name=agent_list[0])
            internal = True

        if not len(file_info_list):
            raise Exception(f"No history data found. Observation must be performed to load it.")
        
        def get_last_min_index(f_idx, tick):
            file_info = file_info_list[f_idx]
            # Read and parse history file
            history = self._cached_load(os.path.join(branch_ckpt_dir, file_info["filename"]), "json")

            f_ticks = sorted(map(int, history["__SortedMap__"].keys()))
            # Find the last index where value < now_tick
            idx = bisect_left(f_ticks, tick) - 1
            if idx < 0:
                return None, None

            tick = f_ticks[idx]
            return history, tick
        
        ticks = list(map(lambda file_info: file_info["tick"], file_info_list))
        tick = now_tick
        file_idx = bisect_left(ticks, tick - 1)
        while True:
            tmp_history, tmp_tick = get_last_min_index(file_idx, tick)
            if tmp_history is None:  # if now_tick is the first tick of selected history file
                if file_idx == 0:  # if there is no previous history file
                    return None
                file_idx -= 1
                history, tick = get_last_min_index(file_idx, tick)  # search from previous history file
                assert history is not None

            else:
                history, tick = tmp_history, tmp_tick

            history_at_tick = history["__SortedMap__"][str(tick)]
            if "blocks" in history_at_tick.get("visibility", {}):
                break

        if internal:
            history_at_tick, _ = self._get_internal_history(branch_str, base_ckpt_dir, agent_list, tick)
        
        return history_at_tick, tick   

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
    
    def _from_index(self, index: int) -> np.ndarray:
        sx, sy, sz = int(self.size[0]), int(self.size[1]), int(self.size[2])
        x = index % sx
        y = (index // sx) % sy
        z = index // (sx * sy)
        return np.array([x, y, z]) + self.range[0]

    def from_base64(self, base64_str: str):
        byte_array = base64.b64decode(base64_str)
        binary_str = ''.join(f'{byte:08b}' for byte in byte_array)
        total_size = int(np.prod(self.size))
        self.data = np.array([bit == '1' for bit in binary_str[:total_size]], dtype=bool)

    def to_base64(self) -> str:
        bits = self.data.astype(np.uint8)
        pad = (-len(bits)) % 8
        if pad:
            bits = np.pad(bits, (0, pad), mode='constant', constant_values=0)

        byte_arr = np.packbits(bits, bitorder='big')
        return base64.b64encode(byte_arr.tobytes()).decode('ascii')        

    def add(self, vec) -> None:
        v = np.asarray(vec, dtype=int)
        if v.shape != (3,):
            raise ValueError("vec must be length-3 (x, y, z).")
        if not self._is_within_range(v):
            raise ValueError("Vec3 is out of the specified range.")
        idx = self._to_index(v)
        self.data[idx] = True

    def has(self, vec: np.ndarray) -> bool:
        if not self._is_within_range(vec):
            return False
        return bool(self.data[self._to_index(vec)])
    
    def get_all(self):
        true_indices = np.flatnonzero(self.data)
        return [self._from_index(int(i)) for i in true_indices]
    
    def intersection(self, other):
        if not isinstance(other, Vec3BoolMap):
            raise TypeError("other must be a Vec3BoolMap")

        overlap_min = np.maximum(self.range[0], other.range[0])
        overlap_max = np.minimum(self.range[1], other.range[1])

        if np.any(overlap_min > overlap_max):
            return None

        sx, sy, sz = map(int, self.size)
        ox, oy, oz = map(int, other.size)

        self_3d = self.data.reshape((sx, sy, sz), order='F')
        other_3d = other.data.reshape((ox, oy, oz), order='F')

        self_start = (overlap_min - self.range[0]).astype(int)
        self_end   = (overlap_max - self.range[0]).astype(int)  # inclusive

        other_start = (overlap_min - other.range[0]).astype(int)
        other_end   = (overlap_max - other.range[0]).astype(int)  # inclusive

        sx_slice = slice(self_start[0], self_end[0] + 1)
        sy_slice = slice(self_start[1], self_end[1] + 1)
        sz_slice = slice(self_start[2], self_end[2] + 1)

        ox_slice = slice(other_start[0], other_end[0] + 1)
        oy_slice = slice(other_start[1], other_end[1] + 1)
        oz_slice = slice(other_start[2], other_end[2] + 1)

        sub_self  = self_3d[sx_slice,  sy_slice,  sz_slice]
        sub_other = other_3d[ox_slice, oy_slice, oz_slice]

        and_block = np.logical_and(sub_self, sub_other)

        result = Vec3BoolMap((overlap_min.tolist(), overlap_max.tolist()))
        result.data = and_block.ravel(order='F')

        return result

def _vec2key_array(positions):
    """positions: (N,3) ndarray"""
    n = positions.shape[0]
    out = np.empty((n, 3), np.int64)
    for i in range(n):
        out[i, 0] = int(positions[i, 0])
        out[i, 1] = int(positions[i, 1])
        out[i, 2] = int(positions[i, 2])
    return out


class Vec3Map:
    __slots__ = ("data",)

    def __init__(self, vec3map):
        if "__Vec3Map__" in vec3map:
            vec3map = vec3map["__Vec3Map__"]

        positions = np.array([d["position"] for d in vec3map], dtype=np.float64)
        keys = _vec2key_array(positions)

        self.data = {}
        d_items = [ {k: v for k, v in d.items() if k != "position"} for d in vec3map]

        for key_row, val in zip(keys, d_items):
            self.data[(int(key_row[0]), int(key_row[1]), int(key_row[2]))] = val

    def set(self, vec, value):
        self.data[(int(vec[0]), int(vec[1]), int(vec[2]))] = value

    def get(self, vec):
        return self.data[(int(vec[0]), int(vec[1]), int(vec[2]))]

    def has(self, vec):
        return (int(vec[0]), int(vec[1]), int(vec[2])) in self.data

    def delete(self, vec):
        del self.data[(int(vec[0]), int(vec[1]), int(vec[2]))]

    def to_dict(self):
        data = []
        append = data.append
        for (x, y, z), val in self.data.items():
            d = {"position": [x, y, z]}
            d.update(val)
            append(d)
        return {"__Vec3Map__": data}

    def keys(self):
        return [[x, y, z] for (x, y, z) in self.data.keys()]


def get_obs_file_info(branch_ckpt_dir, type_, mode, agent_name=None, use_cache=True):

    if use_cache:
        files = loader._cached_listdir(branch_ckpt_dir)
    else:
        files = os.listdir(branch_ckpt_dir)

    if agent_name is None:
        regex = re.compile(rf"^{re.escape(type_)}#(-?\d+)\.json$")
    else:
        # .internal
        regex = re.compile(rf"^{re.escape(agent_name)}#{re.escape(type_)}#(-?\d+)\.json$")
    
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

    if "visibility" not in history_at_tick:
        raise Exception(f"No visibility data found in branch '{branch_str}' at tick '{t}'. Visibility is not recorded in non-'follow' branches.")

    if "blocks" not in history_at_tick["visibility"]:
        history_at_tick, t = loader.get_previous_block_vis(branch_str, t)
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

def update_state(
    tick: int,
    state,
    filtered_history,
    obj_block_state_map,
    agent_list,
    position_state_mode = "last_seen",
    has_inventory_info = None,
):
    status = filtered_history["status"]
    events = filtered_history["events"]

    block_state_map = Vec3Map(state["blocks"])
    
    block_vis = filtered_history["visibility"]["blocks"]
    block_visibility_from_agent = Vec3BoolMap(
        (np.array(block_vis["__Vec3BoolMap__"]["range"][0]["__Vec3__"]),
         np.array(block_vis["__Vec3BoolMap__"]["range"][1]["__Vec3__"]))
    )
    block_visibility_from_agent.from_base64(block_vis["__Vec3BoolMap__"]["base64"])

    _update_status_state(
        state=state,
        status=status,
        events=[],
        agent_list=agent_list,
        has_inventory_info=has_inventory_info or {},
        position_state_mode=position_state_mode,
    )

    updated_blocks = []

    for visible_pos in block_visibility_from_agent.get_all():
        if obj_block_state_map.has(visible_pos):
            obj_state_block = obj_block_state_map.get(visible_pos)

            if not block_state_map.has(visible_pos) or obj_state_block != block_state_map.get(visible_pos):
                block_state_map.set(visible_pos, obj_state_block)
                updated_blocks.append(
                    {
                        "position": visible_pos,
                        "name": obj_state_block.get("name"),
                        "properties": obj_state_block.get("properties"),
                    }
                )

    state["blocks"] = block_state_map.to_dict()

    _update_container_state(state, events, updated_blocks, block_state_map)

    if events:
        state["events"][tick] = []
        for e in events:
            state["events"][tick].append(e)


def _update_container_state(
    state,
    events,
    updated_blocks,
    block_state_map,
):
    container_state_map = Vec3Map(state["containers"])

    for b in updated_blocks:
        if b.get("name") == "chest" and not container_state_map.has(b["position"]):
            container_state_map.set(b["position"], {})

    for pos in container_state_map.keys():
        if block_state_map.has(pos) and block_state_map.get(pos)["name"] != "chest":
            container_state_map.delete(pos)

    for e in events:
        if e.get("eventName") not in ["getItemFromChest", "depositItemIntoChest"]:
            continue

        pos = e.get("visible", {}).get("chestPos")["__Vec3__"]
        if not pos:
            raise ValueError(f"chestPos is not defined. event: {json.dumps(e, ensure_ascii=False)}")

        if e.get("hidden", {}).get("chestItems") is not None:
            container_state_map.set(pos, e["hidden"]["chestItems"])
            continue

        chest_items = {}
        if container_state_map.has(pos):
            chest_items = container_state_map.get(pos)

        if e["eventName"] == "getItemFromChest":
            for item_name, count in e.get("visible", {}).get("gotItems", {}).items():
                if item_name not in chest_items:
                    continue
                if count >= chest_items[item_name]:
                    del chest_items[item_name]
                else:
                    chest_items[item_name] -= count

        elif e["eventName"] == "depositItemIntoChest":
            for item_name, count in e.get("visible", {}).get("depositedItems", {}).items():
                if item_name in chest_items:
                    chest_items[item_name] += count
                else:
                    chest_items[item_name] = count
        else:
            raise ValueError(f'Invalid event name "{e["eventName"]}"')

        container_state_map.set(pos, chest_items)
        
    state["containers"] = container_state_map.to_dict()


def _update_status_state(
    state,
    status,
    events = None,
    agent_list = None,
    has_inventory_info = None,
    position_state_mode = "last_seen",
) -> None:

    events = events or []
    has_inventory_info = has_inventory_info or {}

    state.setdefault("status", {})

    agent_names = set(agent_list)

    for agent_name in agent_names:
        if agent_name not in state["status"]:
            state["status"][agent_name] = {"visible": {}, "hidden": {}}

        if agent_name in status:
            state["status"][agent_name]["visible"] = copy.deepcopy(status[agent_name].get("visible", {}))
            if status[agent_name].get("hidden"):
                state["status"][agent_name]["hidden"] = copy.deepcopy(status[agent_name]["hidden"])
        else:
            if position_state_mode == "last_seen":
                pass
            elif position_state_mode == "current":
                mem_vis = state["status"][agent_name].setdefault("visible", {})
                mem_vis["position"] = None
                mem_vis["velocity"] = None
                mem_vis["yaw"] = None
                mem_vis["pitch"] = None
                mem_vis["onGround"] = None
            else:
                raise ValueError(f'Invalid value of position_state_mode "{position_state_mode}"')

        state["status"][agent_name].setdefault("hidden", {})
        state["status"][agent_name]["hidden"].setdefault("inventory", {})

    def _add(agent_name: str, name: str, count: int):
        if has_inventory_info.get(agent_name):
            return
        inv = state["status"][agent_name]["hidden"]["inventory"]
        inv[name] = inv.get(name, 0) + count

    def _remove(agent_name: str, name: str, count: int):
        if has_inventory_info.get(agent_name):
            return
        inv = state["status"][agent_name]["hidden"]["inventory"]
        if name not in inv:
            return
        inv[name] -= count
        if inv[name] <= 0:
            del inv[name]

    for e in events:
        event_name = e.get("eventName")
        if event_name == "mineBlock":
            _add(e["agentName"], e["visible"]["blockName"], 1)

        elif event_name == "craftItem":
            _add(e["agentName"], e["visible"]["itemName"], e["visible"]["producedCount"])
            for name, count in e["visible"].get("consumedItems", {}).items():
                _remove(e["agentName"], name, count)

        elif event_name == "smeltItem":
            _add(e["agentName"], e["visible"]["producedItemName"], e["visible"]["producedCount"])
            for name, count in e["visible"].get("consumedItems", {}).items():
                _remove(e["agentName"], name, count)

        elif event_name == "getItemFromChest":
            for name, count in e["visible"].get("gotItems", {}).items():
                _add(e["agentName"], name, count)

        elif event_name == "depositItemIntoChest":
            for name, count in e["visible"].get("depositedItems", {}).items():
                _remove(e["agentName"], name, count)

        elif event_name == "giveItemToOther":
            _remove(e["agentName"], e["visible"]["itemName"], e["visible"]["count"])
            _add(e["visible"]["otherAgentName"], e["visible"]["itemName"], e["visible"]["count"])

        elif event_name == "receiveItemFromOther":
            _add(e["agentName"], e["visible"]["itemName"], e["visible"]["count"])
            _remove(e["visible"]["otherAgentName"], e["visible"]["itemName"], e["visible"]["count"])

        else:
            pass


def filter_status(
    status,
    see_agent_name,
    player_visibility_from_agent,
    disable_position_filtering=False,
):
    filtered_status = {}

    for saw_agent_name, agent_status in status.items():
        if see_agent_name == saw_agent_name:
            filtered_status[saw_agent_name] = agent_status
        else:
            if player_visibility_from_agent.get(saw_agent_name):
                s = copy.deepcopy(agent_status)
                s.pop("hidden", None)  # delete s.hidden
                filtered_status[saw_agent_name] = s
            else:
                if disable_position_filtering:
                    v = agent_status.get("visible", {})
                    filtered_status[saw_agent_name] = {
                        "visible": {
                            "position": copy.deepcopy(v.get("position")),
                            "velocity": copy.deepcopy(v.get("velocity")),
                            "yaw": v.get("yaw"),
                            "pitch": v.get("pitch"),
                            "onGround": v.get("onGround"),
                        }
                    }

    return filtered_status

def filter_events(
    events,
    see_agent_name,
    player_visibility_from_agent,
    block_visibility_from_agent,
):
    vec3boolmap = block_visibility_from_agent

    filtered_events = []

    for e in events:
        filtered = e

        if "blockPos" in e and e["blockPos"] is not None:
            if not vec3boolmap.has(e["blockPos"]):
                continue

        if "agentName" in e and e["agentName"] is not None:
            if see_agent_name == e["agentName"]:
                pass
            else:
                if player_visibility_from_agent.get(e["agentName"]):
                    filtered = copy.deepcopy(filtered)
                    filtered.pop("hidden", None)
                else:
                    continue

        filtered_events.append(filtered)

    return filtered_events


#### FILTER DIFINITION ####

def position(branch_str, agent_name=None, ignore_last_seen=True):
    latest_state, _ = loader.get_latest_state(branch_str)
    try:
        main_agent_name = get_main_agent_name(branch_str)
    except:
        main_agent_name = None

    if agent_name is None:
        assert main_agent_name is not None, "Set `agent_name` to use `position` in `world`."
        agent_name = main_agent_name

    try:
        if main_agent_name and agent_name != main_agent_name and ignore_last_seen:
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
