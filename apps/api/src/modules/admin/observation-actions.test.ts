import {expect,it} from 'vitest';
import {observationCommandKind} from './observation-actions.js';
const base='/api/worlds/:worldSlug/villages/:villageId/';
it('covers command families without capturing previews, camera publications or reads',()=>{
 for(const tail of ['buildings','buildings/:buildingId/expansions','buildings/:buildingId/upgrade','garden-harvests','harvest-intents','buildings/:buildingId/harvest','features/:featureId/extractions','features/:featureId/clear','worksites','worksites/:worksiteId','population/feed','population/rest','processing','market','science','infrastructure','exploitation'])expect(observationCommandKind(base+tail),tail).toBe(tail);
 for(const tail of ['market/preview','processing/preview','infrastructure/preview','exploitation/preview','worksites/preview','events','observation/camera','observation/sources','science/expeditions'])expect(observationCommandKind(base+tail),tail).toBeNull();
 expect(observationCommandKind('/api/admin/session')).toBeNull();
});
