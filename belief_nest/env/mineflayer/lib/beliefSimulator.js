const fs = require('fs');
const path = require('path');
const log4js = require('log4js');

const { McWorldManager } = require('./mcWorldManager');
const { LoggingWrapper, PersistentWorker, buildBranchCkptDir, copyFiles, containsInvalidCharacters } = require('./utils');
const { isReadable } = require('stream');

BOTWORKER_FILE = __dirname + "/botWorker.js"


class BotPlayer{
    static #isCreating = false;

    constructor() {
        if (!BotPlayer.#isCreating) {
            throw new Error("Use BotPlayer.createInstance() to create an instance.");
        }
    }

    static async createInstance({mcName, agentName, outerSim, parentSimPort=null, isAdmin=false, inventory=[], equipment=[]}){
        BotPlayer.#isCreating = true;
        const player = new BotPlayer();
        BotPlayer.#isCreating = false;

        player.mcName = mcName;
        player.agentName = agentName;
        player.outerSim = outerSim;
        player.isAdmin = isAdmin;
        player.childSim = null;

        let branchCkptDir;
        if(isAdmin){
            branchCkptDir = buildBranchCkptDir(
                player.outerSim.ckptDir, 
                player.outerSim.parentPlayers,
                player.outerSim.branchPath
            )
        }

        const requirePortSetting = (player.outerSim.parentPlayers.length >=1) && isAdmin;

        const workerData = {
            mcHost: player.outerSim.mcHost,
            mcPort: player.outerSim.mcPort,
            mcName: mcName,
            offset: player.outerSim.offset,
            envBox: player.outerSim.envBox,
            isAdmin: isAdmin,
            mqHost: player.outerSim.mqHost,
            adminMcName: player.outerSim.adminBot ? player.outerSim.adminBot.mcName : mcName,
            staticBlockTypes: player.outerSim.staticBlockTypes,
            parentAgentNames: player.outerSim.parentPlayers.map(p=>p.agentName),
            requirePortSetting: requirePortSetting,
            canDigWhenMove: player.outerSim.canDigWhenMove,
            moveTimeoutSec: player.outerSim.moveTimeoutSec,
            stuckCheckIntervalSec: player.outerSim.stuckCheckIntervalSec,
            stuckOffsetRange: player.outerSim.stuckOffsetRange,
            observationConfig: player.outerSim.observationConfig,
            branchCkptDir: branchCkptDir,
            logDir: player.outerSim.logDir,
        }

        player.logger = log4js.getLogger(`${player.outerSim.logger.category}.${player.agentName}`)

        const maxTrial = 5;
        for(let i = 0; i < maxTrial; i++){
            player.botWorker = new PersistentWorker(BOTWORKER_FILE, { workerData: workerData }, mcName, player.logger);
            let result;
            try{
                result = await player.botWorker.waitForSignal("bot_status", 60);
            }catch(e){
                result = e;
            }
            if(result?.data?.success){
                break;
            }
            if(i == maxTrial - 1){
                throw new Error(`Failed to create bot "${mcName}".`);
            }
            player.logger.warn(`${result?.errorMsg || result.message}. Trying again...`)
            await player.botWorker.terminate();
        }

        if(requirePortSetting){
            player.botWorker.postMessage({command:"setPorts", args:{parentSimPort}}, [parentSimPort]);
        }
        player.logger.info("Detected that bot worker is ready.")

        return new LoggingWrapper(player, player.logger);
    }

    async postMessageToWorker(command, args={}, transferList=[]){
        const result = await this.botWorker.postMessage({
            "command": command,
            "args": args,
        }, transferList);
        if(result.errorMsg){
            throw new Error(result.errorMsg);
        }
        return result.data;
    }

    async createChildSim(offset, playerPrefix, mcHost, mcPort, startFollow=true){
        const outer = this.outerSim;
        let parentPlayers = outer.parentPlayers.slice(); // shallow copy
        parentPlayers.push(this);
        
        const branchPath = [...outer.branchPath];
        branchPath.push("follow");
        const branchCkptDir = buildBranchCkptDir(outer.ckptDir, outer.parentPlayers, outer.branchPath);
        const childBranchCkptDir = buildBranchCkptDir(outer.ckptDir, parentPlayers, branchPath);

        fs.mkdirSync(childBranchCkptDir, { recursive: true });
        const initStateFile = path.join(childBranchCkptDir, `state#-1.json`);
        if(!fs.existsSync(initStateFile)){
            fs.copyFileSync(path.join(branchCkptDir, `.internal\\${this.agentName}#state#-1.json`), initStateFile);
        }

        const {port1, port2} = new MessageChannel();
        await outer.addChildSimPort(this.agentName, port1);
      
        const simLogger = log4js.getLogger(`${this.logger.category}.sim`);
        this.childSim = await BeliefSimulator.createInstance({
            offset, 
            envBox: outer.envBox, 
            staticBlockTypes: outer.staticBlockTypes, 
            parentPlayers, 
            mcHost, 
            mcPort, 
            mqHost: outer.mqHost,
            adminAgentName: outer.adminBot.agentName, 
            playerPrefix, 
            canDigWhenMove: outer.canDigWhenMove,
            moveTimeoutSec: outer.moveTimeoutSec,
            stuckCheckIntervalSec: outer.stuckCheckIntervalSec,
            stuckOffsetRange: outer.stuckOffsetRange,
            observationConfig: outer.observationConfig,
            parentSimPort: port2,
            ckptDir: outer.ckptDir,
            logDir: outer.logDir,
            logger: simLogger
        });

        let promises = []
        for(const player of Object.values(outer.players)){
            const p = this.childSim.joinBotPlayer({
                agentName: player.agentName,
                doUpdateAgentInfo: false
            });
            promises.push(p);
        }
        for(const p of promises){
            await p;
        }
        await this.childSim.updateAgentInfo();
        for(const agentName in outer.players){
            await this.childSim.adminBot.disableTransparency(agentName);
        }
        await this.childSim.loadObservation(true);
        if(startFollow){
            await this.childSim.startFollow();
        }
        return this.childSim;
    }

    async removeChildSim(){
        await this.childSim.close();
        this.childSim = null;
    }

    hasChildSim(){
        return this.childSim !== null;
    }

    getChildSim(){
        if(!this.childSim){
            throw new Error(`Agent "${this.agentName}" on "${this.outerSim.getBeliefPath()}" does not have a child simulator.`);
        }
        return this.childSim;
    }

    async leave(){
        if(this.childSim){
            await this.childSim.close();
            this.childSim = null;
        }
        await this.postMessageToWorker("close");
    }

    async close(){
        await this.leave();
    }

    async execute(code, primitives){
        return await this.postMessageToWorker("execute", {code, primitives});
    }

    async execMcCommands(commands){
        await this.postMessageToWorker("execMcCommands", {commands});
    }

    async getAllMcNames(){
        return await this.postMessageToWorker("getAllMcNames", {});
    }

    async controlObservation(args){
        if(!this.isAdmin){
            throw new Error("controlObservation is only for admin player.")    
        }
        return await this.postMessageToWorker("observation", args);
    }

    async getSimStatus(){
        const response = await this.postMessageToWorker("getSimStatus");
        return response;
    }

    async addChildSimPort(agentName, port){
        return await this.postMessageToWorker("addChildSimPort", {agentName, port}, [port]);
    }

    async removeChildSimPort(agentName){
        return await this.postMessageToWorker("removeChildSimPort", {agentName});
    }

    async updateAgentInfo(agentInfo){
        return await this.postMessageToWorker("updateAgentInfo", { agentInfo });
    }

    async setBlocks(blockInfoList){
        if(!this.isAdmin){
            throw new Error("setBlocks is only for admin player.")    
        }
        await this.postMessageToWorker("setBlocks", {blockInfoList});
    }

    async teleport(mcName, position, pitch, yaw, timeout=5){
        if(!this.isAdmin){
            throw new Error("teleport is only for admin player.")    
        }
        await this.postMessageToWorker("teleport", {mcNameToTeleport:mcName, position, pitch, yaw, timeout})
    }

    async clearBox(){
        if(!this.isAdmin){
            throw new Error("clearBox is only for admin player.")    
        }
        await this.postMessageToWorker("clearBox", {})
    }

    async enableTransparency(agentName=null){
        if(!this.isAdmin){
            throw new Error("enableTransparency is only for admin player.")    
        }
        await this.postMessageToWorker("enableTransparency", {agentName})
    }

    async disableTransparency(agentName=null){
        if(!this.isAdmin){
            throw new Error("disableTransparency is only for admin player.")    
        }
        await this.postMessageToWorker("disableTransparency", {agentName})
    }

    async updateOffset(offset){
        if(!this.isAdmin){
            throw new Error("updateOffset is only for admin player.")    
        }
        await this.postMessageToWorker("updateOffset", {newOffset:offset})
    }
}


class HumanPlayer{
    static #isCreating = false;

    constructor() {
        if (!HumanPlayer.#isCreating) {
            throw new Error("Use HumanPlayer.createInstance() to create an instance.");
        }
    }

    static async createInstance({agentName, outerSim}){
        HumanPlayer.#isCreating = true;
        const player = new HumanPlayer();
        HumanPlayer.#isCreating = false;

        player.mcName = agentName;
        player.agentName = agentName;
        player.outerSim = outerSim;

        player.logger = log4js.getLogger(`${player.outerSim.logger.category}.${player.agentName}`)

        return new LoggingWrapper(player, player.logger);
    }

    async createChildSim(offset, playerPrefix, mcHost, mcPort, startFollow=true){
        const outer = this.outerSim;
        let parentPlayers = outer.parentPlayers.slice(); // shallow copy
        parentPlayers.push(this);
        
        const branchPath = [...outer.branchPath];
        branchPath.push("follow");
        const branchCkptDir = buildBranchCkptDir(outer.ckptDir, outer.parentPlayers, outer.branchPath);
        const childBranchCkptDir = buildBranchCkptDir(outer.ckptDir, parentPlayers, branchPath);

        fs.mkdirSync(childBranchCkptDir, { recursive: true });
        const initStateFile = path.join(childBranchCkptDir, `state#-1.json`);
        if(!fs.existsSync(initStateFile)){
            fs.copyFileSync(path.join(branchCkptDir, `.internal\\${this.agentName}#state#-1.json`), initStateFile);
        }

        const {port1, port2} = new MessageChannel();
        await outer.addChildSimPort(this.agentName, port1);
      
        const simLogger = log4js.getLogger(`${this.logger.category}.sim`);
        this.childSim = await BeliefSimulator.createInstance({
            offset, 
            envBox: outer.envBox, 
            staticBlockTypes: outer.staticBlockTypes, 
            parentPlayers, 
            mcHost, 
            mcPort, 
            mqHost: outer.mqHost,
            adminAgentName: outer.adminBot.agentName, 
            playerPrefix, 
            canDigWhenMove: outer.canDigWhenMove,
            moveTimeoutSec: outer.moveTimeoutSec,
            stuckCheckIntervalSec: outer.stuckCheckIntervalSec,
            stuckOffsetRange: outer.stuckOffsetRange,
            observationConfig: outer.observationConfig,
            parentSimPort: port2,
            ckptDir: outer.ckptDir,
            logDir: outer.logDir,
            logger: simLogger
        });

        let promises = []
        for(const player of Object.values(outer.players)){
            const p = this.childSim.joinBotPlayer({
                agentName: player.agentName,
                doUpdateAgentInfo: false
            });
            promises.push(p);
        }
        for(const p of promises){
            await p;
        }
        await this.childSim.updateAgentInfo();
        for(const agentName in outer.players){
            await this.childSim.adminBot.disableTransparency(agentName);
        }
        await this.childSim.loadObservation(true);
        if(startFollow){
            await this.childSim.startFollow();
        }
        return this.childSim;
    }

    async removeChildSim(){
        await this.childSim.close();
        this.childSim = null;
    }

    hasChildSim(){
        return this.childSim !== null;
    }

    getChildSim(){
        if(!this.childSim){
            throw new Error(`Agent "${this.agentName}" on "${this.outerSim.getBeliefPath()}" does not have a child simulator.`);
        }
        return this.childSim;
    }

    async leave(){
        if(this.childSim){
            await this.childSim.close();
            this.childSim = null;
        }
    }

    async close(){
        await this.leave();
    }
}


class BeliefSimulator{
    static #isCreating = false;

    constructor() {
        if (!BeliefSimulator.#isCreating) {
            throw new Error("Use BeliefSimulator.createInstance() to create an instance.");
        }
    }

    static async createInstance({
        offset, 
        envBox, 
        staticBlockTypes, 
        parentPlayers, 
        mcHost, 
        mcPort, 
        mqHost="localhost",
        adminAgentName="admin",
        playerPrefix="",
        parentSimPort=null,
        canDigWhenMove=true,
        moveTimeoutSec=60,
        stuckCheckIntervalSec=2,
        stuckOffsetRange=0.5,
        observationConfig,
        ckptDir="ckpt",
        logDir="logs",
        logger=null
    }){
        BeliefSimulator.#isCreating = true;
        const sim = new BeliefSimulator();
        BeliefSimulator.#isCreating = false;

        if(logger){
            sim.logger = logger;
        } else {
            sim.logger = log4js.getLogger(); // dummy
        }
        sim.offset = offset;
        sim.envBox = envBox;
        sim.staticBlockTypes = staticBlockTypes;
        sim.parentPlayers = parentPlayers;
        sim.mcHost = mcHost; 
        sim.mcPort = mcPort;
        sim.mqHost = mqHost;
        sim.playerPrefix = playerPrefix;
        sim.canDigWhenMove = canDigWhenMove;
        sim.moveTimeoutSec = moveTimeoutSec;
        sim.stuckCheckIntervalSec = stuckCheckIntervalSec;
        sim.stuckOffsetRange = stuckOffsetRange;
        sim.observationConfig = observationConfig;
        sim.ckptDir = ckptDir;
        sim.logDir = logDir;

        sim.players = {};

        if(parentPlayers.length > 0){
            sim.branchPath = [...parentPlayers.slice(-1)[0].outerSim.branchPath];
            sim.branchPath.push("follow")
        } else {
            sim.branchPath = ["default"];
        }

        const adminMcName = playerPrefix + adminAgentName;
        sim.adminBot = await BotPlayer.createInstance({
            mcName: adminMcName, 
            agentName: adminAgentName, 
            outerSim: sim,
            parentSimPort,
            isAdmin: true
        });
        if(sim.parentPlayers.length > 0){
            sim.mcWorldManager = sim.parentPlayers.slice(-1)[0].outerSim.mcWorldManager;
        } else{
            sim.mcWorldManager = new McWorldManager();
        }
        await sim.mcWorldManager.addSim(sim.getBeliefPath(), mcHost, mcPort, adminMcName);

        await sim.adminBot.enableTransparency();
        await sim.adminBot.execMcCommands("/gamemode spectator @s");

        return new LoggingWrapper(sim, sim.logger);
    }

    getPlayer(agentName){
        const player = this.players[agentName];
        if(!player){
            throw new Error(`Agent "${agentName}" does not exist in "${this.getBeliefPath()}"`);
        }
        return player;
    }

    getBeliefPath(){
        let path = "/" + this.parentPlayers.map(p=>p.agentName).join("/");
        if(this.parentPlayers.length > 0){
            path += "/";
        }
        return path;
    }

    async joinBotPlayer({agentName, position=null, pitch=null, yaw=null, inventory=[], equipment={}, doUpdateAgentInfo=true}){
        if(!agentName){
            throw new Error(`Specify agentName.`)
        }
        if(["operator", "world", this.adminBot.agentName].includes(agentName)){
            throw new Error(`Cannot use "${agentName}" as an agentName.`);
        }
        const mcName = this.playerPrefix + agentName;
        const allMcNames = await this.adminBot.getAllMcNames();
        if(allMcNames.includes(mcName)){
            throw new Error(`Player cannot join the game due to the duplicate minecraft username "${mcName}". Consider changing prefix.`);
        }
        if(mcName.length > 16){
            throw new Error(`Length of player name is too long [length("${mcName}")=${mcName.length} > 16]. Consider shortening the agentName or playerPrefix.`)
        }
        this.players[agentName] = await BotPlayer.createInstance({
            mcName, 
            agentName, 
            outerSim: this, 
            inventory, 
            equipment
        })
        await this.adminBot.execMcCommands(`/op ${mcName}`)
        if(position){
            await this.adminBot.teleport(mcName, position, pitch, yaw);
        }
        
        if(doUpdateAgentInfo){
            await this.updateAgentInfo();
            await this.adminBot.disableTransparency(agentName);
        }
    }

    async joinHumanPlayer({agentName, position=null, pitch=null, yaw=null, inventory=[], equipment={}, doUpdateAgentInfo=true}){
        if(this.parentPlayers.length > 0){
            throw new Error("Human Player can join only in the real world.");
        }
        if(["operator", "world", this.adminBot.agentName].includes(agentName)){
            throw new Error(`Cannot use "${agentName}" as an agentName.`);
        }
        const mcName = agentName;
        const allMcNames = await this.adminBot.getAllMcNames();
        if(!allMcNames.includes(mcName)){
            throw new Error(`Player ${mcName} does not exist.`)
        }
        this.players[agentName] = await HumanPlayer.createInstance({agentName, outerSim:this})
        if(position){
            await this.adminBot.teleport(mcName, position, pitch, yaw);
        }
        
        if(doUpdateAgentInfo){
            await this.updateAgentInfo();
        }
    }

    async leavePlayer(agentName, doUpdateAgentInfo=true){
        const player = this.getPlayer(agentName);
        await player.leave()
        delete this.players[agentName]
        
        if(doUpdateAgentInfo){
            await this.updateAgentInfo();
        }
    }

    async updateAgentInfo(){
        const agentInfo = {};
        for(const agentName in this.players){
            agentInfo[agentName] = {mcName: this.players[agentName].mcName};
        }

        const promises = [];

        let p = this.adminBot.updateAgentInfo(agentInfo);
        promises.push(p);

        for(const agentName in this.players){
            if(this.players[agentName] instanceof BotPlayer){
                p = this.players[agentName].updateAgentInfo(agentInfo);
                promises.push(p);
            }
        }
        for(const p of promises){
            await p;
        }
    }

    async getSimStatus(){
        return await this.adminBot.getSimStatus()
    }

    getBranchPath(){
        return this.branchPath;
    }

    async switchBranch(branchPath){
        await this.dumpObservation({recursive:true, stop:true});
        await this._switchBranch(branchPath);
        if(branchPath.slice(-1)[0] === "follow"){
            await this.startFollow();
        } else {
            await this.switchMode("observe");
        }

        const promises = [];
        let p;
        for(const agentName in this.players){
            if(this.players[agentName].hasChildSim()){
                const sim = this.players[agentName].getChildSim();
                p = sim.startFollow(true);
                promises.push(p);
            }
        }
        for(const p of promises){
            await p;
        }
    }

    async _switchBranch(branchPath){
        for(const name of branchPath){
            if(containsInvalidCharacters(name)){
                throw new Error(`Invalid character is found in branch path. Specified branch path: ${branchPath}`);
            }
        }
        const oldBranchPath = this.branchPath;
        const oldBranchCkptDir = buildBranchCkptDir(this.ckptDir, this.parentPlayers, oldBranchPath);

        this.branchPath = branchPath;
        const newBranchCkptDir = buildBranchCkptDir(this.ckptDir, this.parentPlayers, branchPath);

        if(!fs.existsSync(newBranchCkptDir)){
            fs.mkdirSync(newBranchCkptDir, { recursive: false });

            copyFiles(oldBranchCkptDir, newBranchCkptDir);
            if(fs.existsSync(path.join(oldBranchCkptDir, ".internal"))){
                fs.mkdirSync(path.join(newBranchCkptDir, ".internal"));
                copyFiles(path.join(oldBranchCkptDir, ".internal"), path.join(newBranchCkptDir, ".internal"));
            }
        }
        
        const promises = [];
        let p = this.updateBranchCkptDir(newBranchCkptDir);
        promises.push(p);

        for(const agentName in this.players){
            if(this.players[agentName].hasChildSim()){
                const childSim = this.players[agentName].getChildSim();

                const childBranchPath = [...branchPath]
                childBranchPath.push("follow");
                p = childSim._switchBranch(childBranchPath);
                promises.push(p);
            }
        }
        for(const p of promises){
            await p;
        }
    }

    async overwriteState(blockState, chestState/*, agentState*/){
        const responseData = await this.adminBot.controlObservation({
            subcommand: "overwriteState",
            args:{ 
                blockState, 
                containerState: chestState, 
                /*agentState*/
            },
        });
        return responseData;
    }

    async stop(recursive=false){
        await this.adminBot.controlObservation({subcommand:"stop"});
        if(recursive){
            const promises = [];
            let p;
            for(const agentName in this.players){
                if(this.players[agentName].hasChildSim()){
                    const sim = this.players[agentName].getChildSim();
                    p = sim.stop(true);
                    promises.push(p);
                }
            }
            for(const p of promises){
                await p;
            }
        }
    }

    async startObservation(){
        await this.adminBot.controlObservation({subcommand:"switchMode", args:{mode: "observe"}});
        await this.adminBot.controlObservation({subcommand:"start"});
    }

    async stopObservation(){
        const {mode} = await this.getSimStatus();
        if(mode !== "observe"){
            throw new Error(`Cannot stop observation because mode is "${mode}".`);
        }
        await this.adminBot.controlObservation({subcommand:"stop"});
    }

    async dumpObservation({recursive=false, stop=false}={}){
        if(recursive){
            const promises = [];
            let p;
            for(const agentName in this.players){
                if(this.players[agentName].hasChildSim()){
                    const sim = this.players[agentName].getChildSim();
                    const {mode:childMode, isActive:childIsActive} = await sim.getSimStatus();
                    if(childMode === "follow" && childIsActive){
                        p = sim.stopFollow(true);
                        promises.push(p);
                    }
                }
            }
            for(const p of promises){
                await p;
            }
        }

        const {mode, isActive} = await this.getSimStatus();
        let endTick;
        switch(mode){
            case "observe":
                await this.stopObservation();
                ({tick:endTick} = await this.getSimStatus());
                break;

            case "follow":
                if(!isActive){
                    throw new Error("Cannot dump observation because following is not running.");
                }
                await this.stopFollow();
                endTick = await this.parentPlayers.slice(-1)[0].outerSim.dumpObservation({recursive:false, stop:false}); 
                break;

            default: throw new Error(`Invalid mode: ${mode}`);
        }

        return await this._dumpObservation({endTick, mode, wasActive:isActive, recursive, stop});
    }

    async _dumpObservation({endTick, mode, wasActive, recursive=false, stop=false}={}){

        switch(mode){
            case "observe":
                ({tick:endTick} = await this.adminBot.controlObservation({subcommand:"dump", args:{stop}}));
                if(wasActive){
                    await this.startObservation(); 
                }
                break;

            case "follow": 
                await this.adminBot.controlObservation({subcommand:"setStopFollowTick", args:{tick:endTick}});
                await this.startFollow();
                const {tick} = await this.adminBot.controlObservation({subcommand:"dump", args:{endTick, stop}});
                if(endTick !== tick){
                    throw new Error(`endTick (${endTick}) !== savedLastTick (${tick})`);
                } 
                break;
                
            default: throw new Error(`Invalid mode: ${mode}`);
        }

        if(recursive){
            const promises = [];
            let p;
            for(const agentName in this.players){
                if(this.players[agentName].hasChildSim()){
                    const sim = this.players[agentName].getChildSim();
                    const {mode:childMode} = await sim.getSimStatus();
                    if(childMode === "follow"){
                        p = await sim._dumpObservation({endTick, mode:"follow", recursive:true});
                        promises.push(p);
                    }
                }
            }
            for(const p of promises){
                await p;
            }
        }

        return endTick;
    }

    async loadObservation(doInitialize){
        await this.adminBot.controlObservation({subcommand:"load", args: {doInitialize}});
    }

    async startFollow(recursive=false){
        await this.adminBot.controlObservation({subcommand:"switchMode", args:{mode: "follow"}});
        await this.adminBot.controlObservation({subcommand:"start"});
        if(recursive){
            const promises = [];
            let p;

            for(const agentName in this.players){
                if(this.players[agentName].hasChildSim()){
                    const sim = this.players[agentName].getChildSim();
                    p = sim.startFollow(true);
                    promises.push(p);
                }
            }
            for(const p of promises){
                await p;
            }
        }
    }

    async stopFollow(recursive=false, force=false){
        const {mode} = await this.getSimStatus();
        if(mode === "follow"){
            await this.adminBot.controlObservation({subcommand:"stop", args:{force}});
        } else {
            if(!recursive) 
                throw new Error(`Cannot stop observation because mode is "${mode}".`);
        }

        if(recursive){
            const promises = [];
            let p;

            for(const agentName in this.players){
                if(this.players[agentName].hasChildSim()){
                    const sim = this.players[agentName].getChildSim();
                    const {mode:childMode, isActive:childIsActive} = await sim.getSimStatus();
                    if(childMode === "follow" && childIsActive){
                        p = sim.stopFollow(true, force);
                        promises.push(p);
                    }
                }
            }
            for(const p of promises){
                await p;
            }
        }
    }

    async switchMode(mode){
        await this.adminBot.controlObservation({subcommand:"switchMode", args:{mode}});
    }

    async updateBranchCkptDir(branchCkptDir){
       await this.adminBot.controlObservation({subcommand:"updateBranchCkptDir", args: {branchCkptDir}});
    }

    async updateOffset(offset){
        throw new Error("Not implemented yet.");

        this.offset = offset

        /* transfer blocks, record players' positions */
        
        let promises = []
        let p;

        p = this.adminBot.updateOffset(offset);
        promises.push(p);
        for(const agentName in this.players){
            p = this.players[agentName].updateOffset(offset);
            promises.push(p)
        }
        for(const p of promises){
            await p;
        }

        /* transfer players */
    }

    async addChildSimPort(agentName, port){
        this.logger.debug("Calling: addChildSimPort()")
        await this.adminBot.addChildSimPort(agentName, port);
        this.logger.debug("Finished: addChildSimPort()")
    }

    async removeChildSimPort(agentName){
        await this.adminBot.removeChildSimPort(agentName);
    }

    async close(){
        await this.adminBot.controlObservation({subcommand:"stop", args:{force:true}});

        let promises = [];
        let p;
        for(const agentName in this.players){
            p = this.leavePlayer(agentName);
            promises.push(p)
        }
        await this.adminBot.clearBox();
        p = this.adminBot.close();
        promises.push(p);
        for(const p of promises){
            await p;
        }
        this.adminBot = null;
        await this.mcWorldManager.removeSim(this.getBeliefPath());
    }
}


module.exports = { BeliefSimulator };