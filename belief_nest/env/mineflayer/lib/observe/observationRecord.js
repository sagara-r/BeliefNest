const Vec3 = require('vec3');

const { dumpToJson, loadFromJson, Vec3Map, cloneObj, SortedMap, isSortedMap } = require('../utils')

class ObservationRecord{
    constructor(bot, positionMemoryMode, logger, agentName=null){
        this.bot = bot;
        this.positionMemoryMode = positionMemoryMode;
        this.logger = logger;
        if(agentName === null){
            this.type = "objective";
            this.agentName = null;
        } else{
            this.type = "subjective";
            this.agentName = agentName;
        }

        this.memory = {
            blocks: new Vec3Map(),  // blocks[_pos_] = {name: "", properties:{}}
            containers: new Vec3Map(),  //containers[_pos_] = {itemType: num}
            status: {},  // status[_agentName_] = {visible:{}, hidden:{}}
            events: {},  // events[_tick_] = []
        };
        this.history = new SortedMap();  // history[_tick_] = {events: [], status: {_agentName_:{}}, visibility: {players:{}, blocks:{}}, updatedBlocks: []}
    }

    addHistoryObjective(tick, status, events, blocksToUpdate, visibility=null){
        //this.logger.trace(`Calling: ObservationRecord.addHistoryObjective()  tick=${tick}  agentName=(objective)`);
        if(this.type === "subjective"){
            throw new Error("Cannot call addHistoryObjective because this.type===\"subjective\"");
        }

        const hasInventoryInfo = {};
        for(const agentName in status){
            if(status[agentName].hidden?.inventory){
                hasInventoryInfo[agentName] = true;
            } else {
                hasInventoryInfo[agentName] = false;
            }
        }

        // update memory
        this._updateStatusMemory(status, events, hasInventoryInfo);

        for(const b of blocksToUpdate){
            this.memory.blocks.set(b.position, {name: b.name, properties: b.properties});
        }

        this._updateContainerMemory(events, blocksToUpdate);

        if (events.length){
            this.memory.events[tick] = [];
            for(const e of events){
                this.memory.events[tick].push(e);
            }
        }

        // add history
        const historyAtT = { events, status };
        if(visibility){
            historyAtT.visibility = visibility
        }
        this.history.set(tick, historyAtT);

        //this.logger.trace(`Finished: ObservationRecord.addHistoryObjective()  tick=${tick}  agentName=(objective)`);
    }

    addHistorySubjective(tick, status, events, playerVisibilityFromAgent, blockVisibilityFromAgent=null, objectiveBlockMemory){
        //this.logger.trace(`Calling: ObservationRecord.addHistorySubjective()  tick=${tick}  agentName=${this.agentName}`);
        if(this.type === "objective"){
            throw new Error("Cannot call addHistoryObjective because this.type===\"objective\"");
        }

        // update memory
        this._updateStatusMemory(status);
        
        const updatedBlocks = [];
        if(blockVisibilityFromAgent){
            for(const visiblePos of blockVisibilityFromAgent.getAll()){
                if(objectiveBlockMemory.has(visiblePos)){
                    const objectiveMemoryBlock = objectiveBlockMemory.get(visiblePos);
                    const memoryBlock = this.memory.blocks.get(visiblePos);
                    if(JSON.stringify(objectiveMemoryBlock) !== JSON.stringify(memoryBlock)){
                        this.memory.blocks.set(visiblePos, objectiveMemoryBlock);
                        updatedBlocks.push({
                            position: visiblePos,
                            name: objectiveMemoryBlock.name,
                            properties: objectiveMemoryBlock.properties
                        });
                    }
                }
            }
        }

        this._updateContainerMemory(events, updatedBlocks);

        let visibility = {};
        visibility.players = playerVisibilityFromAgent;
        if(blockVisibilityFromAgent?.size){
            visibility.blocks = blockVisibilityFromAgent;
        }

        if (events.length){
            this.memory.events[tick] = [];
            for(const e of events){
                this.memory.events[tick].push(e);
            }
        }

        // add history
        this.history.set(tick, { events, status, visibility, updatedBlocks });

        //this.logger.trace(`Finished: ObservationRecord.addHistorySubjective()  tick=${tick}  agentName=${this.agentName}`);
    }

    _updateContainerMemory(events, updatedBlocks){
        this.logger.trace(`Calling updateContainerMemory agentName=${this.agentName || "(objective)"}`);

        /* add memory of added chests */
        for(const b of updatedBlocks){
            if(b.name === "chest" && !this.memory.containers.has(b.position)){
                this.memory.containers.set(b.position, {});
            }
        }

        /* delete memory of deleted chests */
        for(const pos of this.memory.containers.keys()){
            if(this.memory.blocks.has(pos) && this.memory.blocks.get(pos).name !== "chest"){
                this.memory.containers.delete(pos);
            }
        }

        /* update items */
        for(const e of events){
            if(!["getItemFromChest", "depositItemIntoChest"].includes(e.eventName)){
                continue;
            }

            const pos = e.visible.chestPos;
            if(!pos){
                throw new Error(`chestPos is not defined. event: ${dumpToJson(e)}`);
            }
            if(e.hidden?.chestItems){
                this.memory.containers.set(pos, e.hidden.chestItems);
            } else {
                let chestItems = {};
                if(this.memory.containers.has(pos)){
                    chestItems = this.memory.containers.get(pos);
                }
                switch(e.eventName){
                    case "getItemFromChest":
                        for(const [itemName, count] of Object.entries(e.visible.gotItems)){
                            if(!chestItems[itemName]){
                                continue;
                            }
                            if(count >= chestItems[itemName]){
                                delete chestItems[itemName];
                            } else {
                                chestItems[itemName] -= count;
                            }
                        }
                        break;
                    case "depositItemIntoChest":
                        for(const [itemName, count] of Object.entries(e.visible.depositedItems)){
                            if(chestItems[itemName]){
                                chestItems[itemName] += count;
                            } else {
                                chestItems[itemName] = count;
                            }
                        }
                        break;

                    default: throw new Error(`Invalid event name "${e.eventName}"`);
                }
                this.memory.containers.set(pos, chestItems);
            }
        }
        this.logger.debug(`Finished updateContainerMemory agentName=${this.agentName || "(objective)"}`)
    }

    _updateStatusMemory(status, events=[], hasInventoryInfo, positionMemoryMode="last_seen"){
        for(const agentName of Object.keys(this.bot.agentInfo)){
            if(status[agentName]){
                if(!this.memory.status[agentName]){
                    this.memory.status[agentName] = {visible: {}, hidden: {}};
                }
                this.memory.status[agentName].visible = cloneObj(status[agentName].visible);
                if(status[agentName].hidden){
                    this.memory.status[agentName].hidden = cloneObj(status[agentName].hidden);
                }
            } else {
                switch(this.positionMemoryMode){
                    case "last_seen": break;
                    case "current":
                        if(!this.memory.status[agentName]){
                            this.memory.status[agentName] = {visible:{}, hidden:{}};
                        }
                        this.memory.status[agentName].visible.position = null;
                        this.memory.status[agentName].visible.velocity = null;
                        this.memory.status[agentName].visible.yaw = null;
                        this.memory.status[agentName].visible.pitch = null;
                        this.memory.status[agentName].visible.onGround = null;

                        break;

                    default: throw new Error(`Invalid value of positionMemoryMode "${positionMemoryMode}"`);
                }
            }

            if(!this.memory.status[agentName].hidden){
                this.memory.status[agentName].hidden = {};
            }
            if(!this.memory.status[agentName].hidden.inventory){
                this.memory.status[agentName].hidden.inventory = {};
            }
        }

        function add(self, agentName, name, count){
            if(hasInventoryInfo[agentName]){
                return;
            }
            const inventory = self.memory.status[agentName].hidden.inventory;
            if(!inventory[name]){
                inventory[name] = 0;
            }
            inventory[name] += count;
        }

        function remove(self, agentName, name, count){
            if(hasInventoryInfo[agentName]){
                return;
            }
            const inventory = self.memory.status[agentName].hidden.inventory;
            if(!inventory[name]){
                return;
            }
            inventory[name] -= count;
            if(inventory[name] <= 0){
                delete inventory[name];
            }
        }

        for(const e of events){
            switch(e.eventName){
                case "mineBlock": 
                    add(this, e.agentName, e.visible.blockName, 1);
                    break;
                case "craftItem":
                    add(this, e.agentName, e.visible.itemName, e.visible.count);
                    for(const [name, count] of Object.entries(e.visible.consumedItems)){
                        remove(this, e.agentName, name, count);
                    } 
                    break;
                case "getItemFromChest": 
                    for(const [name, count] of Object.entries(e.visible.gotItems)){
                        add(this, e.agentName, name, count);
                    }
                    break;
                case "depositItemIntoChest":
                    for(const [name, count] of Object.entries(e.visible.depositedItems)){
                        remove(this, e.agentName, name, count);
                    } 
                    break;
                case "giveItemToOther": 
                    remove(this, e.agentName, e.visible.itemName, e.visible.count);
                    add(this, e.visible.otherAgentName, e.visible.itemName, e.visible.count);
                    break;
                default: break;
            }
        }
    }

    toFormattedStrings(startTick=0){
        this.logger.debug(`Calling: ObservationRecord.toFormattedStrings()  agentName=${this.agentName || "(objective)"}`);
        const stateJsonStr = dumpToJson(this.memory, {argList:["\t"]});
        const historyJsonStr = dumpToJson(this.history, {argList:["\t"], sortedMapRange:[startTick, Infinity]});

        this.logger.debug(`Finished: ObservationRecord.toFormattedStrings()  agentName=${this.agentName || "(objective)"}`);
        return {stateJsonStr, historyJsonStr};
    }

    fromFormattedStrings(stateJsonStr, historyJsonStr=null){
        this.logger.debug(`Calling: ObservationRecord.fromFormattedStrings()  agentName=${this.agentName || "(objective)"}`);
        this.memory = loadFromJson(stateJsonStr);
        if(this.memory.blocks?.constructor?.name !== "Vec3Map"){
            throw new Error("Memory Json file broken.");
        }
        if(this.memory.containers?.constructor?.name !== "Vec3Map"){
            throw new Error("Memory Json file broken.");
        }
        if(this.memory.status === undefined){
            throw new Error("Memory Json file broken.");
        }

        if(historyJsonStr === null){
            this.history = new SortedMap();
        } else {
            this.history = loadFromJson(historyJsonStr);
            const keys = this.history.keys()
            this.logger.debug(`History from ${keys[0]} until ${keys.slice(-1)[0]} loaded from files.`)
        }
        
        if(!isSortedMap(this.history)){
            throw new Error(`loaded history is not SortedMap.`);
        }

        this.logger.debug(`Finished: ObservationRecord.fromFormattedStrings()  agentName=${this.agentName || "(objective)"}`);
    }

    getBlockMemory(blockTypes=null){
        this.logger.trace(`Calling: ObservationRecord.getBlockMemory()  agentName=${this.agentName || "(objective)"}`);
        if(blockTypes === null){
            return this.memory.blocks.deepcopy();
        }

        const map = new Vec3Map();
        if(blockTypes.length === 0){
            return map;
        }

        for(const [pos, block] of this.memory.blocks.entries()){
            if(blockTypes.includes(block.name)){
                map.set(pos, cloneObj(block));
            }
        }

        this.logger.trace(`Finished: ObservationRecord.getBlockMemory()  agentName=${this.agentName || "(objective)"}`);
        return map;
    }

    setBlockMemory(blocks){
        this.logger.trace(`Calling: ObservationRecord.setBlockMemory()  agentName=${this.agentName || "(objective)"}`);
        this.memory.blocks = blocks;
        this.logger.trace(`Finished: ObservationRecord.setBlockMemory()  agentName=${this.agentName || "(objective)"}`);
    }

    getHistory(tick){
        return this.history.get(tick);
    }

    getTicksInRange(startTick, endTick){
        const rangeTicks = this.history.rangeKeys(startTick, endTick);

        for(let i = 0; i < rangeTicks.length-1; i++){
            if(rangeTicks[i] >= rangeTicks[i+1]){
                throw new Error(`not sorted. rangeTicks=[${rangeTicks}]`);
            }
        }
        return rangeTicks;
    }

    async overwriteState(blockState, containerState/*, agentState*/){
        this.logger.trace(`Calling: ObservationRecord.overwriteState()`);

        for(const b of blockState){
            if(b.position === undefined){
                throw new Error(`The key "position" does not exist in an element of blockState.`);
            }
            if(b.name === undefined){
                throw new Error(`The key "name" does not exist in an element of blockState.`);
            }

            const pos = new Vec3(b.position[0], b.position[1], b.position[2]);
            if(b.name === null){
                this.memory.blocks.delete(pos);
            } else {
                const block = {name: b.name};
                if(b.properties){
                    block.properties = b.properties;
                }   
                this.memory.blocks.set(pos, block)
            }
        }

        for(const c of containerState){
            if(c.position === undefined){
                throw new Error(`The key "position" does not exist in an element of containerState.`);
            }
            if(c.items === undefined){
                throw new Error(`The key "items" does not exist in an element of containerState.`);
            }

            const pos = new Vec3(c.position[0], c.position[1], c.position[2]);
            if(c.items === null){
                this.memory.containers.delete(pos);
            } else {
                this.memory.containers.set(pos, c.items);
            }
        }

        /*
        for(const agentName in agentState){
            const s = agentState[agentName];
            if(s.position){
                this.memory.status[agentName].visible.position = new Vec3(s.position[0], s.position[1], s.position[2]);
            }
            if(s.yaw){
                this.memory.status[agentName].visible.yaw = s.yaw;
            }
            if(s.pitch){
                this.memory.status[agentName].visible.pitch = s.pitch;
            }
            if(s.equipment){
                this.memory.status[agentName].visible.equipment = s.equipment;
            }
            if(s.inventory){
                this.memory.status[agentName].hidden.inventory = s.inventory;
            }
        }
        */

        this.logger.trace(`Finished: ObservationRecord.overwriteState()`);
    }
}

module.exports = ObservationRecord;