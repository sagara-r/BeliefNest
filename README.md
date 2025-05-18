# BeliefNest: A Joint Action Simulator for Embodied Agents with Theory of Mind
<div align="right">

[日本語はこちら(Japanese)](README_jp.md)

</div>

<div align="center">

[[Arxiv]]()

[![Python Version](https://img.shields.io/badge/Python-3.9-blue.svg)](https://github.com/sagara-r/BeliefNest)
[![GitHub license](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/sagara-r/BeliefNest/blob/main/LICENSE)
______________________________________________________________________

![](images/overview.png)

</div>

We propose an open-source simulator, BeliefNest, designed to enable embodied agents to perform collaborative tasks by leveraging Theory of Mind. BeliefNest dynamically and hierarchically constructs simulators within a Minecraft environment, allowing agents to explicitly represent nested belief states about themselves and others. This enables agent control in open-domain tasks that require Theory of Mind reasoning. The simulator provides a prompt generation mechanism based on each belief state, facilitating the design and evaluation of methods for agent control utilizing large language models (LLMs).

In this repo, we provide BeliefNest code. This codebase is under [MIT License](LICENSE).

# Installation
Download the latest version [here](https://github.com/sagara-r/BeliefNest/releases). BeliefNest requires Python ≥ 3.9 and Node.js ≥ 16.13.0. We have tested on Windows 11. You need to follow the instructions below to install BeliefNest.

## Step 1. Python Install
```
cd BeliefNest
pip install -e .
```

## Step 2. Node.js Install
```
cd belief_nest/env/mineflayer
npm install
```

## Step 3. Docker Install
If you are using Windows, download the installer from [Docker Docs](https://docs.docker.com/desktop/setup/install/windows-install/) and execute it.

## Step 4. Minecraft Client Install
Install the [Minecraft Launcher](https://www.minecraft.net/) and ensure that you can play Minecraft: Java Edition (version 1.19). It will be used as a client. A valid Java Edition license is required.

From the "Installations" tab in the launcher, create a new launch configuration and select version 1.19.

# Usage
## Getting Started
Start the RabbitMQ server, the Minecraft server, and the main program in three different terminals.

### Launch the RabbitMQ server
If you are using Docker Desktop, make sure to launch the application beforehand.
```
docker run -it --rm --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:4.1-management
```

### Launch the Minecraft server
See [here](https://www.minecraft.net/download/server) to launch a Minecraft server. Alternatively, you can launch the server using the command below. 
```
cd mc_server/flat
docker compose up -d
docker attach minecraft-server
```

It is possible to use `Open to LAN` in `Singleplayer` mode, though it is not recommended, as only up to 8 players can log in and thus only very small-scale experiments can run.

Run `/op operator` in the Minecraft server terminal; this only needs to be done once unless you switch to a different world.

Launch the Minecraft client and join the world from `Multiplayer`. If the world doesn't appear, use `Add Server` and specify the server address (e.g., `localhost:25565`).

### Run the example code
```
cd examples/sally_anne/
```
After writing the API key value into `api_key.py`, please execute the following command.
```
python main.py
```

## Use own world
Change the initial state and config.

### Create initial state
```
cd belief_nest/env/mineflayer/
node generate_init_state.js
mv state#-1.js /path/to/main_dir
```

## API
See [doc/API.md](doc/API.md)

# License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

Some portions of the code are adapted from [MineDojo/Voyager](https://github.com/MineDojo/Voyager), which is also licensed under the MIT License.

# Citation
~~~
@article{sagara2025beliefnest,
  title={####},
  author={Rikunari SAGARA, Koichiro TERAO, Naoto IWAHASHI},
  year={2025},
  journal={arXiv preprint arXiv: ####}
}
~~~
