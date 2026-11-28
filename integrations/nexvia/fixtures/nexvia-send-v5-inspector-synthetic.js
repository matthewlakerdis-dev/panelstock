function(e,data){let item=data.files[0];let endpoint;
item.normalized=decodeURIComponent(item.name.replace(/\+/g,'%20')).replace(new RegExp(' ', 'g'),'_').replace(/[%]/g,'_');
item.normalized=item.normalized.replace(' - ','_');item.normalized=item.normalized.replace(/\s+/g,'_');
if(controller==='opaque-1'||controller==='opaque-2'||controller==='opaque-3'||controller==='opaque-4'||controller==='opaque-5'||controller==='opaque-6'||controller==='opaque-7'||controller==='opaque-8'||controller==='opaque-9'){endpoint='/fixture/policy/';}else{endpoint='/'+controller+'/fixture/policy/';}
if(!item.cache){$.ajax({url:endpoint,type:'GET',async:false,data:{file_name:item.name,file_size:item.size,file_type:item.type},success:function(response){item.cache=response;}});}
let form=new FormData();form.append('key',item.cache.key);form.append('policy',item.cache.policy);
form.append('x-goog-algorithm',item.cache['x-goog-algorithm']);form.append('x-goog-credential',item.cache['x-goog-credential']);
form.append('x-goog-date',item.cache['x-goog-date']);form.append('x-goog-signature',item.cache['x-goog-signature']);}