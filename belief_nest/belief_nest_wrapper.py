import os
import time
import json
import yaml
from pathlib import Path
from logging import FileHandler, Formatter, INFO
from datetime import datetime
from pathlib import Path
import requests
import atexit
import pika
import threading

from .utils import create_logger, MethodLogging

import belief_nest.utils as U
from belief_nest.env.process_monitor import SubprocessMonitor
from belief_nest.observation_loader import initialize_observation_loader, load_from_template
from belief_nest.primitives import load_primitives


class BeliefNestWrapper(MethodLogging):
    def __init__(
        self,
        resume=False,
        config=None,
        initial_state=None,
        mf_server_host="localhost",
        mf_server_port=3000,
        mc_host="localhost",
        mc_port=25565,
        mq_host="localhost",
        ckpt_dir="ckpt",
        log_dir="logs",
        logger=None,
        log_level=INFO,
    ):
        self.server_addr = f"http://{mf_server_host}:{mf_server_port}"
        self.ckpt_dir = os.path.abspath(ckpt_dir)
        self.log_dir = os.path.abspath(log_dir)
        self.log_level = log_level

        self.primitives = load_primitives()

        if logger:
            self.logger = logger
            if log_level:
                self.logger.warning("log_level is ignored because logger is given.")
        else:
            timestr = datetime.now().strftime('%Y%m%d_%H%M%S')
            log_file = Path(f'{self.log_dir}/bn_wrapper_{timestr}.log')
            log_file.parent.mkdir(parents=True, exist_ok=True)
            handler = FileHandler(filename=log_file, encoding="utf-8")
            formatter = Formatter('%(asctime)s ; %(name)s ; %(levelname)s ; %(message)s')
            handler.setFormatter(formatter)
            self.logger = create_logger("ctrlr", handler=handler, level=log_level)

        if not resume:
            assert config and initial_state
            world_dir = Path(self.ckpt_dir) / "world[default]"
            world_dir.mkdir(parents=True, exist_ok=True)

            with Path(self.ckpt_dir).joinpath("config.json").open("w") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            with world_dir.joinpath("state#-1.json").open("w") as f:
                json.dump(initial_state, f, indent=2)

        self.mq_connection = pika.BlockingConnection(pika.ConnectionParameters(mq_host))
        self.chat_callbacks = {}
        self.mq_channels = {}
        self.mq_channel_threads = {}
        t = threading.Thread(target=self._create_mq_channel, args=("/",), daemon=True)
        t.start()
        self.mq_channel_threads["/"] = t

        Path(self.log_dir).mkdir(parents=True, exist_ok=True)

        self.js_process = self._get_js_process(mf_server_port)
        self.js_process.run()
        atexit.register(self.js_process.stop)

        with Path(self.ckpt_dir).joinpath("config.json").open() as f:
            agent_names = list(json.load(f)["players"].keys())

        initialize_observation_loader(self.ckpt_dir, agent_names)

        args = {
            "mcHost": mc_host,
            "mcPort": mc_port,
            "mqHost": mq_host,
            "ckptDir": self.ckpt_dir,
            "logDir": self.log_dir
        }
        res = requests.post(f"{self.server_addr}/setup", json=args)
        if res.status_code != 200:
            self.js_process.stop()
            self._handle_error(res)
    
            
    def create_sim(self, belief_path, agent_name, offset, player_prefix, mc_host=None, mc_port=None):
        if belief_path[-1] != "/":
            belief_path += "/"
        t = threading.Thread(target=self._create_mq_channel, args=(belief_path,), daemon=True)
        t.start()
        self.mq_channel_threads[belief_path] = t

        self._create_mq_channel(belief_path)
        args = {
            "beliefPath": belief_path,
            "agentName": agent_name,
            "offset": offset,
            "playerPrefix": player_prefix,
            "mcHost": mc_host,
            "mcPort": mc_port
        }
        res = requests.post(f"{self.server_addr}/createSim", json=args)
        if res.status_code != 200:
            self._handle_error(res)
        
    def remove_sim(self, belief_path):
        args = {
            "beliefPath": belief_path
        }
        res = requests.post(f"{self.server_addr}/removeSim", json=args)
        if res.status_code != 200:
            self._handle_error(res)
        
    def execute(self, belief_path, agent_name, code, start_stop_observation=True, wait_sec=4):
        if start_stop_observation:
            self._start_observation(belief_path)

        args = {
            "beliefPath": belief_path,
            "agentName": agent_name,
            "code": code,
            "primitives": self.primitives
        }
        res = requests.post(f"{self.server_addr}/execute", json=args)
        if res.status_code != 200:
            self._handle_error(res)

        time.sleep(wait_sec)
        
        if start_stop_observation:
            self._stop_observation(belief_path)

        data = res.json()
        return data["success"], data["errorMsg"]
        
    def execute_mc_commands(self, belief_path, agent_name, commands, start_stop_observation=True, wait_sec=1):
        if start_stop_observation:
            self._start_observation(belief_path)

        args = {
            "beliefPath": belief_path,
            "agentName": agent_name,
            "commands": commands
        }
        res = requests.post(f"{self.server_addr}/execMcCommands", json=args)
        if res.status_code != 200:
            self._handle_error(res)
        
        time.sleep(wait_sec)
        
        if start_stop_observation:
            self._stop_observation(belief_path)

    def execute_mc_commands_by_admin(self, belief_path, commands):
        args = {
            "beliefPath": belief_path,
            "commands": commands
        }
        res = requests.post(f"{self.server_addr}/execMcCommandsByAdmin", json=args)
        if res.status_code != 200:
            self._handle_error(res)

    def switch_branch(self, belief_path, branch_name):
        args = {
            "beliefPath": belief_path,
            "branchName": branch_name
        }
        res = requests.post(f"{self.server_addr}/switchBranch", json=args)
        if res.status_code != 200:
            self._handle_error(res)

    #def overwrite_belief(self, belief_path, blocks=[], chests=[], agents={}):
    def overwrite_belief(self, belief_path, blocks=[], chests=[]):
        args = {
            "beliefPath": belief_path,
            "blockState": blocks,
            "chestState": chests,
            #"agentState": agents,
        }
        res = requests.post(f"{self.server_addr}/overwriteState", json=args)
        if res.status_code != 200:
            self._handle_error(res)
        response = res.json()

        success = response["success"]
        error_msg = response["errorMsg"]

        return success, error_msg
    
    def chat(self, belief_path, agent_name, msg, silent=False, start_stop_observation=True, wait_sec=2):
        args = {
            "beliefPath": belief_path,
            "agentName": agent_name,
            "msg": msg,
            "silent": silent,
        }

        if start_stop_observation:
            self._start_observation(belief_path)

        res = requests.post(f"{self.server_addr}/chat", json=args)
        if res.status_code != 200:
            self._handle_error(res)

        time.sleep(wait_sec)
        
        if start_stop_observation:
            self._stop_observation(belief_path)

        response = res.json()
        success = response["success"]
        error_msg = response["errorMsg"]

        return success, error_msg
    
    def register_chat_callback(self, belief_path, callback, **kwargs):
        if belief_path[-1] != "/":
            belief_path += "/"
        self.chat_callbacks.setdefault(belief_path, [])
        self.chat_callbacks[belief_path].append({
            "callback": callback,
            "kwargs": kwargs
        })

    def remove_chat_callbacks(self, belief_path):
        if belief_path[-1] != "/":
            belief_path += "/"
        self.chat_callbacks[belief_path] = []

    def get_branch_str(self, belief_path, dump=True, get_path=False):
        if self.sim_exists(belief_path):
            if dump:
                # To use branch_str in template, dumping is needed
                self._dump_observation(belief_path)
            info = self.get_sim_status(belief_path)
            branch_str = info[0]["branchStr"]

            return_belief_path = belief_path

        else:
            belief_struct = self._parse_belief_path(belief_path)
            parent_belief_path = "/" + "/".join(belief_struct[:-1])
            parent_branch_str, base_belief_path = self.get_branch_str(parent_belief_path, dump=dump, get_path=True)
            branch_str = parent_branch_str + f".{belief_struct[-1]}[follow]"

            return_belief_path = base_belief_path

        if get_path:
            return branch_str, return_belief_path
        
        return branch_str
    
    def sim_exists(self, belief_path):
        belief_struct = self._parse_belief_path(belief_path)

        status_list = self.get_sim_status()
        for status in status_list:
            branch_str = status["branchStr"]
            branch_str_struct = branch_str.split(".")[1:]

            if len(belief_struct) != len(branch_str_struct):
                continue

            exist = True
            for be, br in zip(belief_struct, branch_str_struct):
                if be != br.split("[")[0]:
                    exist = False
                    break

            if exist:
                return True
            
        return False

        
    def load_from_template(self, belief_path, template, variables={}, extra_filters=[], allow_filter_override=False, dump=True):
        branch_str, base_belief_path = self.get_branch_str(belief_path, dump=False, get_path=True)
        if dump:
            self._dump_observation(base_belief_path)

        variables = dict(
            **variables,
            **{"branch": branch_str}
        )

        return load_from_template(template, variables=variables, extra_filters=extra_filters, allow_filter_override=allow_filter_override)
    
    def get_sim_status(self, belief_path=None):
        if belief_path is None:
            args = {}
        else:
            args = {"beliefPath": belief_path}
        res = requests.post(f"{self.server_addr}/getSimStatus", json=args)
        if res.status_code != 200:
            self._handle_error(res)
        
        return res.json()
    
    def get_offset(self, belief_path):
        args = {"beliefPath": belief_path}
        res = requests.post(f"{self.server_addr}/getOffset", json=args)
        if res.status_code != 200:
            self._handle_error(res)

        response = res.json()
        
        return tuple(response["offset"])
    
    def close(self, clear_env=True):
        if clear_env:
            res = requests.post(f"{self.server_addr}/close", json={})
            if res.status_code != 200:
                self._handle_error(res)

        self.js_process.stop()

        for key in self.mq_channels:
            self.mq_channels[key].stop_consuming()
        
        for key in self.mq_channel_threads:
            self.mq_channel_threads[key].join()
            
    def _get_js_process(self, server_port):
        tmp = os.path.abspath(os.path.dirname(__file__))
        mineflayer_dir = U.f_join(tmp, "env", "mineflayer")
        return SubprocessMonitor(
            commands=[
                "node",
                U.f_join(mineflayer_dir, "server.js"),
                str(server_port),
            ],
            name=f"{self.logger.name}.mineflayer",
            ready_match=r"Server started on port (\d+)",
            log_path=U.f_join(self.log_dir),
            log_level=self.log_level,
            kill_children=True
        )
    
    def _parse_belief_path(self, belief_path):
        return [p for p in belief_path.split("/") if p]

    def _start_observation(self, belief_path):
        args = {
            "beliefPath": belief_path,
        }
        res = requests.post(f"{self.server_addr}/startObservation", json=args)
        if res.status_code != 200:
            self._handle_error(res)
        
    def _stop_observation(self, belief_path):
        args = {
            "beliefPath": belief_path,
        }
        res = requests.post(f"{self.server_addr}/stopObservation", json=args)
        if res.status_code != 200:
            self._handle_error(res)
        
    def _dump_observation(self, belief_path, recursive=False):
        args = {
            "beliefPath": belief_path,
            "recursive": recursive
        }
        res = requests.post(f"{self.server_addr}/dumpObservation", json=args)
        if res.status_code != 200:
            self._handle_error(res)   

    def _create_mq_channel(self, belief_path):
        if belief_path[-1] != "/":
            belief_path += "/"

        def on_message(ch, method, properties, body):
            try:
                data = json.loads(body)
                for callback_dict in self.chat_callbacks[belief_path]:
                    callback = callback_dict["callback"]
                    kwargs = callback_dict["kwargs"]
                    callback(data["msg"], data["agentName"], **kwargs)
            except Exception as e:
                print("Error handling message:", e)

        # RabbitMQ接続設定
        channel = self.mq_connection.channel()
        self.mq_channels[belief_path] = channel

        chat_exchange = self._get_chat_exchange_name(belief_path)
        #channel.queue_declare(queue=queue_name, durable=True)
        #channel.basic_consume(queue=queue_name, on_message_callback=on_message, auto_ack=True)

        channel.exchange_declare(exchange=chat_exchange, exchange_type='fanout', durable=False)
        result = channel.queue_declare(queue='', exclusive=True)
        queue_name = result.method.queue
        channel.queue_bind(exchange=chat_exchange, queue=queue_name)
        channel.basic_consume(queue=queue_name, on_message_callback=on_message, auto_ack=True)

        print(f"Listening for messages on queue '{queue_name}'...")
        channel.start_consuming()

    def _get_chat_exchange_name(self, belief_path):
        parent_agent_names = [p for p in belief_path.split("/") if p]
        return "-".join(parent_agent_names) + "_chat"
        
    def _handle_error(self, res):
        status_code = res.status_code
        data = res.json()
        error_msg = data.get("errorMsg", "")

        msg = f"Javascript server replies with code {status_code}."
        if error_msg:
            msg += " Message: " + error_msg

        raise RuntimeError(msg)
