const fs = require('fs');
const path = require('path');
const AsyncLock = require('async-lock');
const Vec3 = require('vec3');
const amqp = require('amqplib');

const { hasVec3NaN, cloneObj, dumpToJson, loadFromJson, mergeSortedMapJsonStrings } = require('../utils');
const { teleport, setBlocks, clearBox, setContainer, setEquipment, setInventoryAndEquipment, enableTransparency, disableTransparency } = require('../mcUtils');
const ObservationRecord = require('./observationRecord');
const { getStatus } = require('./status');
const { getPlayerVisibility, getBlockVisibility } = require('./visibility');

const OnBlockUpdate = require('./onBlockUpdate');
const OnChat = require('./onChat');
const OnCraftItem = require('./onCraftItem');
const OnGiveItemToOther = require('./onGiveItemToOther');
const OnMineBlock = require('./onMineBlock');
const onMove = require('./onMove');
const onSmeltItem = require('./onSmeltItem');
const OnThink = require('./onThink');
const OnUseChest = require('./onUseChest');
const OnUseLever = require('./onUseLever')

const lock = new AsyncLock();

class ObservationManager{
    constructor({bot, parentSimPort, branchCkptDir, staticBlockTypes, parentAgentNames, logger, config}){
        this.bot = bot;
        this.parentSimPort = parentSimPort;
        this.branchCkptDir = branchCkptDir;
        this.staticBlockTypes = staticBlockTypes;
        this.logger = logger;

        config = config ? config : {};
        this.playerObsInterval = config.playerObsInterval || 5; // ticks
        this.blockObsInterval = config.blockObsInterval || 10;  // ticks
        this.maxVisibleDistance = config.maxVisibleDistance || 20
        this.disablePositionFiltering = config.disablePositionFiltering !== undefined ? config.disablePositionFiltering : false;
        this.useLegacyBlockVis = config.useLegacyBlockVis ?? false;

        // this.positionMemoryMode = config.positionMemoryMode || "last_seen"; // "last_seen", "current"
        this.positionMemoryMode = "last_seen"
        
        this.observation = {
            objective : new ObservationRecord(this.bot, this.positionMemoryMode, this.logger),
            subjective: {}
        };
        this.isObserving = false;
        this.isFollowing = false;
        this.isSending = false;

        this.globalTick = null;

        this.nonExistentAgentNames = [];
        
        this.previousObsTick = {player:null, block:null}
        this.observeBound = this.observe.bind(this);
        this.followIntervalHandler = null;

        this.mode = null;
        this.isSchedulerActive = false;
        
        const eventClasses = [OnBlockUpdate, OnChat, OnCraftItem, OnGiveItemToOther, OnMineBlock, onMove, onSmeltItem, OnThink, OnUseChest, OnUseLever];
        this.eventInstances = {};
        for(const obsClass of eventClasses){
            this.eventInstances[obsClass.name] = new obsClass(bot, config[obsClass.name]);
        }

        if(this.parentSimPort){
            this.parentSimPort.on("message", this.receiveFromParent.bind(this));
            this.historyQueueToFollow = [];
        }
        this.childSimPorts = {};
        this.childRequests = {};
        this.sendDataBound = this.sendDataToChildSim.bind(this);
        this.sendDataIntervalHandler = setInterval(this.sendDataBound, 50);

        this.stopFollowTick = null;
        this.replyFromParent = {};

        this.stuckTickCounter = 0;
        this.stuckPosList = [];

        this.mqConn = null;
        this.mqChannel = null;
        this._connectMq();
        this.AGENT_CONTROLL_EXCHANGE = parentAgentNames.join("-") + "_agent_control";
        this.AGENT_DATA_QUEUE = parentAgentNames.join("-") + "_agent_data";

        this.blockOverwriteQueue = [];

        this.followModeCache = {};

        this.mcData = require("minecraft-data")(this.bot.version);
    }

    async _connectMq(){
        this.mqConn = await amqp.connect('amqp://localhost');
        this.mqChannel = await this.mqConn.createChannel();
        await this.mqChannel.assertQueue(this.AGENT_DATA_QUEUE, { durable: false });
        this.mqChannel.consume(this.AGENT_DATA_QUEUE, (msg) => {
            const jsonMsg = msg.content.toString();
            if(this.mode === "observe" && this.isSchedulerActive){
                const data = JSON.parse(jsonMsg);
                const agentName = data.agentName;
                const eventJsonMsgArr = data.eventJsonMsgArr;
                
                for(const eventJsonMsg of eventJsonMsgArr){
                    const event = loadFromJson(eventJsonMsg);
                    this.bot.emit(event.name, agentName, eventJsonMsg);
                }
            } else {
                this.logger.warn(`Data received but observation is not active (mode=${this.mode}, isActive=${this.isSchedulerActive}). Data ignored.`);
            }
        }, { noAck: true });
    }

    switchMode({mode}){
        if(!["observe", "follow"].includes(mode)){
            throw new Error(`Invalid mode ${mode}.`);
        }
        if(this.isSchedulerActive){
            throw new Error(`Stop "${mode}" before switching mode.`);
        }
        this.mode = mode;
    }

    async start(){
        this.logger.debug("Calling: obsevationManager.start()");

        if(this.isSchedulerActive){
            throw new Error(`Already started (mode ${this.mode}).`);
        }

        this.isSchedulerActive = true;
        switch(this.mode){
            case "observe":
                this.globalTick++;
                this.bot.on('physicsTick', this.observeBound);
                for(const eventInstance of Object.values(this.eventInstances)){
                    eventInstance.start();
                }
                while(!this.mqConn){
                    this.logger.info("Waiting for rabbitMQ connection ready...");
                    await this.bot.waitForTicks(10);
                }
                this.mqChannel.publish(this.AGENT_CONTROLL_EXCHANGE, '', Buffer.from("start"));
                break;
            
            case "follow":
                this.historyQueueToFollow = [];
        
                this.requestDataToParent(this.globalTick);
                this.followIntervalHandler = setInterval(this.follow.bind(this), 50);
                break;

            case null: throw new Error(`Set mode before starting.`);

            default: throw new Error(`Invalid mode ${mode}`);
        }
        
        this.logger.debug("Finished: obsevationManager.start()");
    }

    async stop({strict=false, force=false}={}){
        this.logger.debug("Calling: obsevationManager.stop()");

        if(this.isSchedulerActive){
            this.isSchedulerActive = false;
            switch(this.mode){
                case "observe":
                    this.bot.removeListener('physicsTick', this.observeBound);
                    for(const eventInstance of Object.values(this.eventInstances)){
                        eventInstance.stop();
                    }
            
                    if(this.isObserving){
                        while(this.isObserving){
                            this.logger.info(`Waiting for completing observation...`);
                            await this.bot.waitForTicks(1);
                        }
                        this.logger.info(`Observation completed.`);
                    }
                    this.mqChannel.publish(this.AGENT_CONTROLL_EXCHANGE, '', Buffer.from("stop"));
                    break;
    
                case "follow":
                    if(!force && (this.historyQueueToFollow.length > 0 || this.isFollowing)){
                        while(this.historyQueueToFollow.length > 0 || this.isFollowing){
                            this.logger.info(`Waiting for completing following... Queue length=${this.historyQueueToFollow.length}`);
                            await this.bot.waitForTicks(10);
                        }
                        this.logger.info("Following completed.");
                    }
                    clearInterval(this.followIntervalHandler);
                    this.followIntervalHandler = null;
                    break;
    
                default: throw new Error(`Invalid mode ${mode}`);
            }   
             
        } else{
            if(strict) throw new Error(`Already stopped (mode ${this.mode})`);
        }

        this.logger.debug("Finished: obsevationManager.stop()");
    }

    deleteCache(){
        for(const eventInstance of Object.values(this.eventInstances)){
            eventInstance.deleteCache();
        }
    }

    async dump({endTick=null, stop=false, overwrite=false}={}){
        this.logger.debug("Calling: obsevationManager.dump()");

        let shouldResume = false;
        if(endTick !== null){
            if(this.mode === "observe"){
                throw new Error(`endTick for dump() is only for follow mode.`);
            }
            if(this.isSchedulerActive){
                while(this.isSchedulerActive){
                    this.logger.info(`Waiting for following completed (now ${this.globalTick} < target ${this.stopFollowTick})...`)
                    await this.bot.waitForTicks(10);
                }
                this.logger.info("following completed.");
            }
            if(endTick !== this.globalTick){
                throw new Error(`endTick (${endTick}) != globalTick (${this.globalTick})`);
            }
            if(!stop){
                shouldResume = true;
            }
        } else {
            if(this.isSchedulerActive){
                await this.stop();
                if(!stop){
                    shouldResume = true;
                }
            }  
        }

        let ticks = this.observation.objective.history.sortedKeys;
        let now = -1;
        if(ticks.length){
            now = ticks.slice(-1)[0];

            fs.mkdirSync(path.join(this.branchCkptDir, ".internal"), { recursive: true });

            async function dumpToFile(self, obj, dir_, prefix, tick){
                const stateFilename = `${prefix}state#${tick}.json`
                const historyFilename = `${prefix}history#${tick}.json`

                let {tick: prevTick} = self.getNewestHistoryFileInfo(dir_, prefix);
                if(prevTick === null){
                    prevTick = -1;
                }

                if(prevTick >= tick){
                    if(overwrite){
                        fs.unlinkSync(path.join(dir_, historyFilename)); // delete latest history file
                        const {tick: tmp} = self.getNewestHistoryFileInfo(dir_, prefix);
                        prevTick = tmp;
                    } else {
                        self.logger.warn(`History File of ${prefix} at tick ${tick} already exists. Dump skipped.`);
                        return;    
                    }
                }

                const {stateJsonStr, historyJsonStr} = obj.toFormattedStrings(prevTick+1);

                const stateFilepath = path.join(dir_, stateFilename);
                fs.writeFileSync(stateFilepath, stateJsonStr);

                const historyFilepath = path.join(dir_, historyFilename);
                fs.writeFileSync(historyFilepath, historyJsonStr);
            }

            await dumpToFile(this, this.observation.objective, this.branchCkptDir, "", now);
            for(const agentName in this.observation.subjective){
                await dumpToFile(this, this.observation.subjective[agentName], path.join(this.branchCkptDir, `.internal`), `${agentName}#`, now);
            }
        }

        if(shouldResume){
            this.start();
        }
        
        this.logger.debug(`Finished: obsevationManager.dump() now=${now}`);

        return {tick:now};
    }

    async load({doInitialize=true}={}){
        this.logger.debug("Calling: obsevationManager.load()");
        if(this.isSchedulerActive){
            await this.stop();
        }
        this.childRequests = {};
        if(this.parentSimPort){
            this.historyQueueToFollow = [];
        }
        this.followModeCache = {};

        const {tick, filename} = this.getNewestStateFileInfo(this.branchCkptDir, "");
        
        this.globalTick = tick;
        this.previousObsTick = {player:null, block:null};

        const agentNameList = Object.keys(this.bot.agentInfo);

        if(this.globalTick === -1){
            const stateJsonStr = fs.readFileSync(path.join(this.branchCkptDir, filename), 'utf8');
            this.observation.objective.fromFormattedStrings(stateJsonStr);

            fs.mkdirSync(path.join(this.branchCkptDir, ".internal"), {recursive: true});

            /* initialize block state of agents */
            const blockState = this.observation.objective.getBlockMemory(this.staticBlockTypes);
            for(const agentName of agentNameList){
                this.observation.subjective[agentName] = new ObservationRecord(this.bot, this.positionMemoryMode, this.logger, agentName);
                this.observation.subjective[agentName].setBlockMemory(blockState.deepcopy());

                const {stateJsonStr} = this.observation.subjective[agentName].toFormattedStrings();
                const stateFilepath = path.join(this.branchCkptDir, `.internal\\${agentName}#state#-1.json`);
                fs.writeFileSync(stateFilepath, stateJsonStr);
            }
        } else {
            function loadFromFiles(self, dir_, prefix, obj){
                const historyJsonStrings = [];
                const fileInfoList = self.getHistoryFileInfoList(dir_, prefix);
                self.logger.debug(`History files (${fileInfoList.map(o=>o.tick)}) detected.`);

                for(const {tick, filename} of fileInfoList){
                    try{
                        const historyJsonStr = fs.readFileSync(path.join(dir_, filename), 'utf8');
                        historyJsonStrings.push(historyJsonStr);
                    } catch(e){
                        throw new Error(`File ${filename} in ${dir_} does not exist.`);
                    }
                }
                
                const mergedHistoryJsonStr = mergeSortedMapJsonStrings(historyJsonStrings);

                const {filename} = self.getNewestStateFileInfo(dir_, prefix);
                let stateJsonStr;
                try{
                    stateJsonStr = fs.readFileSync(path.join(dir_, filename), 'utf8');
                } catch(e){
                    throw new Error(`File ${filename} in ${dir_} does not exist.`);
                }
                obj.fromFormattedStrings(stateJsonStr, mergedHistoryJsonStr)
            }

            loadFromFiles(this, this.branchCkptDir, "", this.observation.objective);
            for(const agentName of agentNameList){
                this.observation.subjective[agentName] = new ObservationRecord(this.bot, this.positionMemoryMode, this.logger, agentName);
                loadFromFiles(this, path.join(this.branchCkptDir, ".internal"), `${agentName}#`, this.observation.subjective[agentName]);  
            }
        }

        if(doInitialize){
            /* blocks */
            await clearBox({bot:this.bot});
            const blockInfoList = [];
            for(const [pos, block] of this.observation.objective.memory.blocks.entries()){
                if(block.name === "air"){
                    continue;
                }
                blockInfoList.push({
                    position: pos,
                    name: block.name,
                    properties: block.properties
                })
            }
            await setBlocks({bot:this.bot, blockInfoList});

            /* containers */
            const promises = []
            let p;
            for(const [pos, items] of this.observation.objective.memory.containers.entries()){
                p = setContainer({bot:this.bot, pos, items});
                promises.push(p);
            }

            /* agents */
            this.nonExistentAgentNames = [];
            
            for(const agentName of agentNameList){
                const mcName = this.bot.agentInfo[agentName].mcName;
                const agentStatus = this.observation.objective.memory.status[agentName];

                /* position */
                if(agentStatus?.visible.position){
                    const position = agentStatus.visible.position;
                    const pitch = agentStatus.visible.pitch;
                    const yaw = agentStatus.visible.yaw;
                    try{
                        p = teleport({bot:this.bot, mcNameToTeleport: mcName, position, pitch, yaw})
                    }catch(e){
                        this.logger.error(`Failed to teleport ${agentName}. Check that admin and the agent are not too distant.`);
                    }
                    promises.push(p);

                    disableTransparency({bot:this.bot, agentName})
                } else {
                    enableTransparency({bot:this.bot, agentName})
                    this.nonExistentAgentNames.push(agentName);
                }

                await setInventoryAndEquipment({
                    bot: this.bot,
                    agentName,
                    inventory: agentStatus?.hidden?.inventory,
                    equipment: agentStatus?.visible.equipment,
                });

                /*
                await setInventory({
                    bot: this.bot, 
                    agentName, 
                    inventory: {},
                    clear: true,
                });


                let mainhandItem = null;
                if(agentStatus?.visible.equipment){
                    mainhandItem = await setEquipment({
                        bot: this.bot, 
                        agentName, 
                        equipment:agentStatus.visible.equipment,
                        clear: false,
                        mainhand: true,
                    })
                }

                let inventory;
                if(agentStatus?.hidden?.inventory){
                    inventory = agentStatus.hidden.inventory;
                } else {
                    inventory = {};
                }
                await setInventory({
                    bot: this.bot, 
                    agentName, 
                    inventory: inventory,
                    clear: false,
                    mainhandItem: mainhandItem,
                });
                */
            }
            for(const p of promises){
                await p;
            }
        }

        this.logger.debug("Finished: obsevationManager.load()");
    }

    _getObsFileInfo(dir_, prefix, type, mode){
        const files = fs.readdirSync(dir_);
        const regex = new RegExp(`^${prefix}${type}#(-?\\d+)\\.json$`);
        const result = files
            .map(file => {
                const match = file.match(regex);
                if (!match) {
                    return null;
                }
                return {
                    filename: file,
                    tick: parseInt(match[1], 10)
                };
            })
            .filter(item => item !== null)
            .sort((a, b) => a.tick - b.tick)

        if(result.length === 0 && mode !== "list"){
            return {filename: null, tick: null};
        }

        switch(mode){
            case "list": return result; // [{filename, tick}, ...]
            case "new": return result.slice(-1)[0]; // {filename, tick}
            case "old": return result[0]; // {filename, tick}
        }
    }

    getStateFileInfoList(dir_, prefix){
        return this._getObsFileInfo(dir_, prefix, "state", "list");
    }

    getNewestStateFileInfo(dir_, prefix){
        return this._getObsFileInfo(dir_, prefix, "state", "new");
    }

    getOldestStateFileInfo(dir_, prefix){
        return this._getObsFileInfo(dir_, prefix, "state", "old");
    }

    getHistoryFileInfoList(dir_, prefix){
        return this._getObsFileInfo(dir_, prefix, "history", "list");
    }

    getNewestHistoryFileInfo(dir_, prefix){
        return this._getObsFileInfo(dir_, prefix, "history", "new");
    }

    getOldestHistoryFileInfo(dir_, prefix){
        return this._getObsFileInfo(dir_, prefix, "history", "old");
    }

    onStuck(posThreshold) {
        const currentPos = this.bot.entity.position;
        this.stuckPosList.push(currentPos);

        // Check if the list is full
        if (this.stuckPosList.length === 5) {
            const oldestPos = this.stuckPosList[0];
            const posDifference = currentPos.distanceTo(oldestPos);

            if (posDifference < posThreshold) {
                const blocks = this.bot.findBlocks({
                    matching: (block) => {
                        return block.type === 0;
                    },
                    maxDistance: 1,
                    count: 27,
                });
        
                if (blocks) {
                    // console.log(blocks.length);
                    const randomIndex = Math.floor(Math.random() * blocks.length);
                    const block = blocks[randomIndex];
                    bot.chat(`/tp @s ${block.x} ${block.y} ${block.z}`);
                } else {
                    bot.chat("/tp @s ~ ~1.25 ~");
                }
            }

            // Remove the oldest time from the list
            bot.stuckPosList.shift();
        }
    }

    async observe(force=false){
        const globalTick = ++this.globalTick;

        if (this.bot.pathfinder.isMoving()) {
            this.stuckTickCounter++;
            if (this.stuckTickCounter >= 100) {
                this.onStuck(1.5);
                this.stuckTickCounter = 0;
            }
        }

        let skipObservation = false;
        await lock.acquire("isObserving", () => {
            if(this.isObserving){
                skipObservation = true;
            }
            this.isObserving = true;
        });
        if(skipObservation){
            this.logger.trace(`observe(): skip observation because observation process has already been running (tick=${globalTick})`)
            return;  
        } 

        let playerPositions = {}
        let status;
        if(force || this.previousObsTick.player === null || globalTick - this.previousObsTick.player >= this.playerObsInterval){
            status = getStatus(this.bot);
            
            for(const agentName in status){
                const pos = status[agentName].visible.position;
                if(hasVec3NaN(pos)){
                    this.logger.warn(`${agentName}'s position is NaN. observation skipped. ${JSON.stringify(status)}`);
                    skipObservation = true;
                }
                playerPositions[agentName] = pos;
            }

            this.previousObsTick.player = globalTick;
        } else {
            skipObservation = true;
        }

        if(!skipObservation){
            let doBlockObs = false;
            if(force || this.previousObsTick.block === null || globalTick - this.previousObsTick.block >= this.blockObsInterval){
                doBlockObs = true;
                this.previousObsTick.block = globalTick;
            }
        
            let events = [];

            for(const eventInstance of Object.values(this.eventInstances)){
                if(eventInstance.obsType === "block" && !doBlockObs){
                    continue;
                }
                const specificEvents = eventInstance.get();
                events = events.concat(specificEvents);
            }

            if(events.length){
                this.logger.info(`${events.length} event(s) detected`);
                for(const e of events){
                    this.logger.trace(`detected event: ${dumpToJson(e)}`);
                }
            }

            let blocksToUpdate = [];
            for(const e of events){
                if(e.eventName === "blockUpdate"){
                    blocksToUpdate.push({
                        position: e.blockPos,
                        name: e.visible.name,
                        properties: e.visible.properties
                    });
                }
            }
            if(this.blockOverwriteQueue.length){
                await lock.acquire("blockOverwrite", () => {
                    blocksToUpdate = blocksToUpdate.concat(this.blockOverwriteQueue);
                    this.blockOverwriteQueue = [];
                });
            }
            this.observation.objective.addHistoryObjective(globalTick, status, events, blocksToUpdate);

            const playerVisibility = await getPlayerVisibility(this.bot, playerPositions, this.nonExistentAgentNames);
            let blockVisibility = null;
            if(doBlockObs){
                const startTime = performance.now();
                blockVisibility = await getBlockVisibility(this.bot, playerPositions, this.observation.objective.memory.blocks, this.mcData, this.nonExistentAgentNames, this.maxVisibleDistance, this.useLegacyBlockVis);
                const elapsedTime = Math.round(performance.now() - startTime);
                if(elapsedTime > this.blockObsInterval*50){
                    this.logger.warn(`Getting visible blocks took ${elapsedTime} ms while block observation interval is set ${this.blockObsInterval*50} ms. Consider increasing the interval.`);
                }
                this.logger.trace(`Getting visible blocks took ${elapsedTime} ms.`)
            }

            // generate subjective information
            for(const seeAgentName in status){
                if(this.observation.subjective[seeAgentName] === undefined){
                    this.observation.subjective[seeAgentName] = new ObservationRecord(this.bot, this.positionMemoryMode, this.logger, seeAgentName);
                }
                const blockVisibilityFromAgent = blockVisibility ? blockVisibility[seeAgentName] : null;
                const filteredStatus = this.filterStatus(status, seeAgentName, playerVisibility[seeAgentName]);
                const filteredEvents = this.filterEvents(events, seeAgentName, playerVisibility[seeAgentName], blockVisibilityFromAgent);
                this.observation.subjective[seeAgentName].addHistorySubjective(globalTick, filteredStatus, filteredEvents, playerVisibility[seeAgentName], blockVisibilityFromAgent, this.observation.objective.memory.blocks)
            }

            this.logger.trace(`observe(): observation is done (tick=${globalTick})`);
        } else {
            this.logger.trace(`observe(): observation is skipped (tick=${globalTick})`);
        }

        await lock.acquire("isObserving", () => {
            this.isObserving = false;
        });
    }

    addChildSimPort(agentName, port){
        this.childSimPorts[agentName] = port;
        this.childRequests[agentName] = null;
    }

    removeChildSimPort(agentName){
        delete this.childSimPorts[agentName];
        delete this.childRequests[agentName];
    }

    addRequestFromChild(agentName, args){
        this.childRequests[agentName] = {received: args};
    }

    clearRequest(agentName){
        this.childRequests[agentName] = null;
        this.childSimPorts[agentName].postMessage({respondFor: "fetch_cancel", data:{message:"success"}});
    }

    sendDataToChildSim(){
        if(this.isSending){
            return;
        }
        this.isSending = true;

        for(const agentName in this.childRequests){
            if(this.childRequests[agentName] === null){
                continue;
            }

            const args = this.childRequests[agentName].received;
            const prevTick = args.prevTick;
            if(prevTick === undefined){
                throw new Error(`Specify prevTick. args=${JSON.stringify(args)}`);
            }

            const ticks = this.observation.subjective[agentName].getTicksInRange(prevTick+1, this.globalTick);
            this.logger.trace(`agentname=${agentName} startTick=${prevTick+1}, now=${this.globalTick}. ticks.length=${ticks.length}, ${ticks.length ? `ticks=[${ticks[0]}...${ticks.slice(-1)[0]}]` : ""}`)
            if(ticks.length === 0){
                continue;
            }
            
            const data = [];
            for(const t of ticks){
                const historyAtT = this.observation.subjective[agentName].getHistory(t);
                const historyJsonStr = dumpToJson(historyAtT);
                const visibilityFromOthers = {};
                for(const otherAgentName of Object.keys(this.observation.subjective)){
                    if(agentName === otherAgentName){
                        continue;
                    }
                    const otherHistoryAtT = this.observation.subjective[otherAgentName].getHistory(t);
                    visibilityFromOthers[otherAgentName] = otherHistoryAtT.visibility;
                }
                const visOthersJsonStr = dumpToJson(visibilityFromOthers);
    
                data.push({tick: t, historyJsonStr, visOthersJsonStr});
            }
    
            this.childRequests[agentName] = null;
            this.childSimPorts[agentName].postMessage({respondFor: "fetch", data});
    
        }
        this.isSending = false;
    }

    requestDataToParent(prevTick){
        const msg = { command: "fetch", args:{prevTick}};
        this.logger.trace(`requestDataToParent ${JSON.stringify(msg)}`);
        this.parentSimPort.postMessage(msg);
    }

    cancelRequestToParent(){
        const msg = { command: "fetch_cancel"};
        this.logger.trace(`cancelRequestToParent ${JSON.stringify(msg)}`);
        this.parentSimPort.postMessage(msg);
    }

    receiveFromParent({respondFor, data}){
        switch(respondFor){
            case "fetch":
                if(data === undefined){
                    throw new Error("data is undefined.");
                }

                let lastTick;
                if(data.length !== 0){
                    lastTick = data.slice(-1)[0].tick;
                    if(lastTick === undefined){
                        throw new Error("lastTick is undefined.")
                    }
                    this.historyQueueToFollow.push(...data);
                } else {
                    lastTick = this.globalTick;
                }
                
                // request new data
                if(this.mode === "follow" && this.isSchedulerActive){
                    this.requestDataToParent(lastTick);
                }
                break;

            case "fetch_cancel":
                this.replyFromParent[respondFor] = data;
                break;

            default:
                throw new Error(`Invalid value of respondFor "${respondFor}".`);
        }
    }
    
    async follow(){
        if(this.isFollowing){
            return;
        }
        this.isFollowing = true;

        if(this.stopFollowTick !== null){
            if(this.stopFollowTick < this.globalTick){
                throw new Error(`Already passed the stopFollowTick ${this.stopFollowTick} (now ${this.globalTick})`)
            }
            if(this.stopFollowTick === this.globalTick){
                await this.stop({force:true});
                
                this.cancelRequestToParent();
                while(!this.replyFromParent.fetch_cancel){
                    this.logger.info(`Waiting for canceling the request...`);
                    await this.bot.waitForTicks(10);
                }
                this.logger.info(`Request is successfully canceled. ${JSON.stringify(this.replyFromParent.fetch_cancel)}`)
                delete this.replyFromParent.fetch_cancel;
                
                this.historyQueueToFollow = [];
                this.stopFollowTick = null;
                this.isFollowing = false;
                return;
            }
        }

        const length = this.historyQueueToFollow.length;
        if(length !== 0){
            for(let i = 0; i < length; i++){

                if(this.stopFollowTick !== null){
                    if(this.stopFollowTick < this.globalTick){
                        throw new Error(`Already passed the stopFollowTick ${this.stopFollowTick} (now ${this.globalTick})`)
                    }
                    if(this.stopFollowTick === this.globalTick){
                        await this.stop({force:true});
                        this.stopFollowTick = null;
                        this.isFollowing = false;
                        return;
                    }
                }

                const tmp = this.historyQueueToFollow.shift();
                if(!tmp){
                    break;
                }
                const tick = tmp.tick;
                const historyJsonStr = tmp.historyJsonStr;
                const visOthersJsonStr = tmp.visOthersJsonStr;

                const historyAtT = loadFromJson(historyJsonStr);
                const visibilityFromOthers = loadFromJson(visOthersJsonStr);

                if(tick <= this.globalTick){
                    this.logger.error(`Past data was fetched. fetched data t=${tick}, now t=${this.globalTick}. skipped.`);
                    continue;
                }

                let blocksToUpdate = historyAtT.updatedBlocks;
                if(this.blockOverwriteQueue.length){
                    await lock.acquire("blockOverwrite", () => {
                        blocksToUpdate = blocksToUpdate.concat(this.blockOverwriteQueue);
                        this.blockOverwriteQueue = [];
                    });
                }
                
                // objective state update
                this.observation.objective.addHistoryObjective(tick, historyAtT.status, historyAtT.events, blocksToUpdate, historyAtT.visibility);

                // reflect to the environment
                const setBlocksPromise = setBlocks({
                    bot: this.bot,
                    blockInfoList: blocksToUpdate,
                    leaf_persistent: true
                });
                const promises = []
                let p;
                if(i === length - 1){
                    const agentState = this.observation.objective.memory.status;
                    for(const agentName in agentState){
                        /* position */
                        if(agentState[agentName].visible.position){
                            if(this.nonExistentAgentNames.includes(agentName)){
                                this.nonExistentAgentNames = this.nonExistentAgentNames.filter(e => e!==agentName);
                                disableTransparency({bot:this.bot, agentName});
                            }
                            try{
                                p = teleport({
                                    bot: this.bot,
                                    mcNameToTeleport: this.bot.agentInfo[agentName].mcName,
                                    position: agentState[agentName].visible.position,
                                    yaw: agentState[agentName].visible.yaw,
                                    pitch: agentState[agentName].visible.pitch,
                                    timeout: 1,
                                    teleportOffset: new Vec3(0,0,0),
                                    ignoreFailure: true,
                                })
                                promises.push(p);
                            }catch(e){
                                this.logger.error(`Failed to teleport ${agentName}. Check that admin and the agent are not too distant.`);
                            }
                            
                        } else {
                            enableTransparency({bot:this.bot, agentName});
                            if(!this.nonExistentAgentNames.includes(agentName)){
                                this.nonExistentAgentNames.push(agentName);
                                //enableTransparency({bot:this.bot, agentName});
                            }
                        }

                        const equipment = agentState[agentName]?.visible.equipment;
                        if(equipment){
                            await setEquipment({
                                bot: this.bot,
                                agentName,
                                equipment,
                                clear: false,
                                mainhand: true,
                            });
                        }

                        /*
                        if(!this.followModeCache[agentName] || 
                            (!this.followModeCache[agentName].equipment && agentState[agentName].visible.equipment) ||
                            this.followModeCache[agentName].equipment[4] !== agentState[agentName].visible.equipment[4]){
                            // if no cache or first equipment data or mainhand updated
                            await setInventoryAndEquipment({
                                bot: this.bot,
                                agentName,
                                inventory: agentState[agentName].hidden?.inventory,
                                equipment: agentState[agentName].visible.equipment,
                            });
                        } else {
                            const mcName = this.bot.agentInfo[agentName].mcName;
                            // inventory 
                            const inventory = agentState[agentName].hidden?.inventory;
                            if(inventory){
                                for(const [name, count] of Object.entries(inventory)){
                                    const cacheCount = this.followModeCache[agentName].inventory[name]
                                    if(count !== cacheCount){
                                        if(!cacheCount){
                                            this.bot.chat(`/give ${mcName} ${name} ${count}`);
                                        } else if(count > cacheCount){
                                            this.bot.chat(`/give ${mcName} ${name} ${count - cacheCount}`);
                                        } else {
                                            this.bot.chat(`/clear ${mcName} ${name} ${cacheCount - count}`);
                                        }
                                        await this.bot.waitForTicks(1);
                                    }
                                }
                                // deleted items 
                                for(const [name, count] of Object.entries(this.followModeCache[agentName].inventory)){
                                    if(!inventory[name]){
                                        this.bot.chat(`/clear ${mcName} ${name}`);
                                        await this.bot.waitForTicks(1);
                                    }
                                }
                            }

                            // equipment 
                            const parts = ["armor.head", "armor.chest", "armor.legs", "armor.feet", "weapon.mainhand", "weapon.offhand"];
                            for(let i = 0; i < 6; i++){
                                if(i === 4){
                                    continue;
                                }
                                let item = agentState[agentName].visible.equipment[i];
                                if(item !== this.followModeCache[agentName].equipment[i]){
                                    if(!item){
                                        item = "air";
                                    }
                                    this.bot.chat(`/item replace entity ${mcName} ${parts[i]} with ${item}`);
                                    await this.bot.waitForTicks(1);
                                }
                            }

                        }

                        this.followModeCache[agentName] = {
                            inventory: agentState[agentName].hidden?.inventory,
                            equipment: agentState[agentName].visible.equipment,
                        };
                        */
                    }
                }

                // TODO: raycasting to get visibility in this environment, not using visibilityFromOthers
                await setBlocksPromise;

                // subjective history/state update
                for(const agentName in this.bot.agentInfo){
                    let playerVisibilityFromAgent;
                    let blockVisibilityFromAgent;
                    if(visibilityFromOthers[agentName]){
                        playerVisibilityFromAgent = visibilityFromOthers[agentName].players;
                        blockVisibilityFromAgent = visibilityFromOthers[agentName].blocks;
                    } else {
                        playerVisibilityFromAgent = historyAtT.visibility.players;
                        blockVisibilityFromAgent = historyAtT.visibility.blocks;
                    }

                    const filteredStatus = this.filterStatus(historyAtT.status, agentName, playerVisibilityFromAgent);
                    const filteredEvents = this.filterEvents(historyAtT.events, agentName, playerVisibilityFromAgent, blockVisibilityFromAgent);
                    this.observation.subjective[agentName].addHistorySubjective(tick, filteredStatus, filteredEvents, playerVisibilityFromAgent, blockVisibilityFromAgent, this.observation.objective.memory.blocks);
                }

                for(const p of promises){
                    await p;
                }
                
                this.globalTick = tick;
            }

            this.logger.trace(`Follow process until tick ${this.globalTick} done (queue length=${length})`);
        }

        this.isFollowing = false;
    }

    filterStatus(status, seeAgentName, playerVisibilityFromAgent){
        const filteredStatus = {};
        for(const sawAgentName in status){
            if(seeAgentName === sawAgentName){
                filteredStatus[sawAgentName] = status[sawAgentName];
            } else {
                if(playerVisibilityFromAgent[sawAgentName]){
                    const s = cloneObj(status[sawAgentName]);
                    delete s.hidden;
                    filteredStatus[sawAgentName] = s;
                } else {
                    if(this.disablePositionFiltering){
                        const v = status[sawAgentName].visible;
                        filteredStatus[sawAgentName] = {
                            visible: {
                                position: cloneObj(v.position),
                                velocity: cloneObj(v.velocity),
                                yaw: v.yaw,
                                pitch: v.pitch,
                                onGround: v.onGround,
                            }
                        }
                    }
                }
            }
        }

        return filteredStatus;
    }

    filterEvents(events, seeAgentName, playerVisibilityFromAgent, blockVisibilityFromAgent){
        let filteredEvents = [];
        for(const e of events){
            let filtered = e;

            if(e.blockPos){
                if(!blockVisibilityFromAgent.has(e.blockPos)){
                    // if the block cannot be seen, the event is not recorded.
                    continue;
                }
            }

            if(e.agentName){
                if(seeAgentName === e.agentName){
                    ;
                } else {
                    if(playerVisibilityFromAgent[e.agentName]){
                        filtered = cloneObj(filtered);
                        delete filtered.hidden;
                    } else {
                        // if the agent cannot be seen, the event is not recorded
                        continue;
                    }
                }
            }

            filteredEvents.push(filtered);
        }
        return filteredEvents;
    }

    async setStopFollowTick({tick}){
        this.stopFollowTick = tick;
    }

    async updateBranchCkptDir({branchCkptDir}){
        this.branchCkptDir = branchCkptDir;

        await this.load();
    }

    async overwriteState({blockState, containerState/*, agentState*/}){
        await this.observation.objective.overwriteState(blockState, containerState/*, agentState*/);

        let success = true;
        let errorMsg = null;
        try{
            if(blockState.length){
                const blockInfoList = [];
                for(const b of blockState){
                    const blockInfo = {
                        position: new Vec3(b.position[0], b.position[1], b.position[2]),
                        name: b.name,
                    }
                    if(b.properties){
                        blockInfo.properties = b.properties;
                    }
                    blockInfoList.push(blockInfo);
                }
                await setBlocks({
                    bot: this.bot, 
                    blockInfoList
                });

                await lock.acquire("blockOverwrite", () => {
                    this.blockOverwriteQueue = this.blockOverwriteQueue.concat(blockInfoList);
                });
            }
            for(const c of containerState){
                await setContainer({ 
                    bot: this.bot, 
                    pos: new Vec3(c.position[0], c.position[1], c.position[2]), 
                    items: c.items,
                });
            }
            /*
            for(const agentName in agentState){
                const s = agentState[agentName];
                if(s.position){
                    await teleport({
                        bot: this.bot,
                        mcNameToTeleport: this.bot.agentInfo[agentName].mcName,
                        position: new Vec3(s.position[0], s.position[1], s.position[2]),
                        pitch: s.pitch,
                        yaw: s.yaw,
                    });
        
                }
                if(s.inventory){
                    await setInventory({
                        bot: this.bot,
                        agentName,
                        inventory: s.inventory,
                        clear: true,
                    });
        
                }
                if(s.equipment){
                    await setEquipment({
                        bot: this.bot,
                        agentName,
                        equipment: s.equipment,
                        mainhand: false,
                        clear: false,
                    })
        
                }
            }
            */
            await this.dump({overwrite: true});
        } catch(e){
            success = false;
            errorMsg = e.stack;
            this.logger.error(e.stack);
        }
        return {success, errorMsg}
    }

    async close(){
        clearInterval(this.sendDataIntervalHandler, this.sendDataBound);
        await this.stop({force:true});
        this.mqChannel.close();
        this.mqConn.close();
    }
}

module.exports = { ObservationManager }