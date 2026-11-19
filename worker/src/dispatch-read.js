// Dispatch needs QA status/history metadata, not inline photo bytes. Scan the
// stored JSON chunks before parsing so a large evidence library never becomes
// several full-size JavaScript objects just to check readiness. Storage is read
// only: the signed QA evidence remains untouched.
export function readDispatchQa(sql,fallback=[]){
 const prefix='data:image/',parts=[];let seen=false,inString=false,escaped=false,probing=false,probe='',skip=false;
 for(const {value} of sql.exec('SELECT value FROM documents WHERE key=? ORDER BY part','qa-checks')){
  seen=true;let output='';
  for(let index=0;index<value.length;index++){
   const char=value[index];
   if(!inString){output+=char;if(char==='"'){inString=true;probing=true;probe='';skip=false;escaped=false;}continue;}
   if(escaped){if(!skip)output+=char;escaped=false;continue;}
   if(char==='\\'){if(probing){output+=probe;probing=false;}if(!skip)output+=char;escaped=true;continue;}
   if(char==='"'){if(probing)output+=probe;output+=char;inString=false;probing=false;skip=false;continue;}
   if(skip)continue;
   if(probing){probe+=char;if(prefix.startsWith(probe)){if(probe===prefix){skip=true;probing=false;}}else{output+=probe;probing=false;}continue;}
   output+=char;
  }
  if(output)parts.push(output);
 }
 return seen?JSON.parse(parts.join('')):fallback;
}
