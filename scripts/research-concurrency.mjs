// One limiter instance is shared by every request in the resident service.
export class OriginLimiter {
  constructor({maximum=20,perOrigin=()=>2,maximumQueued=512}={}) {
    this.maximum=maximum;this.perOrigin=perOrigin;this.maximumQueued=maximumQueued;
    this.active=0;this.origins=new Map();this.queue=[];this.peak=0;
  }
  run(origin,deadline,execute) {
    if(this.queue.length>=this.maximumQueued)return Promise.reject(new Error('Search queue capacity exceeded; retry later'));
    return new Promise((resolve,reject)=>{
      const item={origin,deadline,execute,resolve,reject};
      const budget=Math.floor(deadline-performance.now());
      if(budget<=0){reject(new Error('Search deadline exceeded before origin dispatch'));return;}
      item.timer=setTimeout(()=>{
        const index=this.queue.indexOf(item);
        if(index>=0){this.queue.splice(index,1);reject(new Error('Search deadline exceeded in origin queue'));this.dispatch();}
      },budget);
      this.queue.push(item);this.dispatch();
    });
  }
  dispatch() {
    while(this.active<this.maximum){
      const index=this.queue.findIndex(item=>(this.origins.get(item.origin)||0)<this.perOrigin(item.origin));
      if(index<0)return;
      const item=this.queue.splice(index,1)[0];clearTimeout(item.timer);
      if(performance.now()>=item.deadline){item.reject(new Error('Search deadline exceeded before origin dispatch'));continue;}
      this.active++;this.peak=Math.max(this.peak,this.active);this.origins.set(item.origin,(this.origins.get(item.origin)||0)+1);
      Promise.resolve().then(item.execute).then(item.resolve,item.reject).finally(()=>{
        this.active--;this.origins.set(item.origin,this.origins.get(item.origin)-1);this.dispatch();
      });
    }
  }
}

export function withinDeadline(promise,deadline) {
  const budget=Math.floor(deadline-performance.now());
  if(budget<=0)return Promise.reject(new Error('Shared search deadline exceeded'));
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Shared search deadline exceeded while awaiting shared work')),budget);})]).finally(()=>clearTimeout(timer));
}
