const fs = require('fs');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');

const mineflayer = require('mineflayer');
const Vec3 = require('vec3');
const amqp = require('amqplib');

const skills = require("./skillLoader");
const { WorkerLogger, getFormattedDateTime, dumpToJson, loadFromJson, handleError, isErrorMessage } = require("./utils");
const { getMyAdditionalStatus } = require("./observe/status");
const { teleport, setBlocks, clearBox, execMcCommands, enableTransparency, disableTransparency } = require("./mcUtils");
const { ObservationManager } = require("./observe/observationManager");


const mcHost = workerData.mcHost;
const mcPort = workerData.mcPort;
const mcName = workerData.mcName;
const initialOffsetVec3 = new Vec3(...workerData.offset);
const envBox = workerData.envBox;
const isAdmin = workerData.isAdmin;
const adminMcName = workerData.adminMcName ?? "admin";
const staticBlockTypes = workerData.staticBlockTypes ?? [];
const parentAgentNames = workerData.parentAgentNames;
const requirePortSetting = workerData.requirePortSetting;
const canDigWhenMove = workerData.canDigWhenMove ?? true;
const moveTimeoutSec = workerData.moveTimeoutSec ?? 60;
const createBotTimeoutSec = workerData.createBotTimeoutSec ?? 20;
const logDir = workerData.logDir;

let observationConfig;
let initialBranchCkptDir;
let parentSimPort;
if(isAdmin){
    observationConfig = workerData.observationConfig;    
    initialBranchCkptDir = workerData.branchCkptDir;
}

const logger = new WorkerLogger(parentPort)
let bot;
let obsManager;

let mqConn;
let mqChannel;
amqp.connect('amqp://localhost')
.then((v)=>{
    mqConn = v;
})
.catch((e)=>{
    throw new Error(`Failed to connect to rabbitmq server. msg="${e.message}"`);
});
let prevAdditionalStatusJson = "{}";

function sendResponse(id, data={}, errorMsg=null){
    if([undefined, null].includes(data)){
        data = {};
    }
    if(errorMsg === undefined){
        errorMsg = null;
    }
    parentPort.postMessage({
        type: "response",
        id: id,
        result:{data, errorMsg}
    })
}

function sendSignal(signal, data={}, errorMsg=null){
    if([undefined, null].includes(data)){
        data = {};
    }
    if(errorMsg === undefined){
        errorMsg = null;
    }
    parentPort.postMessage({
        type: "signal", 
        id: signal, 
        result:{data, errorMsg}
    });
}

function getMcData(){
    const mcData = require("minecraft-data")(bot.version);
    mcData.itemsByName["leather_cap"] = mcData.itemsByName["leather_helmet"];
    mcData.itemsByName["leather_tunic"] =
        mcData.itemsByName["leather_chestplate"];
    mcData.itemsByName["leather_pants"] =
        mcData.itemsByName["leather_leggings"];
    mcData.itemsByName["leather_boots"] = mcData.itemsByName["leather_boots"];
    mcData.itemsByName["lapis_lazuli_ore"] = mcData.itemsByName["lapis_ore"];
    mcData.blocksByName["lapis_lazuli_ore"] = mcData.blocksByName["lapis_ore"];

    return mcData
}

try{
    const timeoutId = setTimeout(()=>{
        sendSignal("bot_status", {success: false}, `Failed to create bot "${mcName}" on ${mcHost}:${mcPort}`)
    }, createBotTimeoutSec*1000)
    bot = mineflayer.createBot({
        host: mcHost,
        port: mcPort,
        username: mcName,
        disableChatSigning: true,
        checkTimeoutInterval: 60 * 60 * 1000,
    });
    clearTimeout(timeoutId);
}catch(e){
    logger.critical(`Failed to create bot "${mcName}" on ${mcHost}:${mcPort}`)
    return;
}

bot.once('spawn', async () => {
    logger.debug(`${mcName} has spawned!`)

    bot.envBox = [new Vec3(...envBox[0]), new Vec3(...envBox[1])];
    bot.agentInfo = {};
    bot.isAdmin = isAdmin;
    bot.adminMcName = adminMcName;
    bot.offsetVec3 = initialOffsetVec3;

    sendSignal("bot_status", {success: true})

    parentPort.on('message', async ({id, data}) => {
        const command = data.command;
        const args = data.args;

        logger.debug(`command "${command}" start`);

        let responseData;
        let errorMsg = null;
        try{
            switch (command) {
                case "execute":         responseData = await execute(args); break;
                case "execMcCommands":  _execMcCommands(args); break;
                case "getAllMcNames":   responseData = getAllMcNames(args); break;
                case "updateOffset":    await updateOffset(args); break;
                case "observation":     responseData = await observation(args); break;
                case "updateAgentInfo": updateAgentInfo(args); break;
                case "teleport":        await _teleport(args); break;
                case "setBlocks":       await _setBlocks(args); break;
                case "clearBox":        await _clearBox(args); break;
                case "enableTransparency": _enableTransparency(args); break;
                case "disableTransparency": _disnableTransparency(args); break;
                case "setPorts":        setPorts(args); break;
                case "getSimStatus":    responseData = getSimStatus(args); break;
                case "addChildSimPort": addChildSimPort(args); break;
                case "removeChildSimPort": removeChildSimPort(args); break;
                case "close":            await close(); break;
                default:
                    sendResponse(id, {}, `Invalid command "${command}"`);
                    return;
            }
        }catch(e){
            errorMsg = e.stack;
        }
        sendResponse(id, responseData, errorMsg);
        logger.debug(`command "${command}" finished`);
    });

    if(isAdmin){
        let waitingForPortSetting = false;
        while(requirePortSetting && !parentSimPort){
            await bot.waitForTicks(10);
            logger.info("Waiting for port setting...")
            waitingForPortSetting = true;
        }
        if(waitingForPortSetting){
            logger.info("Port setting done");
            waitingForPortSetting = false;
        }

        obsManager = new ObservationManager({
            bot: bot,
            parentSimPort: parentSimPort,
            branchCkptDir: initialBranchCkptDir,
            staticBlockTypes: staticBlockTypes,
            parentAgentNames: parentAgentNames,
            logger: logger,
            config: observationConfig, 
        });

        bot.additionalStatus = {};
        bot.on("updateStatus", (agentName, eventJsonMsg)=>{
            const event = loadFromJson(eventJsonMsg);
            bot.additionalStatus[agentName] = event.status;
        });

    } else {
        mqChannel = await mqConn.createChannel();
        const EXCHANGE = parentAgentNames.join("-") + "_agent_control";
        const DATA_QUEUE = parentAgentNames.join("-") + "_agent_data";
        let interval;

        await mqChannel.assertExchange(EXCHANGE, 'fanout', { durable: false });
        const q = await mqChannel.assertQueue('', { exclusive: true });
        mqChannel.bindQueue(q.queue, EXCHANGE, '');

        await mqChannel.assertQueue(DATA_QUEUE, { durable: false });

        let eventJsonMsgArr = [];
        bot.on("event", (eventJsonMsg)=>{
            if(interval){
                eventJsonMsgArr.push(eventJsonMsg);
                const event = loadFromJson(eventJsonMsg);
                logger.debug(`event recorded: ${event.name}`);
            }
        });

        mqChannel.consume(q.queue, (msg) => {
            const command = msg.content.toString();
    
            switch(command){
                case "start": 
                    if(!interval){
                        eventJsonMsgArr = [];
                        prevAdditionalStatusJson = "{}";
                        interval = setInterval(() => {
                            const additionalStatus = getMyAdditionalStatus(bot);
                            const statusJson = dumpToJson(additionalStatus);
                            if(statusJson !== prevAdditionalStatusJson){
                                prevAdditionalStatusJson = statusJson;
                                eventJsonMsgArr.push(dumpToJson({
                                    name: "updateStatus",
                                    status: additionalStatus
                                }));
                            }

                            if(!eventJsonMsgArr.length){
                                return;
                            }
                            let agentName = null;
                            for(const tAgentName in bot.agentInfo){
                                if(bot.agentInfo[tAgentName].mcName === mcName){
                                    agentName = tAgentName;
                                    break;
                                }
                            }
                            if(agentName === null){
                                logger.error(`mcName "${mcName}" was not in bot.agentInfo. bot.agentInfo=${JSON.stringify(bot.agentInfo)}`);
                                return;
                            }
                            const data = {
                                agentName: agentName,
                                eventJsonMsgArr: eventJsonMsgArr
                            }
                            eventJsonMsgArr = [];
                            //logger.info(`#####send ${JSON.stringify(data)}`)
                            mqChannel.sendToQueue(DATA_QUEUE, Buffer.from(JSON.stringify(data)));
                        }, 50);
                    }
                    break;
                case "stop": 
                    if(interval){
                        clearInterval(interval);
                        interval = null;
                        eventJsonMsgArr = [];
                        prevAdditionalStatusJson = {};
                    }
                    break;
                default: throw new Error(`Invalid command "${command}".`);
            }
        }, { noAck: true });
    }

    const { pathfinder } = require("mineflayer-pathfinder");
    bot.loadPlugin(pathfinder);

    bot.on('error', (err) => logger.error(`Error in worker of ${mcName}: ${err.stack}`));
    bot.on('kicked', (msg) => logger.error(`${mcName} kicked: ${msg}`));
    bot.on('end', () => logger.info(`${mcName} disconnected.`));
    bot.on('message', (jsonMsg) => {
        const message = jsonMsg.toString();
        if (isErrorMessage(message)) {
            logger.error(`Minecraft command error: ${message}`);
        }
    });

    let movingTickCounter = 0;
    function onTick() {
        if (bot.pathfinder.isMoving()) {
            movingTickCounter++;
            if (movingTickCounter >= 20 * moveTimeoutSec) {
                bot.pathfinder.stop();
                movingTickCounter = 0;
            }
        } else {
            movingTickCounter = 0;
        }
    }
    bot.on("physicsTick", onTick);

    bot.chat("/gamerule sendCommandFeedback false");
});

async function execute({code, primitives=[]}){
    const {
        Movements,
        goals: {
            Goal,
            GoalBlock,
            GoalNear,
            GoalXZ,
            GoalNearXZ,
            GoalY,
            GoalGetToBlock,
            GoalLookAtBlock,
            GoalBreakBlock,
            GoalCompositeAny,
            GoalCompositeAll,
            GoalInvert,
            GoalFollow,
            GoalPlaceBlock,
        },
        pathfinder,
        Move,
        ComputedPath,
        PartiallyComputedPath,
        XZCoordinates,
        XYZCoordinates,
        SafeBlock,
        GoalPlaceBlockOptions,
    } = require("mineflayer-pathfinder");
    const { Vec3 } = require("vec3");

    const mcData = getMcData();

    const movements = new Movements(bot, mcData);
    movements.canDig = canDigWhenMove;
    bot.pathfinder.setMovements(movements);

    let _craftItemFailCount = 0;
    let _killMobFailCount = 0;
    let _mineBlockFailCount = 0;
    let _placeItemFailCount = 0;
    let _smeltItemFailCount = 0;

    const primitivesStr = primitives.join("\n\n");
    const wholeCode = "(async () => {" + primitivesStr + "\n" + code + "})()";
    let success;
    let errorMsg = null;
    try{
        await eval(wholeCode);
        success = true;
    } catch(e){
        success = false;
        errorMsg = handleError(e, code, primitivesStr);
    }
    bot.pathfinder.stop();

    const suffix = success ? "" : "_error"
    const fileToSave = path.join(logDir, `executed_code_${getFormattedDateTime()}_${mcName}${suffix}.txt`);
    fs.writeFileSync(fileToSave, code, 'utf8');
    
    return {success, errorMsg};
}

function _execMcCommands(args){
    args.bot = bot;
    execMcCommands(args);
}

function getAllMcNames(){
    return [...Object.keys(bot.players)];
}

async function updateOffset({ newOffset }){
    if(!(newOffset instanceof Vec3)){
        newOffset = new Vec3(...newOffset);
    }
    bot.offsetVec3 = newOffset;
    
    if(bot.isAdmin){
        await teleport({ bot, mcName, position:new Vec3(0,0,0), pitch:0, yaw:0});
    }
}

async function observation(argObj){
    if(!bot.isAdmin){
        throw new Error(`"observation" is only for admin player. mcName=${mcName}`);
    }
    const subcommand = argObj.subcommand;
    const args = argObj.args;

    let responseData;
    switch(subcommand){
        case "switchMode": obsManager.switchMode(args); break;
        case "start":  await obsManager.start(args);  break;
        case "stop":   await obsManager.stop(args);   break;
        case "dump":   responseData = await obsManager.dump(args); break;
        case "load":   await obsManager.load(args); break;
        case "setStopFollowTick": await obsManager.setStopFollowTick(args); break;
        case "updateBranchCkptDir": await obsManager.updateBranchCkptDir(args); break;
        case "overwriteState": responseData = await obsManager.overwriteState(args); break;
        default: new Error(`Subcommand "${subcommand}" does not exist for observation.`)
    }
    return responseData;
}

function updateAgentInfo({ agentInfo }){
    //logger.debug(`updateAgentInfo   agentNames:[${Object.keys(agentInfo)}]`);
    bot.agentInfo = agentInfo;
}

async function _teleport(args){
    args.bot = bot;
    args.position = new Vec3(...args.position);
    if(args.teleportOffset){
        args.teleportOffset = new Vec3(...args.teleportOffset);
    }
    await teleport(args);
}

async function _setBlocks(args){
    args.bot = bot;
    const blockInfoList = []
    for(const b of args.blockInfoList){
        b.position = new Vec3(...b.position);
        blockInfoList.push(b)
    }
    await setBlocks(args);
}

async function _clearBox(args){
    args.bot = bot;
    await clearBox(args);
}

function _enableTransparency(args){
    args.bot = bot;
    enableTransparency(args);
}

function _disnableTransparency(args){
    args.bot = bot;
    disableTransparency(args);
}

function setPorts({parentSimPort:aParentSimPort}){
    logger.debug("Calling: setPorts");
    parentSimPort = aParentSimPort;
    logger.debug("Finished: setPorts");
}

function getSimStatus(){
    return {"mode":obsManager.mode, "isActive": obsManager.isSchedulerActive, "tick":obsManager.globalTick};
}

async function addChildSimPort({agentName, port}){
    obsManager.addChildSimPort(agentName, port);
    port.on("message", async ({command, args})=>{
        switch(command){
            case "fetch": obsManager.addRequestFromChild(agentName, args); break;
            case "fetch_cancel": obsManager.clearRequest(agentName); break;
            default: throw new Error(`Invalid command "${command}".`);
        }
    })
    
}

async function removeChildSimPort({agentName}){
    obsManager.removeChildSimPort(agentName);
}

async function close(){
    if(obsManager){
        await obsManager.close();
    }
    bot.end();
    if(mqChannel){
        mqChannel.close();
    }
    if(mqConn){
        mqConn.close();
    }
}

logger.info(`${mcName}'s botWorker created`);