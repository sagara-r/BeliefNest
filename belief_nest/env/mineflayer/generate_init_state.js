const mineflayer = require('mineflayer');
const fs = require('fs');
const Vec3 = require('vec3');
const cliProgress = require('cli-progress');
const readline = require('readline');

const { roundVec3 } = require('./lib/utils');


async function input(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function generate_init_state(){
    const mcHost = await input("Enter host name of Minecraft server [localhost] > ") || "localhost";
    const mcPort = parseInt(await input("Enter port number of Minecraft server [25565] > ")) || 25565;

    const destFile = await input(`Enter filepath of output file [state#-1.json] > `) || "state#-1.json";

    const corner1 = (await input(`Enter the coordinates of one corner of the world. Example: -10 -50 -10 > `)).split(" ").map(Number);
    if(corner1.length !== 3){
        console.log("Three numbers have to be entered.");
        exit();
    }
    const corner2 = (await input(`Enter the coordinates of opposite corner of the world. Example: 10 -40 10 > `)).split(" ").map(Number);
    if(corner2.length !== 3){
        console.log("Three numbers have to be entered.");
        exit();
    }

    const envBox = [
        [Math.min(corner1[0], corner2[0]), Math.min(corner1[1], corner2[1]), Math.min(corner1[2], corner2[2])],
        [Math.max(corner1[0], corner2[0]), Math.max(corner1[1], corner2[1]), Math.max(corner1[2], corner2[2])],
    ];

    await input(`envBox ${JSON.stringify(envBox)}  Write in the config.json when executing BeliefNest. Press ENTER to continue.`)

    await input(`Execute "/op operator" in the server terminal, and press ENTER.`)

    const bot = mineflayer.createBot({
        host: mcHost,
        port: mcPort,
        username: "operator",
        disableChatSigning: true,
        checkTimeoutInterval: 60 * 60 * 1000,
    });

    bot.once('spawn', async () => {
        console.log("Bot spawned and ready.");
        // プログレスバーの作成
        const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

        try {
            const blocks = [];
            const chests = [];

            const [x1, y1, z1] = envBox[0];
            const [x2, y2, z2] = envBox[1];

            const [minX, maxX] = [Math.min(x1, x2), Math.max(x1, x2)];
            const [minY, maxY] = [Math.min(y1, y2), Math.max(y1, y2)];
            const [minZ, maxZ] = [Math.min(z1, z2), Math.max(z1, z2)];

            const totalBlocks = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);

            progressBar.start(totalBlocks, 0);
            let processedBlocks = 0;

            bot.chat(`/gamemode creative @s`)

            for (let x = minX; x <= maxX; x++) {
                for (let z = minZ; z <= maxZ; z++) {
                    for (let y = minY; y <= maxY; y++) {
                        let block = bot.blockAt(new Vec3(x, y, z));
                        if(!block){
                            // block is null when that point is not loaded
                            bot.chat(`/tp @s ${x} ${y} ${z}`)
                            const interval = 5;
                            const maxSec = 30
                            for(let trial = 0; trial < 20/interval * maxSec; trial++){
                                block = bot.blockAt(new Vec3(x, y, z));
                                if(block){
                                    break;
                                }
                                await bot.waitForTicks(interval);
                            }
                            //await bot.waitForChunksToLoad();
                        }
                        if(!block){
                            throw new Error(`Block at (${x},${y},${z}) could not be loaded.`)
                        }

                        const blockData = {
                            position: [x, y, z],
                            name: block.name,
                        }
                        const properties = block.getProperties();
                        if(Object.keys(properties).length > 0){
                            blockData.properties = properties;
                        }
                        blocks.push(blockData);

                        // Check if the block is a chest
                        if (block.name === 'chest' || block.name === 'trapped_chest') {
                            bot.chat(`/tp @s ${x} ${y + 1} ${z}`);
                            await bot.waitForTicks(20);
                            const chestBlock = await bot.openContainer(block);
                            if (!chestBlock) {
                                throw new Error("Failed to open chest.");
                            }

                            const chestInfo = {position: [x, y, z]};

                            for(const item of chestBlock.containerItems()){
                                if(!chestInfo[item.name]){
                                    chestInfo[item.name] = 0;
                                }
                                chestInfo[item.name] += item.count;
                            }

                            chests.push(chestInfo);

                            chestBlock.close();
                        }

                        processedBlocks++;
                        progressBar.update(processedBlocks);
                    }
                }
            }

            progressBar.stop();

            const humanMcName = await input(`Block state is successfully recorded. Next, record agents' states. First, join the server and enter your minecraft id > `)
            let humanEntity;
            try{
                bot.chat(`/tp @s ${humanMcName}`);
                await bot.waitForTicks(20);
                humanEntity = bot.players[humanMcName].entity;
            } catch(e){
                throw new Error(`Could not find the player "${humanMcName}".`);
            }
            const status = {};
            while(true){
                await input(`Stand at the initial position of an agent, and press ENTER.`)
                const pos = roundVec3(humanEntity.position, 2);
                const mcName = await input(`Position is ${pos}. Enter the agent name whose initial position is here > `);
                status[mcName] = {
                    visible: {
                        position: {__Vec3__: [pos.x, pos.y, pos.z]},
                        yaw: Math.round(humanEntity.yaw * 100) / 100,
                        pitch: Math.round(humanEntity.pitch * 100) / 100
                    }, 
                    hidden: {}
                }
                let ans;
                while(!['y','n'].includes(ans)){
                    ans = (await input(`${mcName}'s initial position is recorded. Do you add another agent? ([y]/n) > `)) || "y";
                }
                if(ans === "n"){
                    break;
                }
            }

            // Write to JSON file
            const data = {
                blocks: {
                    __Vec3Map__: blocks
                },
                containers: {
                    __Vec3Map__: chests
                },
                events: {},
                status: status
            };

            fs.writeFileSync(destFile, JSON.stringify(data, null, "\t"));
            console.log(`Complete! Initial state data has been written to ${destFile}`);

        } catch (err) {
            progressBar.stop();
            console.error("Error while fetching blocks: ", err);
        } finally {
            bot.quit();
        }
    });
}

generate_init_state()