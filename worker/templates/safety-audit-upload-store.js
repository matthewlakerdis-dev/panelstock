// Unsent audit photos stay on this device until their server save is confirmed.
// Each operation owns its connection; no credentials are stored here.
const auditUploadStore=(()=>{
 const database='lennox-safety-audit-uploads',table='audits';
 function failure(error,message){
  if(error?.auditPhotoStorage)return error;
  const full=error?.name==='QuotaExceededError';
  const result=Error(full?'This device does not have enough space to keep the photos. Free up storage and try again.':message||'Could not access saved audit photos on this device. Keep this screen open and try again.');
  result.auditPhotoStorage=true;result.cause=error;return result;
 }
 function open(){
  return new Promise((resolve,reject)=>{
   let request,settled=false;
   const finish=(error,db)=>{if(settled){db?.close();return;}settled=true;clearTimeout(timer);if(error)reject(error);else resolve(db);};
   const timer=setTimeout(()=>finish(failure(null,'Photo storage did not open. Keep this screen open and try again.')),10000);
   try{
    if(typeof indexedDB==='undefined')throw Error('IndexedDB unavailable');
    request=indexedDB.open(database,1);
    request.onupgradeneeded=()=>{
     if(settled){try{request.transaction?.abort()}catch{}return;}
     try{if(!request.result.objectStoreNames.contains(table))request.result.createObjectStore(table)}
     catch(error){try{request.transaction?.abort()}catch{}finish(failure(error));}
    };
    request.onerror=()=>finish(failure(request.error));
    request.onblocked=()=>finish(failure(null,'Photo storage is busy. Close other Safety tabs and try again.'));
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();finish(null,db)};
   }catch(error){finish(failure(error,'Photo storage is unavailable on this device. Keep this screen open and try again.'));}
  });
 }
 async function run(operation,username,walkId,value,expectedRevision){
  if(typeof username!=='string'||!username||operation!=='list'&&(typeof walkId!=='string'||!walkId))throw failure(null,'Sign in and open the audit before saving photos on this device.');
  if(!['read','list'].includes(operation)&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER))throw failure(null,'Reopen this audit before changing photos saved on this device.');
  const db=await open();
  try{return await new Promise((resolve,reject)=>{
   let tx,request,result=null,requestError,settled=false;
   const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(failure(error));else resolve(result);};
   const abort=error=>{requestError=error;try{tx?.abort()}catch{}finish(error);};
   const timer=setTimeout(()=>{try{tx?.abort()}catch{}finish(Error('Photo storage operation timed out'));},30000);
   try{
    tx=db.transaction(table,['read','list'].includes(operation)?'readonly':'readwrite');
    tx.oncomplete=()=>finish(requestError);
    tx.onabort=()=>finish(requestError||tx.error||Error('Photo storage operation was cancelled'));
    tx.onerror=()=>{requestError=tx.error||request?.error||Error('Photo storage failed');};
    const store=tx.objectStore(table),key=[username,walkId];
    if(operation==='list'){
     result=[];request=store.openCursor();
     request.onsuccess=()=>{
      try{
       const cursor=request.result;if(!cursor)return;
       // Inspect the compound key before accessing another account's data.
       if(Array.isArray(cursor.key)&&cursor.key.length===2&&cursor.key[0]===username){
        const value=cursor.value?.value,record=value?.record;
        if(record?.createdBy===username&&record.id===cursor.key[1]&&((Array.isArray(value.uploads)&&value.uploads.length)||value.uploadPending))result.push({id:record.id,documentNo:record.documentNo||'',area:record.area||'',date:record.date||''});
       }
       cursor.continue();
      }catch(error){abort(error);}
     };
    }else{
    request=store.get(key);
    request.onsuccess=()=>{
     try{
      const current=request.result;
      if(current!==undefined&&(!current||!Number.isSafeInteger(current.revision)||current.revision<1||!Object.prototype.hasOwnProperty.call(current,'value')))throw Error('Stored audit photo state is invalid');
      if(operation==='read'){result=current??null;return;}
      if((current?.revision||0)!==expectedRevision){const error=failure(null,'Photos for this audit changed in another tab. Keep this screen open and download any pending photos before reopening the audit.');error.auditPhotoConflict=true;throw error;}
      result=operation==='write'?expectedRevision+1:true;
      request=operation==='write'?store.put({revision:result,value},key):store.delete(key);
      request.onerror=()=>{requestError=request.error||Error('Photo storage request failed');};
     }catch(error){abort(error);}
    };
    }
    request.onerror=()=>{requestError=request.error||Error('Photo storage request failed');};
   }catch(error){abort(error);}
  })}finally{db.close();}
 }
 return {list:username=>run('list',username),read:(username,walkId)=>run('read',username,walkId),write:(username,walkId,value,expectedRevision=0)=>run('write',username,walkId,value,expectedRevision),remove:(username,walkId,expectedRevision)=>run('remove',username,walkId,undefined,expectedRevision)};
})();
