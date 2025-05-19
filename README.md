# BeliefNest: A Joint Action Simulator for Embodied Agents with Theory of Mind
<div align="right">

[日本語はこちら(Japanese)](README_jp.md)

</div>

<div align="center">

<!--[[Arxiv]]()-->

[![Python Version](https://img.shields.io/badge/Python-3.9-blue.svg)](https://github.com/sagara-r/BeliefNest)
[![GitHub license](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/sagara-r/BeliefNest/blob/main/LICENSE)
______________________________________________________________________

![](images/overview.png)

</div>

We introduce an open-source simulator, BeliefNest, designed to enable embodied agents to perform collaborative tasks by leveraging Theory of Mind. BeliefNest dynamically and hierarchically constructs simulators within a Minecraft environment, allowing agents to explicitly represent nested belief states about themselves and others. This enables agent control in open-domain tasks that require Theory of Mind reasoning. The simulator provides a prompt generation mechanism based on each belief state, facilitating the design and evaluation of methods for agent control utilizing large language models (LLMs).

In this repo, we provide BeliefNest code. This codebase is under [MIT License](LICENSE).

# Installation

This tool runs entirely within Docker, so there is no need to install Python or Node.js on your local machine. Download the latest version from [here](https://github.com/sagara-r/BeliefNest/releases). The setup has been tested on Windows 11. Follow the steps below to install.

## Install Docker

If you're using Windows, download and run the installer from the [Docker Docs](https://docs.docker.com/desktop/setup/install/windows-install/).

## Install Minecraft

Install the [Minecraft Launcher](https://www.minecraft.net/) and make sure you can run Minecraft: Java Edition (version 1.19). A valid Java Edition license is required.

In the Minecraft Launcher, go to the "Installations" tab, click "New Installation", and select version 1.19.

---

# Usage
## Getting Started
Start the RabbitMQ server, the Minecraft server, and the main program in three different terminals.

### Launch the RabbitMQ server
Make sure Docker Desktop is already running.

Double-click `rabbitmq.bat` located in the downloaded `BeliefNest-*.*.*` folder to launch the server.

### Launch the Minecraft server
Double-click `mc_server.bat` inside the `mc_server/flat` directory to start the server.

When you see the message `Done (*.**s)! For help, type "help"` in the terminal, type `op operator` to grant operator permissions. You only need to do this once unless you use a different world.

Launch the Minecraft client, go to "Multiplayer", and join the server. If the world does not appear, click "Add Server" and enter `localhost:25565` as the server address.

Once you've joined the world, run `op xxx` and `gamemode creative xxx` in the terminal, replacing `xxx` with your Minecraft username. In creative mode, double-tapping the spacebar allows you to fly. Use WASD and Shift to move.


### Running the sample code

Generate your OpenAI API key from [here](https://platform.openai.com/api-keys). You’ll need to create an account.

Paste the API key into `api_key.py` located in `examples/sally_anne`, then double-click `main.bat` to run the sample.

The API cost for running the sample code should be less than $0.10 USD.

---

## Using Other Minecraft Worlds

You can run BeliefNest in other Minecraft worlds. Copy `docker-compose.yaml` and `mc_server.bat` from `mc_server/flat` to a new folder, and double-click the copied `mc_server.bat`.

You can also connect to a Minecraft world running natively on Windows. In this case, set the `mqHost` parameter in the `BeliefNestWrapper` constructor to `host.docker.internal`. Be aware that blocks in the world may be forcibly replaced, so take care when using existing worlds.

Using "Open to LAN" from Singleplayer mode is also possible, but it only supports up to 8 players, which limits the size of experiments.

Once the necessary blocks are placed in the world, follow the steps below to generate the initial state and configuration file.

### Generating the Initial State

Open a command prompt in the `belief_nest/env/mineflayer` directory and run:

```
node generate_init_state.js
```

Move the generated `state#-1.js` file to an appropriate folder and load it in `main.py`.

## API
See [doc/API.md](doc/API.md)

# License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

Some portions of the code are adapted from [MineDojo/Voyager](https://github.com/MineDojo/Voyager), which is also licensed under the MIT License.

# Citation
~~~
@article{sagara2025beliefnest,
  title={BeliefNest: A Joint Action Simulator for Embodied Agents with Theory of Mind},
  author={Rikunari Sagara, Koichiro Terao, Naoto Iwahashi},
  year={2025},
  journal={arXiv preprint arXiv: ####}
}
~~~
