import {qaAttemptPhotos,qaInspectionPhotoGallery} from './qa-photos.js';
import {qaMediaReference} from './qa-media.js';

// A queue is metadata only. Keep the stored inspection and its evidence intact.
function metadata(value){
 if(typeof value==='string')return value.startsWith('data:image/')||qaMediaReference(value)?'':value;
 if(Array.isArray(value))return value.map(metadata);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='photo'&&key!=='photos').map(([key,item])=>[key,metadata(item)]));
 return value;
}
export function qaQueueItem(item){
 const attempts=[item.latest,...(Array.isArray(item.history)?item.history:[])].filter(Boolean),additions=Array.isArray(item.photoAdditions)?item.photoAdditions:[],
   attempt=value=>value?{...metadata(value),photoCount:qaInspectionPhotoGallery(item,value).length}:value;
 return {...metadata(item),
  ...(Object.hasOwn(item,'latest')?{latest:attempt(item.latest)}:{}),
  ...(Array.isArray(item.history)?{history:item.history.map(attempt)}:{}),
  ...(Array.isArray(item.photoAdditions)?{photoAdditions:additions.map(addition=>({...metadata(addition),photoCount:qaAttemptPhotos(addition).length}))}:{}),
  evidenceLoaded:false,hasPhotoEvidence:qaAttemptPhotos(item).length>0||attempts.some(value=>qaInspectionPhotoGallery(item,value).length>0)||additions.some(value=>qaAttemptPhotos(value).length>0)
 };
}
export function qaQueueView(view){return {...metadata(view),items:view.items.map(qaQueueItem)};}
export function qaQueueMutationResponse(body){
 return {...body,...(Array.isArray(body.items)?{items:body.items.map(qaQueueItem)}:{}),...(Array.isArray(body.dispatches)?{dispatches:metadata(body.dispatches)}:{})};
}
