const Vec3 = require('vec3');
const { hasVec3NaN, Vec3BoolMap } = require('../utils');

async function getPlayerVisibility(bot, playerRelativePositions, blockMemory, mcData, Block, nonExistentAgentNames=[], maxDist=20, extraTransparentBlocks=[]){
    const height = new Vec3(0, bot.entity.height, 0);
    const o = bot.offsetVec3;
    const absEnvBox = [bot.envBox[0].plus(o), bot.envBox[1].plus(o)];

    let playerVisibility = {}

    for(const seeAgentName in playerRelativePositions){
        const seeAbsPos = playerRelativePositions[seeAgentName].plus(height).plus(bot.offsetVec3);
        playerVisibility[seeAgentName] = {}
        for(const sawAgentName in playerRelativePositions){
            if(seeAgentName === sawAgentName){
                continue;
            }
            if(nonExistentAgentNames.includes(seeAgentName) || nonExistentAgentNames.includes(sawAgentName)){
                playerVisibility[seeAgentName][sawAgentName] = false;
            } else {
                const sawAbsPos = playerRelativePositions[sawAgentName].plus(height).plus(bot.offsetVec3);

                const absMinX = Math.floor(Math.min(Math.max(seeAbsPos.x - maxDist, absEnvBox[0].x), absEnvBox[1].x));
                const absMaxX = Math.floor(Math.max(Math.min(seeAbsPos.x + maxDist, absEnvBox[1].x), absEnvBox[0].x));
                const absMinY = Math.floor(Math.min(Math.max(seeAbsPos.y - maxDist, absEnvBox[0].y), absEnvBox[1].y));
                const absMaxY = Math.floor(Math.max(Math.min(seeAbsPos.y + maxDist, absEnvBox[1].y), absEnvBox[0].y));
                const absMinZ = Math.floor(Math.min(Math.max(seeAbsPos.z - maxDist, absEnvBox[0].z), absEnvBox[1].z));
                const absMaxZ = Math.floor(Math.max(Math.min(seeAbsPos.z + maxDist, absEnvBox[1].z), absEnvBox[0].z));
                const size = new Vec3(absMaxX - absMinX + 1, absMaxY - absMinY + 1, absMaxZ - absMinZ + 1)

                // Build a 3D occupancy grid (`occ`) representing occluding (vision-blocking) blocks only.
                const {occ, shapeGrid} = get_occupancy_grid(blockMemory, mcData, Block, size, o, new Vec3(absMinX, absMinY, absMinZ), extraTransparentBlocks);
                playerVisibility[seeAgentName][sawAgentName] = rayVisible(seeAbsPos, sawAbsPos, new Vec3(absMinX, absMinY, absMinZ), occ, shapeGrid, size);
            }            
        }
    }
    return playerVisibility;
}

function get_occupancy_grid(blockMemory, mcData, Block, size, offset, absMin, extraTransparentBlocks=[]){
    const occ = new Uint8Array(size.x * size.y * size.z);
    const shapeGrid = new Array(size.x * size.y * size.z);

    for (const [pos, b] of blockMemory.entries()) {
        // Skip blocks with no collision (e.g., air, grass, flowers)
        if (mcData.blocksByName[b.name].boundingBox === "empty") continue;

        // Skip transparent blocks
        let transparentBlocks = ['glass', 'tinted_glass', 'glass_pane', 'barrier', 'ice'];
        transparentBlocks = transparentBlocks.concat(extraTransparentBlocks);
        if(
            transparentBlocks.includes(b.name) || 
            b.name.endsWith('_stained_glass') ||
            b.name.endsWith('_stained_glass_pane')
        ) continue;
        
        const absPos = pos.plus(offset);
        const ix = absPos.x - absMin.x;
        const iy = absPos.y - absMin.y;
        const iz = absPos.z - absMin.z;
        if (ix < 0 || ix >= size.x || iy < 0 || iy >= size.y || iz < 0 || iz >= size.z) continue;

        const idx = ix + size.x * (iy + size.y * iz);
        occ[idx] = 1;

        if(b.stateId){
            const block = Block.fromStateId(b.stateId, 0);

            const isTall = 
                block.name.endsWith('_wall') ||
                block.name.endsWith('_fence') ||
                (block.name.endsWith('_fence_gate') && !block.properties?.open);

            if(isTall && block.shapes?.length){
                shapeGrid[idx] = block.shapes.map(([xmin, ymin, zmin, xmax, ymax, zmax]) => [
                    xmin, ymin, zmin,
                    xmax, Math.min(ymax, 1),
                    zmax
                ]);
            } else {
                shapeGrid[idx] = block.shapes?.length ? block.shapes : null;
            }
        } else {
            throw new Error(`stateId is empty pos=${pos} name=${b.name}`);
        }
    }
    return {occ, shapeGrid};
}

/* playerPositions[agentName] = playerPosition (Vec3) */
async function getBlockVisibility(bot, playerRelativePositions, blockMemory, mcData, Block, nonExistentAgentNames=[], maxDist=20, useLegacyBlockVis=false, extraTransparentBlocks=[]){
    
    const agentNames = Object.keys(playerRelativePositions);
    const height = new Vec3(0, bot.entity.height, 0);
    const o = bot.offsetVec3;

    const absEnvBox = [bot.envBox[0].plus(o), bot.envBox[1].plus(o)];

    let blockVisibility = {}

    for(const agentName of agentNames){
        const playerEyeAbsPos = playerRelativePositions[agentName].plus(height).plus(o);

        const absMinX = Math.floor(Math.min(Math.max(playerEyeAbsPos.x - maxDist, absEnvBox[0].x), absEnvBox[1].x));
        const absMaxX = Math.floor(Math.max(Math.min(playerEyeAbsPos.x + maxDist, absEnvBox[1].x), absEnvBox[0].x));
        const absMinY = Math.floor(Math.min(Math.max(playerEyeAbsPos.y - maxDist, absEnvBox[0].y), absEnvBox[1].y));
        const absMaxY = Math.floor(Math.max(Math.min(playerEyeAbsPos.y + maxDist, absEnvBox[1].y), absEnvBox[0].y));
        const absMinZ = Math.floor(Math.min(Math.max(playerEyeAbsPos.z - maxDist, absEnvBox[0].z), absEnvBox[1].z));
        const absMaxZ = Math.floor(Math.max(Math.min(playerEyeAbsPos.z + maxDist, absEnvBox[1].z), absEnvBox[0].z));
        
        let visiblePositions = new Vec3BoolMap([
            new Vec3(absMinX, absMinY, absMinZ).minus(o), 
            new Vec3(absMaxX, absMaxY, absMaxZ).minus(o)
        ]);

        const size = new Vec3(absMaxX - absMinX + 1, absMaxY - absMinY + 1, absMaxZ - absMinZ + 1)

        // Build a 3D occupancy grid (`occ`) representing occluding (vision-blocking) blocks only.
        const {occ, shapeGrid} = get_occupancy_grid(blockMemory, mcData, Block, size, o, new Vec3(absMinX, absMinY, absMinZ), extraTransparentBlocks);

        if(!nonExistentAgentNames.includes(agentName)){
            for (let x = absMinX; x <= absMaxX; x++) 
            for (let y = absMinY; y <= absMaxY; y++) 
            for (let z = absMinZ; z <= absMaxZ; z++) {
                const blockAbsPos = new Vec3(x,y,z);
                if(_calc_dist(playerEyeAbsPos, blockAbsPos.plus(new Vec3(0.5,0.5,0.5))) > maxDist){
                    continue
                }

                const targetPointsOnFace = [[0.5, 0.5], [0.01, 0.01], [0.01, 0.99], [0.99, 0.01], [0.99,0.99]];
                let targetPoints = [blockAbsPos.plus(new Vec3(0.5,0.5,0.5))];
            
                // xface
                if (blockAbsPos.x > playerEyeAbsPos.x){
                    const xface = blockAbsPos;
                    for (const pOnFace of targetPointsOnFace){
                        targetPoints.push(xface.plus(new Vec3(0.01, pOnFace[0], pOnFace[1])));
                    }
                }else if (playerEyeAbsPos.x > blockAbsPos.x + 1){
                    const xface = blockAbsPos.plus(new Vec3(1,0,0));
                    for (const pOnFace of targetPointsOnFace){
                        targetPoints.push(xface.plus(new Vec3(-0.01, pOnFace[0], pOnFace[1])));
                    }
                }
            
                // yface
                if (blockAbsPos.y > playerEyeAbsPos.y){
                    const yface = blockAbsPos;
                    for (const pOnFace of targetPointsOnFace){
                        targetPoints.push(yface.plus(new Vec3(pOnFace[0], 0.01, pOnFace[1])));
                    }
                }else if (playerEyeAbsPos.y > blockAbsPos.y + 1){
                    const yface = blockAbsPos.plus(new Vec3(0,1,0));
                    for (const pOnFace of targetPointsOnFace){
                        targetPoints.push(yface.plus(new Vec3(pOnFace[0], -0.01, pOnFace[1])));
                    }
                }
            
                // zface
                if (blockAbsPos.z > playerEyeAbsPos.z){
                    const zface = blockAbsPos;
                    for (const pOnFace of targetPointsOnFace){
                        targetPoints.push(zface.plus(new Vec3(pOnFace[0], pOnFace[1], 0.01)));
                    }
                }else if (playerEyeAbsPos.z > blockAbsPos.z + 1){
                    const zface = blockAbsPos.plus(new Vec3(0,0,1));
                    for (const pOnFace of targetPointsOnFace){
                        targetPoints.push(zface.plus(new Vec3(pOnFace[0], pOnFace[1], -0.01)));
                    }
                }

                if (useLegacyBlockVis) {
                    for (const targetPoint of targetPoints){
                        let toBlockVec = targetPoint.minus(playerEyeAbsPos);
                        const maxDist = toBlockVec.norm() + 0.01
                        const direction = toBlockVec.normalize() // destructive
                        const hitBlock = bot.world.raycast(playerEyeAbsPos, direction, maxDist);
                        if (!hitBlock || hitBlock.position.distanceTo(blockAbsPos) === 0) {
                            visiblePositions.add(blockAbsPos.minus(o));
                            break;
                        }
                    }
                } else {
                    for (const targetPoint of targetPoints){
                        const isVisible = rayVisible(playerEyeAbsPos, targetPoint, new Vec3(absMinX, absMinY, absMinZ), occ, shapeGrid, size);
                        if(isVisible){
                            visiblePositions.add(blockAbsPos.minus(o));
                            break;
                        }
                    }
                }
            }
        }
        blockVisibility[agentName] = visiblePositions;
    }
    return blockVisibility;
}

function _calc_dist(vec1, vec2){
    const diff = vec2.minus(vec1);
    return Math.sqrt(Math.pow(diff.x, 2) + Math.pow(diff.y, 2) + Math.pow(diff.z, 2));
}

function rayVisible(playerPos, targetPos, origin, occ, shapeGrid, size) {
    const [ox, oy, oz] = [playerPos.x, playerPos.y, playerPos.z];
    const [tx, ty, tz] = [targetPos.x,  targetPos.y,  targetPos.z];

    let dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len === 0) return true;
    dx /= len;  dy /= len;  dz /= len;

    const invDx = dx !== 0 ? 1/dx : Infinity;
    const invDy = dy !== 0 ? 1/dy : Infinity;
    const invDz = dz !== 0 ? 1/dz : Infinity;
  
    let ix = Math.floor(ox) - origin.x;
    let iy = Math.floor(oy) - origin.y;
    let iz = Math.floor(oz) - origin.z;
    const txi = Math.floor(tx) - origin.x;
    const tyi = Math.floor(ty) - origin.y;
    const tzi = Math.floor(tz) - origin.z;
  
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
  
    const voxelX = Math.floor(ox);
    const voxelY = Math.floor(oy);
    const voxelZ = Math.floor(oz);

    const nextBoundaryX = voxelX + (stepX > 0 ? 1 : 0);
    const nextBoundaryY = voxelY + (stepY > 0 ? 1 : 0);
    const nextBoundaryZ = voxelZ + (stepZ > 0 ? 1 : 0);

    let tMaxX = dx !== 0
    ? (nextBoundaryX - ox) * invDx
    : Infinity;
    let tMaxY = dy !== 0
    ? (nextBoundaryY - oy) * invDy
    : Infinity;
    let tMaxZ = dz !== 0
    ? (nextBoundaryZ - oz) * invDz
    : Infinity;
  
    const tDeltaX = stepX * invDx;
    const tDeltaY = stepY * invDy;
    const tDeltaZ = stepZ * invDz;

    if (ix === txi && iy === tyi && iz === tzi) return true;
  
    while (true) {
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          ix += stepX; tMaxX += tDeltaX;
        } else {
          iz += stepZ; tMaxZ += tDeltaZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          iy += stepY; tMaxY += tDeltaY;
        } else {
          iz += stepZ; tMaxZ += tDeltaZ;
        }
      }
      
      if (ix < 0 || ix >= size.x || iy < 0 || iy >= size.y || iz < 0 || iz >= size.z) {
        return true;
      }
      if (ix === txi && iy === tyi && iz === tzi){
        return true;
      } 

        const idx = ix + size.x * (iy + size.y * iz);
        if (occ[idx]) {
            const shapes = shapeGrid[idx];
            if (!shapes) return false;

            const blockMin = {
                x: ix + origin.x,
                y: iy + origin.y,
                z: iz + origin.z
            };

            let blocked = false;
            for (const aabb of shapes) {
                const min = {
                    x: blockMin.x + aabb[0],
                    y: blockMin.y + aabb[1],
                    z: blockMin.z + aabb[2]
                };
                const max = {
                    x: blockMin.x + aabb[3],
                    y: blockMin.y + aabb[4],
                    z: blockMin.z + aabb[5]
                };
                if (rayIntersectsAABB(playerPos.x, playerPos.y, playerPos.z,
                                    dx, dy, dz, min, max, len)) {
                    blocked = true; 
                    break;
                }
            }
            if (blocked) 
                return false;
        }

    }
}

function rayIntersectsAABB(ox, oy, oz, dx, dy, dz, min, max, maxDist) {
    let tMin = 0, tMax = maxDist;
    // slab method
    for (const [o, d, mn, mx] of [[ox, dx, min.x, max.x],
                                    [oy, dy, min.y, max.y],
                                    [oz, dz, min.z, max.z]]) {
        if (d === 0) {
            if (o < mn || o > mx) return false;
            continue;
        }
        const t1 = (mn - o) / d;
        const t2 = (mx - o) / d;
        const tNear = Math.min(t1, t2);
        const tFar  = Math.max(t1, t2);
        tMin = Math.max(tMin, tNear);
        tMax = Math.min(tMax, tFar);
        if (tMin > tMax) return false;
    }
    return tMax >= 0 && tMin <= maxDist;
}


module.exports = { getPlayerVisibility, getBlockVisibility }