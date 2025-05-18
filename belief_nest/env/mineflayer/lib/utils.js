const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const Vec3 = require('vec3');
const yaml = require('js-yaml');
const log4js = require('log4js');


function getSim(world, beliefPath){
    if(beliefPath.startsWith("/")){
        beliefPath = beliefPath.slice(1);
    }
    if(beliefPath.endsWith("/")){
        beliefPath = beliefPath.slice(0, -1)
    }
    const simArr = beliefPath.split('/')
    return _getSim(world, simArr)
}

function _getSim(sim, unresolved){
    if(unresolved.length === 0){
        return sim;
    }
    if(unresolved[0] === ""){
        return _getSim(sim, unresolved.slice(1))    
    }
    const player = sim.getPlayer(unresolved[0])
    return _getSim(player.getChildSim(), unresolved.slice(1))
}

class WorkerLogger{
    constructor(parentPort){
        this.parentPort = parentPort;
    }

    postLog(level, msg){
        this.parentPort.postMessage({type: "log", result: {level, msg}});
    }

    trace(msg){
        this.postLog("trace", msg);
    }

    debug(msg){
        this.postLog("debug", msg);
    }

    info(msg){
        this.postLog("info", msg);
    }

    warn(msg){
        this.postLog("warn", msg);
    }

    error(msg){
        this.postLog("error", msg);
    }

    fatal(msg){
        this.postLog("fatal", msg);
    }
}


class LoggingWrapper {
    constructor(target, logger) {
        return new Proxy(target, {
            get(obj, prop) {
                const original = obj[prop];
                if (typeof original === 'function') {
                    return function (...args) {
                        logger.debug(`Calling: ${prop}()`);
                        const result = original.apply(obj, args);

                        if (result instanceof Promise) {
                            return result
                                .then(res => {
                                    logger.debug(`Finished: ${prop}()`);
                                    return res;
                                })
                        }

                        logger.debug(`Finished: ${prop}()`);
                        return result;
                    };
                }
                return original;
            }
        });
    }
}

class PersistentWorker {
    constructor(workerFile, args={}, mcName, logger=null) {
        this.worker = new Worker(workerFile, args);
        this.mcName = mcName;

        this.callbacks = new Map();
        this.onExitBound = this.onExit.bind(this);
        this.nextId = 1;
        this.initialized = false;

        if(logger){
            this.parentLogger = logger;
            this.workerLogger = log4js.getLogger(`${logger.category}.botWorker`)
        } else{
            this.parentLogger = log4js.getLogger()
            this.workerLogger = log4js.getLogger()
        }

        this.worker.on('message', ({ type, id, result }) => {
            //this.parentLogger.debug(`message from worker! type=${type}, id=${id}, result=${JSON.stringify(result)}`)
            let msg;
            switch(type){
                case "log":
                    const level = result.level;
                    msg = result.msg;
                    switch(level){
                        case "trace": this.workerLogger.trace(msg); break;
                        case "debug": this.workerLogger.debug(msg); break;
                        case "info":  this.workerLogger.info(msg);  break;
                        case "warn":  this.workerLogger.warn(msg);  break;
                        case "error": this.workerLogger.error(msg); break;
                        case "fatal": this.workerLogger.fatal(msg); break;
                        default: throw Error(`Invalid logger level ${level}`);
                    }
                    break;

                case "signal": // fall through
                case "response":
                    this.parentLogger.debug(`registered callbacks=[${[...this.callbacks.keys()]}]`)
                    const callback = this.callbacks.get(id);
                    if (callback) {
                        callback.resolve(result);
                        this.callbacks.delete(id);
                    }
                    break;

                default: throw new Error(`Invalid type ${type}.`)
            }
        });

        this.worker.on('error', (err) => {
            const msg = `Uncaught Exception occurred in worker of ${this.mcName}: ${err.stack}`;
            this.workerLogger.error(msg);
            throw new Error(msg);
        });

        this.worker.on('exit', this.onExitBound);
    }

    postMessage(data, transferList=[], timeout = 0) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            const timeoutId = timeout > 0 ? setTimeout(() => {
                if (this.callbacks.has(id)) {
                    this.callbacks.get(id).reject(new Error("Timeout exceeded"));
                    this.callbacks.delete(id);
                }
            }, timeout) : null;

            this.callbacks.set(id, {
                resolve: (result) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    resolve(result);
                },
                reject: (error) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    reject(error);
                },
            });

            this.worker.postMessage({ id, data }, transferList);
        });
    }

    waitForSignal(signal, timeout = 0){
        return new Promise((resolve, reject) => {
            const timeoutId = timeout > 0 ? setTimeout(() => {
                if (this.callbacks.has(signal)) {
                    this.callbacks.get(signal).reject(new Error("Timeout exceeded"));
                    this.callbacks.delete(signal);
                }
            }, timeout*1000) : null;

            this.callbacks.set(signal, {
                resolve: (result) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    resolve(result);
                    this.parentLogger.debug(`signal "${signal}" resolved`)
                },
                reject: (error) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    reject({
                        data: { success: false },
                        errorMsg:error
                    });
                    this.parentLogger.debug(`signal "${signal}" rejected`)
                },
            });
        });
    }

    onExit(error) {
        const msg = `Worker terminated. Error code : ${error}`;
        if(this.initialized){
            this.workerLogger.error(msg);
        } else {
            this.workerLogger.warn(msg);
            for(const p of this.callbacks.values()){
                try{
                    p.reject();
                } catch(e){
                    ;
                }
            }
        }
    }

    async terminate() {
        this.worker.removeListener('exit', this.onExitBound);
        await this.worker.terminate();
        this.worker.on('exit', this.onExitBound);
    }
}

function roundVec3(vec, decimalPlaces) {
    const factor = Math.pow(10, decimalPlaces);
    return new Vec3(
      Math.round(vec.x * factor) / factor,
      Math.round(vec.y * factor) / factor,
      Math.round(vec.z * factor) / factor
    );
}

function hasVec3NaN(vec) {
    return isNaN(vec.x) || isNaN(vec.y) || isNaN(vec.z);
}

function vecArrToStr(arr){
    return `(${arr[0]},${arr[1]},${arr[2]})`;
}

function dumpToJson(obj, {argList=[], sortedMapRange=null}={}){
    return JSON.stringify(obj, (key, value) => {
        if(isVec3Map(value)){
            const entries = value.entries();
            return {
                __Vec3Map__: entries.map(([vec, v]) => ({
                    position: [vec.x, vec.y, vec.z],
                    ...v,
                })),
            };
        }
        if(isVec3BoolMap(value)){
            return {__Vec3BoolMap__: {range: value.range, base64: value.toBase64()}};
        }
        if(isVec3(value)){
            return { __Vec3__: [value.x, value.y, value.z] };
        }
        if(isSortedMap(value)){
            const obj = {};
            for(const key of value.keys()){
                if(!sortedMapRange || (sortedMapRange[0] <= key && key <= sortedMapRange[1])){
                    obj[key] = value.get(key);
                }
            }
            return { __SortedMap__: obj};
        }
        return value;
    }, ...argList);
}

function loadFromJson(jsonStr){
    return JSON.parse(jsonStr, (key, value) => {
        if (value?.__Vec3Map__) {
            const map = new Vec3Map();
            for (const item of value.__Vec3Map__) {
                if (item.position) {
                    const { position, ...rest } = item;
                    map.set(new Vec3(...position), rest);
                }
            }
            return map;
        }
        if (value?.__Vec3BoolMap__) {
            const map = new Vec3BoolMap(value.__Vec3BoolMap__.range);
            map.fromBase64(value.__Vec3BoolMap__.base64);
            return map;
        }
        if (value?.__Vec3__) {
            const [x, y, z] = value.__Vec3__;
            return new Vec3(x, y, z);
        }
        if(value?.__SortedMap__) {
            const obj = value.__SortedMap__;
            const map = new SortedMap();
            for(const [key, value] of Object.entries(obj)){
                map.set(Number(key), value);
            }
            return map;
        }
        return value;
    });
}

function dumpToYaml(obj, args) {
    args.replacer = (key, value) => {
        if(isVec3Map(value)){
            const entries = value.entries();
            return {
                __Vec3Map__: entries.map(([vec, v]) => ({
                    position: [vec.x, vec.y, vec.z],
                    ...v,
                })),
            };
        }
        if(isVec3BoolMap(value)){
            return {__Vec3BoolMap__: {range: value.range, base64: value.toBase64()}};
        }
        if(isVec3(value)){
            return { __Vec3__: [value.x, value.y, value.z] };
        }
        return value;
    };

    return yaml.dump(obj, args);
}

function loadFromYaml(yamlStr){
    const parsedYaml = yaml.load(yamlStr);

    function transform(value) {
        if (value?.__Vec3Map__) {
            const map = new Vec3Map();
            for (const item of value.__Vec3Map__) {
                if (item.position) {
                    const { position, ...rest } = item;
                    map.set(new Vec3(...position), rest);
                }
            }
            return map;
        }
        if (value?.__Vec3BoolMap__) {
            const map = new Vec3BoolMap(value.__Vec3BoolMap__.range);
            map.fromBase64(value.__Vec3BoolMap__.base64);
            return map;
        }
        if (value?.__Vec3__) {
            const [x, y, z] = value.__Vec3__;
            return new Vec3(x, y, z);
        }
        if (value && typeof value === 'object') {
            for (const key of Object.keys(value)) {
                value[key] = transform(value[key]);
            }
        }
        return value;
    }

    return transform(parsedYaml);
}

function cloneObj(obj){
    return loadFromJson(dumpToJson(obj));
}

function buildBranchCkptDir(ckptDir, parentPlayers, branchPath){
  const parts = [];

  parts.push(`world[${branchPath[0]}]`);

  for (let i = 0; i < parentPlayers.length; i++) {
    parts.push(`${parentPlayers[i].agentName}[${branchPath[i+1]}]`);
  }

  return path.join(ckptDir, ...parts);
}

class Vec3Map extends Map {
    static generateKey(vec) {
        if(!isVec3(vec)){
            throw new TypeError(`Key must be an instance of Vec3. key=${JSON.stringify(vec)}`);
        }
        return `${vec.x},${vec.y},${vec.z}`;
    }

    set(vec, value) {
        const key = Vec3Map.generateKey(vec);
        return super.set(key, value);
    }

    get(vec) {
        const key = Vec3Map.generateKey(vec);
        return super.get(key);
    }

    has(vec) {
        const key = Vec3Map.generateKey(vec);
        return super.has(key);
    }

    delete(vec) {
        const key = Vec3Map.generateKey(vec);
        return super.delete(key);
    }

    entries() {
        return Array.from(super.entries()).map(([key, value]) => {
            const [x, y, z] = key.split(',').map(Number);
            return [new Vec3(x, y, z), value];
        });
    }

    keys() {
        return Array.from(super.keys()).map(key => {
            const [x, y, z] = key.split(',').map(Number);
            return new Vec3(x, y, z);
        });
    }

    deepcopy() {
        return cloneObj(this);
    }
}

class Vec3BoolMap {
    constructor(range) {
      this.range = range;
  
      this.size = {
        x: range[1].x - range[0].x + 1,
        y: range[1].y - range[0].y + 1,
        z: range[1].z - range[0].z + 1,
      };
  
      const totalSize = this.size.x * this.size.y * this.size.z;
      this.data = new Array(totalSize).fill(false);
    }
  
    _isWithinRange(vec) {
      return (
        vec.x >= this.range[0].x && vec.x <= this.range[1].x &&
        vec.y >= this.range[0].y && vec.y <= this.range[1].y &&
        vec.z >= this.range[0].z && vec.z <= this.range[1].z
      );
    }
  
    _toIndex(vec) {
      const x = vec.x - this.range[0].x;
      const y = vec.y - this.range[0].y;
      const z = vec.z - this.range[0].z;
  
      return x + this.size.x * (y + this.size.y * z);
    }
  
    _fromIndex(index) {
      const x = index % this.size.x;
      const y = Math.floor(index / this.size.x) % this.size.y;
      const z = Math.floor(index / (this.size.x * this.size.y));
      return new Vec3(x + this.range[0].x, y + this.range[0].y, z + this.range[0].z);
    }
  
    add(vec) {
      if (!this._isWithinRange(vec)) {
        throw new Error("Vec3 is out of the specified range.");
      }
      const index = this._toIndex(vec);
      this.data[index] = true;
    }
  
    has(vec) {
      if (!this._isWithinRange(vec)) {
        return false;
      }
      const index = this._toIndex(vec);
      return this.data[index];
    }
  
    getAll() {
      return this.data
        .map((val, index) => (val ? this._fromIndex(index) : null))
        .filter(vec => vec !== null);
    }
  
    count() {
      return this.data.filter(val => val).length;
    }
  
    toBase64() {
      const binaryString = this.data.map(val => (val ? '1' : '0')).join('');
      const byteArray = new Uint8Array(
        binaryString.match(/.{1,8}/g).map(byte => parseInt(byte.padEnd(8, '0'), 2))
      );
      return Buffer.from(byteArray).toString('base64');
    }
  
    fromBase64(base64) {
      const binaryString = Array.from(Buffer.from(base64, 'base64'))
        .map(byte => byte.toString(2).padStart(8, '0'))
        .join('');
      this.data = binaryString
        .slice(0, this.size.x * this.size.y * this.size.z)
        .split('')
        .map(bit => bit === '1');
    }
}

function getChunkCornersInBox({envBox, isRelative=true, offset=null}) {
    const CHUNK_SIZE = 16;

    let absEnvBox;
    if(isRelative){
        if(!offset){ 
            throw new Error(`Specify offset when isRelative is set true.`);
        }
        absEnvBox = [envBox[0].plus(offset), envBox[1].plus(offset)];
    } else {
        absEnvBox = envBox;
    }

    let [minCoords, maxCoords] = absEnvBox;

    minCoords = minCoords.toArray();
    maxCoords = maxCoords.toArray();

    const [minX, minY, minZ] = minCoords;
    const [maxX, maxY, maxZ] = maxCoords;

    const minChunkX = Math.floor(minX / CHUNK_SIZE);
    const maxChunkX = Math.floor(maxX / CHUNK_SIZE);
    const minChunkZ = Math.floor(minZ / CHUNK_SIZE);
    const maxChunkZ = Math.floor(maxZ / CHUNK_SIZE);

    const chunks = [];
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
        for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
            const chunkMinX = chunkX * CHUNK_SIZE;
            const chunkMaxX = chunkMinX + CHUNK_SIZE - 1;
            const chunkMinZ = chunkZ * CHUNK_SIZE;
            const chunkMaxZ = chunkMinZ + CHUNK_SIZE - 1;

            chunks.push({
                minCorner: new Vec3(Math.max(chunkMinX, minX), minY, Math.max(chunkMinZ, minZ)),
                maxCorner: new Vec3(Math.min(chunkMaxX, maxX), maxY, Math.min(chunkMaxZ, maxZ)),
            });
        }
    }

    return chunks;
}

function isVec3(obj){
    if(!obj) return false;
    return (obj.constructor?.name === "Vec3")
}

function isVec3Map(obj){
    if(!obj) return false;
    return (obj.constructor?.name === "Vec3Map")
}

function isVec3BoolMap(obj){
    if(!obj) return false;
    return (obj.constructor?.name === "Vec3BoolMap")
}

function isSortedMap(obj){
    if(!obj) return false;
    return (obj.constructor?.name === "SortedMap")
}

class SortedMap {
    constructor() {
        this.map = new Map();
        this.sortedKeys = [];
    }

    _binarySearch(key, comparator) {
        let low = 0;
        let high = this.sortedKeys.length;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (comparator(this.sortedKeys[mid], key)) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return low;
    }

    set(key, value) {
        if (typeof key !== "number"){
            throw new Error(`key must be number, not ${typeof key}.`);
        }
        if (!this.map.has(key)) {
            const index = this._binarySearch(key, (current, target) => current < target);
            this.sortedKeys.splice(index, 0, key);
        }
        this.map.set(key, value);
    }

    get(key) {
        return this.map.get(key);
    }

    delete(key) {
        if (this.map.has(key)) {
            this.map.delete(key);
            const index = this._binarySearch(key, (current, target) => current < target);
            if (index < this.sortedKeys.length && this.sortedKeys[index] === key) {
                this.sortedKeys.splice(index, 1);
            }
        }
    }

    range(min, max=null, deepcopy=true) {
        const rangeMap = new SortedMap();

        if(max === null){
            max = this.sortedKeys.slice(-1)[0];
        }

        for(const key of this.rangeKeys(min, max)){
            let value = this.map.get(key);
            if(deepcopy){
                value = cloneObj(value);
            }
            rangeMap.set(key, value);
        }

        return rangeMap;
    }

    rangeKeys(min, max=null) {
        if(max === null){
            max = this.sortedKeys.slice(-1)[0];
        }

        const startIndex = this._binarySearch(min, (current, target) => current < target);
        const endIndex = this._binarySearch(max, (current, target) => current <= target);
        return this.sortedKeys.slice(startIndex, endIndex);
    }

    keys(){
        return this.sortedKeys;
    }
}

function mergeSortedMapJsonStrings(sortedMapJsonStrings){
    const strList = [];
    for(let str of sortedMapJsonStrings){
        str = str.trim().slice(1, -1)                   // remove "{" and "}"
              .trim().slice('"__SortedMap__"'.length)   // remove key
              .trim().slice(1)                          // remove ":"
              .trim().slice(1, -1);                     // remove "{" and "}"
        if(str.length === 0){
            continue;
        }
        strList.push(str);
    }
    return `{"__SortedMap__":{  ${strList.join(",")}  }}`;
}

function copyFiles(srcDir, destDir){
    const items = fs.readdirSync(srcDir);

    items.forEach(async (item) => {
        const srcPath = path.join(srcDir, item);
        const destPath = path.join(destDir, item);

        if (fs.lstatSync(srcPath).isDirectory()) {
            return;
        } 
        fs.copyFileSync(srcPath, destPath);
    });
}

/* for agentName, mcName and branchName */
function containsInvalidCharacters(str) {
    const regex = /[^a-zA-Z0-9_]/;
    return regex.test(str);
}

function getFormattedDateTime() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');

    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function handleError(err, code, programs) {
    let stack = err.stack;
    if (!stack) {
        return err;
    }
    console.log(stack);
    const final_line = stack.split("\n")[1];
    const regex = /<anonymous>:(\d+):\d+\)/;

    const programs_length = programs.split("\n").length;
    let match_line = null;
    for (const line of stack.split("\n")) {
        const match = regex.exec(line);
        if (match) {
            const line_num = parseInt(match[1]);
            if (line_num >= programs_length) {
                match_line = line_num - programs_length;
                break;
            }
        }
    }
    if (!match_line) {
        return err.message;
    }
    let f_line = final_line.match(
        /\((?<file>.*):(?<line>\d+):(?<pos>\d+)\)/
    );
    if (f_line && f_line.groups && fs.existsSync(f_line.groups.file)) {
        const { file, line, pos } = f_line.groups;
        const f = fs.readFileSync(file, "utf8").split("\n");
        // let filename = file.match(/(?<=node_modules\\)(.*)/)[1];
        let source = file + `:${line}\n${f[line - 1].trim()}\n `;

        const code_source =
            "at " +
            code.split("\n")[match_line - 1].trim() +
            " in your code";
        return source + err.message + "\n" + code_source;
    } else if (
        f_line &&
        f_line.groups &&
        f_line.groups.file.includes("<anonymous>")
    ) {
        const { file, line, pos } = f_line.groups;
        let source =
            "Your code" +
            `:${match_line}\n${code.split("\n")[match_line - 1].trim()}\n `;
        let code_source = "";
        if (line < programs_length) {
            source =
                "In your program code: " +
                programs.split("\n")[line - 1].trim() +
                "\n";
            code_source = `at line ${match_line}:${code
                .split("\n")
                [match_line - 1].trim()} in your code`;
        }
        return source + err.message + "\n" + code_source;
    }
    return err.message;
}

function isErrorMessage(msg){
    const patterns = [
        "<--[HERE]",
        "Could not set the block"
    ]
    for(const p of patterns){
        if(msg.includes(p)){
            return true;
        }
    }
    return false;
}

module.exports = { getSim, WorkerLogger, LoggingWrapper, PersistentWorker, roundVec3, hasVec3NaN, vecArrToStr, dumpToJson, loadFromJson, dumpToYaml, loadFromYaml, cloneObj, buildBranchCkptDir, Vec3Map, Vec3BoolMap, getChunkCornersInBox, isVec3, isVec3Map, isVec3BoolMap, isSortedMap, SortedMap, mergeSortedMapJsonStrings, copyFiles, containsInvalidCharacters, getFormattedDateTime, handleError, isErrorMessage }