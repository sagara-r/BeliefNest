# BeliefNest: A Joint Action Simulator for Embodied Agents with Theory of Mind
<div align="right">

[日本語はこちら(Japanese)](README_jp.md)

</div>

<div align="center">

[\[Arxiv\]](https://arxiv.org/abs/2505.12321)

<!--![Docker Pulls](https://img.shields.io/docker/pulls/sagarar/beliefnest)-->
[![GitHub license](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/sagara-r/BeliefNest/blob/main/LICENSE)
______________________________________________________________________

![](images/overview.png)

</div>

We introduce an open-source simulator, BeliefNest, designed to enable embodied agents to perform collaborative tasks by leveraging Theory of Mind. BeliefNest dynamically and hierarchically constructs simulators within a Minecraft environment, allowing agents to explicitly represent nested belief states about themselves and others. This enables agent control in open-domain tasks that require Theory of Mind reasoning. The simulator provides a prompt generation mechanism based on each belief state, facilitating the design and evaluation of methods for agent control utilizing large language models (LLMs).

In this repo, we provide BeliefNest code. This codebase is under [MIT License](LICENSE).

# Preparation

This tool runs inside Docker, so you don't need to install Python, Node.js, or other dependencies manually.  
To get started, you'll need to install **Docker** and **Minecraft**.  
The setup has been tested on Windows 11.

## Download BeliefNest

Download the latest version from [here](https://github.com/sagara-r/BeliefNest/releases). 

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

Double-click `rabbitmq.bat` located in the downloaded `BeliefNest-*.*.*` folder to launch the server.　Alternatively, you can run the following commands in any folder:
```
docker network create bnnet
docker run -it --rm --network bnnet --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:4.1-management
```

### Launch and prepare the Minecraft server

- **Launch the Server**

  Double-click `mc_server.bat` located in `mc_server/flat` to launch the server. Alternatively, execute the following commands inside the `mc_server/flat` directory:
  ```
  docker compose up -d
  docker attach mc_server
  ```

- **Join the World**

  When the terminal displays `Done (*.**s)! For help, type "help"`, start the Minecraft client and join the world via "Multiplayer". If the server is not listed, click "Add Server" and enter the server address as `localhost:25565`.

- **Grant Permissions**

  After joining the world, run the following commands in the terminal:
  ```
  op operator
  op xxx
  gamemode creative xxx
  ```
  Replace `xxx` with your Minecraft username. This will grant operator privileges to your user and the `operator` user used by BeliefNest, enabling the use of various commands. If you reuse the same server later, you do not need to run these commands again.

  In Minecraft, press the spacebar twice quickly to start flying. Use WASD and Shift to move around.


### Run the sample code

- Obtain an OpenAI API key from [here](https://platform.openai.com/api-keys). You will need to create an account. Enter the obtained API key into `api_key.py` in the `examples/sally_anne` directory. Also, please confirm that your balance is at least $0.10 from [this page](https://platform.openai.com/settings/organization/billing/overview).

- Double-click `main.bat` to run the sample. Alternatively, execute the following command in the `examples/sally_anne` directory:
  ```
  docker run -it --rm -v %cd%:/app -w /app --network bnnet --name beliefnest sagarar/beliefnest:latest python main.py
  ```

  The estimated OpenAI API cost for a single belief inference in the sample code is less than $0.10.

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
```bibtex
@article{sagara2025beliefnest,
  title={BeliefNest: A Joint Action Simulator for Embodied Agents with Theory of Mind},
  author={Rikunari Sagara, Koichiro Terao, Naoto Iwahashi},
  year={2025},
  journal={arXiv preprint arXiv:2505.12321}
}
```
