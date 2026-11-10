export const ORDER_LOGO_WIDTH_PT=90;
const EMU_PER_PT=12700;

// Enlarge only a landscape picture in the top-left header. Keep the original
// artwork, position and proportions; body photos and other drawings are untouched.
export function enlargeOrderHeaderLogo(source){
  return source.replace(/<((?:[\w.-]+:)?)(twoCellAnchor|oneCellAnchor)\b[^>]*>[\s\S]*?<\/\1\2>/g,(anchor,prefix,kind)=>{
    const from=anchor.match(/<(?:[\w.-]+:)?from\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?from>/)?.[0];
    if(!from)return anchor;
    const marker=name=>Number(from.match(new RegExp('<(?:[\\w.-]+:)?'+name+'>\\s*(\\d+)\\s*</(?:[\\w.-]+:)?'+name+'>'))?.[1]??Infinity);
    if(marker('col')>2||marker('row')>3||/<(?:[\w.-]+:)?(?:grpSp|graphicFrame|sp|cxnSp)\b/.test(anchor))return anchor;
    const pictures=[...anchor.matchAll(/<(?:[\w.-]+:)?pic\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?pic>/g)];
    if(pictures.length!==1)return anchor;
    const picture=pictures[0][0],transform=picture.match(/<(?:[\w.-]+:)?xfrm\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?xfrm>/)?.[0];
    const extent=transform?.match(/<(?:[\w.-]+:)?ext\b[^>]*\/>/)?.[0],offset=transform?.match(/<(?:[\w.-]+:)?off\b[^>]*\/>/)?.[0];
    const attribute=(tag,name)=>Number(tag?.match(new RegExp('\\b'+name+'\\s*=\\s*["\\x27](\\d+)["\\x27]'))?.[1]??NaN);
    const width=attribute(extent,'cx'),height=attribute(extent,'cy'),left=attribute(offset,'x'),top=attribute(offset,'y');
    if(![width,height,left,top].every(Number.isFinite)||width<=0||height<=0||left>70*EMU_PER_PT||top>25*EMU_PER_PT||width/height<1.2||width/height>6)return anchor;
    // Leave room above the Project row and before the central heading.
    const scale=Math.min(ORDER_LOGO_WIDTH_PT*EMU_PER_PT/width,46*EMU_PER_PT/height,(62*EMU_PER_PT-top)/height,(140*EMU_PER_PT-left)/width);
    if(scale<=1)return anchor;
    const cx=Math.round(width*scale),cy=Math.round(height*scale),sized=extent.replace(/\bcx\s*=\s*["'][^"']*["']/,'cx="'+cx+'"').replace(/\bcy\s*=\s*["'][^"']*["']/,'cy="'+cy+'"');
    const updated=anchor.replace(picture,picture.replace(extent,sized)),anchorExtent='<'+prefix+'ext cx="'+cx+'" cy="'+cy+'"/>';
    if(kind==='oneCellAnchor'){
      const before=updated.slice(0,pictures[0].index),ownExtent=before.match(/<(?:[\w.-]+:)?ext\b[^>]*\/>/)?.[0];
      return ownExtent?updated.replace(ownExtent,anchorExtent):anchor;
    }
    const to=updated.match(/<(?:[\w.-]+:)?to\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?to>/)?.[0];
    if(!to)return anchor;
    const opening=updated.match(/^<[^>]*>/)[0],replacement=opening.replace('twoCellAnchor','oneCellAnchor').replace(/\s+editAs\s*=\s*(?:"[^"]*"|'[^']*')/g,'');
    return updated.replace(opening,replacement).replace(to,anchorExtent).replace('</'+prefix+'twoCellAnchor>','</'+prefix+'oneCellAnchor>');
  });
}
