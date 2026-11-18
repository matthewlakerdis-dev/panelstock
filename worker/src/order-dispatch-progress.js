import dispatchProgress from '../../order-dispatch-progress.js';
export function decorateDispatchProgress(order,panels=[],loads=[]){return {...order,dispatchProgress:dispatchProgress.progress(order,{panels,loads})};}
