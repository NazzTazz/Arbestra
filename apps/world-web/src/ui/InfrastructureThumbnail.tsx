import {BuildingThumbnail} from './BuildingThumbnail';
export function InfrastructureThumbnail({code}:{code:string}) {return <BuildingThumbnail code={`infra:${code}`}/>;}