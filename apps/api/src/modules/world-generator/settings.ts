import type { AppConfig } from '../../config.js';
export function generatorSettings(config:AppConfig){
  const env=process.env;
  const positive=(key:string,fallback:number)=>{const n=Number(env[key]??fallback);return Number.isSafeInteger(n)&&n>0?n:fallback;};
  return {
    operatorEmails:config.worldGeneratorOperatorEmails??[],
    maxCells:Math.min(262144,positive('WORLD_GENERATOR_MAX_CELLS',131072)),
    timeoutMs:positive('WORLD_GENERATOR_TIMEOUT_MS',180000),
    heartbeatMs:positive('WORLD_GENERATOR_HEARTBEAT_MS',1000),
    staleMs:positive('WORLD_GENERATOR_STALE_MS',15000),
    memoryMb:positive('WORLD_GENERATOR_MEMORY_MB',768),
  };
}
