from datetime import datetime
import json
from pathlib import Path
from logging import FileHandler, Formatter, DEBUG

from belief_nest import BeliefNestWrapper
from belief_nest.utils import create_logger


#########################################################

CONFIG_FILE = "config.json"
INITIAL_STATE_FILE = "state#-1.json"

# Use container name (e.g., "mc_server") when running inside Docker on the same network
# Use "localhost" when running outside Docker
# Use "host.docker.internal" to access the host from inside Docker (only on Windows/macOS)
MC_HOST = "mc_server"  
MC_PORT = 25565

# Same rules apply for RabbitMQ
MQ_HOST = "rabbitmq"

HUMAN_MC_NAME = "rikuacq"  ######### SET YOUR MINECRAFT ID
HUMAN_PREFIX = HUMAN_MC_NAME[0]
assert HUMAN_PREFIX != "a", "duplicate prefix"

#########################################################

CONFIG = json.loads(open(CONFIG_FILE).read().replace("HUMAN_MC_NAME", HUMAN_MC_NAME))
INITIAL_STATE = json.loads(open(INITIAL_STATE_FILE).read().replace("HUMAN_MC_NAME", HUMAN_MC_NAME))

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


bn = BeliefNestWrapper(
    config=CONFIG,
    initial_state=INITIAL_STATE,
    mc_host=MC_HOST,
    mc_port=MC_PORT,
    mq_host=MQ_HOST, 
    ckpt_dir=str(ckpt_dir), 
    log_dir=str(log_dir), 
    logger=logger
)

bn.create_sim("/", HUMAN_MC_NAME, [-12,0,-25], f"{HUMAN_PREFIX}_")
bn.create_sim(f"/{HUMAN_MC_NAME}", "anne", [-12,0,-50], f"{HUMAN_PREFIX}a_")
bn.create_sim("/", "anne", [12,0,-25], "a_")
bn.create_sim("/anne", HUMAN_MC_NAME, [12,0,-50], f"a{HUMAN_PREFIX}_")

parts = ["armor.head", "armor.chest", "armor.legs", "armor.feet", "weapon.mainhand", "weapon.offhand"]
items = INITIAL_STATE["status"][HUMAN_MC_NAME]["visible"]["equipment"]

equip_commands = []
for mc_name in [f"{HUMAN_PREFIX}_{HUMAN_MC_NAME}", f"{HUMAN_PREFIX}a_{HUMAN_MC_NAME}", f"a_{HUMAN_MC_NAME}", f"a{HUMAN_PREFIX}_{HUMAN_MC_NAME}"]:
    for part, item in zip(parts, items):
        if item is None:
            item = "air"
        equip_commands.append(f"/item replace entity {mc_name} {part} with {item}")

bn.execute_mc_commands_by_admin("/", equip_commands)

bn._start_observation("/")

input("Simulators are created. Press ENTER to close.")

bn.close()
