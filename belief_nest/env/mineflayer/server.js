const express = require("express");
const bodyParser = require("body-parser");
const fs = require('fs')
const path = require('path')
const log4js = require('log4js')

const { BeliefSimulator } = require("./lib/beliefSimulator")
const { getSim, getFormattedDateTime } = require("./lib/utils")

const app = express();

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: false }));


let world = null;
let logger = null;
let isSetupCompleted = false;

// wrapper to call error handling middleware when error occurred in async function
const asyncWrapper = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

function requireParams(requiredParams) {
    return (req, res, next) => {
        const missingParams = requiredParams.filter(param => !req.body[param]);
        if (missingParams.length > 0) {
            const msg = `Missing required parameters: ${missingParams.join(', ')}`;
            if(logger) logger.warn(msg);
            return res.status(400).json({
                errorMsg: msg
            });
        }
        next();
    };
}

// logging middleware
app.use((req, res, next) => {
    if(logger) logger.debug(`Calling: ${req.path}`);

    if (!isSetupCompleted && req.path !== '/setup') {
        const msg = 'Setup must be completed before making other requests.'
        if (logger) logger.warn(msg); 
        return res.status(403).json({"errorMsg": msg});
    }

    res.on('finish', () => {
        if (logger) logger.debug(`Finished: ${req.path}`);
    });
    next();
});


app.post("/setup", requireParams(['ckptDir', 'logDir']), asyncWrapper(async (req, res) => {
    const ckptDir = req.body.ckptDir;
    const logDir = req.body.logDir;
    
    const mcHost = req.body.mcHost || "localhost";
    const mcPort = req.body.mcPort || 25565;
    const mqHost = req.body.mqHost || "localhost";
    const doJoinAgents = req.body.doJoinAgents !== undefined ? req.body.doJoinAgents : true;
    const doInitializeWorld = req.body.doInitializeWorld !== undefined ? req.body.doInitializeWorld : true;
    const consoleLogLevel = req.body.consoleLogLevel || "info";

    log4js.configure({
        appenders : {
            file : {type : 'file', filename : path.join(logDir, `js_server_${getFormattedDateTime()}.log`)},
            console: { type: 'console' },
            consoleFilter: {
                type: 'logLevelFilter',
                appender: 'console',
                level: consoleLogLevel,
            },
        },
        categories : {
            default : {appenders : ['file', 'consoleFilter'], level : 'trace'},
        }
    });

    logger = log4js.getLogger("js_server");
    const simLogger = log4js.getLogger(`${logger.category}.world`);


    const globalSettingStr = fs.readFileSync(path.join(ckptDir, "config.json"));
    const {envBox, staticBlockTypes, adminAgentName, canDigWhenMove, moveTimeoutSec, stuckCheckIntervalSec, stuckOffsetRange, players, observation:observationConfig} = JSON.parse(globalSettingStr);

    world = await BeliefSimulator.createInstance({
        offset:[0,0,0], 
        envBox, 
        staticBlockTypes,
        parentPlayers: [],
        mcHost, 
        mcPort, 
        mqHost,
        adminAgentName, 
        playerPrefix:"", 
        canDigWhenMove,
        moveTimeoutSec,
        stuckCheckIntervalSec,
        stuckOffsetRange,
        observationConfig,
        ckptDir,
        logDir,
        logger: simLogger
    });
    
    if(doJoinAgents){
        const promises = []
        let p;
        for(const [agentName, info] of Object.entries(players)){
            switch(info.type){
                case "BotPlayer": p = world.joinBotPlayer({agentName, doUpdateAgentInfo:false}); break;
                case "HumanPlayer": p = world.joinHumanPlayer({agentName, doUpdateAgentInfo:false}); break;
                default: throw new Error(`Invalid type: ${info.type}`);
            }
            promises.push(p);
        }
        for(const p of promises){
            await p;
        }
        await world.updateAgentInfo();
        await world.loadObservation(doInitializeWorld);
    }
    await world.switchMode("observe");
    isSetupCompleted = true;
    logger.info("Mineflayer server setup completed");
    
    res.json();
}));

app.post("/join", requireParams(['agentName']), asyncWrapper(async (req, res) => {
    logger.debug(`parameters: ${JSON.stringify(req.body)}`);

    const agentName = req.body.agentName;
    const isHuman = req.body.isHuman !== undefined ? req.body.isHuman : false;
    const inventory = req.body.inventory ? req.body.inventory : {};
    const equipment = req.body.equipment ? req.body.equipment : [null, null, null, null, null, null];
    const skinUrl = req.body.skinUrl;

    if(isHuman){
        await world.joinHumanPlayer({agentName});
    } else{
        await world.joinBotPlayer({
            agentName, inventory, equipment
        });
    }

    res.json();
}));

app.post("/leave", asyncWrapper(async (req, res) => {
    const agentName = req.body.agentName;

    await world.leavePlayer(agentName);

    res.json();
}));

app.post("/execute", asyncWrapper(async (req, res) => {
    const beliefPath = req.body.beliefPath;
    const agentName = req.body.agentName;
    const code = req.body.code;
    const primitives = req.body.primitives;

    const sim = getSim(world, beliefPath);
    const player = sim.getPlayer(agentName);
    const result = await player.execute(code, primitives);

    res.json({
        success: result.success,
        errorMsg: result.errorMsg,
    });
}));

app.post("/execMcCommands", asyncWrapper(async (req, res) => {
    const beliefPath = req.body.beliefPath;
    const agentName = req.body.agentName;
    const commands = req.body.commands;

    const sim = getSim(world, beliefPath);
    const player = sim.getPlayer(agentName);
    await player.execMcCommands(commands);

    res.json();
}));

app.post("/execMcCommandsByAdmin", asyncWrapper(async (req, res) => {
    const beliefPath = req.body.beliefPath;
    const commands = req.body.commands;

    const sim = getSim(world, beliefPath);
    await sim.adminBot.execMcCommands(commands);

    res.json();
}));

app.post("/createSim", requireParams(['beliefPath', 'agentName', 'offset', 'playerPrefix']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const agentName = req.body.agentName;
    const offset = req.body.offset;
    const playerPrefix = req.body.playerPrefix;
    const mcHost = req.body.mcHost ? req.body.mcHost : world.mcHost;
    const mcPort = req.body.mcPort ? req.body.mcPort : world.mcPort;
    const startFollow = req.body.startFollow !== undefined ? req.body.startFollow : true;

    const sim = getSim(world, beliefPath);
    const player = sim.getPlayer(agentName);
    await player.createChildSim(offset, playerPrefix, mcHost, mcPort, startFollow);

    res.json();
}));

app.post("/removeSim", requireParams(['beliefPath']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    if(beliefPath === "/"){
        throw new Error("Cannot remove real world.")
    }

    const sim = getSim(world, beliefPath);
    await sim.stop(true);
    await sim.parentPlayers.slice(-1)[0].removeChildSim();

    res.json();
}));

app.post("/startObservation", requireParams(['beliefPath']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const sim = getSim(world, beliefPath);

    const {mode, isActive} = await sim.getSimStatus();
    if(mode !== "observe" && isActive){
        res.status(500).json({"errorMsg": `Cannot start observation because mode=${mode} is running.`})
        return;
    }
    if(mode === "observe" && isActive){
        logger.warn("Observation has already started. startObservation skipped.");
        res.json();
        return;
    }

    await sim.startObservation();

    res.json();
}));

app.post("/stopObservation", requireParams(['beliefPath']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const sim = getSim(world, beliefPath);

    const {mode, isActive} = await sim.getSimStatus();
    if(mode !== "observe"){
        res.status(500).json({"errorMsg": `Cannot stop observation because mode=${mode}`})
        return;
    }
    if(!isActive){
        logger.warn("Observation has already stopped. stopObservation skipped.");
        res.json()
        return;
    }

    await sim.stopObservation()

    res.json();
}));

app.post("/dumpObservation", requireParams(['beliefPath']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const recursive = req.body.recursive !== undefined ? req.body.recursive : false;

    const sim = getSim(world, beliefPath);
    await sim.dumpObservation({recursive});

    res.json();
}));

app.post("/loadObservation", requireParams(['beliefPath']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const doInitializeWorld = req.body.doInitializeWorld !== undefined ? req.body.doInitializeWorld : true;

    const sim = getSim(world, beliefPath);
    await sim.loadObservation(doInitializeWorld);

    res.json();
}));

app.post("/startFollow", requireParams(['beliefPath']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const sim = getSim(world, beliefPath);

    const {mode, isActive} = await sim.getSimStatus();
    if(mode !== "follow" && isActive){
        res.status(500).json({"errorMsg": `Cannot start following because mode=${mode} is running.`})
        return;
    }
    if(mode === "follow" && isActive){
        logger.warn("Following has already started. startFollow skipped.");
        res.json();
        return;
    }

    await sim.startFollow();

    res.json();
}));

app.post("/stopFollow", requireParams(['beliefPath']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const sim = getSim(world, beliefPath);

    const {mode, isActive} = await sim.getSimStatus();
    if(mode !== "follow"){
        res.status(500).json({"errorMsg": `Cannot stop following because mode=${mode}`})
        return;
    }
    if(!isActive){
        logger.warn("Following has already stopped. stopFollow skipped.");
        res.json()
        return;
    }

    await sim.stopFollow();

    res.json();
}));

app.post("/switchBranch", requireParams(['beliefPath', 'branchName']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const branchName = req.body.branchName;

    const sim = getSim(world, beliefPath);

    const branchPath = [...sim.getBranchPath()];
    branchPath[branchPath.length - 1] = branchName;
    await sim.switchBranch(branchPath);

    res.json();
}));

app.post("/overwriteState", requireParams(['beliefPath', 'blockState', 'chestState'/*, 'agentState'*/]), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const blockState = req.body.blockState;
    const chestState = req.body.chestState;
    /*const agentState = req.body.agentState;*/

    const sim = getSim(world, beliefPath);
    const responseData = await sim.overwriteState(blockState, chestState/*, agentState*/);

    res.json(responseData);
}));

app.post("/chat", requireParams(['beliefPath', 'agentName', 'msg']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const agentName = req.body.agentName;
    const msg = req.body.msg;
    const silent = req.body.silent ?? false;

    const sim = getSim(world, beliefPath);
    const simStatus = await sim.getSimStatus();

    let errorMsg;
    if(simStatus.mode !== "observe"){
        errorMsg = `Mode of simulator ${beliefPath} must be observe, not ${simStatus.mode}.`;
    }
    else if(!simStatus.isActive){
        errorMsg = `Observation is not running.`;
    }

    if(errorMsg){
        res.json({success: false, errorMsg})
    } else {
        const player = sim.getPlayer(agentName);
        await player.chat({msg, silent});

        res.json({success: true, errorMsg:null});
    }
}));

app.post("/getSimStatus", asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath || null;

    const info = [];
    async function addInfo(sim){
        const simStatus = await sim.getSimStatus();

        const parentPlayers = sim.parentPlayers.map(p=>p.agentName);
        const branchPath = sim.getBranchPath();

        let parts = [`world[${branchPath[0]}]`];
        for (let i = 0; i < parentPlayers.length; i++) {
            parts.push(`${parentPlayers[i]}[${branchPath[i+1]}]`);
        }

        info.push({
            branchStr: parts.join("."),
            mode: simStatus.mode,
            isActive: simStatus.isActive,
            tick: simStatus.tick
        })
    }

    async function recursivePut(sim){
        await addInfo(sim);
        for(const agentName in sim.players){
            const player = sim.players[agentName];
            if(player.hasChildSim()){
                await recursivePut(player.getChildSim());
            }
        }
    }

    if(beliefPath){
        const sim = getSim(world, beliefPath);
        await addInfo(sim)
    } else {
        await recursivePut(world);
    }
    logger.info(info)

    res.json(info);
}))

app.post("/getBranchStr", requireParams(['beliefPath']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;

    const sim = getSim(world, beliefPath);

    const branchPath = [...sim.getBranchPath()];
    branchPath[branchPath.length - 1] = branchName;
    await sim.switchBranch(branchPath);

    res.json();
}));

app.post("/getOffset", requireParams(['beliefPath']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const sim = getSim(world, beliefPath);
    offset = sim.offset;

    res.json({"offset": offset});
}));

app.post("/updateOffset", requireParams(['beliefPath', 'offset']), asyncWrapper(async (req,res)=> {
    const beliefPath = req.body.beliefPath;
    const offset = req.body.offset;
    const sim = getSim(world, beliefPath);
    await sim.updateOffset(offset);

    res.json();
}));

app.post("/close", asyncWrapper(async (req,res)=> {
    await world.close();

    res.json();
}));

// error handling middleware
app.use((err, req, res, next) => {
    if (logger) logger.error(`${err.stack}`);
    res.status(500).json({ "errorMsg": err.message });
});

// 404 error handling middleware
app.use((req, res) => {
    if (logger) logger.debug(`404 Not Found: ${req.path}`);
    res.status(404).json({ "errorMsg": `Not Found (${req.path})` });
});


// Server listening to PORT 3000
const DEFAULT_PORT = 3000;
const PORT = process.argv[2] || DEFAULT_PORT;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
