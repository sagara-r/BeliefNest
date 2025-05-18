from datetime import datetime
import json
import yaml
import re
from pathlib import Path
from logging import FileHandler, Formatter, DEBUG
from langchain.schema import SystemMessage, HumanMessage

from belief_nest import BeliefNestWrapper, coding_llm, llm
from belief_nest.utils import create_logger
from api_key import OPENAI_API_KEY


#########################################################

CONFIG_FILE = "config.json"
INITIAL_STATE_FILE = "state#-1.json"

MC_PORT = 25565
TASK = "Get a diamond from a chest."

#########################################################

if OPENAI_API_KEY == "":
    print("Write your api key in api_key.py.")
    exit()

CONFIG = json.load(open(CONFIG_FILE))
INITIAL_STATE = json.load(open(INITIAL_STATE_FILE))

with open("mc_codes/put_diamond.js") as f:
    PUT_DIAMOND_CODE = f.read()

with open("mc_codes/move_diamond.js") as f:
    MOVE_DIAMOND_CODE = f.read()

base_dir = Path("out") / datetime.now().strftime('%y%m%d_%H%M%S')
ckpt_dir = Path(base_dir) / "ckpt"
log_dir = Path(base_dir) / "logs"
log_dir.mkdir(parents=True, exist_ok=True)

timestr = datetime.now().strftime('%Y%m%d_%H%M%S')
log_file = Path(f'{log_dir}/main_{timestr}.log')
handler = FileHandler(filename=log_file, encoding="utf-8")
formatter = Formatter('%(asctime)s ; %(name)s ; %(levelname)s ; %(message)s')
handler.setFormatter(formatter)
logger = create_logger("main", handler=handler, level=DEBUG)


def call_coding_llm(bn:BeliefNestWrapper, belief_path):
    with open("prompts/coding_llm_human_prompt_template.txt") as f:
        human_prompt_template = f.read()
    human_prompt = bn.load_from_template(belief_path, human_prompt_template, variables={"task": TASK})

    with open("prompts/coding_llm_system_prompt_template.txt") as f:
        system_prompt_template = f.read()

    code, _ = coding_llm(system_prompt_template, human_prompt, OPENAI_API_KEY, log_dir, logger)

    return code


def call_offset_llm(code):
    with open("prompts/offset_llm_system_prompt.txt", encoding="utf-8") as f:
        content = f.read()
        system_prompt = SystemMessage(content=content)
        
    content = f"{code}"
    human_prompt = HumanMessage(content=content)

    print(f"\033[32m\n###### Offset LLM ###### \033[0m")
    print(f"\033[32m{human_prompt.content}\033[0m")

    response = llm([system_prompt, human_prompt], OPENAI_API_KEY, model_name="gpt-4o-mini", log_dir=log_dir, name="offset_llm")

    pattern = re.compile(r"```(?:javascript|js)(.*?)```", re.DOTALL)
    offset_code = "\n".join(pattern.findall(response))

    print(f"\033[31m{offset_code}\033[0m")

    return offset_code


bn = BeliefNestWrapper(
    config=CONFIG,
    initial_state=INITIAL_STATE,
    mc_port=MC_PORT, 
    ckpt_dir=str(ckpt_dir), 
    log_dir=str(log_dir), 
    logger=logger
)

bn.create_sim("/", "anne", [-12,0,-25], "a_")
bn.create_sim("/anne", "sally", [-12,0,-50], "as_")
bn.create_sim("/", "sally", [12,0,-25], "s_")
bn.create_sim("/sally", "anne", [12,0,-50], "sa_")

input("Simulators are created. Press ENTER to start scenario in real world.")

bn.execute("/", "sally", PUT_DIAMOND_CODE)
bn.execute("/", "anne", MOVE_DIAMOND_CODE)

input("Scenario done. Press ENTER to start to estimate Sally's action in Anne's belief simulator.")

trial = 1
while True:
    bn.switch_branch("/anne/", "ckpt01")
    bn.switch_branch("/anne/", f"ckpt01_trial{trial}")

    code = call_coding_llm(bn, "/anne/sally/")
    offset_code = call_offset_llm(code)
    success, errormsg = bn.execute("/anne/", "sally", offset_code)
    print(success)
    if not success:
        print(errormsg)

    inp = input("Finished. Do you want to retry? [y]/n > ")
    if inp == "n":
        break

    print("Retry.")
    trial += 1

bn.close()
